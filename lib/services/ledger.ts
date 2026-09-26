/**
 * Reglas contables automáticas. Cada captura en la app pasa por aquí, así el usuario solo
 * registra "qué pasó" y el sistema decide qué ledger se afecta:
 *
 *  - Gasto pagado con dinero PERSONAL → P&L + Aporte del propietario (ya pagado). No toca la caja.
 *  - Gasto pagado con cuenta LLC (Mercury Checking) → P&L + salida de caja.
 *  - Gasto con tarjeta LLC (Mercury IO) → P&L + cuenta por pagar, hasta pagar la tarjeta.
 *  - Ingreso cobrado en Skool → saldo de la plataforma (por cobrar). El payout a Mercury lo pasa a caja;
 *    un payout a una cuenta personal es un retiro del dueño.
 *
 * Todas las funciones reciben una transacción: o se aplica todo o nada.
 */
import { and, asc, desc, eq, gte, inArray, lte, sql, sum } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as s from "@/db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Tx = PgDatabase<PgQueryResultHKT, typeof s, any>;

type Currency = "USD" | "HNL";
type Funding = "llc_cash" | "llc_credit" | "owner_personal";
type Interval = "one_time" | "monthly" | "quarterly" | "annual";

export const FALLBACK_HNL_PER_USD = 26.86;
const INTERVAL_MONTHS: Record<Exclude<Interval, "one_time">, number> = { monthly: 1, quarterly: 3, annual: 12 };

// ── Utilidades ────────────────────────────────────────────────────────────────

export function addMonthsToDate(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Próxima fecha (≥ `from`) que cae en el día `day` del mes. */
export function nextDayOfMonth(from: string, day: number) {
  const [y, m] = from.split("-").map(Number);
  for (let i = 0; i < 2; i++) {
    const first = new Date(Date.UTC(y, m - 1 + i, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(day, last));
    const iso = first.toISOString().slice(0, 10);
    if (iso >= from) return iso;
  }
  return addMonthsToDate(from, 1);
}

/** Tasa a USD para una moneda en una fecha: la última guardada en o antes de esa fecha. */
export async function fxRateToUsd(tx: Tx, currency: Currency, date: string): Promise<string> {
  if (currency === "USD") return "1";
  const [before] = await tx
    .select({ rate: s.exchangeRates.rate })
    .from(s.exchangeRates)
    .where(and(eq(s.exchangeRates.base, "USD"), eq(s.exchangeRates.quote, "HNL"), lte(s.exchangeRates.rateDate, date)))
    .orderBy(desc(s.exchangeRates.rateDate))
    .limit(1);
  const [after] = before
    ? [undefined]
    : await tx
        .select({ rate: s.exchangeRates.rate })
        .from(s.exchangeRates)
        .where(and(eq(s.exchangeRates.base, "USD"), eq(s.exchangeRates.quote, "HNL"), gte(s.exchangeRates.rateDate, date)))
        .orderBy(asc(s.exchangeRates.rateDate))
        .limit(1);
  const hnlPerUsd = Number(before?.rate ?? after?.rate ?? FALLBACK_HNL_PER_USD);
  return (1 / hnlPerUsd).toFixed(6);
}

const toUsdCents = (cents: number, fx: string | number) => Math.round(cents * Number(fx));

/** El origen del dinero se deduce de la cuenta elegida. `null` = cuenta personal sin especificar. */
export async function fundingForAccount(tx: Tx, accountId: string | null): Promise<Funding> {
  if (!accountId) return "owner_personal";
  const [a] = await tx.select().from(s.financialAccounts).where(eq(s.financialAccounts.id, accountId));
  if (!a) throw new Error("La cuenta no existe");
  if (a.owner === "personal") return "owner_personal";
  return a.type === "credit_card" ? "llc_credit" : "llc_cash";
}

async function account(tx: Tx, id: string) {
  const [a] = await tx.select().from(s.financialAccounts).where(eq(s.financialAccounts.id, id));
  if (!a) throw new Error("La cuenta no existe");
  return a;
}

/** Fecha de pago de una tarjeta para un cargo: siguiente día de pago configurado. */
async function cardDueDate(tx: Tx, accountId: string | null, chargeDate: string) {
  if (!accountId) return null;
  const a = await account(tx, accountId);
  if (a.type !== "credit_card" || !a.paymentDueDay) return null;
  return nextDayOfMonth(addMonthsToDate(chargeDate, 1).slice(0, 8) + "01", a.paymentDueDay);
}

// ── Gastos ───────────────────────────────────────────────────────────────────

export type ExpenseInput = {
  expenseDate: string;
  description: string;
  categoryId: string;
  vendorId: string | null;
  frequency: Interval;
  currency: Currency;
  amountCents: number;
  paymentAccountId: string | null;
  status: "pending" | "paid";
  dueDate: string | null;
  paidOn: string | null;
  subscriptionId?: string | null;
  contractId?: string | null;
  debtId?: string | null;
  productId?: string | null;
  notes: string | null;
  createdBy?: string | null;
};

/** Recalcula los efectos de un gasto (aporte del dueño o salida de caja). Idempotente. */
export async function syncExpense(tx: Tx, expenseId: string) {
  await tx.delete(s.ownerLedger).where(eq(s.ownerLedger.expenseId, expenseId));
  await tx.delete(s.cashMovements).where(eq(s.cashMovements.expenseId, expenseId));

  const [e] = await tx.select().from(s.expenses).where(eq(s.expenses.id, expenseId));
  if (!e || e.status === "void") return;

  if (e.fundingSource === "owner_personal") {
    await tx.insert(s.ownerLedger).values({
      entryDate: e.expenseDate,
      type: "contribution",
      currency: e.currency,
      amountCents: e.amountCents,
      fxRateToUsd: e.fxRateToUsd,
      expenseId: e.id,
      personalAccountId: e.paymentAccountId,
      description: `Aporte: ${e.description}`,
    });
  } else if (e.fundingSource === "llc_cash" && e.status === "paid" && e.paymentAccountId) {
    await tx.insert(s.cashMovements).values({
      accountId: e.paymentAccountId,
      movementDate: e.paidOn ?? e.expenseDate,
      type: "expense_payment",
      amountCents: -e.amountCents,
      currency: e.currency,
      fxRateToUsd: e.fxRateToUsd,
      expenseId: e.id,
      description: e.description,
      createdBy: e.createdBy,
    });
  }
  // llc_credit: queda como cuenta por pagar de la tarjeta hasta `payCard`.
}

export async function saveExpense(tx: Tx, input: ExpenseInput, id?: string) {
  const fundingSource = await fundingForAccount(tx, input.paymentAccountId);
  const fx = await fxRateToUsd(tx, input.currency, input.expenseDate);
  // Lo que paga el dueño es un aporte ya hecho: la LLC no queda debiendo nada.
  const status = fundingSource === "owner_personal" ? "paid" : input.status;
  const dueDate =
    status === "paid" ? null : (input.dueDate ?? (await cardDueDate(tx, input.paymentAccountId, input.expenseDate)));
  const values = {
    ...input,
    status,
    fundingSource,
    fxRateToUsd: fx,
    dueDate,
    paidOn: status === "paid" ? (input.paidOn ?? input.expenseDate) : null,
  };

  let expenseId = id;
  if (id) {
    await tx.update(s.expenses).set({ ...values, updatedAt: new Date() }).where(eq(s.expenses.id, id));
  } else {
    const [row] = await tx.insert(s.expenses).values(values).returning({ id: s.expenses.id });
    expenseId = row.id;
  }
  await syncExpense(tx, expenseId!);
  return expenseId!;
}

export async function deleteExpense(tx: Tx, id: string) {
  await tx.delete(s.ownerLedger).where(eq(s.ownerLedger.expenseId, id));
  await tx.delete(s.cashMovements).where(eq(s.cashMovements.expenseId, id));
  await tx.delete(s.expenses).where(eq(s.expenses.id, id));
}

// ── Ingresos ─────────────────────────────────────────────────────────────────

export type RevenueInput = {
  revenueDate: string;
  productId: string | null;
  categoryId: string;
  customerName: string | null;
  billingInterval: Interval;
  serviceStart: string | null;
  currency: Currency;
  grossCents: number;
  processorFeeCents: number;
  affiliateFeeCents: number;
  status: "pending" | "available" | "paid_out" | "refunded" | "disputed";
  depositAccountId: string | null;
  memberId?: string | null;
  affiliateName?: string | null;
  notes: string | null;
  createdBy?: string | null;
};

export async function syncRevenue(tx: Tx, revenueId: string) {
  await tx.delete(s.cashMovements).where(eq(s.cashMovements.revenueId, revenueId));
  await tx.delete(s.ownerLedger).where(eq(s.ownerLedger.revenueId, revenueId));

  const [r] = await tx.select().from(s.revenues).where(eq(s.revenues.id, revenueId));
  if (!r || !r.depositAccountId || r.status === "refunded" || r.status === "disputed") return;
  const a = await account(tx, r.depositAccountId);

  if (a.owner === "llc") {
    await tx.insert(s.cashMovements).values({
      accountId: a.id,
      movementDate: r.revenueDate,
      type: "revenue_direct",
      amountCents: r.netCents,
      currency: r.currency,
      fxRateToUsd: r.fxRateToUsd,
      revenueId: r.id,
      description: "Cobro (neto de comisiones)",
      createdBy: r.createdBy,
    });
  } else {
    // Dinero de la LLC que cayó directo en una cuenta personal = retiro del dueño.
    await tx.insert(s.ownerLedger).values({
      entryDate: r.revenueDate,
      type: "draw",
      currency: r.currency,
      amountCents: r.netCents,
      fxRateToUsd: r.fxRateToUsd,
      revenueId: r.id,
      personalAccountId: a.id,
      description: "Ingreso depositado en cuenta personal",
    });
  }
}

export async function saveRevenue(tx: Tx, input: RevenueInput, id?: string) {
  const fx = await fxRateToUsd(tx, input.currency, input.revenueDate);
  const values = { ...input, fxRateToUsd: fx, serviceStart: input.billingInterval === "one_time" ? null : (input.serviceStart ?? input.revenueDate) };
  let revenueId = id;
  if (id) {
    await tx.update(s.revenues).set({ ...values, updatedAt: new Date() }).where(eq(s.revenues.id, id));
  } else {
    const [row] = await tx.insert(s.revenues).values(values).returning({ id: s.revenues.id });
    revenueId = row.id;
  }
  await syncRevenue(tx, revenueId!);
  return revenueId!;
}

export async function deleteRevenue(tx: Tx, id: string) {
  await tx.delete(s.cashMovements).where(eq(s.cashMovements.revenueId, id));
  await tx.delete(s.ownerLedger).where(eq(s.ownerLedger.revenueId, id));
  await tx.delete(s.revenues).where(eq(s.revenues.id, id));
}

// ── Tarjetas de la LLC (Mercury IO) ─────────────────────────────────────────

/**
 * Paga todos los cargos pendientes de una tarjeta LLC desde una cuenta LLC.
 * Si la tarjeta da cashback (IO: 1.5%), lo registra como "Otros ingresos" en la cuenta que pagó.
 */
export async function payCard(tx: Tx, { cardId, fromAccountId, date, userId }: { cardId: string; fromAccountId: string; date: string; userId?: string | null }) {
  const card = await account(tx, cardId);
  const from = await account(tx, fromAccountId);
  if (card.type !== "credit_card" || card.owner !== "llc") throw new Error("Solo se pagan tarjetas de la LLC");
  if (from.owner !== "llc" || from.type === "credit_card") throw new Error("Paga desde una cuenta bancaria de la LLC");

  const pending = await tx
    .select()
    .from(s.expenses)
    .where(and(eq(s.expenses.paymentAccountId, cardId), eq(s.expenses.fundingSource, "llc_credit"), eq(s.expenses.status, "pending")));
  if (pending.length === 0) return { total: 0, cashback: 0, count: 0 };

  const total = pending.reduce((acc, e) => acc + toUsdCents(e.amountCents, e.fxRateToUsd), 0);
  await tx
    .update(s.expenses)
    .set({ status: "paid", paidOn: date, updatedAt: new Date() })
    .where(inArray(s.expenses.id, pending.map((e) => e.id)));

  await tx.insert(s.cashMovements).values({
    accountId: from.id,
    movementDate: date,
    type: "card_payment",
    amountCents: -total,
    currency: "USD",
    description: `Pago ${card.name} (${pending.length} cargos)`,
    createdBy: userId ?? null,
  });

  let cashback = 0;
  const pct = Number(card.cashbackPct ?? 0);
  if (pct > 0) {
    cashback = Math.round((total * pct) / 100);
    const [other] = await tx
      .select({ id: s.categories.id })
      .from(s.categories)
      .where(and(eq(s.categories.kind, "revenue"), eq(s.categories.name, "Otros ingresos")));
    const [anyRevenue] = other ? [other] : await tx.select({ id: s.categories.id }).from(s.categories).where(eq(s.categories.kind, "revenue")).limit(1);
    if (cashback > 0 && anyRevenue) {
      await saveRevenue(tx, {
        revenueDate: date,
        productId: null,
        categoryId: anyRevenue.id,
        customerName: card.institution ?? card.name,
        billingInterval: "one_time",
        serviceStart: null,
        currency: "USD",
        grossCents: cashback,
        processorFeeCents: 0,
        affiliateFeeCents: 0,
        status: "available",
        depositAccountId: from.id,
        notes: `Cashback ${pct}% ${card.name}`,
        createdBy: userId ?? null,
      });
    }
  }
  return { total, cashback, count: pending.length };
}

// ── Suscripciones y contratos ───────────────────────────────────────────────

/** Registra el cobro de una suscripción como gasto y adelanta la próxima renovación. */
export async function chargeSubscription(tx: Tx, subscriptionId: string, { date, accountId, userId }: { date: string; accountId?: string | null; userId?: string | null }) {
  const [sub] = await tx.select().from(s.subscriptions).where(eq(s.subscriptions.id, subscriptionId));
  if (!sub) throw new Error("La suscripción no existe");
  const paymentAccountId = accountId === undefined ? sub.defaultPaymentAccountId : accountId;
  const funding = await fundingForAccount(tx, paymentAccountId);

  const expenseId = await saveExpense(tx, {
    expenseDate: date,
    description: sub.name,
    categoryId: sub.categoryId,
    vendorId: sub.vendorId,
    frequency: sub.billingInterval,
    currency: sub.currency,
    amountCents: sub.amountCents,
    paymentAccountId,
    status: funding === "llc_cash" ? "paid" : "pending",
    dueDate: null,
    paidOn: null,
    subscriptionId: sub.id,
    notes: null,
    createdBy: userId ?? null,
  });

  if (sub.billingInterval !== "one_time") {
    let next = sub.nextRenewalOn;
    const step = INTERVAL_MONTHS[sub.billingInterval];
    while (next <= date) next = addMonthsToDate(next, step);
    await tx.update(s.subscriptions).set({ nextRenewalOn: next, updatedAt: new Date() }).where(eq(s.subscriptions.id, sub.id));
  }
  return expenseId;
}

/** Paga una cuota de un contrato con proveedor. Al completar el total, el contrato se cierra solo. */
export async function payContractInstallment(
  tx: Tx,
  contractId: string,
  { date, amountCents, accountId, userId }: { date: string; amountCents: number; accountId: string | null; userId?: string | null }
) {
  const [ct] = await tx.select().from(s.vendorContracts).where(eq(s.vendorContracts.id, contractId));
  if (!ct) throw new Error("El contrato no existe");
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.expenses).where(eq(s.expenses.contractId, contractId));
  const funding = await fundingForAccount(tx, accountId);

  const expenseId = await saveExpense(tx, {
    expenseDate: date,
    description: `Cuota ${n + 1} · ${ct.name}`,
    categoryId: ct.categoryId,
    vendorId: ct.vendorId,
    frequency: "one_time",
    currency: ct.currency,
    amountCents,
    paymentAccountId: accountId,
    status: funding === "llc_cash" ? "paid" : "pending",
    dueDate: null,
    paidOn: null,
    contractId: ct.id,
    notes: null,
    createdBy: userId ?? null,
  });

  const [{ paid }] = await tx.select({ paid: sum(s.expenses.amountCents) }).from(s.expenses).where(eq(s.expenses.contractId, contractId));
  if (Number(paid ?? 0) >= ct.totalCents) {
    await tx.update(s.vendorContracts).set({ status: "completed", updatedAt: new Date() }).where(eq(s.vendorContracts.id, contractId));
  }
  return expenseId;
}

// ── Deudas ──────────────────────────────────────────────────────────────────

export async function recordDebtPayment(
  tx: Tx,
  debtId: string,
  p: { date: string; principalCents: number; interestCents: number; feeCents: number; accountId: string | null; userId?: string | null }
) {
  const [debt] = await tx.select().from(s.debts).where(eq(s.debts.id, debtId));
  if (!debt) throw new Error("La deuda no existe");
  const funding = await fundingForAccount(tx, p.accountId);
  const total = p.principalCents + p.interestCents + p.feeCents;

  const [payment] = await tx
    .insert(s.debtPayments)
    .values({
      debtId,
      dueDate: p.date,
      paidOn: p.date,
      principalCents: p.principalCents,
      interestCents: p.interestCents,
      feeCents: p.feeCents,
      fundingSource: funding,
    })
    .returning();

  if (funding === "owner_personal") {
    await tx.insert(s.ownerLedger).values({
      entryDate: p.date,
      type: "contribution",
      currency: debt.currency,
      amountCents: total,
      debtPaymentId: payment.id,
      personalAccountId: p.accountId,
      description: `Aporte: pago de ${debt.name}`,
    });
  } else if (p.accountId) {
    await tx.insert(s.cashMovements).values({
      accountId: p.accountId,
      movementDate: p.date,
      type: "debt_payment",
      amountCents: -total,
      currency: debt.currency,
      debtPaymentId: payment.id,
      description: `Pago ${debt.name}`,
      createdBy: p.userId ?? null,
    });
  }

  const [{ paid }] = await tx
    .select({ paid: sum(s.debtPayments.principalCents) })
    .from(s.debtPayments)
    .where(and(eq(s.debtPayments.debtId, debtId), sql`${s.debtPayments.paidOn} is not null`));
  if (Number(paid ?? 0) >= debt.principalCents) {
    await tx.update(s.debts).set({ status: "paid_off", updatedAt: new Date() }).where(eq(s.debts.id, debtId));
  }
  return payment.id;
}

export async function deleteDebtPayment(tx: Tx, paymentId: string) {
  await tx.delete(s.cashMovements).where(eq(s.cashMovements.debtPaymentId, paymentId));
  await tx.delete(s.ownerLedger).where(eq(s.ownerLedger.debtPaymentId, paymentId));
  const [p] = await tx.delete(s.debtPayments).where(eq(s.debtPayments.id, paymentId)).returning();
  if (p) await tx.update(s.debts).set({ status: "active" }).where(and(eq(s.debts.id, p.debtId), eq(s.debts.status, "paid_off")));
}

// ── Propietario ─────────────────────────────────────────────────────────────

const OWNER_CASH_TYPE = {
  contribution: { type: "owner_contribution", sign: 1 },
  loan: { type: "owner_contribution", sign: 1 },
  draw: { type: "owner_draw", sign: -1 },
  reimbursement: { type: "owner_reimbursement", sign: -1 },
} as const;

/** Movimiento directo del dueño (depósito a la LLC, retiro, préstamo, reembolso). */
export async function recordOwnerEntry(
  tx: Tx,
  e: {
    type: "contribution" | "loan" | "reimbursement" | "draw";
    date: string;
    currency: Currency;
    amountCents: number;
    llcAccountId: string | null;
    description: string;
    userId?: string | null;
  }
) {
  const fx = await fxRateToUsd(tx, e.currency, e.date);
  const [row] = await tx
    .insert(s.ownerLedger)
    .values({ entryDate: e.date, type: e.type, currency: e.currency, amountCents: e.amountCents, fxRateToUsd: fx, description: e.description, createdBy: e.userId ?? null })
    .returning();
  if (e.llcAccountId) {
    const map = OWNER_CASH_TYPE[e.type];
    await tx.insert(s.cashMovements).values({
      accountId: e.llcAccountId,
      movementDate: e.date,
      type: map.type,
      amountCents: map.sign * e.amountCents,
      currency: e.currency,
      fxRateToUsd: fx,
      ownerLedgerId: row.id,
      description: e.description,
      createdBy: e.userId ?? null,
    });
  }
  return row.id;
}

/** Borra una entrada del dueño. Las que nacen de un gasto/ingreso se editan desde ese registro. */
export async function deleteOwnerEntry(tx: Tx, id: string) {
  const [row] = await tx.select().from(s.ownerLedger).where(eq(s.ownerLedger.id, id));
  if (!row) return;
  if (row.expenseId || row.revenueId || row.debtPaymentId) throw new Error("Esta entrada se generó desde otro registro; edítala desde ahí.");
  await tx.delete(s.cashMovements).where(eq(s.cashMovements.ownerLedgerId, id));
  await tx.delete(s.ownerLedger).where(eq(s.ownerLedger.id, id));
}

// ── Cuentas: transferencias, ajustes, conciliación ─────────────────────────

export async function transfer(tx: Tx, t: { fromId: string; toId: string; date: string; amountCents: number; description: string | null; userId?: string | null }) {
  const group = crypto.randomUUID();
  const [from, to] = [await account(tx, t.fromId), await account(tx, t.toId)];
  await tx.insert(s.cashMovements).values([
    { accountId: from.id, movementDate: t.date, type: "transfer", amountCents: -t.amountCents, currency: from.currency, transferGroupId: group, description: t.description ?? `A ${to.name}`, createdBy: t.userId ?? null },
    { accountId: to.id, movementDate: t.date, type: "transfer", amountCents: t.amountCents, currency: to.currency, transferGroupId: group, description: t.description ?? `Desde ${from.name}`, createdBy: t.userId ?? null },
  ]);
  return group;
}

export async function accountBalanceCents(tx: Tx, accountId: string, upTo: string) {
  const a = await account(tx, accountId);
  const [{ total }] = await tx
    .select({ total: sum(s.cashMovements.amountCents) })
    .from(s.cashMovements)
    .where(and(eq(s.cashMovements.accountId, accountId), lte(s.cashMovements.movementDate, upTo)));
  return a.openingBalanceCents + Number(total ?? 0);
}

/** Compara el saldo del banco con el del sistema y, si difieren, registra un ajuste. */
export async function reconcile(tx: Tx, r: { accountId: string; date: string; statementBalanceCents: number; userId?: string | null }) {
  const computed = await accountBalanceCents(tx, r.accountId, r.date);
  const [statement] = await tx
    .insert(s.accountStatements)
    .values({
      accountId: r.accountId,
      statementDate: r.date,
      closingBalanceCents: r.statementBalanceCents,
      computedBalanceCents: computed,
      reconciledAt: new Date(),
      reconciledBy: r.userId ?? null,
    })
    .onConflictDoUpdate({
      target: [s.accountStatements.accountId, s.accountStatements.statementDate],
      set: { closingBalanceCents: r.statementBalanceCents, computedBalanceCents: computed, reconciledAt: new Date(), reconciledBy: r.userId ?? null },
    })
    .returning();

  const diff = r.statementBalanceCents - computed;
  if (diff !== 0) {
    await tx.insert(s.cashMovements).values({
      accountId: r.accountId,
      movementDate: r.date,
      type: "adjustment",
      amountCents: diff,
      statementId: statement.id,
      reconciled: true,
      description: "Ajuste de conciliación",
      createdBy: r.userId ?? null,
    });
  }
  await tx
    .update(s.cashMovements)
    .set({ reconciled: true, statementId: statement.id })
    .where(and(eq(s.cashMovements.accountId, r.accountId), lte(s.cashMovements.movementDate, r.date), eq(s.cashMovements.reconciled, false)));
  return { computed, diff };
}

// ── Impuestos ───────────────────────────────────────────────────────────────

/**
 * Paga (total o parcial) una obligación fiscal. Se registra como gasto para que afecte
 * P&L, caja o aportes igual que cualquier otro pago.
 */
export async function payTax(
  tx: Tx,
  taxId: string,
  p: { date: string; amountCents: number; accountId: string | null; categoryId?: string | null; userId?: string | null }
) {
  const [t] = await tx.select().from(s.taxObligations).where(eq(s.taxObligations.id, taxId));
  if (!t) throw new Error("La obligación no existe");
  const paid = t.paidCents + p.amountCents;
  await tx
    .update(s.taxObligations)
    .set({ paidCents: paid, status: paid >= t.estimatedCents ? "paid" : "in_progress", updatedAt: new Date() })
    .where(eq(s.taxObligations.id, taxId));
  if (p.amountCents === 0) return null;

  const categoryId = p.categoryId ?? (await categoryByName(tx, "opex", "Impuestos y licencias"));
  return saveExpense(tx, {
    expenseDate: p.date,
    description: t.name,
    categoryId,
    vendorId: t.authorityId,
    frequency: "one_time",
    currency: t.currency,
    amountCents: p.amountCents,
    paymentAccountId: p.accountId,
    status: "paid",
    dueDate: null,
    paidOn: p.date,
    notes: `Pago de obligación fiscal (${t.jurisdiction})`,
    createdBy: p.userId ?? null,
  });
}

/** Id de una categoría por nombre; la crea si no existe. */
export async function categoryByName(tx: Tx, kind: "revenue" | "cogs" | "opex", name: string) {
  const [c] = await tx.select().from(s.categories).where(and(eq(s.categories.kind, kind), eq(s.categories.name, name)));
  if (c) return c.id;
  const [row] = await tx.insert(s.categories).values({ kind, name }).returning();
  return row.id;
}

// ── Plataformas de cobro (Skool): payouts ──────────────────────────────────

/** Cuenta personal genérica del dueño, oculta en la app; solo sirve para registrar retiros. */
export async function ownerPersonalAccountId(tx: Tx) {
  const [a] = await tx.select().from(s.financialAccounts).where(eq(s.financialAccounts.owner, "personal")).orderBy(asc(s.financialAccounts.sortOrder)).limit(1);
  if (a) return a.id;
  const [row] = await tx
    .insert(s.financialAccounts)
    .values({ name: "Cuenta personal del dueño", owner: "personal", type: "checking", sortOrder: 99 })
    .returning();
  return row.id;
}

/**
 * Payout desde una plataforma (Skool) hacia una cuenta bancaria de la LLC — o, si `toAccountId`
 * es null, hacia el dueño (retiro). El saldo de la plataforma solo baja por payouts.
 */
export async function payout(
  tx: Tx,
  p: { platformId: string; toAccountId: string | null; date: string; amountCents: number; userId?: string | null }
) {
  const platform = await account(tx, p.platformId);
  if (platform.type !== "processor") throw new Error("El payout sale de una plataforma de cobro (ej. Skool).");
  const available = await accountBalanceCents(tx, platform.id, p.date);
  if (p.amountCents > available) throw new Error("El payout supera el saldo de la plataforma a esa fecha.");
  const group = crypto.randomUUID();

  if (p.toAccountId) {
    const to = await account(tx, p.toAccountId);
    if (to.owner !== "llc" || to.type === "credit_card" || to.type === "processor") throw new Error("El destino debe ser una cuenta bancaria de la LLC.");
    await tx.insert(s.cashMovements).values([
      { accountId: platform.id, movementDate: p.date, type: "revenue_payout", amountCents: -p.amountCents, currency: platform.currency, transferGroupId: group, description: `Payout a ${to.name}`, createdBy: p.userId ?? null },
      { accountId: to.id, movementDate: p.date, type: "revenue_payout", amountCents: p.amountCents, currency: to.currency, transferGroupId: group, description: `Payout de ${platform.name}`, createdBy: p.userId ?? null },
    ]);
    return group;
  }

  const [draw] = await tx
    .insert(s.ownerLedger)
    .values({ entryDate: p.date, type: "draw", amountCents: p.amountCents, currency: platform.currency, personalAccountId: await ownerPersonalAccountId(tx), description: `Payout de ${platform.name} al dueño`, createdBy: p.userId ?? null })
    .returning();
  await tx.insert(s.cashMovements).values({
    accountId: platform.id, movementDate: p.date, type: "owner_draw", amountCents: -p.amountCents, currency: platform.currency,
    ownerLedgerId: draw.id, transferGroupId: group, description: "Payout al dueño (retiro)", createdBy: p.userId ?? null,
  });
}

// ── Bitácora ────────────────────────────────────────────────────────────────

export async function audit(tx: Tx, userId: string | null, action: string, entity: string, entityId: string | null, diff?: unknown) {
  await tx.insert(s.auditLog).values({ userId, action, entity, entityId, diff: diff ?? null });
}

// ── Catálogos ───────────────────────────────────────────────────────────────

/** Busca una contraparte por nombre (sin distinguir mayúsculas) o la crea. */
export async function findOrCreateCounterparty(tx: Tx, name: string, type: "customer" | "vendor" | "creditor" | "tax_authority" | "processor") {
  const [found] = await tx.select().from(s.counterparties).where(sql`lower(${s.counterparties.name}) = lower(${name})`);
  if (found) return found.id;
  const [row] = await tx.insert(s.counterparties).values({ type, name: name.trim() }).returning();
  return row.id;
}

// ── Clasificar movimientos bancarios sueltos ────────────────────────────────

export type MovementClass = "owner_contribution" | "owner_draw" | "revenue" | "expense" | "other_income" | "bank_fee" | "adjustment";

/**
 * Convierte un movimiento suelto (ej. registrado a mano desde el estado de cuenta) en lo que
 * realmente es: aporte, retiro, ingreso, gasto, cashback/intereses, comisión o ajuste.
 * Ingresos y gastos pasan a sus módulos (y a los reportes); el movimiento queda ligado.
 */
export async function classifyMovement(
  tx: Tx,
  movementId: string,
  c: { as: MovementClass; description: string; categoryId?: string | null; productId?: string | null; userId?: string | null }
) {
  const [m] = await tx.select().from(s.cashMovements).where(eq(s.cashMovements.id, movementId));
  if (!m) throw new Error("El movimiento no existe");
  if (m.revenueId || m.expenseId || m.ownerLedgerId || m.debtPaymentId || m.transferGroupId) {
    throw new Error("Este movimiento ya está ligado a otro registro; edítalo desde ahí.");
  }
  const amount = Math.abs(m.amountCents);
  const inflow = m.amountCents > 0;
  // Lo que viene del banco (id de Mercury, conciliación) sobrevive a la reclasificación.
  const keep = { statementId: m.statementId, reconciled: m.reconciled, externalId: m.externalId };
  const need = (ok: boolean, msg: string) => {
    if (!ok) throw new Error(msg);
  };

  switch (c.as) {
    case "owner_contribution":
    case "owner_draw": {
      need(c.as === "owner_contribution" ? inflow : !inflow, c.as === "owner_contribution" ? "Un aporte es dinero que entra." : "Un retiro es dinero que sale.");
      const [row] = await tx
        .insert(s.ownerLedger)
        .values({ entryDate: m.movementDate, type: c.as === "owner_contribution" ? "contribution" : "draw", currency: m.currency, amountCents: amount, fxRateToUsd: m.fxRateToUsd, description: c.description, createdBy: c.userId ?? null })
        .returning();
      await tx.update(s.cashMovements).set({ type: c.as, ownerLedgerId: row.id, description: c.description, updatedAt: new Date() }).where(eq(s.cashMovements.id, m.id));
      return;
    }
    case "revenue": {
      need(inflow, "Un ingreso es dinero que entra.");
      let categoryId = c.categoryId ?? null;
      if (!categoryId && c.productId) [{ categoryId }] = await tx.select({ categoryId: s.products.categoryId }).from(s.products).where(eq(s.products.id, c.productId));
      categoryId ??= await categoryByName(tx, "revenue", "Otros ingresos");
      await tx.delete(s.cashMovements).where(eq(s.cashMovements.id, m.id));
      const id = await saveRevenue(tx, {
        revenueDate: m.movementDate, productId: c.productId ?? null, categoryId, customerName: null, billingInterval: "one_time", serviceStart: null,
        currency: m.currency, grossCents: amount, processorFeeCents: 0, affiliateFeeCents: 0, status: "available", depositAccountId: m.accountId,
        notes: c.description, createdBy: c.userId ?? null,
      });
      await tx.update(s.cashMovements).set(keep).where(eq(s.cashMovements.revenueId, id));
      return;
    }
    case "expense": {
      need(!inflow, "Un gasto es dinero que sale.");
      need(!!c.categoryId, "Elige la categoría del gasto.");
      await tx.delete(s.cashMovements).where(eq(s.cashMovements.id, m.id));
      const id = await saveExpense(tx, {
        expenseDate: m.movementDate, description: c.description, categoryId: c.categoryId!, vendorId: null, frequency: "one_time",
        currency: m.currency, amountCents: amount, paymentAccountId: m.accountId, status: "paid", dueDate: null, paidOn: m.movementDate,
        notes: "Clasificado desde un movimiento bancario", createdBy: c.userId ?? null,
      });
      await tx.update(s.cashMovements).set(keep).where(eq(s.cashMovements.expenseId, id));
      return;
    }
    case "other_income":
      need(inflow, "Cashback o intereses son dinero que entra.");
      await tx.update(s.cashMovements).set({ type: "interest", description: c.description, updatedAt: new Date() }).where(eq(s.cashMovements.id, m.id));
      return;
    case "bank_fee":
      need(!inflow, "Una comisión bancaria es dinero que sale.");
      await tx.update(s.cashMovements).set({ type: "fee", description: c.description, updatedAt: new Date() }).where(eq(s.cashMovements.id, m.id));
      return;
    case "adjustment":
      await tx.update(s.cashMovements).set({ type: "adjustment", description: c.description, updatedAt: new Date() }).where(eq(s.cashMovements.id, m.id));
      return;
  }
}

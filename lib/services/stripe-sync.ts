/**
 * Stripe → libros. Cada evento confirmado por Stripe se procesa una sola vez (tabla
 * stripe_events) y reutiliza las reglas contables de siempre:
 *
 *  - invoice.paid           → ingreso (bruto sin impuesto, comisión exacta de Stripe, impuesto aparte)
 *                             depositado en "Saldo Stripe"; si es plan en cuotas, marca la cuota y
 *                             crea la tarea de habilitar el siguiente nivel en Skool.
 *  - invoice.payment_failed → cuota fallida, contrato "fallido" y tarea de contactar al cliente.
 *  - customer.subscription.deleted → contrato completado o cancelado (+ revisar acceso).
 *  - charge.refunded        → ingreso reembolsado (total) o reembolso parcial como gasto.
 *  - payout.paid            → transferencia Saldo Stripe → Mercury (NO es ingreso nuevo).
 *
 * Los estados solo cambian con eventos de Stripe. El acceso en Skool solo cambia al confirmar
 * la tarea manual (Skool no tiene API para módulos).
 */
import type Stripe from "stripe";
import { and, asc, eq, sql } from "drizzle-orm";
import * as s from "@/db/schema";
import type { StripeGateway } from "@/lib/stripe/client";
import { installmentLimitEnabled } from "@/lib/stripe/client";
import { addMonthsToDate, categoryByName, saveExpense, saveRevenue, syncRevenue, type Tx } from "./ledger";
import { cancelMember, saveMember } from "./members";

export const GRACE_DAYS = 7;
const TZ = "America/Tegucigalpa";
export const dateOf = (unix: number) => new Date(unix * 1000).toLocaleDateString("en-CA", { timeZone: TZ });
const minusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const idOf = (v: string | { id: string } | null | undefined) => (v == null ? null : typeof v === "string" ? v : v.id);

type Contract = typeof s.customerContracts.$inferSelect;
type Product = typeof s.products.$inferSelect;

// ── Cuentas y catálogo ──────────────────────────────────────────────────────

export async function stripeAccountId(tx: Tx) {
  const [a] = await tx
    .select({ id: s.financialAccounts.id })
    .from(s.financialAccounts)
    .where(and(eq(s.financialAccounts.type, "processor"), eq(s.financialAccounts.owner, "llc"), sql`lower(coalesce(${s.financialAccounts.institution}, '')) = 'stripe'`));
  if (!a) throw new Error('No existe la cuenta "Saldo Stripe".');
  return a.id;
}

/** Cuenta bancaria donde Stripe deposita (Mercury Checking). */
async function payoutBankId(tx: Tx) {
  const banks = await tx
    .select()
    .from(s.financialAccounts)
    .where(and(eq(s.financialAccounts.owner, "llc"), eq(s.financialAccounts.type, "checking")))
    .orderBy(asc(s.financialAccounts.sortOrder));
  const bank = banks.find((b) => b.institution?.toLowerCase() === "mercury") ?? banks[0];
  if (!bank) throw new Error("No hay una cuenta bancaria de la LLC para recibir payouts.");
  return bank.id;
}

async function productFor(tx: Tx, stripeProductId: string | null, description: string): Promise<Product> {
  if (stripeProductId) {
    const [p] = await tx.select().from(s.products).where(eq(s.products.stripeProductId, stripeProductId));
    if (p) return p;
  }
  // Producto aún no enlazado: se crea para que nada se pierda; luego se configura en Catálogos.
  const name = stripeProductId ? `Stripe · ${description}`.slice(0, 120) : "Cobros directos (Stripe)";
  const [byName] = await tx.select().from(s.products).where(eq(s.products.name, name));
  if (byName) return byName;
  const [cat] = await tx.select().from(s.categories).where(eq(s.categories.kind, "revenue")).orderBy(asc(s.categories.name)).limit(1);
  const [created] = await tx
    .insert(s.products)
    .values({ name, categoryId: cat.id, platform: "Stripe", stripeProductId, defaultBillingInterval: "one_time" })
    .returning();
  return created;
}

export const levelLabel = (product: Product, level: number) => {
  const levels = Array.isArray(product.accessLevels) ? (product.accessLevels as string[]) : [];
  return levels[level - 1] ?? (level >= (product.installments ?? 0) ? "Acceso completo" : `Nivel ${level}`);
};

// ── Clientes y contratos ────────────────────────────────────────────────────

async function memberFor(
  tx: Tx,
  c: { customerId: string | null; name: string | null; email: string | null; product: Product; date: string; interval: "monthly" | "quarterly" | "annual"; priceCents: number; periodEnd: string | null }
) {
  const email = c.email?.trim().toLowerCase() || null;
  const [byCustomer] = c.customerId ? await tx.select().from(s.members).where(eq(s.members.stripeCustomerId, c.customerId)) : [];
  const [byEmail] = !byCustomer && email ? await tx.select().from(s.members).where(eq(s.members.email, email)) : [];
  const found = byCustomer ?? byEmail;
  if (found) {
    if (!found.stripeCustomerId && c.customerId) await tx.update(s.members).set({ stripeCustomerId: c.customerId }).where(eq(s.members.id, found.id));
    return found.id;
  }
  const id = await saveMember(tx, {
    name: c.name?.trim() || email || "Cliente de Stripe",
    productId: c.product.id,
    billingInterval: c.interval,
    currency: "USD",
    priceCents: c.priceCents,
    startedOn: c.date,
    currentPeriodEnd: c.periodEnd,
    notes: "Alta desde Stripe",
  });
  await tx.update(s.members).set({ email, stripeCustomerId: c.customerId }).where(eq(s.members.id, id));
  return id;
}

async function contractBySubscription(tx: Tx, subscriptionId: string | null) {
  if (!subscriptionId) return null;
  const [c] = await tx.select().from(s.customerContracts).where(eq(s.customerContracts.stripeSubscriptionId, subscriptionId));
  return c ?? null;
}

async function addTask(tx: Tx, contractId: string, t: { kind: (typeof s.accessTaskKindEnum.enumValues)[number]; level?: number | null; title: string; detail?: string }) {
  // Una tarea pendiente por tipo y nivel: los reintentos de Stripe no duplican tareas.
  const [dup] = await tx
    .select({ id: s.accessTasks.id })
    .from(s.accessTasks)
    .where(
      and(
        eq(s.accessTasks.contractId, contractId),
        eq(s.accessTasks.kind, t.kind),
        eq(s.accessTasks.status, "pendiente"),
        t.level == null ? sql`${s.accessTasks.level} is null` : eq(s.accessTasks.level, t.level)
      )
    );
  if (dup) return dup.id;
  const [row] = await tx.insert(s.accessTasks).values({ contractId, kind: t.kind, level: t.level ?? null, title: t.title, detail: t.detail ?? null }).returning({ id: s.accessTasks.id });
  return row.id;
}

/** Recalcula estado, próximo cobro y días en mora a partir de las cuotas (fuente: eventos de Stripe). */
export async function refreshContract(tx: Tx, contractId: string, today: string) {
  const [c] = await tx.select().from(s.customerContracts).where(eq(s.customerContracts.id, contractId));
  if (!c) return null;
  const rows = await tx.select().from(s.contractInstallments).where(eq(s.contractInstallments.contractId, contractId));
  const paid = rows.filter((r) => r.status === "pagada").length;
  const failed = rows.filter((r) => r.status === "fallida");
  let status = c.status;
  let failedSince = c.failedSince;
  if (c.status !== "cancelado") {
    if (paid >= c.installments) {
      status = "completado";
      failedSince = null;
    } else if (failed.length) {
      failedSince ??= today;
      status = failedSince <= minusDays(today, GRACE_DAYS) ? "vencido" : "fallido";
    } else {
      failedSince = null;
      status = "al_dia";
    }
  }
  const nextDueDate = paid < c.installments && status !== "cancelado" ? addMonthsToDate(c.accessStart, paid) : null;
  const [updated] = await tx
    .update(s.customerContracts)
    .set({ status, failedSince, nextDueDate, updatedAt: new Date() })
    .where(eq(s.customerContracts.id, contractId))
    .returning();
  return updated;
}

// ── Eventos ─────────────────────────────────────────────────────────────────

export async function recordInvoicePaid(tx: Tx, inv: Stripe.Invoice, gw: StripeGateway, today: string) {
  if (!inv.amount_paid || inv.amount_paid <= 0) return { kind: "skip" as const };
  if (inv.currency !== "usd") throw new Error(`Moneda no soportada en Stripe: ${inv.currency}`);

  const line = inv.lines?.data?.[0];
  const stripeProductId = line?.pricing?.price_details?.product ?? null;
  const product = await productFor(tx, stripeProductId, line?.description ?? inv.description ?? "Cobro");
  const subscriptionId = idOf(inv.parent?.subscription_details?.subscription);
  const customerId = idOf(inv.customer as string | { id: string } | null);
  const paidDate = dateOf(inv.status_transitions?.paid_at ?? inv.created);
  const taxCents = (inv.total_taxes ?? []).reduce((a, t) => a + t.amount, 0);
  const grossCents = inv.amount_paid - taxCents;

  // Plan en cuotas: el contrato nace con el primer cobro confirmado.
  let contract: Contract | null = await contractBySubscription(tx, subscriptionId);
  const isPlan = !!(subscriptionId && product.installments && product.installments > 0);
  const totalCents = product.listPriceCents ?? inv.amount_paid * (product.installments ?? 1);
  const memberId = await memberFor(tx, {
    customerId,
    name: inv.customer_name,
    email: inv.customer_email,
    product,
    date: contract?.accessStart ?? paidDate,
    interval: isPlan ? "annual" : product.defaultBillingInterval === "one_time" ? "monthly" : product.defaultBillingInterval,
    priceCents: isPlan ? totalCents : grossCents,
    periodEnd: isPlan ? addMonthsToDate(contract?.accessStart ?? paidDate, 12) : line?.period?.end ? dateOf(line.period.end) : null,
  });
  if (isPlan && !contract) {
    const accessEnd = minusDays(addMonthsToDate(paidDate, 12), 1);
    [contract] = await tx
      .insert(s.customerContracts)
      .values({ memberId, productId: product.id, stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId, totalCents, installments: product.installments!, accessStart: paidDate, accessEnd })
      .returning();
  }

  // Ingreso: una vez por factura (in_…), aunque Stripe repita el evento o se reimporte.
  const [existing] = await tx.select().from(s.revenues).where(eq(s.revenues.externalId, inv.id));
  let revenueId = existing?.id;
  if (!revenueId) {
    const charge = await gw.chargeForInvoice(inv.id);
    revenueId = await saveRevenue(tx, {
      revenueDate: paidDate,
      productId: product.id,
      categoryId: product.categoryId,
      customerName: inv.customer_name ?? inv.customer_email,
      memberId,
      billingInterval: isPlan ? "annual" : product.defaultBillingInterval,
      serviceStart: contract?.accessStart ?? paidDate,
      currency: "USD",
      grossCents,
      processorFeeCents: charge?.feeCents ?? 0,
      affiliateFeeCents: 0,
      status: "available",
      depositAccountId: await stripeAccountId(tx),
      externalId: inv.id,
      stripeChargeId: charge?.chargeId ?? null,
      taxCents,
      taxCountry: inv.customer_address?.country ?? null,
      taxRegion: inv.customer_address?.state ?? null,
      merchantOfRecord: "llc",
      notes: contract ? "Cuota de plan financiado · Stripe" : "Cobro Stripe",
    });
  }

  if (!contract) return { kind: "revenue" as const, revenueId };

  // Cuota: la que falló antes con esta factura, o la siguiente.
  const [byInvoice] = await tx.select().from(s.contractInstallments).where(eq(s.contractInstallments.stripeInvoiceId, inv.id));
  const before = await tx.select().from(s.contractInstallments).where(eq(s.contractInstallments.contractId, contract.id));
  const wasOverdue = contract.status === "vencido";
  if (byInvoice) {
    await tx
      .update(s.contractInstallments)
      .set({ status: "pagada", paidAt: new Date((inv.status_transitions?.paid_at ?? inv.created) * 1000), revenueId, amountCents: inv.amount_paid, updatedAt: new Date() })
      .where(eq(s.contractInstallments.id, byInvoice.id));
  } else {
    await tx.insert(s.contractInstallments).values({
      contractId: contract.id,
      number: before.reduce((m, r) => Math.max(m, r.number), 0) + 1,
      amountCents: inv.amount_paid,
      dueDate: paidDate,
      status: "pagada",
      stripeInvoiceId: inv.id,
      revenueId,
      paidAt: new Date((inv.status_transitions?.paid_at ?? inv.created) * 1000),
      attempts: inv.attempt_count,
    });
  }
  const updated = (await refreshContract(tx, contract.id, today))!;
  const paid = (await tx.select().from(s.contractInstallments).where(and(eq(s.contractInstallments.contractId, contract.id), eq(s.contractInstallments.status, "pagada")))).length;
  const name = inv.customer_name ?? inv.customer_email ?? "el cliente";
  if (paid > updated.accessLevelConfirmed) {
    await addTask(tx, contract.id, {
      kind: "grant_level",
      level: paid,
      title: `Habilitar en Skool: ${levelLabel(product, paid)} — ${name}`,
      detail: `Stripe confirmó la cuota ${paid} de ${contract.installments}. Hazlo en Skool y confirma aquí.`,
    });
  }
  if (wasOverdue) {
    await addTask(tx, contract.id, { kind: "restore_access", title: `Restaurar acceso en Skool — ${name}`, detail: "Pagó la cuota atrasada. Si le restringiste el acceso, vuelve a dárselo." });
  }
  return { kind: "installment" as const, revenueId, contractId: contract.id, paid };
}

export async function recordInvoiceFailed(tx: Tx, inv: Stripe.Invoice, today: string) {
  const contract = await contractBySubscription(tx, idOf(inv.parent?.subscription_details?.subscription));
  if (!contract) return { kind: "skip" as const };
  const [byInvoice] = await tx.select().from(s.contractInstallments).where(eq(s.contractInstallments.stripeInvoiceId, inv.id));
  if (byInvoice?.status === "pagada") return { kind: "skip" as const };
  if (byInvoice) {
    await tx.update(s.contractInstallments).set({ status: "fallida", failedAt: new Date(), attempts: inv.attempt_count, updatedAt: new Date() }).where(eq(s.contractInstallments.id, byInvoice.id));
  } else {
    const rows = await tx.select().from(s.contractInstallments).where(eq(s.contractInstallments.contractId, contract.id));
    await tx.insert(s.contractInstallments).values({
      contractId: contract.id,
      number: rows.reduce((m, r) => Math.max(m, r.number), 0) + 1,
      amountCents: inv.amount_due,
      dueDate: dateOf(inv.created),
      status: "fallida",
      stripeInvoiceId: inv.id,
      failedAt: new Date(),
      attempts: inv.attempt_count,
    });
  }
  await refreshContract(tx, contract.id, today);
  const name = inv.customer_name ?? inv.customer_email ?? "el cliente";
  await addTask(tx, contract.id, {
    kind: "contact_client",
    title: `Contactar a ${name}: falló un cobro`,
    detail: `Stripe reintentará el cobro. Si no se resuelve en ${GRACE_DAYS} días, el contrato pasa a vencido y se propondrá restringir el acceso.`,
  });
  return { kind: "failed" as const, contractId: contract.id };
}

export async function recordSubscriptionEnded(tx: Tx, sub: Stripe.Subscription, today: string) {
  const contract = await contractBySubscription(tx, sub.id);
  if (!contract) return { kind: "skip" as const };
  const paid = (await tx.select().from(s.contractInstallments).where(and(eq(s.contractInstallments.contractId, contract.id), eq(s.contractInstallments.status, "pagada")))).length;
  if (paid >= contract.installments) {
    await refreshContract(tx, contract.id, today); // completado: el acceso sigue hasta el fin del año
    return { kind: "completed" as const };
  }
  await tx.update(s.customerContracts).set({ status: "cancelado", nextDueDate: null, updatedAt: new Date() }).where(eq(s.customerContracts.id, contract.id));
  await cancelMember(tx, contract.memberId, { date: today, accessUntil: today });
  await addTask(tx, contract.id, {
    kind: "review_access",
    title: "Suscripción cancelada antes de terminar las cuotas: revisar acceso en Skool",
    detail: `Pagó ${paid} de ${contract.installments} cuotas. Decide si mantiene el nivel ${contract.accessLevelConfirmed} o se le retira.`,
  });
  return { kind: "canceled" as const };
}

/** Si STRIPE_LIMIT_INSTALLMENTS=1, programa el fin de la suscripción tras la última cuota. */
export async function limitInstallmentSubscription(tx: Tx, sub: Stripe.Subscription, gw: StripeGateway) {
  if (!installmentLimitEnabled() || sub.cancel_at) return { kind: "skip" as const };
  const stripeProductId = idOf(sub.items?.data?.[0]?.price?.product as string | { id: string } | undefined);
  if (!stripeProductId) return { kind: "skip" as const };
  const [product] = await tx.select().from(s.products).where(eq(s.products.stripeProductId, stripeProductId));
  if (!product?.installments) return { kind: "skip" as const };
  const anchor = dateOf(sub.billing_cycle_anchor);
  const end = addMonthsToDate(anchor, product.installments); // justo antes de la cuota N+1
  await gw.cancelSubscriptionAt(sub.id, Math.floor(Date.parse(`${end}T12:00:00Z`) / 1000));
  return { kind: "limited" as const, cancelAt: end };
}

export async function recordRefund(tx: Tx, charge: Stripe.Charge, today: string) {
  const [rev] = await tx.select().from(s.revenues).where(eq(s.revenues.stripeChargeId, charge.id));
  if (!rev) return { kind: "skip" as const };
  if (charge.refunded || charge.amount_refunded >= charge.amount) {
    if (rev.status !== "refunded") {
      await tx.update(s.revenues).set({ status: "refunded", updatedAt: new Date() }).where(eq(s.revenues.id, rev.id));
      await syncRevenue(tx, rev.id);
    }
    const [inst] = await tx.select().from(s.contractInstallments).where(eq(s.contractInstallments.revenueId, rev.id));
    if (inst) {
      await tx.update(s.contractInstallments).set({ status: "reembolsada", updatedAt: new Date() }).where(eq(s.contractInstallments.id, inst.id));
      await refreshContract(tx, inst.contractId, today);
      await addTask(tx, inst.contractId, { kind: "review_access", title: "Cuota reembolsada: revisar acceso en Skool", detail: `Se reembolsó la cuota ${inst.number}.` });
    }
    return { kind: "refunded" as const };
  }
  // Parcial: lo nuevo desde el último registro, como gasto pagado desde el saldo de Stripe.
  const key = `stripe-refund:${charge.id}`;
  const prior = await tx.select({ c: s.expenses.amountCents }).from(s.expenses).where(eq(s.expenses.notes, key));
  const delta = charge.amount_refunded - prior.reduce((a, x) => a + x.c, 0);
  if (delta <= 0) return { kind: "skip" as const };
  await saveExpense(tx, {
    expenseDate: today,
    description: `Reembolso parcial · ${rev.customerName ?? "cliente"}`,
    categoryId: await categoryByName(tx, "opex", "Descuentos y reembolsos a clientes"),
    vendorId: null,
    frequency: "one_time",
    currency: "USD",
    amountCents: delta,
    paymentAccountId: await stripeAccountId(tx),
    status: "paid",
    dueDate: null,
    paidOn: today,
    notes: key,
  });
  return { kind: "partial" as const, amountCents: delta };
}

/** Payout Stripe → banco: transferencia entre tus cuentas, nunca ingreso nuevo. */
export async function recordPayout(tx: Tx, po: Stripe.Payout) {
  if (po.currency !== "usd") throw new Error(`Moneda de payout no soportada: ${po.currency}`);
  const stripeId = await stripeAccountId(tx);
  const [dup] = await tx.select({ id: s.cashMovements.id }).from(s.cashMovements).where(and(eq(s.cashMovements.accountId, stripeId), eq(s.cashMovements.externalId, po.id)));
  if (dup) return { kind: "skip" as const };
  const bankId = await payoutBankId(tx);
  const date = dateOf(po.arrival_date);
  const group = crypto.randomUUID();
  await tx.insert(s.cashMovements).values([
    { accountId: stripeId, movementDate: date, type: "revenue_payout", amountCents: -po.amount, currency: "USD", transferGroupId: group, externalId: po.id, description: "Payout a Mercury" },
    // Sin id externo: cuando llegue el depósito en la bandeja de Mercury se reconoce como "ya registrado".
    { accountId: bankId, movementDate: date, type: "revenue_payout", amountCents: po.amount, currency: "USD", transferGroupId: group, description: "Payout de Stripe" },
  ]);
  return { kind: "payout" as const, date };
}

export async function reversePayout(tx: Tx, po: Stripe.Payout) {
  const stripeId = await stripeAccountId(tx);
  const [m] = await tx.select().from(s.cashMovements).where(and(eq(s.cashMovements.accountId, stripeId), eq(s.cashMovements.externalId, po.id)));
  if (m?.transferGroupId) await tx.delete(s.cashMovements).where(eq(s.cashMovements.transferGroupId, m.transferGroupId));
  return { kind: m ? ("reversed" as const) : ("skip" as const) };
}

/** Despacha un evento verificado. Idempotente: el mismo evt_… no se procesa dos veces. */
export async function handleStripeEvent(tx: Tx, event: Stripe.Event, gw: StripeGateway, today: string) {
  const fresh = await tx.insert(s.stripeEvents).values({ id: event.id, type: event.type, livemode: event.livemode }).onConflictDoNothing().returning({ id: s.stripeEvents.id });
  if (!fresh.length) return { kind: "duplicate" as const };
  switch (event.type) {
    case "invoice.paid":
      return recordInvoicePaid(tx, event.data.object, gw, today);
    case "invoice.payment_failed":
      return recordInvoiceFailed(tx, event.data.object, today);
    case "customer.subscription.created":
      return limitInstallmentSubscription(tx, event.data.object, gw);
    case "customer.subscription.deleted":
      return recordSubscriptionEnded(tx, event.data.object, today);
    case "charge.refunded":
      return recordRefund(tx, event.data.object, today);
    case "payout.paid":
      return recordPayout(tx, event.data.object);
    case "payout.failed":
    case "payout.canceled":
      return reversePayout(tx, event.data.object);
    default:
      return { kind: "ignored" as const };
  }
}

// ── Tareas diarias e historial ──────────────────────────────────────────────

/** Mora: pasados los días de gracia, el contrato pasa a vencido y se propone restringir acceso. */
export async function escalateOverdue(tx: Tx, today: string) {
  const failing = await tx.select().from(s.customerContracts).where(eq(s.customerContracts.status, "fallido"));
  let escalated = 0;
  for (const c of failing) {
    const u = await refreshContract(tx, c.id, today);
    if (u?.status === "vencido") {
      const [m] = await tx.select({ name: s.members.name }).from(s.members).where(eq(s.members.id, c.memberId));
      await addTask(tx, c.id, {
        kind: "restrict_access",
        title: `Evaluar restringir acceso en Skool — ${m?.name ?? "cliente"}`,
        detail: `Lleva más de ${GRACE_DAYS} días con una cuota sin pagar. Confirma solo si de verdad lo restringiste en Skool.`,
      });
      escalated++;
    }
  }
  return escalated;
}

/** Guarda el saldo real de Stripe (disponible + pendiente) para comparar con los libros. */
export async function storeStripeBalance(tx: Tx, gw: StripeGateway, today: string, booksCents: number) {
  const b = await gw.balance();
  const accountId = await stripeAccountId(tx);
  await tx
    .insert(s.accountStatements)
    .values({ accountId, statementDate: today, closingBalanceCents: b.availableCents + b.pendingCents, computedBalanceCents: booksCents })
    .onConflictDoUpdate({
      target: [s.accountStatements.accountId, s.accountStatements.statementDate],
      set: { closingBalanceCents: b.availableCents + b.pendingCents, computedBalanceCents: booksCents, updatedAt: new Date() },
    });
  const value = { ...b, at: new Date().toISOString() };
  await tx.insert(s.settings).values({ key: "stripe_balance", value }).onConflictDoUpdate({ target: s.settings.key, set: { value, updatedAt: new Date() } });
  return b;
}

/** Importa el historial (facturas pagadas y payouts). Seguro de repetir: no duplica. */
export async function importStripeHistory(tx: Tx, gw: StripeGateway, sinceUnix: number, today: string) {
  let invoices = 0;
  let payouts = 0;
  for await (const inv of gw.paidInvoices(sinceUnix)) {
    const r = await recordInvoicePaid(tx, inv, gw, today);
    if (r.kind !== "skip") invoices++;
  }
  for await (const po of gw.payouts(sinceUnix)) {
    if (po.status !== "paid") continue;
    const r = await recordPayout(tx, po);
    if (r.kind === "payout") payouts++;
  }
  return { invoices, payouts };
}

export async function latestStripeBalance(tx: Tx) {
  const [row] = await tx.select().from(s.settings).where(eq(s.settings.key, "stripe_balance"));
  return (row?.value as { availableCents: number; pendingCents: number; at: string } | undefined) ?? null;
}


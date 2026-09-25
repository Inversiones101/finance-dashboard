import { eq, isNull } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as s from "@/db/schema";
import type { FinanceData } from "@/lib/finance/engine";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<PgQueryResultHKT, typeof s, any>;

const num = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

/** Lee todo lo que necesita el motor. A esta escala (cientos/miles de filas) cabe en memoria sin problema. */
export async function loadFinanceData(db: AnyDb): Promise<FinanceData> {
  const [categories, products, accounts, revenues, expenses, movements, ownerLedger, debts, debtPayments, contracts, subscriptions, taxes, reminders, members, memberEvents, budgets, goals, [opsStart]] =
    await Promise.all([
      db.select().from(s.categories),
      db.select().from(s.products),
      db.select().from(s.financialAccounts),
      db.select().from(s.revenues),
      db.select().from(s.expenses),
      db.select().from(s.cashMovements),
      db.select().from(s.ownerLedger),
      db.select().from(s.debts),
      db.select().from(s.debtPayments),
      db.select().from(s.vendorContracts),
      db.select().from(s.subscriptions),
      db.select().from(s.taxObligations),
      db.select().from(s.reminders).where(isNull(s.reminders.doneAt)),
      db.select().from(s.members),
      db.select().from(s.memberEvents),
      db.select().from(s.budgets),
      db.select().from(s.goals),
      db.select().from(s.settings).where(eq(s.settings.key, "operations_start_date")),
    ]);

  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const llcIds = new Set(accounts.filter((a) => a.owner === "llc").map((a) => a.id));

  return {
    categories: categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, pnlLine: c.pnlLine })),
    products: products.map((p) => ({ id: p.id, name: p.name, listPriceCents: p.listPriceCents })),
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      owner: a.owner,
      type: a.type,
      status: a.status,
      currency: a.currency,
      openingBalanceCents: a.openingBalanceCents,
      creditLimitCents: a.creditLimitCents,
      sortOrder: a.sortOrder,
    })),
    revenues: revenues.map((r) => ({
      date: r.revenueDate,
      productId: r.productId,
      customerName: r.customerName,
      categoryId: r.categoryId,
      billingInterval: r.billingInterval,
      serviceStart: r.serviceStart,
      grossCents: r.grossCents,
      processorFeeCents: r.processorFeeCents,
      affiliateFeeCents: r.affiliateFeeCents,
      fxRateToUsd: num(r.fxRateToUsd),
      status: r.status,
      depositAccountId: r.depositAccountId,
    })),
    expenses: expenses.map((e) => ({
      date: e.expenseDate,
      description: e.description,
      categoryId: e.categoryId,
      amountCents: e.amountCents,
      fxRateToUsd: num(e.fxRateToUsd),
      fundingSource: e.fundingSource,
      paymentAccountId: e.paymentAccountId,
      dueDate: e.dueDate,
      status: e.status,
      contractId: e.contractId,
    })),
    movements: movements.map((m) => ({
      accountId: m.accountId,
      date: m.movementDate,
      amountCents: m.amountCents,
      fxRateToUsd: num(m.fxRateToUsd),
      type: m.type,
      transferGroupId: m.transferGroupId,
      debtPaymentId: m.debtPaymentId,
      linked: !!(m.revenueId || m.expenseId || m.debtPaymentId || m.ownerLedgerId),
    })),
    ownerLedger: ownerLedger.map((o) => ({ date: o.entryDate, type: o.type, amountCents: o.amountCents, fxRateToUsd: num(o.fxRateToUsd) })),
    debts: debts.map((d) => ({ id: d.id, name: d.name, currency: d.currency, principalCents: d.principalCents, status: d.status })),
    debtPayments: debtPayments.map((p) => ({
      id: p.id,
      debtId: p.debtId,
      dueDate: p.dueDate,
      paidOn: p.paidOn,
      principalCents: p.principalCents,
      interestCents: p.interestCents,
      feeCents: p.feeCents,
    })),
    contracts: contracts.map((c) => ({
      id: c.id,
      name: c.name,
      currency: c.currency,
      totalCents: c.totalCents,
      installmentDay: c.installmentDay,
      installmentAmountCents: c.installmentAmountCents,
      status: c.status,
    })),
    subscriptions: subscriptions.map((sub) => ({
      name: sub.name,
      currency: sub.currency,
      amountCents: sub.amountCents,
      billingInterval: sub.billingInterval,
      nextRenewalOn: sub.nextRenewalOn,
      status: sub.status,
      // Cuentas personales no se muestran: lo pagado por el dueño es "aporte".
      paymentAccountName: sub.defaultPaymentAccountId && llcIds.has(sub.defaultPaymentAccountId) ? (accountName.get(sub.defaultPaymentAccountId) ?? null) : null,
    })),
    taxObligations: taxes.map((t) => ({
      name: t.name,
      dueDate: t.dueDate,
      currency: t.currency,
      estimatedCents: t.estimatedCents,
      paidCents: t.paidCents,
      status: t.status,
    })),
    reminders: reminders.map((r) => ({ dueOn: r.dueOn, title: r.title, detail: r.detail, amountCents: r.amountCents, done: false })),
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      productId: m.productId,
      billingInterval: m.billingInterval,
      currency: m.currency,
      priceCents: m.priceCents,
      startedOn: m.startedOn,
      currentPeriodEnd: m.currentPeriodEnd,
      status: m.status,
      canceledOn: m.canceledOn,
      accessUntil: m.accessUntil,
    })),
    memberEvents: memberEvents.map((e) => ({ memberId: e.memberId, date: e.eventDate, type: e.type, mrrDeltaCents: e.mrrDeltaCents })),
    operationsStart: typeof opsStart?.value === "string" ? opsStart.value : null,
    budgets: budgets.map((b) => ({ categoryId: b.categoryId, month: b.month, amountCents: b.amountCents })),
    goals: goals.map((g) => ({ id: g.id, name: g.name, metric: g.metric, target: Number(g.target), periodStart: g.periodStart, periodEnd: g.periodEnd, status: g.status })),
  };
}

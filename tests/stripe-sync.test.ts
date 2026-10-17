import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import type Stripe from "stripe";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { seed } from "@/db/seed";
import { loadFinanceData } from "@/lib/data/finance-data";
import { computeBalanceSheet, computeMembers, computePnlReport } from "@/lib/finance/engine";
import { accountBalanceCents, type Tx } from "@/lib/services/ledger";
import { escalateOverdue, handleStripeEvent, importStripeHistory, limitInstallmentSubscription, stripeAccountId } from "@/lib/services/stripe-sync";
import { completeAccessTask } from "@/lib/services/access-tasks";
import { refreshSuggestions } from "@/lib/services/bank-sync";
import type { StripeGateway } from "@/lib/stripe/client";

const DAY = 86_400;
const unix = (iso: string) => Math.floor(Date.parse(`${iso}T15:00:00Z`) / 1000);
let db: Tx;
let n = 0;

const gw = (over: Partial<StripeGateway> = {}): StripeGateway => ({
  chargeForInvoice: async (id) => ({ chargeId: `ch_${id}`, feeCents: 222 }),
  balance: async () => ({ availableCents: 0, pendingCents: 0 }),
  paidInvoices: async function* () {},
  payouts: async function* () {},
  cancelSubscriptionAt: async () => {},
  ...over,
});

const invoice = (id: string, paidOn: string, over: Partial<Record<string, unknown>> = {}) =>
  ({
    id,
    object: "invoice",
    currency: "usd",
    amount_paid: 6633,
    amount_due: 6633,
    attempt_count: 1,
    created: unix(paidOn),
    customer: "cus_ana",
    customer_name: "Ana Torres",
    customer_email: "ana@x.com",
    customer_address: { country: "HN", state: null },
    total_taxes: [],
    status_transitions: { paid_at: unix(paidOn) },
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_ana" }, quote_details: null },
    lines: { data: [{ description: "Membresía anual en 3 cuotas", period: { start: unix(paidOn), end: unix(paidOn) + 30 * DAY }, pricing: { price_details: { product: "prod_cuotas", price: "price_x" } } }] },
    ...over,
  }) as unknown as Stripe.Invoice;

const event = (type: string, object: unknown) => ({ id: `evt_${++n}`, type, livemode: false, data: { object } }) as unknown as Stripe.Event;

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema: s });
  await migrate(d, { migrationsFolder: path.join(__dirname, "..", "db", "migrations") });
  await seed(d);
  db = d as unknown as Tx;
  await db.delete(s.members);
  const [cat] = await db.select().from(s.categories).where(eq(s.categories.kind, "revenue")).limit(1);
  await db.insert(s.products).values({
    name: "Membresía anual en 3 cuotas",
    categoryId: cat.id,
    platform: "Stripe",
    stripeProductId: "prod_cuotas",
    installments: 3,
    listPriceCents: 19900,
    accessLevels: ["Módulos 1–4", "Módulos 5–8", "Acceso completo"],
  });
});

const contract = async () => (await db.select().from(s.customerContracts))[0];
const tasks = async (kind?: string) => (await db.select().from(s.accessTasks)).filter((t) => t.status === "pendiente" && (!kind || t.kind === kind));

describe("Stripe: plan anual de $199 en 3 cuotas", () => {
  it("primera cuota: ingreso, comisión exacta, cliente, contrato y tarea de acceso; sin duplicar", async () => {
    const r = await handleStripeEvent(db, event("invoice.paid", invoice("in_1", "2026-10-10")), gw(), "2026-10-10");
    expect(r.kind).toBe("installment");

    const [rev] = await db.select().from(s.revenues).where(eq(s.revenues.externalId, "in_1"));
    expect(rev).toMatchObject({ grossCents: 6633, processorFeeCents: 222, merchantOfRecord: "llc", taxCountry: "HN", stripeChargeId: "ch_in_1" });
    expect(await accountBalanceCents(db, await stripeAccountId(db), "2026-10-10")).toBe(6633 - 222); // queda en el saldo de Stripe, no en caja

    const c = await contract();
    expect(c).toMatchObject({ status: "al_dia", totalCents: 19900, installments: 3, accessStart: "2026-10-10", accessEnd: "2027-10-09", nextDueDate: "2026-11-10", accessLevelConfirmed: 0 });
    expect((await tasks("grant_level")).map((t) => t.title)).toEqual(["Habilitar en Skool: Módulos 1–4 — Ana Torres"]);

    // El compromiso de $199 no es efectivo: el MRR cuenta el plan anual ($199/12).
    const m = computeMembers(await loadFinanceData(db), { asOf: "2026-10-15", hnlPerUsd: 26.9 });
    expect(m.mrr).toBe(1658);

    // Mismo evento repetido y otro evento con la misma factura: nada se duplica.
    const e = event("invoice.paid", invoice("in_1", "2026-10-10"));
    await handleStripeEvent(db, e, gw(), "2026-10-10");
    expect((await handleStripeEvent(db, e, gw(), "2026-10-10")).kind).toBe("duplicate");
    expect(await db.select().from(s.revenues).where(eq(s.revenues.externalId, "in_1"))).toHaveLength(1);
    expect(await db.select().from(s.contractInstallments)).toHaveLength(1);
  });

  it("el nivel de acceso solo cambia al confirmar la tarea", async () => {
    await handleStripeEvent(db, event("invoice.paid", invoice("in_1", "2026-10-10")), gw(), "2026-10-10");
    const [t] = await tasks("grant_level");
    expect((await contract()).accessLevelConfirmed).toBe(0);
    await completeAccessTask(db, t.id, null);
    expect((await contract()).accessLevelConfirmed).toBe(1);
  });

  it("cuota fallida → contactar; 7 días después → vencido y proponer restringir; al pagar → al día, restaurar y siguiente nivel", async () => {
    await handleStripeEvent(db, event("invoice.paid", invoice("in_1", "2026-10-10")), gw(), "2026-10-10");
    await handleStripeEvent(db, event("invoice.payment_failed", invoice("in_2", "2026-11-10", { amount_paid: 0, attempt_count: 1 })), gw(), "2026-11-10");
    expect((await contract()).status).toBe("fallido");
    expect(await tasks("contact_client")).toHaveLength(1);

    await escalateOverdue(db, "2026-11-15");
    expect((await contract()).status).toBe("fallido"); // aún dentro de la gracia
    await escalateOverdue(db, "2026-11-17");
    expect((await contract()).status).toBe("vencido");
    expect(await tasks("restrict_access")).toHaveLength(1);

    await handleStripeEvent(db, event("invoice.paid", invoice("in_2", "2026-11-18")), gw(), "2026-11-18");
    const c = await contract();
    expect(c).toMatchObject({ status: "al_dia", failedSince: null, nextDueDate: "2026-12-10" });
    expect(await tasks("restore_access")).toHaveLength(1);
    expect((await tasks("grant_level")).map((t) => t.level)).toEqual([1, 2]);
    const inst = await db.select().from(s.contractInstallments).where(eq(s.contractInstallments.contractId, c.id));
    expect(inst.map((i) => [i.number, i.status])).toEqual([[1, "pagada"], [2, "pagada"]]);
  });

  it("tercera cuota → completado; la suscripción termina sin cancelar al miembro", async () => {
    for (const [id, d] of [["in_1", "2026-10-10"], ["in_2", "2026-11-10"], ["in_3", "2026-12-10"]] as const)
      await handleStripeEvent(db, event("invoice.paid", invoice(id, d, id === "in_3" ? { amount_paid: 6634 } : {})), gw(), d);
    expect(await contract()).toMatchObject({ status: "completado", nextDueDate: null });
    await handleStripeEvent(db, event("customer.subscription.deleted", { id: "sub_ana" }), gw(), "2026-12-11");
    expect((await contract()).status).toBe("completado");
    const [m] = await db.select().from(s.members);
    expect(m.status).toBe("active");
    const paid = await db.select().from(s.contractInstallments).where(eq(s.contractInstallments.status, "pagada"));
    expect(paid.reduce((a, i) => a + i.amountCents, 0)).toBe(19900);
  });

  it("si se cancela antes de terminar: contrato cancelado, baja del miembro y revisar acceso", async () => {
    await handleStripeEvent(db, event("invoice.paid", invoice("in_1", "2026-10-10")), gw(), "2026-10-10");
    await handleStripeEvent(db, event("customer.subscription.deleted", { id: "sub_ana" }), gw(), "2026-11-12");
    expect((await contract()).status).toBe("cancelado");
    expect(await tasks("review_access")).toHaveLength(1);
    expect((await db.select().from(s.members))[0].status).toBe("canceled");
  });

  it("payout de Stripe a Mercury es transferencia: no suma ingresos y la bandeja lo reconoce", async () => {
    await handleStripeEvent(db, event("invoice.paid", invoice("in_1", "2026-10-10")), gw(), "2026-10-10");
    const before = computePnlReport(await loadFinanceData(db), { from: "2026-10", to: "2026-10", granularity: "month" }).total.gross;
    await handleStripeEvent(db, event("payout.paid", { id: "po_1", amount: 6411, currency: "usd", arrival_date: unix("2026-10-12"), status: "paid" }), gw(), "2026-10-12");
    const data = await loadFinanceData(db);
    expect(computePnlReport(data, { from: "2026-10", to: "2026-10", granularity: "month" }).total.gross).toBe(before);
    expect(await accountBalanceCents(db, await stripeAccountId(db), "2026-10-12")).toBe(0);
    expect(computeBalanceSheet(data, { asOf: "2026-10-31", hnlPerUsd: 26.9 }).difference).toBe(0);

    // El mismo depósito llega por Mercury: la bandeja lo marca "ya registrado", no ingreso nuevo.
    const [chk] = await db.select().from(s.financialAccounts).where(eq(s.financialAccounts.name, "Mercury Checking"));
    await db.insert(s.bankInbox).values({ accountId: chk.id, externalId: "merc_1", postedOn: "2026-10-13", amountCents: 6411, counterparty: "STRIPE" });
    await refreshSuggestions(db);
    const [item] = await db.select().from(s.bankInbox);
    expect((item.suggestion as { as: string }).as).toBe("match");
  });

  it("impuesto cobrado por Stripe: fuera del ingreso, como pasivo por remitir; el balance cuadra", async () => {
    await handleStripeEvent(db, event("invoice.paid", invoice("in_t", "2026-10-10", { amount_paid: 7133, total_taxes: [{ amount: 500 }], customer_address: { country: "US", state: "TX" } })), gw(), "2026-10-10");
    const [rev] = await db.select().from(s.revenues).where(eq(s.revenues.externalId, "in_t"));
    expect(rev).toMatchObject({ grossCents: 6633, taxCents: 500, taxCountry: "US", taxRegion: "TX" });
    const bs = computeBalanceSheet(await loadFinanceData(db), { asOf: "2026-10-31", hnlPerUsd: 26.9 });
    expect(bs.liabilities.salesTaxPayable).toBe(5);
    expect(bs.difference).toBe(0);
  });

  it("reembolso total: el ingreso queda reembolsado y la cuota también", async () => {
    await handleStripeEvent(db, event("invoice.paid", invoice("in_1", "2026-10-10")), gw(), "2026-10-10");
    await handleStripeEvent(db, event("charge.refunded", { id: "ch_in_1", amount: 6633, amount_refunded: 6633, refunded: true }), gw(), "2026-10-20");
    const [rev] = await db.select().from(s.revenues).where(eq(s.revenues.externalId, "in_1"));
    expect(rev.status).toBe("refunded");
    const [inst] = await db.select().from(s.contractInstallments);
    expect(inst.status).toBe("reembolsada");
    expect(await tasks("review_access")).toHaveLength(1);
  });

  it("importar el historial no duplica lo que ya llegó por webhook", async () => {
    await handleStripeEvent(db, event("invoice.paid", invoice("in_1", "2026-10-10")), gw(), "2026-10-10");
    const history = gw({
      paidInvoices: async function* () {
        yield invoice("in_1", "2026-10-10");
      },
      payouts: async function* () {
        yield { id: "po_1", amount: 6411, currency: "usd", arrival_date: unix("2026-10-12"), status: "paid" } as unknown as Stripe.Payout;
      },
    });
    await importStripeHistory(db, history, 0, "2026-10-16");
    await importStripeHistory(db, history, 0, "2026-10-16");
    expect(await db.select().from(s.revenues).where(eq(s.revenues.externalId, "in_1"))).toHaveLength(1);
    const stripeId = await stripeAccountId(db);
    expect(await db.select().from(s.cashMovements).where(and(eq(s.cashMovements.accountId, stripeId), eq(s.cashMovements.externalId, "po_1")))).toHaveLength(1);
  });

  it("limitar a 3 cuotas solo si está activado, y programa el fin justo antes de la cuarta", async () => {
    const cancelSubscriptionAt = vi.fn(async () => {});
    const sub = { id: "sub_ana", cancel_at: null, billing_cycle_anchor: unix("2026-10-10"), items: { data: [{ price: { product: "prod_cuotas" } }] } } as unknown as Stripe.Subscription;
    expect((await limitInstallmentSubscription(db, sub, gw({ cancelSubscriptionAt }))).kind).toBe("skip");
    expect(cancelSubscriptionAt).not.toHaveBeenCalled();
    vi.stubEnv("STRIPE_LIMIT_INSTALLMENTS", "1");
    const r = await limitInstallmentSubscription(db, sub, gw({ cancelSubscriptionAt }));
    vi.unstubAllEnvs();
    expect(r).toEqual({ kind: "limited", cancelAt: "2027-01-10" });
    expect(cancelSubscriptionAt).toHaveBeenCalledWith("sub_ana", unix("2027-01-10") - 3 * 3600);
  });
});

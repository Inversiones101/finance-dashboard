import { beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { seed } from "@/db/seed";
import { loadFinanceData } from "@/lib/data/finance-data";
import { computeBalanceSheet, computeDashboard } from "@/lib/finance/engine";
import * as ledger from "@/lib/services/ledger";

/** Cada test arranca de una BD recién sembrada y verifica que las reglas automáticas se apliquen. */
let db: ledger.Tx;
let acc: Record<string, string>;
let cat: Record<string, string>;

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema: s });
  await migrate(d, { migrationsFolder: path.join(__dirname, "..", "db", "migrations") });
  await seed(d);
  db = d as unknown as ledger.Tx;
  acc = Object.fromEntries((await db.select().from(s.financialAccounts)).map((a) => [a.name, a.id]));
  cat = Object.fromEntries((await db.select().from(s.categories)).map((c) => [c.name, c.id]));
  // Mercury ya abierta para estas pruebas.
  await db.update(s.financialAccounts).set({ status: "active" }).where(eq(s.financialAccounts.institution, "Mercury"));
});

const dash = async () => {
  const data = await loadFinanceData(db);
  // Toda operación debe dejar el balance cuadrado.
  expect(computeBalanceSheet(data, { asOf: "2026-12-31", hnlPerUsd: 26.86 }).difference).toBe(0);
  return computeDashboard(data, { asOf: "2026-10-20", hnlPerUsd: 26.86 });
};
const baseExpense = (over: Partial<ledger.ExpenseInput>): ledger.ExpenseInput => ({
  expenseDate: "2026-10-05", description: "Prueba", categoryId: "", vendorId: null, frequency: "one_time",
  currency: "USD", amountCents: 10000, paymentAccountId: null, status: "paid", dueDate: null, paidOn: null, notes: null, ...over,
});

describe("gastos", () => {
  it("con tarjeta personal ⇒ aporte del dueño, la caja no cambia", async () => {
    const before = await dash();
    await ledger.saveExpense(db, baseExpense({ categoryId: cat["Marketing y publicidad"], paymentAccountId: acc["AMEX"], status: "pending" }));
    const after = await dash();
    expect(after.owner.contributed - before.owner.contributed).toBeCloseTo(100, 2);
    expect(after.cash.total).toBe(before.cash.total);
  });

  it("con Mercury Checking ⇒ sale de la caja, no es aporte", async () => {
    await ledger.transfer(db, { fromId: acc["Saldo Skool"], toId: acc["Mercury Checking"], date: "2026-10-01", amountCents: 100000, description: null });
    const before = await dash();
    const id = await ledger.saveExpense(db, baseExpense({ categoryId: cat["Marketing y publicidad"], paymentAccountId: acc["Mercury Checking"] }));
    const after = await dash();
    expect(after.cash.total).toBeCloseTo(before.cash.total - 100, 2);
    expect(after.owner.contributed).toBe(before.owner.contributed);
    // Cambiarlo a tarjeta personal revierte la salida de caja y crea el aporte.
    await ledger.saveExpense(db, baseExpense({ categoryId: cat["Marketing y publicidad"], paymentAccountId: acc["AMEX"] }), id);
    const edited = await dash();
    expect(edited.cash.total).toBe(before.cash.total);
    expect(edited.owner.contributed - before.owner.contributed).toBeCloseTo(100, 2);
  });

  it("gastos en lempiras se convierten con la tasa de su fecha", async () => {
    await db.insert(s.exchangeRates).values({ rateDate: "2026-10-01", base: "USD", quote: "HNL", rate: "25", source: "test" });
    const id = await ledger.saveExpense(db, baseExpense({ categoryId: cat["Diseño y contenido"], currency: "HNL", amountCents: 250000, paymentAccountId: acc["BAC"] }));
    const [e] = await db.select().from(s.expenses).where(eq(s.expenses.id, id));
    expect(Number(e.fxRateToUsd)).toBeCloseTo(0.04, 6); // L2,500 = $100
  });
});

describe("Mercury IO", () => {
  it("los cargos quedan por pagar; al pagar sale de Checking y entra el 1.5% de cashback", async () => {
    await ledger.transfer(db, { fromId: acc["Saldo Skool"], toId: acc["Mercury Checking"], date: "2026-10-01", amountCents: 200000, description: null });
    await ledger.saveExpense(db, baseExpense({ categoryId: cat["Software y herramientas"], paymentAccountId: acc["Mercury IO"], status: "pending", amountCents: 20000 }));
    const mid = await dash();
    expect(mid.cash.llcCards[0].balance).toBe(200);
    expect(mid.liabilities.llcPayables).toBe(200);

    const r = await ledger.payCard(db, { cardId: acc["Mercury IO"], fromAccountId: acc["Mercury Checking"], date: "2026-10-10" });
    expect(r).toEqual({ total: 20000, cashback: 300, count: 1 });
    const after = await dash();
    expect(after.cash.llcCards[0].balance).toBe(0);
    expect(after.cash.total).toBeCloseTo(mid.cash.total - 200 + 3, 2);
  });
});

describe("ingresos", () => {
  it("depositado en cuenta personal ⇒ retiro del dueño, no suma a la caja", async () => {
    const before = await dash();
    await ledger.saveRevenue(db, {
      revenueDate: "2026-10-05", productId: null, categoryId: cat["Membresías"], customerName: null, billingInterval: "one_time",
      serviceStart: null, currency: "USD", grossCents: 5000, processorFeeCents: 0, affiliateFeeCents: 0, status: "paid_out",
      depositAccountId: acc["BAC"], notes: null,
    });
    const after = await dash();
    expect(after.cash.total).toBe(before.cash.total);
    expect(after.owner.draws - before.owner.draws).toBeCloseTo(50, 2);
  });
});

describe("contratos y suscripciones", () => {
  it("pagar el resto de Skool Scaling cierra el contrato", async () => {
    const [ct] = await db.select().from(s.vendorContracts);
    await ledger.payContractInstallment(db, ct.id, { date: "2026-10-15", amountCents: 523000, accountId: acc["AMEX"] });
    const [after] = await db.select().from(s.vendorContracts);
    expect(after.status).toBe("completed");
    expect((await dash()).liabilities.commitmentsTotal).toBe(0);
  });

  it("registrar el cobro de una suscripción crea el gasto y adelanta la renovación", async () => {
    const [loom] = await db.select().from(s.subscriptions).where(eq(s.subscriptions.name, "Loom"));
    await ledger.chargeSubscription(db, loom.id, { date: "2026-10-11" });
    const [after] = await db.select().from(s.subscriptions).where(eq(s.subscriptions.id, loom.id));
    expect(after.nextRenewalOn).toBe("2026-11-11");
    const exps = await db.select().from(s.expenses).where(eq(s.expenses.subscriptionId, loom.id));
    expect(exps).toHaveLength(3);
    const charge = exps.find((e) => e.expenseDate === "2026-10-11");
    expect(charge).toMatchObject({ fundingSource: "owner_personal", status: "paid", dueDate: null }); // aporte ya hecho
  });
});

describe("Skool: payouts", () => {
  it("payout a Mercury mueve el dinero de la plataforma a la caja", async () => {
    const before = await dash();
    await ledger.payout(db, { platformId: acc["Saldo Skool"], toAccountId: acc["Mercury Checking"], date: "2026-10-01", amountCents: 300000 });
    const after = await dash();
    expect(after.platforms.total).toBeCloseTo(before.platforms.total - 3000, 2);
    expect(after.cash.total).toBeCloseTo(before.cash.total + 3000, 2);
    expect(after.kpis.netProfit).toBe(before.kpis.netProfit);
  });
  it("payout al dueño es un retiro y no pasa por la caja", async () => {
    const before = await dash();
    await ledger.payout(db, { platformId: acc["Saldo Skool"], toAccountId: null, date: "2026-10-01", amountCents: 10000 });
    const after = await dash();
    expect(after.cash.total).toBe(before.cash.total);
    expect(after.owner.draws - before.owner.draws).toBeCloseTo(100, 2);
  });
  it("no se puede sacar más de lo que hay en la plataforma", async () => {
    await expect(ledger.payout(db, { platformId: acc["Saldo Skool"], toAccountId: acc["Mercury Checking"], date: "2026-10-01", amountCents: 99999999 })).rejects.toThrow();
  });
});

describe("impuestos", () => {
  it("pagar una obligación crea el gasto y cuadra el balance", async () => {
    const [tax] = await db.select().from(s.taxObligations).where(eq(s.taxObligations.jurisdiction, "US-WY"));
    await ledger.transfer(db, { fromId: acc["Saldo Skool"], toId: acc["Mercury Checking"], date: "2026-10-01", amountCents: 10000, description: null });
    const before = await dash();
    await ledger.payTax(db, tax.id, { date: "2026-10-05", amountCents: 6000, accountId: acc["Mercury Checking"] });
    const after = await dash();
    expect(after.cash.total).toBeCloseTo(before.cash.total - 60, 2);
  });
});

describe("clasificar movimientos del banco", () => {
  const manual = async (amountCents: number, description: string) => {
    const [m] = await db.insert(s.cashMovements).values({ accountId: acc["Mercury Checking"], movementDate: "2026-10-02", type: "adjustment", amountCents, description }).returning();
    return m.id;
  };
  it("ingreso, gasto, aporte y cashback quedan donde corresponden", async () => {
    const before = await dash();
    await ledger.classifyMovement(db, await manual(6467, "Payout Nas.com"), { as: "revenue", description: "Payout Nas.com" });
    await ledger.classifyMovement(db, await manual(-2000, "Claude Pro"), { as: "expense", description: "Claude Pro", categoryId: cat["Software y herramientas"] });
    await ledger.classifyMovement(db, await manual(2387, "Wise"), { as: "owner_contribution", description: "Aporte vía Wise" });
    await ledger.classifyMovement(db, await manual(30, "Cashback IO"), { as: "other_income", description: "Cashback IO" });
    const after = await dash(); // dash() verifica que el balance cuadre
    expect(after.cash.total).toBeCloseTo(before.cash.total + 64.67 - 20 + 23.87 + 0.3, 2);
    expect(after.owner.contributed - before.owner.contributed).toBeCloseTo(23.87, 2);
    const revs = await db.select().from(s.revenues).where(eq(s.revenues.notes, "Payout Nas.com"));
    expect(revs).toHaveLength(1);
  });
  it("no deja clasificar un gasto como ingreso", async () => {
    await expect(ledger.classifyMovement(db, await manual(-500, "x"), { as: "revenue", description: "x" })).rejects.toThrow();
  });
});

describe("conciliación", () => {
  it("registra un ajuste por la diferencia con el banco", async () => {
    const r = await ledger.reconcile(db, { accountId: acc["Saldo Skool"], date: "2026-09-30", statementBalanceCents: 390000 });
    expect(r.diff).toBe(390000 - 388571);
    expect(await ledger.accountBalanceCents(db, acc["Saldo Skool"], "2026-09-30")).toBe(390000);
  });
});

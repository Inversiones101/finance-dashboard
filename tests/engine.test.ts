import { beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { seed } from "@/db/seed";
import { loadFinanceData } from "@/lib/data/finance-data";
import { computeBalanceSheet, computeBudgets, computeCashFlow, computeDashboard, computeGoals, computePnlReport, type Dashboard, type FinanceData } from "@/lib/finance/engine";

/** Corre migraciones + siembra en un Postgres en memoria y verifica el motor contra números conocidos. */
let data: FinanceData;
let d: Dashboard;

beforeAll(async () => {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "..", "db", "migrations") });
  await seed(db);
  data = await loadFinanceData(db);
  d = computeDashboard(data, { asOf: "2026-09-22", hnlPerUsd: 26.86 });
});

describe("P&L de septiembre 2026 (cuadra con el panel de Skool)", () => {
  it("ingresos netos = bruto − comisiones", () => {
    expect(d.kpis.revenueGross).toBe(4034);
    expect(d.kpis.platformFees).toBe(148);
    expect(d.kpis.revenue).toBe(3886);
  });
  it("utilidad bruta y neta", () => {
    // Lo pagado por el dueño antes del 20 sep (Loom, cuota 2, Skool Pro) es puesta en marcha:
    // fuera de la utilidad bruta y el EBITDA, pero sí resta en la utilidad neta.
    expect(d.kpis.grossProfit).toBe(3886);
    expect(d.kpis.ebitda).toBe(3886);
    expect(d.kpis.preOperating).toBe(623);
    expect(d.kpis.netProfit).toBe(3264.05); // + ajuste de conciliación de Skool ($1.05)
    expect(d.kpis.netMargin).toBeCloseTo(0.84, 2);
  });
  it("ingresos por producto separan membresía mensual y anual", () => {
    expect(d.month.revenueByProduct.map((p) => p.name).sort()).toEqual(["Membresía anual", "Membresía mensual"]);
  });
  it("MRR reparte el anual en 12 meses", () => {
    expect(d.kpis.mrr).toBe(811);
    expect(d.kpis.arr).toBe(9732);
  });
});

describe("Caja, propietario y compromisos", () => {
  it("caja = solo bancos; el saldo de Skool va aparte como plataforma de cobro", () => {
    expect(d.cash.total).toBe(0); // Mercury aún no abre
    expect(d.cash.accounts.map((a) => a.name)).toEqual(["Mercury Checking", "Mercury Savings"]);
    expect(d.platforms).toMatchObject({ total: 3885.71, accounts: [{ name: "Saldo Skool", balance: 3885.71 }] });
    expect(d.cash.llcCards[0]).toMatchObject({ name: "Mercury IO", status: "pending_opening", balance: 0 });
  });
  it("gastos pagados con dinero personal son aportes, no salen de la caja", () => {
    expect(d.owner.contributed).toBeCloseTo(3355.86, 2); // sin la comisión de minicuotas (era personal)
    expect(d.owner.draws).toBe(1.34);
  });
  it("Skool Scaling: $5,230 pendientes, próxima cuota el 15 de octubre", () => {
    expect(d.liabilities.commitments[0]).toMatchObject({ pending: 5230, paid: 2500, next: { date: "2026-10-15", amount: 500 } });
    expect(d.liabilities.debtTotal).toBe(0);
  });
  it("nada personal: lo pagado por el dueño no genera cuentas por pagar ni pagos de tarjeta", () => {
    expect(d.liabilities.llcPayables).toBe(0);
    expect(d.upcoming.some((u) => u.kind === "card")).toBe(false);
    expect(JSON.stringify(d.upcoming)).not.toMatch(/AMEX|Visa|personal/i);
  });
  it("burn neto 0 ⇒ runway infinito", () => {
    expect(d.kpis.netBurn).toBe(0);
    expect(d.kpis.runwayMonths).toBeNull();
  });
});

describe("Estados financieros", () => {
  it("el balance cuadra: activos = pasivos + patrimonio", () => {
    const b = computeBalanceSheet(data, { asOf: "2026-09-22", hnlPerUsd: 26.86 });
    expect(b.difference).toBe(0);
    expect(b.assets.total).toBe(3885.71);
    expect(b.assets.platforms).toEqual([{ name: "Saldo Skool", amount: 3885.71 }]);
    expect(b.equity.capital).toBeCloseTo(3355.86, 2);
    expect(b.equity.preOperating).toBeCloseTo(3355.86, 2); // todo lo aportado fue puesta en marcha
    expect(b.equity.draws).toBe(1.34);
  });
  it("P&L: la puesta en marcha va en su propia línea, fuera de la operación", () => {
    const r = computePnlReport(data, { from: "2026-08", to: "2026-09", granularity: "month" });
    const [aug, sep] = r.periods;
    expect(aug.opex).toBe(0);
    expect(aug.interest).toBe(0);
    expect(aug.preOperating).toBeCloseTo(2732.86, 2);
    expect(aug.netProfit).toBeCloseTo(-2732.86, 2);
    expect(sep.processorFees + sep.affiliateFees).toBe(148);
    expect(sep.ebitda).toBe(3886);
    expect(sep.preOperating).toBe(623);
    expect(sep.other).toBe(1.05);
    expect(Object.keys(sep.details.revenueByProduct).sort()).toEqual(["Membresía anual", "Membresía mensual"]);
  });
  it("flujo de efectivo: sin bancos abiertos no hay movimientos de caja", () => {
    const f = computeCashFlow(data, { from: "2026-09", to: "2026-09", granularity: "month" });
    expect(f.periods[0]).toMatchObject({ operating: 0, financing: 0, closingCash: 0 });
    expect(f.periods[0].nonCashOwnerFunded).toBe(623);
  });
});

describe("Miembros: MRR, bajas y pronóstico", () => {
  const plan = (id: string, over: Partial<NonNullable<FinanceData["members"]>[number]>) => ({
    id, name: id, productId: "p", billingInterval: "monthly" as const, currency: "USD" as const, priceCents: 3700,
    startedOn: "2026-09-01", currentPeriodEnd: "2026-10-01", status: "active" as const, canceledOn: null, accessUntil: null, ...over,
  });
  it("el MRR sale de los planes activos; una baja cuenta hasta el fin de su periodo", () => {
    const members = [
      plan("a", {}),
      plan("b", { billingInterval: "annual", priceCents: 19700, currentPeriodEnd: "2027-09-01" }),
      plan("c", { status: "canceled", canceledOn: "2026-09-20", accessUntil: "2026-10-01" }),
    ];
    const r = computeDashboard({ ...data, members }, { asOf: "2026-09-22", hnlPerUsd: 26.86, churnAssumption: 0 });
    expect(r.kpis.mrr).toBeCloseTo(37 + 37 + 197 / 12, 1); // c aún tiene acceso
    expect(r.members.canceledThisMonth).toBe(1);
    expect(r.members.forecast[0].committed).toBeCloseTo(37 + 197 / 12, 1); // oct: sin c
    expect(r.insights.some((i) => i.title.includes("baja"))).toBe(true);
  });
  it("el pronóstico aplica el churn supuesto mes a mes", () => {
    const r = computeDashboard({ ...data, members: [plan("a", { priceCents: 10000 })] }, { asOf: "2026-09-22", hnlPerUsd: 26.86, churnAssumption: 0.1 });
    expect(r.members.churnIsAssumption).toBe(true);
    expect(r.members.forecast[1].expected).toBeCloseTo(100 * 0.9 * 0.9, 1);
  });
});

describe("Planeación", () => {
  it("presupuesto del mes pisa al general y alerta al excederse", () => {
    const consultoria = data.categories.find((c) => c.name === "Consultoría y mentoría")!.id;
    const software = data.categories.find((c) => c.name === "Software y herramientas")!.id;
    const withBudgets: FinanceData = {
      ...data,
      operationsStart: null, // sin puesta en marcha: todo cuenta contra el presupuesto
      budgets: [
        { categoryId: consultoria, month: null, amountCents: 100000 },
        { categoryId: consultoria, month: "2026-09", amountCents: 40000 },
        { categoryId: software, month: null, amountCents: 10000 },
      ],
    };
    const b = computeBudgets(withBudgets, "2026-09");
    expect(b.rows.find((r) => r.name === "Consultoría y mentoría")).toMatchObject({ budget: 400, actual: 500 });
    expect(b.rows.find((r) => r.name === "Software y herramientas")).toMatchObject({ budget: 100, actual: 24 });
    expect(b.unbudgeted).toBe(99); // Skool Pro sin presupuesto
    const r = computeDashboard(withBudgets, { asOf: "2026-09-22", hnlPerUsd: 26.86 });
    expect(r.insights.some((i) => i.title === "Presupuesto excedido: Consultoría y mentoría")).toBe(true);
  });
  it("metas: acumulativas contra el ritmo esperado", () => {
    const withGoals: FinanceData = {
      ...data,
      goals: [
        { id: "g1", name: "Facturar 10k en sep", metric: "gross_revenue", target: 10000, periodStart: "2026-09-01", periodEnd: "2026-09-30", status: "active" },
        { id: "g2", name: "Facturar 4k", metric: "gross_revenue", target: 4000, periodStart: "2026-09-01", periodEnd: "2026-12-31", status: "active" },
      ],
    };
    const [g1, g2] = computeGoals(withGoals, { asOf: "2026-09-22", hnlPerUsd: 26.86 });
    expect(g1).toMatchObject({ value: 4034, status: "behind" }); // 40% con 72% del mes transcurrido
    expect(g2.status).toBe("achieved");
  });
});

describe("Genérico: datos nuevos no requieren código", () => {
  it("un producto nuevo aparece en el desglose y suma a ingresos", () => {
    const extra: FinanceData = {
      ...data,
      products: [...data.products, { id: "p-curso", name: "Curso de Bolsa" }],
      revenues: [
        ...data.revenues,
        { date: "2026-09-20", productId: "p-curso", categoryId: data.revenues[0].categoryId, billingInterval: "one_time", serviceStart: null, grossCents: 20000, processorFeeCents: 1000, affiliateFeeCents: 0, fxRateToUsd: 1, status: "available" },
      ],
    };
    const r = computeDashboard(extra, { asOf: "2026-09-22", hnlPerUsd: 26.86 });
    expect(r.kpis.revenue).toBe(3886 + 190);
    expect(r.kpis.mrr).toBe(811); // venta única: no suma al MRR
    expect(r.month.revenueByProduct.map((p) => p.name)).toContain("Curso de Bolsa");
  });
  it("MRR: un cliente que pasa de mensual a anual en el mismo mes cuenta una sola vez", () => {
    const cat = data.revenues[0].categoryId;
    const base = { productId: null, categoryId: cat, processorFeeCents: 0, affiliateFeeCents: 0, fxRateToUsd: 1, status: "available" as const };
    const only: FinanceData = {
      ...data,
      revenues: [
        { ...base, date: "2026-09-10", customerName: "Ana", billingInterval: "monthly", serviceStart: "2026-09-10", grossCents: 3700 },
        { ...base, date: "2026-09-10", customerName: "ana ", billingInterval: "annual", serviceStart: "2026-09-10", grossCents: 16700 },
        { ...base, date: "2026-09-12", customerName: "Luis", billingInterval: "monthly", serviceStart: "2026-09-12", grossCents: 3700 },
      ],
    };
    const r = computeDashboard(only, { asOf: "2026-09-22", hnlPerUsd: 26.86 });
    expect(r.kpis.mrr).toBeCloseTo(167 / 12 + 37, 0); // Ana anual + Luis mensual
    expect(r.kpis.revenueGross).toBe(37 + 167 + 37); // la facturación sí suma todo
  });
  it("una deuda nueva de la LLC aparece en pasivos y su pago en próximos movimientos", () => {
    const extra: FinanceData = {
      ...data,
      debts: [{ id: "d1", name: "Préstamo equipo", currency: "USD", principalCents: 100000, status: "active" }],
      debtPayments: [{ debtId: "d1", dueDate: "2026-10-01", paidOn: null, principalCents: 10000, interestCents: 500, feeCents: 0 }],
    };
    const r = computeDashboard(extra, { asOf: "2026-09-22", hnlPerUsd: 26.86 });
    expect(r.liabilities.debtTotal).toBe(1000);
    expect(r.upcoming.some((u) => u.kind === "debt" && u.amount === 105)).toBe(true);
  });
});

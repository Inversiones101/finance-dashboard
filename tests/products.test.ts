import { describe, expect, it } from "vitest";
import type { FinanceData } from "@/lib/finance/engine";
import { computeAffiliates, computeProductReport } from "@/lib/finance/engine";

type Rev = FinanceData["revenues"][number];
type Exp = FinanceData["expenses"][number];
const rev = (productId: string | null, gross: number, over: Partial<Rev> = {}): Rev => ({
  date: "2026-10-05", productId, categoryId: "c", billingInterval: "one_time", serviceStart: null, grossCents: gross, processorFeeCents: Math.round(gross * 0.03),
  affiliateFeeCents: 0, fxRateToUsd: 1, status: "available", ...over,
});
const exp = (amount: number, productId: string | null, over: Partial<Exp> = {}): Exp => ({
  date: "2026-10-10", description: "x", categoryId: "o", amountCents: amount, fxRateToUsd: 1, fundingSource: "llc_cash", paymentAccountId: null, dueDate: null, status: "paid", contractId: null, productId, ...over,
});
const data = (revenues: Rev[], expenses: Exp[], members: FinanceData["members"] = []): FinanceData => ({
  categories: [], products: [{ id: "curso", name: "Curso de Bolsa" }, { id: "memb", name: "Membresía mensual" }], accounts: [], revenues, expenses, movements: [],
  ownerLedger: [], debts: [], debtPayments: [], contracts: [], subscriptions: [], taxObligations: [], reminders: [], members, operationsStart: "2026-09-20",
});

describe("productos y afiliados", () => {
  it("asigna costos al producto, deja el resto como gasto general y cuadra el resultado", () => {
    const r = computeProductReport(
      data([rev("curso", 20_000), rev("curso", 20_000), rev("memb", 3_700)], [exp(15_000, "curso"), exp(5_000, null), exp(9_999, null, { fundingSource: "owner_personal", date: "2026-09-10" })]),
      { from: "2026-09-01", to: "2026-10-31" }
    );
    const curso = r.products.find((p) => p.name === "Curso de Bolsa")!;
    expect(curso).toMatchObject({ sales: 2, gross: 400, net: 388, costs: 150, contribution: 238 });
    expect(r.generalCosts).toBe(50); // la puesta en marcha no cuenta
    expect(r.result).toBeCloseTo(238 + 35.89 - 50, 2);
  });

  it("agrupa referidos y comisiones por afiliado", () => {
    const m = (id: string, invitedBy: string | null) => ({
      id, name: id, productId: "memb", billingInterval: "monthly" as const, currency: "USD" as const, priceCents: 3700, startedOn: "2026-09-01",
      currentPeriodEnd: "2026-11-01", status: "active" as const, canceledOn: null, accessUntil: null, invitedBy,
    });
    const a = computeAffiliates(
      data([rev("memb", 3_700, { affiliateName: "Luis ", affiliateFeeCents: 1_110 }), rev("memb", 3_700)], [], [m("a", "Luis"), m("b", "luis"), m("c", null)]),
      { from: "2026-10-01", to: "2026-10-31", asOf: "2026-10-20" }
    );
    expect(a).toEqual([{ name: "Luis", referred: 2, active: 2, mrr: 74, gross: 37, commissions: 11.1, costPct: 0.3 }]);
  });
});

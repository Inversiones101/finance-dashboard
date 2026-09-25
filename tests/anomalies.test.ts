import { describe, expect, it } from "vitest";
import type { FinanceData } from "@/lib/finance/engine";
import { computeAnomalies } from "@/lib/finance/anomalies";

const ASOF = "2026-10-20";
type Exp = FinanceData["expenses"][number];
const exp = (date: string, description: string, amountCents: number, categoryId = "soft"): Exp => ({
  date, description, categoryId, amountCents, fxRateToUsd: 1, fundingSource: "llc_cash", paymentAccountId: "chk", dueDate: null, status: "paid", contractId: null,
});
const data = (expenses: Exp[], members: FinanceData["members"] = []): FinanceData => ({
  categories: [{ id: "soft", name: "Software", kind: "opex" }], products: [], accounts: [], revenues: [], expenses, movements: [], ownerLedger: [],
  debts: [], debtPayments: [], contracts: [], subscriptions: [], taxObligations: [], reminders: [], members,
});
const titles = (d: FinanceData) => computeAnomalies(d, ASOF).map((i) => i.title);

describe("anomalías", () => {
  it("detecta un gasto duplicado y no un cargo mensual normal", () => {
    expect(titles(data([exp("2026-10-10", "Loom", 1500), exp("2026-10-11", "Loom", 1500)]))).toContain("¿Gasto duplicado? Loom");
    expect(titles(data([exp("2026-09-10", "Loom", 1500), exp("2026-10-10", "Loom", 1500)]))).toEqual([]);
  });

  it("avisa cuando una suscripción sube de precio", () => {
    expect(titles(data([exp("2026-09-19", "Skool Pro", 9900), exp("2026-10-19", "Skool Pro", 14900)]))).toContain("Skool Pro subió de precio");
  });

  it("avisa de renovaciones vencidas sin cobro", () => {
    const m = { id: "a", name: "Ana", productId: "p", billingInterval: "monthly" as const, currency: "USD" as const, priceCents: 3700, startedOn: "2026-09-01", currentPeriodEnd: "2026-10-01", status: "active" as const, canceledOn: null, accessUntil: null };
    expect(titles(data([], [m]))).toContain("1 renovación vencida sin cobro");
  });

  it("marca un gasto de más de 3× lo usual en su categoría", () => {
    const hist = ["2026-06-05", "2026-07-05", "2026-08-05"].map((d) => exp(d, "Herramienta", 2000));
    expect(titles(data([...hist, exp("2026-10-12", "Licencia anual", 24000)]))).toContain("Gasto fuera de lo normal en Software");
  });
});

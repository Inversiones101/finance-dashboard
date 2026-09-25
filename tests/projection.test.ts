import { describe, expect, it } from "vitest";
import type { FinanceData, Member } from "@/lib/finance/engine";
import { computeProjection } from "@/lib/finance/projection";

const ASOF = "2026-09-25";
const opts = { asOf: ASOF, hnlPerUsd: 26.9, churnAssumption: 0 };

const member = (id: string, over: Partial<Member> = {}): Member => ({
  id, name: id, productId: "p-m", billingInterval: "monthly", currency: "USD", priceCents: 3700,
  startedOn: "2026-09-01", currentPeriodEnd: "2026-10-01", status: "active", canceledOn: null, accessUntil: null, ...over,
});

function data(over: Partial<FinanceData> = {}): FinanceData {
  return {
    categories: [{ id: "c-rev", name: "Membresías", kind: "revenue" }, { id: "c-opex", name: "Software", kind: "opex" }],
    products: [{ id: "p-m", name: "Membresía mensual", listPriceCents: 3700 }, { id: "p-a", name: "Membresía anual", listPriceCents: 19700 }],
    accounts: [{ id: "chk", name: "Mercury Checking", owner: "llc", type: "checking", status: "active", currency: "USD", openingBalanceCents: 100_000, creditLimitCents: null, sortOrder: 1 }],
    revenues: [], expenses: [], movements: [], ownerLedger: [], debts: [], debtPayments: [], contracts: [], subscriptions: [], taxObligations: [], reminders: [],
    members: [], memberEvents: [],
    ...over,
  };
}

describe("proyección de caja", () => {
  it("parte de la caja real y suma las renovaciones en su fecha", () => {
    const p = computeProjection(data({ members: [member("a"), member("b", { currentPeriodEnd: "2026-10-20" })] }), opts, { newPerMonth: 0 });
    expect(p.startCash).toBe(1000);
    const w1 = p.weeks.find((w) => w.from <= "2026-10-01" && w.to >= "2026-10-01")!;
    expect(w1.inflow).toBe(37);
    expect(p.weeks.at(-1)!.endCash).toBeGreaterThan(1000 + 37 * 2); // varias renovaciones en 13 semanas
  });

  it("las suscripciones de la LLC y las cuotas de contratos salen en su fecha; las del dueño no", () => {
    const p = computeProjection(
      data({
        subscriptions: [
          { name: "Skool Pro", currency: "USD", amountCents: 9900, billingInterval: "monthly", nextRenewalOn: "2026-10-19", status: "active", paymentAccountName: "Mercury IO" },
          { name: "Loom", currency: "USD", amountCents: 1500, billingInterval: "monthly", nextRenewalOn: "2026-10-11", status: "active", paymentAccountName: null },
        ],
        contracts: [{ id: "ss", name: "Skool Scaling", currency: "USD", totalCents: 773_000, installmentDay: 15, installmentAmountCents: 50_000, status: "active" }],
      }),
      opts,
      { newPerMonth: 0 }
    );
    const all = p.weeks.flatMap((w) => w.notable.map((n) => n.label));
    expect(all).toContain("Skool Pro");
    expect(all).not.toContain("Loom");
    const oct15 = p.weeks.find((w) => w.from <= "2026-10-15" && w.to >= "2026-10-15")!;
    expect(oct15.notable.find((n) => n.label === "Cuota Skool Scaling")!.amount).toBe(-500);
  });

  it("un precio nuevo solo aplica a las altas desde su fecha y avisa cuando la caja baja del mínimo", () => {
    const base = data({ members: [member("a")] });
    const same = computeProjection(base, opts, { newPerMonth: 4 });
    const raised = computeProjection(base, opts, { newPerMonth: 4, priceChange: { monthlyCents: 4700, annualCents: null, from: "2026-11-01" } });
    expect(raised.months[0].mrr).toBe(same.months[0].mrr); // antes del lanzamiento, igual
    expect(raised.mrrIn12!).toBeGreaterThan(same.mrrIn12!);

    const tight = computeProjection(base, { ...opts, minCashCents: 50_000 }, { newPerMonth: 0, extraMonthlyCents: 200_000 });
    expect(tight.firstBelowMin).not.toBeNull();
    expect(tight.runwayMonths).not.toBeNull();
  });
});

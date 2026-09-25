/**
 * Proyección de caja (13 semanas) y simulador de escenarios (12 meses). Puro: recibe los mismos
 * datos que el motor y devuelve números; no toca la base.
 *
 * Qué se proyecta, día por día:
 *  + Renovaciones de cada miembro activo en su fecha real, a SU precio, menos comisión, y
 *    ponderadas por la probabilidad de que siga (churn).
 *  + Miembros nuevos del escenario, al precio vigente en su fecha (los precios cambian).
 *  − Suscripciones pagadas por la LLC, cuotas de contratos, cargos por pagar, deudas e impuestos.
 *  − "Otros gastos": el promedio de gasto mensual que no está en la lista anterior.
 *  − Gasto nuevo del escenario.
 * Liquidez = bancos + saldo de Skool por cobrar (llega por payout).
 */
import { computeCommunity, computeDashboard, type EngineOptions, type FinanceData } from "./engine";

export type Scenario = {
  /** Altas por mes. Por defecto, el promedio real reciente. */
  newPerMonth?: number;
  /** Churn mensual (0.05 = 5%). Por defecto, el de la página de Miembros. */
  churn?: number;
  /** Precio nuevo para miembros que entren desde `from` (centavos). */
  priceChange?: { monthlyCents: number | null; annualCents: number | null; from: string } | null;
  /** Gasto adicional mensual (centavos): contratación, publicidad… */
  extraMonthlyCents?: number;
};

type Flow = { date: string; cents: number; label: string; kind: "renewals" | "new" | "subscriptions" | "contracts" | "cards" | "debts" | "taxes" | "other" | "extra" | "expenses" };

const KIND_LABEL: Record<Flow["kind"], string> = {
  renewals: "Renovaciones de miembros",
  new: "Miembros nuevos",
  subscriptions: "Suscripciones",
  contracts: "Cuotas de contratos",
  cards: "Pago de tarjetas",
  debts: "Deudas",
  taxes: "Impuestos",
  expenses: "Gastos por pagar",
  other: "Otros gastos (promedio)",
  extra: "Gasto nuevo del escenario",
};

const MONTHS = { monthly: 1, quarterly: 3, annual: 12 } as const;
const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
function addMonthsIso(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
const monthOf = (iso: string) => iso.slice(0, 7);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const dollars = (c: number) => Math.round(c) / 100;
const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const shortDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTH_LABELS[Number(iso.slice(5, 7)) - 1].toLowerCase()}`;

export function computeProjection(data: FinanceData, opts: EngineOptions & { minCashCents?: number }, scenario: Scenario = {}) {
  const { asOf, hnlPerUsd } = opts;
  const end = addDays(asOf, 365);
  const usd = (cents: number, currency: "USD" | "HNL") => (currency === "USD" ? cents : Math.round(cents / hnlPerUsd));
  const dash = computeDashboard(data, opts);
  const community = computeCommunity(data, opts);
  const members = (data.members ?? []).filter((m) => m.status === "active" && m.billingInterval !== "one_time");

  const churn = scenario.churn ?? community.churn;
  const keep = (date: string) => Math.pow(1 - churn, Math.max(0, daysBetween(asOf, date)) / 30.44); // prob. de seguir
  const feeRate = community.feeRate;
  const startCents = Math.round((dash.cash.total + dash.platforms.total) * 100);
  const flows: Flow[] = [];

  // ── Renovaciones de los miembros actuales ────────────────────────────────
  for (const m of members) {
    const n = MONTHS[m.billingInterval as keyof typeof MONTHS];
    for (let r = m.currentPeriodEnd, k = 1; r <= end; r = addMonthsIso(m.currentPeriodEnd, n * k++)) {
      if (r < asOf) continue; // vencida sin cobro: no se asume
      flows.push({ date: r, cents: usd(m.priceCents, m.currency) * (1 - feeRate) * keep(r), label: m.name, kind: "renewals" });
    }
  }

  // ── Miembros nuevos del escenario ────────────────────────────────────────
  const recentNew = community.windowMonths ? community.newMembers / community.windowMonths : 0;
  const newPerMonth = scenario.newPerMonth ?? recentNew;
  const annualShare = (() => {
    const total = sum(community.mix.map((x) => x.members));
    return total ? (community.mix.find((x) => x.interval === "annual")?.members ?? 0) / total : 0;
  })();
  // Precio actual de lista: el más común entre los activos de cada frecuencia (o el de su producto).
  const listPrice = (interval: "monthly" | "annual") => {
    const ofInterval = members.filter((m) => m.billingInterval === interval);
    const byProduct = new Map<string, number>();
    for (const m of ofInterval) byProduct.set(m.productId, (byProduct.get(m.productId) ?? 0) + 1);
    const top = [...byProduct.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const p = data.products.find((x) => x.id === top);
    return p?.listPriceCents ?? ofInterval[0]?.priceCents ?? 0;
  };
  const priceFor = (interval: "monthly" | "annual", date: string) => {
    const pc = scenario.priceChange;
    const override = pc && date >= pc.from ? (interval === "monthly" ? pc.monthlyCents : pc.annualCents) : null;
    return override ?? listPrice(interval);
  };
  const newCohorts: { date: string; size: number; interval: "monthly" | "annual"; price: number }[] = [];
  if (newPerMonth > 0) {
    for (let d = addDays(asOf, 7); d <= end; d = addDays(d, 7)) {
      const size = (newPerMonth * 12) / 52;
      for (const [interval, share] of [["monthly", 1 - annualShare], ["annual", annualShare]] as const) {
        if (share <= 0) continue;
        const cohort = { date: d, size: size * share, interval, price: priceFor(interval, d) };
        newCohorts.push(cohort);
        for (let r = d, k = 1; r <= end; r = addMonthsIso(d, MONTHS[interval] * k++)) {
          const stay = Math.pow(1 - churn, daysBetween(d, r) / 30.44);
          flows.push({ date: r, cents: cohort.size * cohort.price * (1 - feeRate) * stay, label: "Nuevos", kind: "new" });
        }
      }
    }
  }

  // ── Salidas conocidas ────────────────────────────────────────────────────
  let knownMonthly = 0; // lo que ya se proyecta como recurrente (para no contarlo dos veces en "otros")
  for (const s of data.subscriptions) {
    if (s.status !== "active" || !s.paymentAccountName || s.billingInterval === "one_time") continue; // la paga el dueño: no sale de la LLC
    const n = MONTHS[s.billingInterval];
    knownMonthly += usd(s.amountCents, s.currency) / n;
    for (let r = s.nextRenewalOn, k = 1; r <= end; r = addMonthsIso(s.nextRenewalOn, n * k++)) {
      if (r >= asOf) flows.push({ date: r, cents: -usd(s.amountCents, s.currency), label: s.name, kind: "subscriptions" });
    }
  }
  const expenses = data.expenses.filter((e) => e.status !== "void");
  for (const ct of data.contracts.filter((c) => c.status === "active")) {
    const paid = sum(expenses.filter((e) => e.contractId === ct.id).map((e) => Math.round(e.amountCents * e.fxRateToUsd)));
    let pending = Math.max(0, usd(ct.totalCents, ct.currency) - paid);
    if (!pending || !ct.installmentDay) continue;
    const installment = ct.installmentAmountCents ? usd(ct.installmentAmountCents, ct.currency) : pending;
    knownMonthly += installment; // ya está en el promedio de gastos: no contarlo dos veces
    const paidThisMonth = expenses.some((e) => e.contractId === ct.id && monthOf(e.date) === monthOf(asOf));
    for (let k = paidThisMonth ? 1 : 0; pending > 0 && k < 36; k++) {
      const base = addMonthsIso(`${monthOf(asOf)}-01`, k);
      const last = new Date(Date.UTC(Number(base.slice(0, 4)), Number(base.slice(5, 7)), 0)).getUTCDate();
      const date = `${base.slice(0, 8)}${String(Math.min(ct.installmentDay, last)).padStart(2, "0")}`;
      if (date < asOf) continue;
      const amount = Math.min(installment, pending);
      pending -= amount;
      if (date <= end) flows.push({ date, cents: -amount, label: `Cuota ${ct.name}`, kind: "contracts" });
    }
  }
  for (const e of expenses) {
    if (e.status !== "pending" || e.fundingSource === "owner_personal") continue;
    const date = e.dueDate && e.dueDate > asOf ? e.dueDate : asOf;
    flows.push({ date, cents: -Math.round(e.amountCents * e.fxRateToUsd), label: e.description, kind: e.fundingSource === "llc_credit" ? "cards" : "expenses" });
  }
  for (const p of data.debtPayments) {
    if (p.paidOn || p.dueDate < asOf || p.dueDate > end) continue;
    const d = data.debts.find((x) => x.id === p.debtId);
    flows.push({ date: p.dueDate, cents: -(p.principalCents + p.interestCents + p.feeCents), label: d?.name ?? "Deuda", kind: "debts" });
  }
  for (const t of data.taxObligations) {
    if (["paid", "filed", "not_required"].includes(t.status) || t.dueDate < asOf || t.dueDate > end || !t.estimatedCents) continue;
    flows.push({ date: t.dueDate, cents: -usd(t.estimatedCents - t.paidCents, t.currency), label: t.name, kind: "taxes" });
  }

  // Otros gastos: promedio mensual de costos que no están en la lista (se reparte por día).
  const otherMonthly = Math.max(0, community.breakEven.fixedCosts * 100 - knownMonthly);
  const extraMonthly = scenario.extraMonthlyCents ?? 0;
  for (let d = addDays(asOf, 1); d <= end; d = addDays(d, 1)) {
    if (otherMonthly) flows.push({ date: d, cents: -otherMonthly / 30.44, label: "Otros gastos", kind: "other" });
    if (extraMonthly) flows.push({ date: d, cents: -extraMonthly / 30.44, label: "Gasto nuevo", kind: "extra" });
  }

  // ── Semanas (13) ─────────────────────────────────────────────────────────
  let cash = startCents;
  const minCash = opts.minCashCents ?? 0;
  const weeks = Array.from({ length: 13 }, (_, i) => {
    const from = addDays(asOf, i * 7);
    const to = addDays(from, 6);
    const inWeek = flows.filter((f) => f.date >= from && f.date <= to && !(i > 0 && f.date === asOf));
    const byKind = new Map<Flow["kind"], number>();
    for (const f of inWeek) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + f.cents);
    const inflow = sum(inWeek.filter((f) => f.cents > 0).map((f) => f.cents));
    const outflow = sum(inWeek.filter((f) => f.cents < 0).map((f) => f.cents));
    cash += inflow + outflow;
    const big = inWeek
      .filter((f) => f.kind !== "other" && f.kind !== "extra" && f.kind !== "renewals" && f.kind !== "new")
      .sort((a, b) => a.cents - b.cents)
      .slice(0, 4)
      .map((f) => ({ label: f.label, date: f.date, amount: dollars(f.cents) }));
    return {
      from,
      to,
      label: shortDate(from),
      inflow: dollars(inflow),
      outflow: dollars(outflow),
      net: dollars(inflow + outflow),
      endCash: dollars(cash),
      belowMin: cash < minCash,
      byKind: [...byKind.entries()].map(([k, v]) => ({ kind: k, label: KIND_LABEL[k], amount: dollars(v) })).sort((a, b) => b.amount - a.amount),
      notable: big,
    };
  });

  // ── Meses (12): caja, MRR y miembros esperados ───────────────────────────
  cash = startCents;
  let runwayMonths: number | null = null;
  let breakEvenMonth: string | null = null;
  const fixedMonthly = community.breakEven.fixedCosts * 100 + extraMonthly;
  const months = Array.from({ length: 12 }, (_, i) => {
    const from = i === 0 ? asOf : `${monthOf(addMonthsIso(`${monthOf(asOf)}-01`, i))}-01`;
    const to = addDays(`${monthOf(addMonthsIso(`${monthOf(asOf)}-01`, i + 1))}-01`, -1);
    cash += sum(flows.filter((f) => f.date > (i === 0 ? addDays(asOf, -1) : addDays(from, -1)) && f.date <= to).map((f) => f.cents));
    if (runwayMonths === null && cash < 0) runwayMonths = i;
    const existing = sum(members.map((m) => (usd(m.priceCents, m.currency) / MONTHS[m.billingInterval as keyof typeof MONTHS]) * keep(to)));
    const fresh = newCohorts.filter((c) => c.date <= to);
    const newMrr = sum(fresh.map((c) => ((c.size * c.price) / MONTHS[c.interval]) * Math.pow(1 - churn, daysBetween(c.date, to) / 30.44)));
    const count = sum(members.map(() => keep(to))) + sum(fresh.map((c) => c.size * Math.pow(1 - churn, daysBetween(c.date, to) / 30.44)));
    const mrr = existing + newMrr;
    if (breakEvenMonth === null && fixedMonthly > 0 && mrr * (1 - feeRate) >= fixedMonthly) breakEvenMonth = monthOf(to);
    return { month: monthOf(to), label: MONTH_LABELS[Number(to.slice(5, 7)) - 1], cash: dollars(cash), mrr: dollars(mrr), members: Math.round(count) };
  });

  const low = weeks.reduce((a, w) => (w.endCash < a.endCash ? w : a), weeks[0]);
  return {
    asOf,
    startCash: dollars(startCents),
    minCash: dollars(minCash),
    assumptions: {
      churn,
      newPerMonth,
      recentNewPerMonth: recentNew,
      feeRate,
      annualShare,
      otherMonthly: dollars(otherMonthly),
      extraMonthly: dollars(extraMonthly),
      monthlyPrice: dollars(listPrice("monthly")),
      annualPrice: dollars(listPrice("annual")),
    },
    weeks,
    lowestWeek: { label: low.label, endCash: low.endCash },
    firstBelowMin: weeks.find((w) => w.belowMin) ?? null,
    months,
    runwayMonths,
    breakEvenMonth,
    mrrIn6: months[5]?.mrr ?? null,
    mrrIn12: months[11]?.mrr ?? null,
  };
}

export type Projection = ReturnType<typeof computeProjection>;

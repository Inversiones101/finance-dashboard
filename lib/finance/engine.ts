/**
 * Motor de cálculo financiero. Funciones puras: reciben registros y devuelven métricas.
 * No conoce nombres de productos, categorías ni cuentas: todo sale de los datos, así que
 * agregar un producto, una categoría, una deuda o una cuenta no requiere tocar código.
 *
 * Reglas:
 *  - Estado de resultados: facturación − comisiones = ingreso neto; − costos directos = utilidad bruta;
 *    − gastos operativos = EBITDA; − D&A = EBIT; − intereses ± otros = utilidad antes de impuestos;
 *    − impuestos = utilidad neta.
 *  - Caja: solo cuentas BANCARIAS de la LLC. El saldo de plataformas (Skool) es dinero por cobrar
 *    que solo sale por payouts; las tarjetas son pasivos.
 *  - Dueño: aportes / retiros viven en su propio ledger y en el patrimonio del balance.
 *  - MRR: suma de los planes de los miembros activos (o, sin miembros, de los cobros recurrentes).
 * Montos internos en centavos USD; la salida en dólares.
 */

export type Currency = "USD" | "HNL";
export type CategoryKind = "revenue" | "cogs" | "opex";
export type PnlLine = "operating" | "depreciation" | "interest" | "income_tax";
export type BillingInterval = "one_time" | "monthly" | "quarterly" | "annual";
export type FundingSource = "llc_cash" | "llc_credit" | "owner_personal";
export type AccountType = "checking" | "savings" | "credit_card" | "processor" | "cash";

export type FinanceData = {
  categories: { id: string; name: string; kind: CategoryKind; pnlLine?: PnlLine }[];
  products: { id: string; name: string; listPriceCents?: number | null }[];
  accounts: {
    id: string;
    name: string;
    owner: "llc" | "personal";
    type: AccountType;
    status: "active" | "pending_opening" | "closed";
    currency: Currency;
    openingBalanceCents: number;
    creditLimitCents: number | null;
    sortOrder: number;
  }[];
  revenues: {
    date: string;
    productId: string | null;
    customerName?: string | null;
    categoryId: string;
    billingInterval: BillingInterval;
    serviceStart: string | null;
    grossCents: number;
    processorFeeCents: number;
    affiliateFeeCents: number;
    fxRateToUsd: number;
    status: "pending" | "available" | "paid_out" | "refunded" | "disputed";
    depositAccountId?: string | null;
    affiliateName?: string | null;
  }[];
  expenses: {
    date: string;
    description: string;
    categoryId: string;
    amountCents: number;
    fxRateToUsd: number;
    fundingSource: FundingSource;
    paymentAccountId: string | null;
    dueDate: string | null;
    status: "pending" | "paid" | "financed" | "void";
    contractId: string | null;
    productId?: string | null;
  }[];
  movements: {
    accountId: string;
    date: string;
    amountCents: number;
    fxRateToUsd: number;
    type?: string;
    transferGroupId?: string | null;
    debtPaymentId?: string | null;
    linked?: boolean; // viene de un ingreso/gasto/pago (no es un movimiento suelto)
  }[];
  ownerLedger: { date: string; type: "contribution" | "loan" | "reimbursement" | "draw"; amountCents: number; fxRateToUsd: number }[];
  debts: { id: string; name: string; currency: Currency; principalCents: number; status: string }[];
  debtPayments: { id?: string; debtId: string; dueDate: string; paidOn: string | null; principalCents: number; interestCents: number; feeCents: number }[];
  contracts: {
    id: string;
    name: string;
    currency: Currency;
    totalCents: number;
    installmentDay: number | null;
    installmentAmountCents: number | null;
    status: "active" | "completed" | "canceled";
  }[];
  subscriptions: {
    name: string;
    currency: Currency;
    amountCents: number;
    billingInterval: BillingInterval;
    nextRenewalOn: string;
    status: "active" | "paused" | "canceled";
    paymentAccountName: string | null;
  }[];
  taxObligations: { name: string; dueDate: string; currency: Currency; estimatedCents: number; paidCents: number; status: string }[];
  reminders: { dueOn: string; title: string; detail: string | null; amountCents: number | null; done: boolean }[];
  members?: Member[];
  /** Bitácora del MRR (alta, cambio, baja, reactivación) con su efecto en centavos al mes. */
  memberEvents?: MemberEvent[];
  budgets?: { categoryId: string; month: string | null; amountCents: number }[];
  goals?: Goal[];
  /**
   * Inicio de operaciones (YYYY-MM-DD). Lo que el dueño pagó de su bolsillo antes de esta fecha
   * es puesta en marcha: se financia con su capital inicial y queda fuera de la operación
   * (utilidad bruta, EBITDA, márgenes, burn); aparece en una línea aparte debajo del EBIT.
   */
  operationsStart?: string | null;
};

export type GoalMetric = "gross_revenue" | "net_revenue" | "net_profit" | "mrr" | "active_members" | "new_members" | "cash";
export type Goal = { id: string; name: string; metric: GoalMetric; target: number; periodStart: string; periodEnd: string; status: "active" | "archived" };

export type Member = {
  id: string;
  name: string;
  productId: string;
  billingInterval: BillingInterval;
  currency: Currency;
  priceCents: number;
  startedOn: string;
  currentPeriodEnd: string;
  status: "active" | "canceled";
  canceledOn: string | null;
  accessUntil: string | null;
  invitedBy?: string | null;
};

export type MemberEvent = { memberId: string; date: string; type: "new" | "change" | "cancel" | "reactivate"; mrrDeltaCents: number };

export type EngineOptions = {
  /** Fecha de corte YYYY-MM-DD (hoy, en la zona horaria del negocio). */
  asOf: string;
  /** Lempiras por dólar hoy — para montos que no guardan tasa propia (suscripciones, contratos…). */
  hnlPerUsd: number;
  /** Meses a mostrar en la gráfica. */
  months?: number;
  /** Meses para promediar el burn rate. */
  burnLookbackMonths?: number;
  /** Días hacia adelante para "próximos movimientos". */
  horizonDays?: number;
  /** Churn mensual supuesto para el pronóstico cuando aún no hay historial (0.05 = 5%). */
  churnAssumption?: number;
};

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const INTERVAL_MONTHS: Record<Exclude<BillingInterval, "one_time">, number> = { monthly: 1, quarterly: 3, annual: 12 };

// ── Utilidades de fecha (strings YYYY-MM-DD, sin zonas horarias) ──────────────
const monthOf = (iso: string) => iso.slice(0, 7);
function addMonths(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysInMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
export function monthLabel(month: string) {
  return MONTH_LABELS[Number(month.slice(5, 7)) - 1];
}
export function monthName(month: string) {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

const toDollars = (cents: number) => Math.round(cents) / 100;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const usd = (cents: number, fx: number) => Math.round(cents * fx);
const fmt = (cents: number) => toDollars(cents).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const isBank = (a: FinanceData["accounts"][number]) => a.owner === "llc" && (a.type === "checking" || a.type === "savings" || a.type === "cash");
const isPlatform = (a: FinanceData["accounts"][number]) => a.owner === "llc" && a.type === "processor";
/** Movimientos sueltos que van al estado de resultados (no nacen de un ingreso/gasto). */
const PNL_MOVEMENT_TYPES = new Set(["fee", "interest", "adjustment", "tax_payment"]);

// ─────────────────────────────────────────────────────────────────────────────
// Estado de resultados: una sola fuente para dashboard y reportes
// ─────────────────────────────────────────────────────────────────────────────

type Lines = {
  gross: number;
  processorFees: number;
  affiliateFees: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  opex: number;
  ebitda: number;
  depreciation: number;
  ebit: number;
  interest: number;
  other: number; // otros ingresos (+) / gastos (−)
  preOperating: number; // gastos de puesta en marcha pagados con capital del dueño
  ebt: number;
  taxes: number;
  netProfit: number;
  expenseCount: number;
  detail: {
    revenueByProduct: Map<string, number>;
    cogsByCategory: Map<string, number>;
    opexByCategory: Map<string, number>;
    interestByCategory: Map<string, number>;
    preOperatingByCategory: Map<string, number>;
    otherByType: Map<string, number>;
  };
};

const OTHER_LABEL: Record<string, string> = {
  fee: "Comisiones bancarias",
  interest: "Intereses ganados",
  adjustment: "Ajustes de conciliación",
  tax_payment: "Impuestos pagados",
};

function makePnl(data: FinanceData) {
  const cat = new Map(data.categories.map((c) => [c.id, c]));
  const productName = new Map(data.products.map((p) => [p.id, p.name]));
  const accountById = new Map(data.accounts.map((a) => [a.id, a]));
  const revenues = data.revenues.filter((r) => r.status !== "refunded" && r.status !== "disputed");
  const expenses = data.expenses.filter((e) => e.status !== "void");
  const pnlMovements = data.movements.filter((m) => {
    const a = accountById.get(m.accountId);
    return !m.linked && m.type && PNL_MOVEMENT_TYPES.has(m.type) && a && a.owner === "llc" && a.type !== "credit_card";
  });

  const add = (map: Map<string, number>, k: string, v: number) => map.set(k, (map.get(k) ?? 0) + v);
  const isPreOperating = (e: FinanceData["expenses"][number]) =>
    !!data.operationsStart && e.fundingSource === "owner_personal" && e.date < data.operationsStart;

  /** Líneas del P&L para las fechas que cumplan `inPeriod`. */
  return function lines(inPeriod: (date: string) => boolean): Lines {
    const d: Lines["detail"] = {
      revenueByProduct: new Map(),
      cogsByCategory: new Map(),
      opexByCategory: new Map(),
      interestByCategory: new Map(),
      preOperatingByCategory: new Map(),
      otherByType: new Map(),
    };
    let gross = 0, processorFees = 0, affiliateFees = 0, cogs = 0, opex = 0, depreciation = 0, interest = 0, taxes = 0, other = 0, preOperating = 0, expenseCount = 0;

    for (const r of revenues) {
      if (!inPeriod(r.date)) continue;
      const g = usd(r.grossCents, r.fxRateToUsd);
      gross += g;
      processorFees += usd(r.processorFeeCents, r.fxRateToUsd);
      affiliateFees += usd(r.affiliateFeeCents, r.fxRateToUsd);
      add(d.revenueByProduct, (r.productId && productName.get(r.productId)) || cat.get(r.categoryId)?.name || "Sin producto", g);
    }
    for (const e of expenses) {
      if (!inPeriod(e.date)) continue;
      const v = usd(e.amountCents, e.fxRateToUsd);
      const c = cat.get(e.categoryId);
      const name = c?.name ?? "Sin categoría";
      if (isPreOperating(e)) {
        preOperating += v;
        add(d.preOperatingByCategory, name, v);
        continue;
      }
      expenseCount++;
      const line = c?.pnlLine ?? "operating";
      if (line === "depreciation") depreciation += v;
      else if (line === "income_tax") taxes += v;
      else if (line === "interest") {
        interest += v;
        add(d.interestByCategory, name, v);
      } else if (c?.kind === "cogs") {
        cogs += v;
        add(d.cogsByCategory, name, v);
      } else {
        opex += v;
        add(d.opexByCategory, name, v);
      }
    }
    for (const p of data.debtPayments) {
      if (!p.paidOn || !inPeriod(p.paidOn)) continue;
      const v = p.interestCents + p.feeCents;
      interest += v;
      if (v) add(d.interestByCategory, "Intereses de deudas", v);
    }
    for (const m of pnlMovements) {
      if (!inPeriod(m.date)) continue;
      const v = usd(m.amountCents, m.fxRateToUsd);
      if (m.type === "fee" && v <= 0) {
        opex += -v;
        add(d.opexByCategory, OTHER_LABEL.fee, -v);
      } else if (m.type === "tax_payment") taxes += -v;
      else {
        other += v;
        add(d.otherByType, OTHER_LABEL[m.type!] ?? m.type!, v);
      }
    }

    const revenue = gross - processorFees - affiliateFees;
    const grossProfit = revenue - cogs;
    const ebitda = grossProfit - opex;
    const ebit = ebitda - depreciation;
    const ebt = ebit - interest + other - preOperating;
    const netProfit = ebt - taxes;
    return { gross, processorFees, affiliateFees, revenue, cogs, grossProfit, opex, ebitda, depreciation, ebit, interest, other, preOperating, ebt, taxes, netProfit, expenseCount, detail: d };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Miembros: MRR, churn y pronóstico
// ─────────────────────────────────────────────────────────────────────────────

/** ¿El miembro cuenta para el MRR en la fecha `date`? Cancelado ⇒ cuenta hasta su `accessUntil`. */
function memberCountsOn(m: Member, date: string) {
  if (m.startedOn > date) return false;
  if (m.status === "active") return true;
  return !!m.accessUntil && m.accessUntil > date; // el día que vence su acceso ya no cuenta
}

export function computeMembers(data: FinanceData, opts: EngineOptions) {
  const { asOf, hnlPerUsd, churnAssumption = 0.05 } = opts;
  const members = data.members ?? [];
  const monthlyValue = (m: Member) => {
    if (m.billingInterval === "one_time") return 0;
    const cents = m.currency === "USD" ? m.priceCents : m.priceCents / hnlPerUsd;
    return cents / INTERVAL_MONTHS[m.billingInterval];
  };
  const mrrOn = (date: string) => Math.round(sum(members.filter((m) => memberCountsOn(m, date)).map(monthlyValue)));
  const currentMonth = monthOf(asOf);

  // Churn: bajas del mes ÷ miembros activos al inicio del mes (promedio de los últimos 3 meses con datos).
  const churnFor = (month: string) => {
    const start = `${month}-01`;
    const base = members.filter((m) => m.startedOn < start && memberCountsOn(m, start)).length;
    const lost = members.filter((m) => m.canceledOn && monthOf(m.canceledOn) === month).length;
    return { base, lost, rate: base ? lost / base : null };
  };
  const recent = [0, 1, 2].map((k) => churnFor(addMonths(currentMonth, -k))).filter((c) => c.base > 0);
  const observedChurn = recent.length ? sum(recent.map((c) => c.lost)) / sum(recent.map((c) => c.base)) : null;
  const hasHistory = recent.some((c) => c.lost > 0) || recent.length >= 3;
  const churn = hasHistory && observedChurn !== null ? observedChurn : churnAssumption;

  const active = members.filter((m) => memberCountsOn(m, asOf));
  const mrr = mrrOn(asOf);
  const forecast = Array.from({ length: 6 }, (_, i) => {
    const month = addMonths(currentMonth, i + 1);
    const committed = mrrOn(`${month}-01`);
    const expected = Math.round(committed * Math.pow(1 - churn, i + 1));
    return { month, label: monthLabel(month), committed: toDollars(committed), expected: toDollars(expected) };
  });

  const renewalsSoon = members
    .filter((m) => m.status === "active" && m.billingInterval !== "monthly" && m.currentPeriodEnd >= asOf && daysBetween(asOf, m.currentPeriodEnd) <= 30)
    .map((m) => ({ name: m.name, date: m.currentPeriodEnd, amount: toDollars(m.priceCents) }));

  return {
    hasMembers: members.length > 0,
    mrr,
    activeCount: active.length,
    byInterval: {
      monthly: active.filter((m) => m.billingInterval === "monthly").length,
      quarterly: active.filter((m) => m.billingInterval === "quarterly").length,
      annual: active.filter((m) => m.billingInterval === "annual").length,
    },
    canceledThisMonth: members.filter((m) => m.canceledOn && monthOf(m.canceledOn) === currentMonth).length,
    churnRate: observedChurn,
    churnUsed: churn,
    churnIsAssumption: !(hasHistory && observedChurn !== null),
    lastMonthMrr: mrrOn(`${currentMonth}-01`),
    forecast,
    renewalsSoon,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Métricas de comunidad: movimiento del MRR, punto de equilibrio, LTV/CAC, cohortes
// ─────────────────────────────────────────────────────────────────────────────

const MARKETING = /marketing|publicidad|ads|anuncio/i;

/**
 * Todo sale de datos reales: el movimiento del MRR de la bitácora de miembros (así un aumento de
 * precio para nuevos no se confunde con expansión), los costos del P&L y el churn observado.
 * Cuando un dato aún no es confiable devuelve `null` y la pantalla lo explica en vez de inventar.
 */
export function computeCommunity(data: FinanceData, opts: EngineOptions & { lookbackMonths?: number }) {
  const { asOf, lookbackMonths = 3 } = opts;
  const members = data.members ?? [];
  const events = (data.memberEvents ?? []).filter((e) => e.date <= asOf);
  const currentMonth = monthOf(asOf);
  const base = computeMembers(data, opts);
  const lines = makePnl(data);

  // ── Movimiento del MRR (últimos 6 meses con actividad) ─────────────────────
  const firstEvent = events.reduce<string | null>((min, e) => (!min || e.date < min ? e.date : min), null);
  const start = firstEvent && monthOf(firstEvent) > addMonths(currentMonth, -5) ? monthOf(firstEvent) : addMonths(currentMonth, -5);
  const movement: { month: string; label: string; new: number; expansion: number; contraction: number; churn: number; reactivation: number; net: number; endMrr: number }[] = [];
  for (let m = start; m <= currentMonth; m = addMonths(m, 1)) {
    const inMonth = events.filter((e) => monthOf(e.date) === m);
    const by = (f: (e: MemberEvent) => boolean) => sum(inMonth.filter(f).map((e) => e.mrrDeltaCents));
    const row = {
      new: by((e) => e.type === "new"),
      expansion: by((e) => e.type === "change" && e.mrrDeltaCents > 0),
      contraction: by((e) => e.type === "change" && e.mrrDeltaCents < 0),
      churn: by((e) => e.type === "cancel"),
      reactivation: by((e) => e.type === "reactivate"),
    };
    const net = row.new + row.expansion + row.contraction + row.churn + row.reactivation;
    const endMrr = sum(events.filter((e) => monthOf(e.date) <= m).map((e) => e.mrrDeltaCents));
    movement.push({
      month: m,
      label: monthLabel(m),
      new: toDollars(row.new),
      expansion: toDollars(row.expansion),
      contraction: toDollars(row.contraction),
      churn: toDollars(row.churn),
      reactivation: toDollars(row.reactivation),
      net: toDollars(net),
      endMrr: toDollars(endMrr),
    });
  }

  // ── Economía por miembro ───────────────────────────────────────────────────
  const window = Array.from({ length: lookbackMonths }, (_, i) => addMonths(currentMonth, -i));
  const pnl = lines((d) => window.includes(monthOf(d)));
  const months = Math.max(1, Math.min(lookbackMonths, window.filter((m) => !firstEvent || m >= monthOf(firstEvent)).length));
  const arpu = base.activeCount ? base.mrr / base.activeCount : null; // centavos al mes
  const feeRate = pnl.gross > 0 ? (pnl.processorFees + pnl.affiliateFees) / pnl.gross : 0;
  const grossMargin = pnl.revenue > 0 ? pnl.grossProfit / pnl.revenue : null;
  const contribution = arpu !== null ? arpu * (1 - feeRate) * (grossMargin ?? 1) : null; // lo que deja cada miembro al mes

  // Punto de equilibrio: costos fijos del mes (gastos operativos + costos directos) ÷ lo que deja cada miembro.
  const fixedCosts = (pnl.opex + pnl.cogs + pnl.depreciation + pnl.interest) / months;
  const contributionForBreakEven = arpu !== null ? arpu * (1 - feeRate) : null;
  const membersNeeded = contributionForBreakEven && fixedCosts > 0 ? Math.ceil(fixedCosts / contributionForBreakEven) : null;

  // LTV = lo que deja un miembro al mes × cuántos meses se queda (1 / churn).
  const ltv = contribution !== null && base.churnUsed > 0 ? contribution / base.churnUsed : null;

  // CAC = gasto en marketing ÷ miembros nuevos, en la misma ventana.
  const marketing = sum([...pnl.detail.opexByCategory.entries()].filter(([name]) => MARKETING.test(name)).map(([, v]) => v));
  const newMembers = members.filter((m) => window.includes(monthOf(m.startedOn))).length;
  const cac = newMembers > 0 ? marketing / newMembers : null;
  const payback = cac && contribution ? cac / contribution : null;

  // ── Cohortes: de los que entraron cada mes, % que sigue activo k meses después ─
  const cohortMonths = [...new Set(members.map((m) => monthOf(m.startedOn)))].sort().slice(-12);
  const cohorts = cohortMonths.map((cm) => {
    const group = members.filter((m) => monthOf(m.startedOn) === cm);
    const retention: (number | null)[] = [];
    for (let k = 0; k <= 11; k++) {
      const month = addMonths(cm, k);
      if (month > currentMonth) break;
      const at = month === currentMonth ? asOf : `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
      retention.push(group.length ? group.filter((m) => memberCountsOn(m, at)).length / group.length : null);
    }
    return { month: cm, label: monthLabel(cm), size: group.length, retention };
  });

  // ── Mezcla de planes ───────────────────────────────────────────────────────
  const active = members.filter((m) => memberCountsOn(m, asOf));
  const mrrOf = (m: Member) => (m.billingInterval === "one_time" ? 0 : m.priceCents / INTERVAL_MONTHS[m.billingInterval]);
  const mix = (["monthly", "annual", "quarterly"] as const)
    .map((interval) => {
      const list = active.filter((m) => m.billingInterval === interval);
      return { interval, members: list.length, mrr: toDollars(sum(list.map(mrrOf))) };
    })
    .filter((x) => x.members > 0);

  return {
    mrr: toDollars(base.mrr),
    activeCount: base.activeCount,
    movement,
    hasMovement: events.length > 0,
    arpu: arpu !== null ? toDollars(arpu) : null,
    feeRate,
    grossMargin,
    breakEven: {
      fixedCosts: toDollars(fixedCosts),
      membersNeeded,
      progress: membersNeeded ? Math.min(1, base.activeCount / membersNeeded) : null,
      missing: membersNeeded !== null ? Math.max(0, membersNeeded - base.activeCount) : null,
      mrrNeeded: 1 - feeRate > 0 ? toDollars(fixedCosts / (1 - feeRate)) : null,
    },
    churn: base.churnUsed,
    churnIsAssumption: base.churnIsAssumption,
    ltv: ltv !== null ? toDollars(ltv) : null,
    marketing: toDollars(marketing),
    newMembers,
    cac: cac !== null ? toDollars(cac) : null,
    ltvToCac: ltv !== null && cac ? ltv / cac : null,
    paybackMonths: payback,
    windowMonths: months,
    cohorts,
    mix,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rentabilidad por producto y afiliados
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Por producto: ventas, bruto, comisiones, ingreso neto, costos asignados (gastos con ese
 * producto) y contribución. Lo no asignado queda en "Gastos generales" para que cuadre con el P&L.
 * La puesta en marcha no entra (es capital inicial). `from`/`to` son fechas YYYY-MM-DD.
 */
export function computeProductReport(data: FinanceData, { from, to }: { from: string; to: string }) {
  const inRange = (d: string) => d >= from && d <= to;
  const revenues = data.revenues.filter((r) => r.status !== "refunded" && r.status !== "disputed" && inRange(r.date));
  const expenses = data.expenses.filter(
    (e) => e.status !== "void" && inRange(e.date) && !(data.operationsStart && e.fundingSource === "owner_personal" && e.date < data.operationsStart)
  );
  const name = new Map(data.products.map((p) => [p.id, p.name]));
  const rows = new Map<string, { productId: string | null; name: string; sales: number; gross: number; fees: number; affiliate: number; costs: number }>();
  const row = (id: string | null) => {
    const key = id ?? "";
    if (!rows.has(key)) rows.set(key, { productId: id, name: id ? (name.get(id) ?? "Producto eliminado") : "Sin producto", sales: 0, gross: 0, fees: 0, affiliate: 0, costs: 0 });
    return rows.get(key)!;
  };
  for (const r of revenues) {
    const x = row(r.productId);
    x.sales++;
    x.gross += usd(r.grossCents, r.fxRateToUsd);
    x.fees += usd(r.processorFeeCents, r.fxRateToUsd);
    x.affiliate += usd(r.affiliateFeeCents, r.fxRateToUsd);
  }
  let general = 0;
  for (const e of expenses) {
    const v = usd(e.amountCents, e.fxRateToUsd);
    if (e.productId) row(e.productId).costs += v;
    else general += v;
  }
  const products = [...rows.values()]
    .map((x) => {
      const net = x.gross - x.fees - x.affiliate;
      const contribution = net - x.costs;
      return {
        productId: x.productId,
        name: x.name,
        sales: x.sales,
        gross: toDollars(x.gross),
        fees: toDollars(x.fees),
        affiliate: toDollars(x.affiliate),
        net: toDollars(net),
        costs: toDollars(x.costs),
        contribution: toDollars(contribution),
        margin: net > 0 ? contribution / net : null,
      };
    })
    .sort((a, b) => b.net - a.net);
  const totalContribution = sum(products.map((p) => p.contribution * 100));
  return { products, generalCosts: toDollars(general), result: toDollars(totalContribution - general) };
}

/** Por afiliado: miembros referidos (activos y totales), ventas que trajeron y comisiones que ganaron. */
export function computeAffiliates(data: FinanceData, { from, to, asOf }: { from: string; to: string; asOf: string }) {
  const key = (s: string) => s.trim().toLowerCase();
  const out = new Map<string, { name: string; referred: number; active: number; mrr: number; gross: number; commissions: number }>();
  const get = (n: string) => {
    if (!out.has(key(n))) out.set(key(n), { name: n.trim(), referred: 0, active: 0, mrr: 0, gross: 0, commissions: 0 });
    return out.get(key(n))!;
  };
  for (const m of data.members ?? []) {
    if (!m.invitedBy?.trim()) continue;
    const a = get(m.invitedBy);
    a.referred++;
    if (memberCountsOn(m, asOf)) {
      a.active++;
      a.mrr += m.billingInterval === "one_time" ? 0 : m.priceCents / INTERVAL_MONTHS[m.billingInterval];
    }
  }
  for (const r of data.revenues) {
    if (!r.affiliateName?.trim() || r.status === "refunded" || r.status === "disputed" || r.date < from || r.date > to) continue;
    const a = get(r.affiliateName);
    a.gross += usd(r.grossCents, r.fxRateToUsd);
    a.commissions += usd(r.affiliateFeeCents, r.fxRateToUsd);
  }
  return [...out.values()]
    .map((a) => ({ ...a, mrr: toDollars(a.mrr), gross: toDollars(a.gross), commissions: toDollars(a.commissions), costPct: a.gross ? a.commissions / a.gross : null }))
    .sort((a, b) => b.gross - a.gross || b.referred - a.referred);
}

// ─────────────────────────────────────────────────────────────────────────────
// Planeación: presupuestos y metas
// ─────────────────────────────────────────────────────────────────────────────

/** Presupuesto vs. gasto real del mes, por categoría. Un presupuesto del mes pisa al general. */
export function computeBudgets(data: FinanceData, month: string) {
  const cat = new Map(data.categories.map((c) => [c.id, c]));
  const budgets = data.budgets ?? [];
  const byCategory = new Map<string, number>();
  for (const b of budgets) {
    if (b.month === month) byCategory.set(b.categoryId, b.amountCents);
    else if (b.month === null && !budgets.some((x) => x.categoryId === b.categoryId && x.month === month)) byCategory.set(b.categoryId, b.amountCents);
  }
  const operating = (e: FinanceData["expenses"][number]) =>
    e.status !== "void" && monthOf(e.date) === month && !(data.operationsStart && e.fundingSource === "owner_personal" && e.date < data.operationsStart);
  const actualOf = (categoryId: string) =>
    sum(data.expenses.filter((e) => operating(e) && e.categoryId === categoryId).map((e) => usd(e.amountCents, e.fxRateToUsd)));
  const rows = [...byCategory.entries()]
    .map(([categoryId, budget]) => {
      const actual = actualOf(categoryId);
      return { categoryId, name: cat.get(categoryId)?.name ?? "Sin categoría", kind: cat.get(categoryId)?.kind ?? "opex", budget: toDollars(budget), actual: toDollars(actual), pct: budget ? actual / budget : null };
    })
    .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
  const budgetTotal = sum(rows.map((r) => r.budget));
  const actualTotal = sum(rows.map((r) => r.actual));
  const unbudgeted = toDollars(
    sum(data.expenses.filter((e) => operating(e) && !byCategory.has(e.categoryId)).map((e) => usd(e.amountCents, e.fxRateToUsd)))
  );
  return { month, rows, budgetTotal, actualTotal, pct: budgetTotal ? actualTotal / budgetTotal : null, unbudgeted };
}

export const GOAL_METRICS: Record<GoalMetric, { label: string; kind: "money" | "count"; cumulative: boolean }> = {
  gross_revenue: { label: "Facturación bruta", kind: "money", cumulative: true },
  net_revenue: { label: "Ingreso neto", kind: "money", cumulative: true },
  net_profit: { label: "Utilidad neta", kind: "money", cumulative: true },
  mrr: { label: "MRR", kind: "money", cumulative: false },
  active_members: { label: "Miembros activos", kind: "count", cumulative: false },
  new_members: { label: "Miembros nuevos", kind: "count", cumulative: true },
  cash: { label: "Caja en bancos", kind: "money", cumulative: false },
};

/**
 * Avance de cada meta. Las acumulativas (ventas, utilidad, altas) se comparan contra el ritmo
 * lineal esperado a la fecha; las de nivel (MRR, miembros, caja) contra el objetivo final.
 */
export function computeGoals(data: FinanceData, opts: EngineOptions) {
  const { asOf } = opts;
  const lines = makePnl(data);
  const members = computeMembers(data, opts);
  const bankIds = new Set(data.accounts.filter((a) => isBank(a) && a.status === "active").map((a) => a.id));
  const cash =
    sum(data.accounts.filter((a) => bankIds.has(a.id)).map((a) => (a.currency === "USD" ? a.openingBalanceCents : 0))) +
    sum(data.movements.filter((m) => bankIds.has(m.accountId) && m.date <= asOf).map((m) => usd(m.amountCents, m.fxRateToUsd)));

  return (data.goals ?? [])
    .filter((g) => g.status === "active")
    .map((g) => {
      const end = g.periodEnd < asOf ? g.periodEnd : asOf;
      const inPeriod = (d: string) => d >= g.periodStart && d <= end;
      let value: number;
      switch (g.metric) {
        case "gross_revenue": value = toDollars(lines(inPeriod).gross); break;
        case "net_revenue": value = toDollars(lines(inPeriod).revenue); break;
        case "net_profit": value = toDollars(lines(inPeriod).netProfit); break;
        case "mrr": value = toDollars(members.hasMembers ? members.mrr : 0); break;
        case "active_members": value = members.activeCount; break;
        case "new_members": value = (data.members ?? []).filter((m) => inPeriod(m.startedOn)).length; break;
        case "cash": value = toDollars(cash); break;
      }
      const total = Math.max(1, daysBetween(g.periodStart, g.periodEnd));
      const elapsed = Math.min(1, Math.max(0, daysBetween(g.periodStart, asOf) / total));
      const progress = g.target ? value / g.target : 0;
      const meta = GOAL_METRICS[g.metric];
      const expected = meta.cumulative ? elapsed : null;
      const status = progress >= 1 ? "achieved" : asOf > g.periodEnd ? "missed" : expected !== null && progress < expected - 0.15 ? "behind" : "on_track";
      return { ...g, label: meta.label, kind: meta.kind, value, progress, elapsed, expected, status, daysLeft: Math.max(0, daysBetween(asOf, g.periodEnd)) };
    });
}

export type GoalProgress = ReturnType<typeof computeGoals>[number];

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────

export type Insight = {
  severity: "urgent" | "warning" | "info" | "tip";
  title: string;
  detail: string;
  href?: string;
};

export function computeDashboard(data: FinanceData, opts: EngineOptions) {
  const { asOf, hnlPerUsd, months = 6, burnLookbackMonths = 3, horizonDays = 45 } = opts;
  const currentMonth = monthOf(asOf);
  const horizon = addDays(asOf, horizonDays);
  const usdByCurrency = (cents: number, currency: Currency) => (currency === "USD" ? cents : Math.round(cents / hnlPerUsd));
  const accountById = new Map(data.accounts.map((a) => [a.id, a]));
  const expenses = data.expenses.filter((e) => e.status !== "void");
  const lines = makePnl(data);

  // ── Serie mensual ───────────────────────────────────────────────────────────
  const firstActivity = [...data.revenues.map((r) => r.date), ...expenses.map((e) => e.date)].sort()[0];
  const window = addMonths(currentMonth, -(months - 1));
  const startMonth = firstActivity && monthOf(firstActivity) > window ? monthOf(firstActivity) : window;
  const monthList: string[] = [];
  for (let m = startMonth; m <= currentMonth; m = addMonths(m, 1)) monthList.push(m);
  const series = monthList.map((month) => ({ month, ...lines((d) => monthOf(d) === month) }));
  const current = series[series.length - 1];
  const previous = series.length > 1 ? series[series.length - 2] : null;
  const totalCosts = (l: Lines) => l.cogs + l.opex + l.depreciation + l.interest + l.taxes;

  // ── MRR: por miembros; sin miembros, por cobros recurrentes ─────────────────
  const members = computeMembers(data, opts);
  const chargeMrr = (() => {
    const byCustomer = new Map<string, { date: string; months: number; value: number }>();
    data.revenues.forEach((r, i) => {
      if (r.billingInterval === "one_time" || r.status === "refunded" || r.status === "disputed") return;
      const n = INTERVAL_MONTHS[r.billingInterval];
      const start = monthOf(r.serviceStart ?? r.date);
      if (currentMonth < start || currentMonth > addMonths(start, n - 1)) return;
      const key = r.customerName?.trim().toLowerCase() || `#${i}`;
      const candidate = { date: r.serviceStart ?? r.date, months: n, value: usd(r.grossCents, r.fxRateToUsd) / n };
      const cur = byCustomer.get(key);
      if (!cur || candidate.date > cur.date || (candidate.date === cur.date && candidate.months > cur.months)) byCustomer.set(key, candidate);
    });
    return Math.round(sum([...byCustomer.values()].map((c) => c.value)));
  })();
  const mrr = members.hasMembers ? members.mrr : chargeMrr;

  // ── Caja (bancos), plataformas y tarjetas ───────────────────────────────────
  const balanceOf = (accountId: string) => {
    const a = accountById.get(accountId)!;
    return usdByCurrency(a.openingBalanceCents, a.currency) + sum(data.movements.filter((m) => m.accountId === accountId && m.date <= asOf).map((m) => usd(m.amountCents, m.fxRateToUsd)));
  };
  const llcOpen = data.accounts.filter((a) => a.owner === "llc" && a.status !== "closed").sort((a, b) => a.sortOrder - b.sortOrder);
  const banks = llcOpen.filter(isBank);
  const platforms = llcOpen.filter(isPlatform);
  const cashTotal = sum(banks.filter((a) => a.status === "active").map((a) => balanceOf(a.id)));
  const platformTotal = sum(platforms.filter((a) => a.status === "active").map((a) => balanceOf(a.id)));

  const cardOwed = (id: string) =>
    sum(expenses.filter((e) => e.paymentAccountId === id && e.fundingSource === "llc_credit" && e.status === "pending").map((e) => usd(e.amountCents, e.fxRateToUsd)));
  const llcCards = llcOpen
    .filter((a) => a.type === "credit_card")
    .map((a) => {
      const owed = cardOwed(a.id);
      return {
        name: a.name,
        status: a.status,
        balance: toDollars(owed),
        limit: a.creditLimitCents !== null ? toDollars(usdByCurrency(a.creditLimitCents, a.currency)) : null,
        available: a.creditLimitCents !== null ? toDollars(usdByCurrency(a.creditLimitCents, a.currency) - owed) : null,
      };
    });

  // ── Burn & runway (sobre la caja bancaria) ──────────────────────────────────
  const burnWindow = series.slice(-burnLookbackMonths);
  const grossBurn = burnWindow.length ? sum(burnWindow.map(totalCosts)) / burnWindow.length : 0;
  const netBurn = burnWindow.length ? Math.max(0, sum(burnWindow.map((m) => totalCosts(m) - m.revenue)) / burnWindow.length) : 0;
  const runwayMonths = netBurn > 0 ? (cashTotal + platformTotal) / netBurn : null;

  // ── Pasivos y compromisos de la LLC ─────────────────────────────────────────
  const debts = data.debts
    .filter((d) => d.status === "active")
    .map((d) => {
      const paid = sum(data.debtPayments.filter((p) => p.debtId === d.id && p.paidOn).map((p) => p.principalCents));
      return { name: d.name, balance: toDollars(usdByCurrency(d.principalCents - paid, d.currency)) };
    });
  const llcPayables = sum(expenses.filter((e) => e.status === "pending" && e.fundingSource !== "owner_personal").map((e) => usd(e.amountCents, e.fxRateToUsd)));

  const commitments = data.contracts
    .filter((ct) => ct.status === "active")
    .map((ct) => {
      const payments = expenses.filter((e) => e.contractId === ct.id);
      const paid = sum(payments.map((e) => usd(e.amountCents, e.fxRateToUsd)));
      const total = usdByCurrency(ct.totalCents, ct.currency);
      const pending = Math.max(0, total - paid);
      let next: { date: string; amount: number } | null = null;
      if (pending > 0 && ct.installmentDay) {
        const paidThisMonth = payments.some((e) => monthOf(e.date) === currentMonth);
        let month = paidThisMonth ? addMonths(currentMonth, 1) : currentMonth;
        let date = `${month}-${String(Math.min(ct.installmentDay, daysInMonth(month))).padStart(2, "0")}`;
        if (date < asOf) {
          month = addMonths(month, 1);
          date = `${month}-${String(Math.min(ct.installmentDay, daysInMonth(month))).padStart(2, "0")}`;
        }
        const installment = ct.installmentAmountCents ? usdByCurrency(ct.installmentAmountCents, ct.currency) : pending;
        next = { date, amount: toDollars(Math.min(installment, pending)) };
      }
      return { name: ct.name, total: toDollars(total), paid: toDollars(paid), pending: toDollars(pending), progress: total ? paid / total : 1, next };
    });

  // ── Dueño (solo para su sección privada; el dashboard no lo muestra) ────────
  const ownerSum = (type: FinanceData["ownerLedger"][number]["type"]) =>
    sum(data.ownerLedger.filter((o) => o.type === type && o.date <= asOf).map((o) => usd(o.amountCents, o.fxRateToUsd)));
  const owner = {
    contributed: toDollars(ownerSum("contribution")),
    draws: toDollars(ownerSum("draw")),
    owedToOwner: toDollars(ownerSum("loan") - ownerSum("reimbursement")),
  };

  // ── Desgloses del mes ───────────────────────────────────────────────────────
  const toList = (m: Map<string, number>) => [...m.entries()].map(([name, cents]) => ({ name, amount: toDollars(cents) })).sort((a, b) => b.amount - a.amount);
  const expensesByCategory = toList(new Map([...current.detail.cogsByCategory, ...current.detail.opexByCategory, ...current.detail.interestByCategory]));
  const revenueByProductNet = (() => {
    // Neto por producto: se reparte la comisión en proporción al bruto.
    const feeRatio = current.gross ? current.revenue / current.gross : 0;
    return toList(new Map([...current.detail.revenueByProduct].map(([k, v]) => [k, Math.round(v * feeRatio)])));
  })();

  // ── Próximos movimientos (solo de la LLC) ───────────────────────────────────
  type Upcoming = { date: string; title: string; detail: string; amount: number | null; kind: "reminder" | "subscription" | "contract" | "card" | "debt" | "tax" | "renewal" };
  const upcoming: Upcoming[] = [];
  const inHorizon = (d: string) => d >= asOf && d <= horizon;

  for (const r of data.reminders) if (!r.done && inHorizon(r.dueOn)) upcoming.push({ date: r.dueOn, title: r.title, detail: r.detail ?? "", amount: r.amountCents ? toDollars(r.amountCents) : null, kind: "reminder" });
  for (const s of data.subscriptions)
    if (s.status === "active" && inHorizon(s.nextRenewalOn))
      upcoming.push({ date: s.nextRenewalOn, title: `Renovación ${s.name}`, detail: s.paymentAccountName ?? "Pagado con aporte del dueño", amount: toDollars(usdByCurrency(s.amountCents, s.currency)), kind: "subscription" });
  for (const ct of commitments)
    if (ct.next && inHorizon(ct.next.date))
      upcoming.push({ date: ct.next.date, title: `Cuota ${ct.name}`, detail: `Quedan ${fmt(ct.pending * 100)} por pagar`, amount: ct.next.amount, kind: "contract" });
  // Tarjetas de la LLC con cargos por pagar, agrupadas por fecha de vencimiento.
  const cardDue = new Map<string, { card: string; amount: number; n: number }>();
  for (const e of expenses) {
    if (e.fundingSource !== "llc_credit" || e.status !== "pending" || !e.paymentAccountId) continue;
    const date = e.dueDate ?? asOf;
    const key = `${date}|${e.paymentAccountId}`;
    const g = cardDue.get(key) ?? { card: accountById.get(e.paymentAccountId)?.name ?? "Tarjeta", amount: 0, n: 0 };
    g.amount += usd(e.amountCents, e.fxRateToUsd);
    g.n++;
    cardDue.set(key, g);
  }
  for (const [key, g] of cardDue) {
    const date = key.split("|")[0];
    if (date <= horizon) upcoming.push({ date: date < asOf ? asOf : date, title: `Pago ${g.card}`, detail: `${g.n} cargos de la LLC`, amount: toDollars(g.amount), kind: "card" });
  }
  for (const p of data.debtPayments)
    if (!p.paidOn && inHorizon(p.dueDate)) {
      const d = data.debts.find((x) => x.id === p.debtId);
      upcoming.push({ date: p.dueDate, title: `Pago ${d?.name ?? "deuda"}`, detail: "Deuda de la LLC", amount: toDollars(p.principalCents + p.interestCents + p.feeCents), kind: "debt" });
    }
  for (const t of data.taxObligations)
    if (!["paid", "filed", "not_required"].includes(t.status) && inHorizon(t.dueDate))
      upcoming.push({ date: t.dueDate, title: t.name, detail: "Impuestos", amount: t.estimatedCents ? toDollars(usdByCurrency(t.estimatedCents - t.paidCents, t.currency)) : null, kind: "tax" });
  if (members.renewalsSoon.length) {
    const first = members.renewalsSoon.map((r) => r.date).sort()[0];
    upcoming.push({
      date: first,
      title: `${members.renewalsSoon.length} renovación${members.renewalsSoon.length === 1 ? "" : "es"} anual${members.renewalsSoon.length === 1 ? "" : "es"}`,
      detail: "Miembros anuales en los próximos 30 días",
      amount: sum(members.renewalsSoon.map((r) => r.amount)),
      kind: "renewal",
    });
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date));

  const nextTax = data.taxObligations.filter((t) => !["paid", "filed", "not_required"].includes(t.status) && t.dueDate >= asOf).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

  // ── Alertas y sugerencias ───────────────────────────────────────────────────
  const insights: Insight[] = [];
  for (const u of upcoming) {
    const days = daysBetween(asOf, u.date);
    if (days <= 7 && u.kind !== "renewal") {
      insights.push({
        severity: "urgent",
        title: `${u.title} ${days <= 0 ? "hoy" : days === 1 ? "mañana" : `en ${days} días`}`,
        detail: [u.amount !== null ? fmt(u.amount * 100) : null, u.detail].filter(Boolean).join(" · "),
        href: u.kind === "contract" || u.kind === "debt" ? "/deudas" : u.kind === "tax" ? "/impuestos" : u.kind === "subscription" ? "/suscripciones" : u.kind === "card" ? "/cuentas" : "/catalogos",
      });
    }
  }
  if (nextTax && daysBetween(asOf, nextTax.dueDate) <= 60 && daysBetween(asOf, nextTax.dueDate) > 7)
    insights.push({ severity: "warning", title: `${nextTax.name} vence en ${daysBetween(asOf, nextTax.dueDate)} días`, detail: "Prepara la documentación con tiempo.", href: "/impuestos" });
  if (runwayMonths !== null && runwayMonths < 6)
    insights.push({ severity: "urgent", title: `Runway de ${runwayMonths.toFixed(1)} meses`, detail: "Al ritmo actual la caja no llega a 6 meses. Revisa gastos o acelera cobros.", href: "/reportes" });
  if (current.revenue > 0 && totalCosts(current) > current.revenue)
    insights.push({ severity: "warning", title: "Los gastos superan a los ingresos este mes", detail: `Gastos ${fmt(totalCosts(current))} vs. ingreso neto ${fmt(current.revenue)}.`, href: "/gastos" });
  else if (current.revenue > 0 && current.netProfit / current.revenue < 0.2)
    insights.push({ severity: "warning", title: `Margen neto bajo (${Math.round((current.netProfit / current.revenue) * 100)}%)`, detail: "Por debajo del 20% que se espera en un negocio de membresías.", href: "/reportes" });
  if (current.gross > 0 && (current.processorFees + current.affiliateFees) / current.gross > 0.08)
    insights.push({ severity: "warning", title: `Comisiones altas: ${Math.round(((current.processorFees + current.affiliateFees) / current.gross) * 100)}% de la facturación`, detail: "Revisa el plan de la plataforma o las comisiones de afiliados.", href: "/reportes" });
  if (previous && previous.revenue > 0 && current.revenue < previous.revenue * 0.8 && Number(asOf.slice(8, 10)) >= 20)
    insights.push({ severity: "warning", title: "Ingresos por debajo del mes pasado", detail: `${fmt(current.revenue)} vs. ${fmt(previous.revenue)} el mes anterior.`, href: "/ingresos" });
  if (members.hasMembers && members.canceledThisMonth > 0)
    insights.push({ severity: "warning", title: `${members.canceledThisMonth} baja${members.canceledThisMonth === 1 ? "" : "s"} este mes`, detail: members.churnRate !== null ? `Churn de ${(members.churnRate * 100).toFixed(1)}% en los últimos meses.` : "Revisa por qué se fueron.", href: "/miembros" });
  if (members.hasMembers && members.lastMonthMrr > 0 && members.mrr < members.lastMonthMrr)
    insights.push({ severity: "warning", title: "El MRR bajó este mes", detail: `${fmt(members.mrr)} hoy vs. ${fmt(members.lastMonthMrr)} al inicio del mes.`, href: "/miembros" });
  if (platformTotal > 0 && cashTotal < grossBurn)
    insights.push({ severity: "tip", title: `Tienes ${fmt(platformTotal)} en plataformas de cobro`, detail: "Haz un payout a Mercury para que el dinero esté disponible para pagar.", href: "/cuentas" });
  for (const c of llcCards)
    if (c.limit && c.balance / c.limit > 0.8) insights.push({ severity: "warning", title: `${c.name} al ${Math.round((c.balance / c.limit) * 100)}% del límite`, detail: "Págala para liberar crédito.", href: "/cuentas" });
  if (members.renewalsSoon.length)
    insights.push({ severity: "info", title: `${members.renewalsSoon.length} miembro${members.renewalsSoon.length === 1 ? "" : "s"} anual${members.renewalsSoon.length === 1 ? "" : "es"} renueva${members.renewalsSoon.length === 1 ? "" : "n"} pronto`, detail: `${fmt(sum(members.renewalsSoon.map((r) => r.amount)) * 100)} en los próximos 30 días. Buen momento para escribirles.`, href: "/miembros" });
  if (members.activeCount >= 10 && members.byInterval.monthly / members.activeCount > 0.4)
    insights.push({
      severity: "tip",
      title: `${Math.round((members.byInterval.monthly / members.activeCount) * 100)}% de tus miembros paga mensual`,
      detail: "Una oferta para pasar a anual adelanta caja y reduce el churn.",
      href: "/miembros",
    });
  const productShares = [...current.detail.revenueByProduct.values()];
  if (current.gross > 0 && data.products.length > 0 && current.detail.revenueByProduct.size > 0 && Math.max(...productShares) / current.gross > 0.9 && members.activeCount >= 10)
    insights.push({ severity: "tip", title: "Todo el ingreso viene de un solo producto", detail: "Un curso o una mentoría aparte diversificaría el riesgo.", href: "/catalogos" });
  if (Number(asOf.slice(8, 10)) >= 10 && current.gross === 0 && series.length > 1)
    insights.push({ severity: "warning", title: "Aún no hay ingresos registrados este mes", detail: "Registra los cobros de la plataforma para que los números estén al día.", href: "/ingresos" });
  // Métricas del negocio
  if (current.revenue > 0 && current.grossProfit / current.revenue < 0.6)
    insights.push({ severity: "warning", title: `Margen bruto bajo (${Math.round((current.grossProfit / current.revenue) * 100)}%)`, detail: "Los costos directos se comen más del 40% del ingreso. Revisa plataformas y costos de entrega.", href: "/reportes" });
  if (netBurn > 0)
    insights.push({ severity: "warning", title: `Estás quemando ${fmt(netBurn)} al mes`, detail: "En promedio, los gastos superan a los ingresos. Revisa el burn rate en Reportes.", href: "/reportes" });
  const prevWindow = series.slice(-(burnLookbackMonths * 2), -burnLookbackMonths);
  if (prevWindow.length === burnLookbackMonths && burnWindow.length === burnLookbackMonths) {
    const before = sum(prevWindow.map(totalCosts)) / prevWindow.length;
    if (before > 0 && grossBurn > before * 1.25)
      insights.push({ severity: "warning", title: `El burn rate subió ${Math.round((grossBurn / before - 1) * 100)}%`, detail: `Gasto mensual promedio de ${fmt(grossBurn)} vs. ${fmt(before)} el trimestre anterior.`, href: "/gastos" });
  }
  if (previous && previous.revenue > 0 && Number(asOf.slice(8, 10)) >= 20) {
    const costGrowth = totalCosts(previous) ? totalCosts(current) / totalCosts(previous) - 1 : 0;
    const revGrowth = current.revenue / previous.revenue - 1;
    if (costGrowth > 0.2 && costGrowth > revGrowth + 0.2)
      insights.push({ severity: "warning", title: "Los gastos crecen más rápido que los ingresos", detail: `Gastos +${Math.round(costGrowth * 100)}% vs. ingresos ${revGrowth >= 0 ? "+" : ""}${Math.round(revGrowth * 100)}% contra el mes pasado.`, href: "/reportes" });
  }
  if (members.hasMembers && members.churnRate !== null && members.churnRate > 0.05)
    insights.push({
      severity: members.churnRate > 0.08 ? "urgent" : "warning",
      title: `Churn alto: ${(members.churnRate * 100).toFixed(1)}% mensual`,
      detail: "Más del 5% de tus miembros se va cada mes. Revisa onboarding y contenido de retención.",
      href: "/miembros",
    });

  // Presupuestos y metas
  const budgets = computeBudgets(data, currentMonth);
  for (const b of budgets.rows) {
    if (b.pct !== null && b.pct > 1)
      insights.push({ severity: "warning", title: `Presupuesto excedido: ${b.name}`, detail: `${fmt(b.actual * 100)} de ${fmt(b.budget * 100)} (${Math.round(b.pct * 100)}%).`, href: "/presupuestos" });
    else if (b.pct !== null && b.pct > 0.85)
      insights.push({ severity: "info", title: `${b.name} al ${Math.round(b.pct * 100)}% del presupuesto`, detail: `Quedan ${fmt((b.budget - b.actual) * 100)} este mes.`, href: "/presupuestos" });
  }
  const goals = computeGoals(data, opts);
  for (const g of goals) {
    if (g.status === "behind")
      insights.push({ severity: "warning", title: `Meta atrasada: ${g.name}`, detail: `Vas en ${Math.round(g.progress * 100)}% con ${Math.round(g.elapsed * 100)}% del tiempo transcurrido.`, href: "/metas" });
    else if (g.status === "achieved")
      insights.push({ severity: "info", title: `¡Meta cumplida: ${g.name}!`, detail: "Buen momento para fijar la siguiente.", href: "/metas" });
  }

  const bankIds = new Set(banks.map((a) => a.id));
  const unclassified = data.movements.filter((m) => m.type === "adjustment" && !m.linked && bankIds.has(m.accountId)).length;
  if (unclassified)
    insights.push({
      severity: "warning",
      title: `${unclassified} movimiento${unclassified === 1 ? "" : "s"} bancario${unclassified === 1 ? "" : "s"} sin clasificar`,
      detail: "Cuentan como ajustes y distorsionan tus resultados. Márcalos como aporte, ingreso, gasto o cashback.",
      href: "/cuentas",
    });
  const ORDER = { urgent: 0, warning: 1, info: 2, tip: 3 } as const;
  insights.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

  return {
    asOf,
    period: { month: currentMonth, name: monthName(currentMonth) },
    kpis: {
      revenue: toDollars(current.revenue),
      revenueGross: toDollars(current.gross),
      platformFees: toDollars(current.processorFees + current.affiliateFees),
      cogs: toDollars(current.cogs),
      opex: toDollars(current.opex),
      grossProfit: toDollars(current.grossProfit),
      ebitda: toDollars(current.ebitda),
      preOperating: toDollars(current.preOperating),
      netProfit: toDollars(current.netProfit),
      netMargin: current.revenue > 0 ? current.netProfit / current.revenue : null,
      revenueMoM: previous && previous.revenue > 0 ? current.revenue / previous.revenue - 1 : null,
      mrr: toDollars(mrr),
      arr: toDollars(mrr * 12),
      grossBurn: toDollars(grossBurn),
      netBurn: toDollars(netBurn),
      runwayMonths,
    },
    cash: {
      total: toDollars(cashTotal),
      accounts: banks.map((a) => ({ name: a.name, type: a.type, status: a.status, balance: a.status === "active" ? toDollars(balanceOf(a.id)) : null })),
      llcCards,
    },
    platforms: {
      total: toDollars(platformTotal),
      accounts: platforms.map((a) => ({ name: a.name, status: a.status, balance: a.status === "active" ? toDollars(balanceOf(a.id)) : null })),
    },
    members: {
      hasMembers: members.hasMembers,
      active: members.activeCount,
      byInterval: members.byInterval,
      canceledThisMonth: members.canceledThisMonth,
      churnRate: members.churnRate,
      churnUsed: members.churnUsed,
      churnIsAssumption: members.churnIsAssumption,
      forecast: members.forecast,
    },
    month: {
      expenses: toDollars(totalCosts(current)),
      expenseCount: current.expenseCount,
      revenueByProduct: revenueByProductNet,
      expensesByCategory,
    },
    liabilities: {
      debt: debts,
      debtTotal: sum(debts.map((d) => d.balance)),
      llcPayables: toDollars(llcPayables),
      commitments,
      commitmentsTotal: sum(commitments.map((c) => c.pending)),
    },
    owner,
    series: series.map((m) => ({
      month: m.month,
      label: monthLabel(m.month),
      gross: toDollars(m.gross),
      revenue: toDollars(m.revenue),
      expenses: toDollars(totalCosts(m)),
      net: toDollars(m.netProfit),
    })),
    upcoming,
    insights,
    budgets,
    goals,
    nextTax: nextTax ? { name: nextTax.name, dueDate: nextTax.dueDate } : null,
  };
}

export type Dashboard = ReturnType<typeof computeDashboard>;

// ─────────────────────────────────────────────────────────────────────────────
// Reportes
// ─────────────────────────────────────────────────────────────────────────────

export type Granularity = "month" | "quarter" | "year";

const periodKey = (month: string, g: Granularity) =>
  g === "month" ? month : g === "year" ? month.slice(0, 4) : `${month.slice(0, 4)}-T${Math.ceil(Number(month.slice(5, 7)) / 3)}`;

export function periodLabel(key: string, g: Granularity) {
  if (g === "year") return key;
  if (g === "quarter") return key.replace("-T", " · T");
  return `${MONTH_LABELS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

function periodKeys(from: string, to: string, g: Granularity) {
  const keys: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) {
    const k = periodKey(m, g);
    if (!keys.includes(k)) keys.push(k);
  }
  return keys;
}

function shiftKey(key: string, g: Granularity, years: number, steps: number) {
  if (g === "year") return String(Number(key) - years - steps);
  if (g === "quarter") {
    const [y, q] = key.split("-T").map(Number);
    const idx = y * 4 + (q - 1) - years * 4 - steps;
    return `${Math.floor(idx / 4)}-T${(idx % 4) + 1}`;
  }
  return addMonths(key, -years * 12 - steps);
}

/** Primer y último día del periodo (para el balance y el flujo). */
function periodBounds(key: string, g: Granularity) {
  if (g === "month") return { start: `${key}-01`, end: `${key}-${String(daysInMonth(key)).padStart(2, "0")}` };
  if (g === "year") return { start: `${key}-01-01`, end: `${key}-12-31` };
  const [y, q] = key.split("-T").map(Number);
  const first = `${y}-${String((q - 1) * 3 + 1).padStart(2, "0")}`;
  const last = addMonths(first, 2);
  return { start: `${first}-01`, end: `${last}-${String(daysInMonth(last)).padStart(2, "0")}` };
}

export const PNL_ROWS = [
  { key: "gross", label: "Facturación bruta", detail: "revenueByProduct" },
  { key: "processorFees", label: "− Comisiones de plataforma", out: true },
  { key: "affiliateFees", label: "− Comisiones de afiliados", out: true },
  { key: "revenue", label: "Ingreso neto", strong: true },
  { key: "cogs", label: "− Costos directos", out: true, detail: "cogsByCategory" },
  { key: "grossProfit", label: "Utilidad bruta", strong: true },
  { key: "opex", label: "− Gastos operativos", out: true, detail: "opexByCategory" },
  { key: "ebitda", label: "EBITDA", strong: true },
  { key: "depreciation", label: "− Depreciación y amortización", out: true },
  { key: "ebit", label: "EBIT (utilidad operativa)", strong: true },
  { key: "interest", label: "− Intereses y costos financieros", out: true, detail: "interestByCategory" },
  { key: "other", label: "± Otros ingresos y gastos", detail: "otherByType" },
  { key: "preOperating", label: "− Puesta en marcha (cubierta con capital inicial)", out: true, detail: "preOperatingByCategory" },
  { key: "ebt", label: "Utilidad antes de impuestos", strong: true },
  { key: "taxes", label: "− Impuestos sobre la renta", out: true },
  { key: "netProfit", label: "Utilidad neta", strong: true },
] as const;

export type PnlKey = (typeof PNL_ROWS)[number]["key"];
type DetailKey = keyof Lines["detail"];

/**
 * Estado de resultados por mes, trimestre o año, con desglose de cada línea.
 * `prev` = periodo anterior, `yoy` = mismo periodo del año pasado.
 */
export function computePnlReport(data: FinanceData, { from, to, granularity }: { from: string; to: string; granularity: Granularity }) {
  const lines = makePnl(data);
  const forKey = (key: string) => {
    const { start, end } = periodBounds(key, granularity);
    return lines((d) => d >= start && d <= end);
  };
  const shape = (l: Lines) => {
    const values = Object.fromEntries(PNL_ROWS.map((r) => [r.key, toDollars(l[r.key])])) as Record<PnlKey, number>;
    const details = Object.fromEntries(
      (["revenueByProduct", "cogsByCategory", "opexByCategory", "interestByCategory", "otherByType", "preOperatingByCategory"] as DetailKey[]).map((k) => [
        k,
        Object.fromEntries([...l.detail[k]].map(([name, v]) => [name, toDollars(v)])),
      ])
    ) as Record<DetailKey, Record<string, number>>;
    return { ...values, netMargin: l.revenue ? l.netProfit / l.revenue : null, ebitdaMargin: l.revenue ? l.ebitda / l.revenue : null, grossMargin: l.revenue ? l.grossProfit / l.revenue : null, details };
  };

  const keys = periodKeys(from, to, granularity);
  const periods = keys.map((key) => {
    const cur = shape(forKey(key));
    const prev = shape(forKey(shiftKey(key, granularity, 0, 1)));
    const yoy = granularity === "year" ? null : shape(forKey(shiftKey(key, granularity, 1, 0)));
    return { key, label: periodLabel(key, granularity), ...cur, prev, yoy };
  });
  const total = shape(lines((d) => monthOf(d) >= from && monthOf(d) <= to));
  return { granularity, periods, total };
}

// ── Flujo de efectivo (método directo, solo cuentas bancarias de la LLC) ──────

export const CASHFLOW_ROWS = {
  operating: [
    { key: "collections", label: "Cobros de clientes (payouts y depósitos)" },
    { key: "suppliers", label: "Pagos a proveedores y tarjetas" },
    { key: "interestPaid", label: "Intereses pagados" },
    { key: "bankOther", label: "Comisiones, intereses ganados y ajustes" },
    { key: "taxesPaid", label: "Impuestos pagados" },
  ],
  investing: [{ key: "investing", label: "Compras de activos" }],
  financing: [
    { key: "ownerIn", label: "Aportes de capital del dueño" },
    { key: "ownerOut", label: "Retiros del dueño" },
    { key: "debtIn", label: "Préstamos recibidos" },
    { key: "debtOut", label: "Pago de capital de deudas" },
  ],
} as const;

export function computeCashFlow(data: FinanceData, { from, to, granularity }: { from: string; to: string; granularity: Granularity }) {
  const accountById = new Map(data.accounts.map((a) => [a.id, a]));
  const bankIds = new Set(data.accounts.filter(isBank).map((a) => a.id));
  const debtPaymentById = new Map(data.debtPayments.filter((p) => p.id).map((p) => [p.id!, p]));
  const groupAccounts = new Map<string, string[]>();
  for (const m of data.movements) if (m.transferGroupId) groupAccounts.set(m.transferGroupId, [...(groupAccounts.get(m.transferGroupId) ?? []), m.accountId]);
  const opening = sum(data.accounts.filter(isBank).map((a) => (a.currency === "USD" ? a.openingBalanceCents : 0)));
  const balanceUntil = (date: string) => opening + sum(data.movements.filter((m) => bankIds.has(m.accountId) && m.date <= date).map((m) => usd(m.amountCents, m.fxRateToUsd)));

  const classify = (m: FinanceData["movements"][number]): [string, number][] => {
    const v = usd(m.amountCents, m.fxRateToUsd);
    switch (m.type) {
      case "revenue_payout":
      case "revenue_direct":
        return [["collections", v]];
      case "expense_payment":
      case "card_payment":
        return [["suppliers", v]];
      case "tax_payment":
        return [["taxesPaid", v]];
      case "fee":
      case "interest":
      case "adjustment":
        return [["bankOther", v]];
      case "owner_contribution":
        return [["ownerIn", v]];
      case "owner_draw":
      case "owner_reimbursement":
        return [["ownerOut", v]];
      case "debt_disbursement":
        return [["debtIn", v]];
      case "debt_payment": {
        const p = m.debtPaymentId ? debtPaymentById.get(m.debtPaymentId) : undefined;
        const total = p ? p.principalCents + p.interestCents + p.feeCents : 0;
        const interestShare = p && total ? Math.round((v * (p.interestCents + p.feeCents)) / total) : 0;
        return [["debtOut", v - interestShare], ["interestPaid", interestShare]];
      }
      case "transfer": {
        // Entre bancos propios no es flujo; desde/hacia una plataforma equivale a un payout.
        const others = (m.transferGroupId ? groupAccounts.get(m.transferGroupId) ?? [] : []).filter((id) => id !== m.accountId);
        const fromPlatform = others.some((id) => accountById.get(id)?.type === "processor");
        return fromPlatform ? [["collections", v]] : [];
      }
      default:
        return [["bankOther", v]];
    }
  };

  const keys = periodKeys(from, to, granularity);
  const periods = keys.map((key) => {
    const { start, end } = periodBounds(key, granularity);
    const rows: Record<string, number> = {};
    for (const m of data.movements) {
      if (!bankIds.has(m.accountId) || m.date < start || m.date > end) continue;
      for (const [k, v] of classify(m)) rows[k] = (rows[k] ?? 0) + v;
    }
    const sec = (list: readonly { key: string }[]) => sum(list.map((r) => rows[r.key] ?? 0));
    const operating = sec(CASHFLOW_ROWS.operating);
    const investing = sec(CASHFLOW_ROWS.investing);
    const financing = sec(CASHFLOW_ROWS.financing);
    const openingCash = balanceUntil(addDays(start, -1));
    const nonCashOwner = sum(
      data.ownerLedger.filter((o) => o.type === "contribution" && o.date >= start && o.date <= end).map((o) => usd(o.amountCents, o.fxRateToUsd))
    ) - sum(data.movements.filter((m) => m.type === "owner_contribution" && bankIds.has(m.accountId) && m.date >= start && m.date <= end).map((m) => usd(m.amountCents, m.fxRateToUsd)));
    return {
      key,
      label: periodLabel(key, granularity),
      rows: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, toDollars(v)])),
      operating: toDollars(operating),
      investing: toDollars(investing),
      financing: toDollars(financing),
      netChange: toDollars(operating + investing + financing),
      openingCash: toDollars(openingCash),
      closingCash: toDollars(balanceUntil(end)),
      nonCashOwnerFunded: toDollars(Math.max(0, nonCashOwner)),
    };
  });
  return { granularity, periods };
}

// ── Balance general ───────────────────────────────────────────────────────────

export function computeBalanceSheet(data: FinanceData, { asOf, hnlPerUsd }: { asOf: string; hnlPerUsd: number }) {
  const usdByCurrency = (cents: number, currency: Currency) => (currency === "USD" ? cents : Math.round(cents / hnlPerUsd));
  const balance = (a: FinanceData["accounts"][number]) =>
    usdByCurrency(a.openingBalanceCents, a.currency) + sum(data.movements.filter((m) => m.accountId === a.id && m.date <= asOf).map((m) => usd(m.amountCents, m.fxRateToUsd)));
  const llc = data.accounts.filter((a) => a.owner === "llc");

  // Activos
  const cash = llc.filter(isBank).map((a) => ({ name: a.name, amount: balance(a) })).filter((x) => x.amount !== 0);
  const platforms = llc.filter(isPlatform).map((a) => ({ name: a.name, amount: balance(a) })).filter((x) => x.amount !== 0);
  const receivables = sum(
    data.revenues
      .filter((r) => r.date <= asOf && !r.depositAccountId && r.status !== "refunded" && r.status !== "disputed")
      .map((r) => usd(r.grossCents - r.processorFeeCents - r.affiliateFeeCents, r.fxRateToUsd))
  );

  // Pasivos
  const pending = data.expenses.filter((e) => e.date <= asOf && e.status === "pending" && e.fundingSource !== "owner_personal");
  const cards = llc
    .filter((a) => a.type === "credit_card")
    .map((a) => ({ name: a.name, amount: sum(pending.filter((e) => e.paymentAccountId === a.id && e.fundingSource === "llc_credit").map((e) => usd(e.amountCents, e.fxRateToUsd))) }))
    .filter((x) => x.amount !== 0);
  const payables = sum(pending.filter((e) => e.fundingSource === "llc_cash").map((e) => usd(e.amountCents, e.fxRateToUsd)));
  const debts = data.debts
    .map((d) => {
      const disbursed = d.principalCents;
      const paid = sum(data.debtPayments.filter((p) => p.debtId === d.id && p.paidOn && p.paidOn <= asOf).map((p) => p.principalCents));
      return { name: d.name, amount: usdByCurrency(disbursed - paid, d.currency) };
    })
    .filter((x) => x.amount !== 0);
  const ownerSum = (t: string) => sum(data.ownerLedger.filter((o) => o.type === t && o.date <= asOf).map((o) => usd(o.amountCents, o.fxRateToUsd)));
  const ownerLoans = ownerSum("loan") - ownerSum("reimbursement");

  // Patrimonio
  const lines = makePnl(data);
  const history = lines((d) => d <= asOf);
  const preOperating = history.preOperating;
  const retained = history.netProfit + preOperating; // resultado sin la puesta en marcha
  const openingBalances = sum(llc.map((a) => (a.type === "credit_card" ? 0 : usdByCurrency(a.openingBalanceCents, a.currency))));
  const capital = ownerSum("contribution");
  const draws = ownerSum("draw");

  const totalAssets = sum(cash.map((c) => c.amount)) + sum(platforms.map((p) => p.amount)) + receivables;
  const totalLiabilities = sum(cards.map((c) => c.amount)) + payables + sum(debts.map((d) => d.amount)) + ownerLoans;
  const totalEquity = capital - draws + retained - preOperating + openingBalances;

  const list = (xs: { name: string; amount: number }[]) => xs.map((x) => ({ name: x.name, amount: toDollars(x.amount) }));
  return {
    asOf,
    assets: {
      cash: list(cash),
      platforms: list(platforms),
      receivables: toDollars(receivables),
      total: toDollars(totalAssets),
    },
    liabilities: {
      cards: list(cards),
      payables: toDollars(payables),
      debts: list(debts),
      ownerLoans: toDollars(ownerLoans),
      total: toDollars(totalLiabilities),
    },
    equity: {
      capital: toDollars(capital),
      draws: toDollars(draws),
      openingBalances: toDollars(openingBalances),
      retained: toDollars(retained),
      preOperating: toDollars(preOperating),
      total: toDollars(totalEquity),
    },
    /** Debe ser 0: activos = pasivos + patrimonio. */
    difference: toDollars(totalAssets - totalLiabilities - totalEquity),
  };
}

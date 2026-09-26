/**
 * Los números de un mes, listos para que la IA redacte el informe. Puro. Es la única fuente
 * que recibe el modelo: todo lo que diga el informe tiene que salir de aquí.
 */
import { computeBalanceSheet, computeCashFlow, computeCommunity, computePnlReport, type EngineOptions, type FinanceData } from "./engine";
import { computeAnomalies } from "./anomalies";
import { computeProjection } from "./projection";

const prevMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};
const lastDay = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
const round = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d);
const top = (rec: Record<string, number>, n = 6) =>
  Object.entries(rec)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, n)
    .map(([nombre, monto]) => ({ nombre, monto }));

export function buildReportFacts(data: FinanceData, month: string, opts: EngineOptions & { minCashCents?: number; company: string }) {
  const end = lastDay(month);
  const asOf = opts.asOf < end ? opts.asOf : end; // si el mes está en curso, al día de hoy
  const pnl = computePnlReport(data, { from: prevMonth(month), to: month, granularity: "month" });
  const [prev, cur] = [pnl.periods[0], pnl.periods[1]];
  const community = computeCommunity(data, { ...opts, asOf });
  const move = community.movement.find((m) => m.month === month) ?? null;
  const cash = computeCashFlow(data, { from: month, to: month, granularity: "month" }).periods[0];
  const bs = computeBalanceSheet(data, { asOf: end, hnlPerUsd: opts.hnlPerUsd });
  const projection = computeProjection(data, { ...opts, asOf: opts.asOf, minCashCents: opts.minCashCents });
  const budgets = (data.budgets ?? []).filter((b) => b.month === month || b.month === null);

  const lines = (p: typeof cur) => ({
    facturacion_bruta: p.gross,
    comisiones_plataforma: p.processorFees,
    comisiones_afiliados: p.affiliateFees,
    ingreso_neto: p.revenue,
    costos_directos: p.cogs,
    utilidad_bruta: p.grossProfit,
    gastos_operativos: p.opex,
    ebitda: p.ebitda,
    otros: p.other,
    puesta_en_marcha_capital_inicial: p.preOperating,
    utilidad_neta: p.netProfit,
    margen_bruto: round(p.grossMargin, 3),
    margen_neto: round(p.netMargin, 3),
  });

  return {
    empresa: opts.company,
    mes: month,
    mes_completo: opts.asOf >= end,
    moneda: "USD",
    resultados: lines(cur),
    resultados_mes_anterior: lines(prev),
    ingresos_por_producto: top(cur.details.revenueByProduct),
    gastos_operativos_por_categoria: top(cur.details.opexByCategory),
    costos_directos_por_categoria: top(cur.details.cogsByCategory),
    comunidad: {
      mrr_al_cierre: community.mrr,
      miembros_activos: community.activeCount,
      movimiento_mrr_del_mes: move && { nuevos: move.new, expansion: move.expansion, contraccion: move.contraction, bajas: move.churn, reactivaciones: move.reactivation, neto: move.net },
      churn_mensual: round(community.churn, 3),
      churn_es_supuesto: community.churnIsAssumption,
      arpu: community.arpu,
      ltv: community.ltv,
      cac: community.cac,
      gasto_marketing: community.marketing,
      ltv_cac: round(community.ltvToCac, 2),
      mezcla_planes: community.mix,
      punto_de_equilibrio: { miembros_necesarios: community.breakEven.membersNeeded, faltan: community.breakEven.missing, costos_fijos_mensuales: community.breakEven.fixedCosts },
    },
    caja: {
      inicial: cash?.openingCash ?? null,
      final: cash?.closingCash ?? null,
      operacion: cash?.operating ?? null,
      financiamiento: cash?.financing ?? null,
      saldo_en_plataformas_por_cobrar: bs.assets.platforms.reduce((a, p) => a + p.amount, 0),
    },
    balance: { activos: bs.assets.total, pasivos: bs.liabilities.total, patrimonio: bs.equity.total, capital_aportado: bs.equity.capital },
    proyeccion_13_semanas: {
      semana_mas_baja: projection.lowestWeek,
      baja_del_minimo: projection.firstBelowMin && { semana: projection.firstBelowMin.label, caja: projection.firstBelowMin.endCash },
      mrr_en_6_meses: projection.mrrIn6,
      mes_punto_de_equilibrio: projection.breakEvenMonth,
    },
    presupuestos_definidos: budgets.length,
    alertas: computeAnomalies(data, asOf).map((a) => a.title),
  };
}

export type ReportFacts = ReturnType<typeof buildReportFacts>;

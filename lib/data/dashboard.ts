import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { exchangeRates, settings } from "@/db/schema";
import { computeCommunity, computeDashboard } from "@/lib/finance/engine";
import { loadFinanceData } from "@/lib/data/finance-data";
import { getUsdHnlRate } from "@/lib/fx";
import { todayIn } from "@/lib/today";
import { BRAND } from "@/lib/config";
import { bankAlerts } from "@/lib/services/bank-sync";
import { computeProjection } from "@/lib/finance/projection";
import { computeAnomalies } from "@/lib/finance/anomalies";
import { computeWeekly } from "@/lib/finance/weekly";
import { getProjectionSettings } from "@/lib/data/projection";
import type { Tx } from "@/lib/services/ledger";

export async function getDashboard() {
  const [db, fx] = await Promise.all([getDb(), getUsdHnlRate()]);

  // Guarda la tasa del día: así cada movimiento futuro puede usar la tasa de SU fecha.
  if (fx.source !== "respaldo") {
    await db
      .insert(exchangeRates)
      .values({ rateDate: fx.asOf, base: "USD", quote: "HNL", rate: String(fx.hnlPerUsd), source: fx.source })
      .onConflictDoUpdate({
        target: [exchangeRates.rateDate, exchangeRates.base, exchangeRates.quote],
        set: { rate: sql`excluded.rate`, source: sql`excluded.source` },
      });
  }

  const [data, churn, bank, projectionCfg] = await Promise.all([loadFinanceData(db), getChurnAssumptionPct(), bankAlerts(db as unknown as Tx), getProjectionSettings()]);
  const opts = { asOf: todayIn(BRAND.timeZone), hnlPerUsd: fx.hnlPerUsd, churnAssumption: churn / 100 };
  const dashboard = computeDashboard(data, opts);
  const community = computeCommunity(data, opts);
  // Aviso anticipado: la caja proyectada baja del mínimo que definiste en Proyección.
  const projection = computeProjection(data, { ...opts, minCashCents: projectionCfg.minCashCents });
  const low = projection.firstBelowMin;
  const cashAlert = low
    ? [
        {
          severity: low.endCash < 0 ? ("urgent" as const) : ("warning" as const),
          title: `La caja bajaría a ${low.endCash.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} la semana del ${low.label}`,
          detail: projectionCfg.minCashCents ? `Por debajo de tu caja mínima de ${(projectionCfg.minCashCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}. Revisa la proyección.` : "Revisa la proyección de caja.",
          href: "/proyeccion",
        },
      ]
    : [];
  // Lo del banco primero dentro de su severidad: es lo que mantiene los demás números correctos.
  return { ...dashboard, insights: [...cashAlert, ...bank.filter((b) => b.severity === "warning"), ...dashboard.insights, ...computeAnomalies(data, opts.asOf), ...bank.filter((b) => b.severity === "info")], community, weekly: computeWeekly(data, opts.asOf), fx };
}

/** Churn mensual supuesto (%) para el pronóstico mientras no haya historial de bajas. */
export async function getChurnAssumptionPct() {
  const db = await getDb();
  const [row] = await db.select().from(settings).where(eq(settings.key, "forecast_churn_pct"));
  return typeof row?.value === "number" ? row.value : 5;
}

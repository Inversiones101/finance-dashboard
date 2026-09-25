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

  const [data, churn, bank] = await Promise.all([loadFinanceData(db), getChurnAssumptionPct(), bankAlerts(db as unknown as Tx)]);
  const opts = { asOf: todayIn(BRAND.timeZone), hnlPerUsd: fx.hnlPerUsd, churnAssumption: churn / 100 };
  const dashboard = computeDashboard(data, opts);
  const community = computeCommunity(data, opts);
  // Lo del banco primero dentro de su severidad: es lo que mantiene los demás números correctos.
  return { ...dashboard, insights: [...bank.filter((b) => b.severity === "warning"), ...dashboard.insights, ...bank.filter((b) => b.severity === "info")], community, fx };
}

/** Churn mensual supuesto (%) para el pronóstico mientras no haya historial de bajas. */
export async function getChurnAssumptionPct() {
  const db = await getDb();
  const [row] = await db.select().from(settings).where(eq(settings.key, "forecast_churn_pct"));
  return typeof row?.value === "number" ? row.value : 5;
}

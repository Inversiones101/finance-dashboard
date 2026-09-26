"use server";

import { getDb } from "@/db/client";
import { loadFinanceData } from "@/lib/data/finance-data";
import { getChurnAssumptionPct } from "@/lib/data/dashboard";
import { getProjectionSettings } from "@/lib/data/projection";
import { buildReportFacts } from "@/lib/finance/report-facts";
import { getUsdHnlRate } from "@/lib/fx";
import { BRAND } from "@/lib/config";
import { todayIn } from "@/lib/today";
import { generateMonthlyReport } from "@/lib/services/monthly-report";
import { mutate } from "./mutate";
import { fail, type ActionResult } from "./result";

/** Redacta (o vuelve a redactar) el informe del mes con Claude. */
export async function generateReportAction(month: string): Promise<ActionResult> {
  if (!/^\d{4}-\d{2}$/.test(month)) return fail("Mes inválido");
  const db = await getDb();
  const [data, fx, churn, cfg] = await Promise.all([loadFinanceData(db), getUsdHnlRate(), getChurnAssumptionPct(), getProjectionSettings()]);
  const facts = buildReportFacts(data, month, { asOf: todayIn(), hnlPerUsd: fx.hnlPerUsd, churnAssumption: churn / 100, minCashCents: cfg.minCashCents, company: BRAND.company });
  const r = await mutate("reports", "write", "monthly_reports", "generate", async (tx, userId) => {
    await generateMonthlyReport(tx, facts, userId);
    return { message: "Informe listo", diff: { month } };
  });
  return r;
}


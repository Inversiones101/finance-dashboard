import "server-only";
import { inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { settings } from "@/db/schema";
import type { SavedScenario } from "@/lib/actions/projection";

/** Caja mínima (centavos) y escenarios guardados del simulador. */
export async function getProjectionSettings() {
  const db = await getDb();
  const rows = await db.select().from(settings).where(inArray(settings.key, ["projection_min_cash", "projection_scenarios"]));
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const min = get("projection_min_cash");
  const scenarios = get("projection_scenarios");
  return {
    minCashCents: typeof min === "number" ? min : 0,
    scenarios: (Array.isArray(scenarios) ? scenarios : []) as SavedScenario[],
  };
}

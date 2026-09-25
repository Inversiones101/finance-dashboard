"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import type { Tx } from "@/lib/services/ledger";
import { mutate } from "./mutate";
import { fail, parseForm, zMoney, type ActionResult } from "./result";

export type SavedScenario = {
  id: string;
  name: string;
  newPerMonth: number;
  churn: number;
  monthlyPriceCents: number | null;
  annualPriceCents: number | null;
  priceFrom: string | null;
  extraMonthlyCents: number;
};

const KEY = "projection_scenarios";

async function readScenarios(tx: Tx): Promise<SavedScenario[]> {
  const [row] = await tx.select().from(s.settings).where(eq(s.settings.key, KEY));
  return Array.isArray(row?.value) ? (row.value as SavedScenario[]) : [];
}

async function writeScenarios(tx: Tx, list: SavedScenario[]) {
  await tx.insert(s.settings).values({ key: KEY, value: list }).onConflictDoUpdate({ target: s.settings.key, set: { value: list, updatedAt: new Date() } });
}

const scenarioSchema = z.object({
  name: z.string().trim().min(1, "Ponle un nombre").max(60),
  newPerMonth: z.number().min(0).max(1000),
  churn: z.number().min(0).max(1),
  monthlyPriceCents: z.number().int().min(0).nullable(),
  annualPriceCents: z.number().int().min(0).nullable(),
  priceFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  extraMonthlyCents: z.number().int().min(0).max(100_000_000),
});

/** Guarda (o reemplaza, si el nombre ya existe) un escenario del simulador. */
export async function saveScenarioAction(input: Omit<SavedScenario, "id">): Promise<ActionResult> {
  const p = scenarioSchema.safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  return mutate("planning", "write", "settings", "save_scenario", async (tx) => {
    const list = await readScenarios(tx);
    const existing = list.find((x) => x.name.toLowerCase() === p.data.name.toLowerCase());
    const next = existing ? list.map((x) => (x.id === existing.id ? { ...p.data, id: x.id } : x)) : [...list, { ...p.data, id: crypto.randomUUID() }].slice(-12);
    await writeScenarios(tx, next);
    return { message: existing ? `Escenario "${p.data.name}" actualizado` : `Escenario "${p.data.name}" guardado` };
  });
}

export async function deleteScenarioAction(id: string): Promise<ActionResult> {
  return mutate("planning", "write", "settings", "delete_scenario", async (tx) => {
    await writeScenarios(tx, (await readScenarios(tx)).filter((x) => x.id !== id));
    return { message: "Escenario eliminado" };
  });
}

/** Caja mínima: si la proyección cae por debajo, aparece una alerta en el dashboard. */
export async function saveMinCashAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(z.object({ minCash: zMoney }), form);
  if (!p.data) return fail(p.error);
  const value = p.data.minCash;
  return mutate("planning", "write", "settings", "update", async (tx) => {
    await tx.insert(s.settings).values({ key: "projection_min_cash", value }).onConflictDoUpdate({ target: s.settings.key, set: { value, updatedAt: new Date() } });
    return { message: `Caja mínima: $${(value / 100).toLocaleString("en-US")}` };
  });
}

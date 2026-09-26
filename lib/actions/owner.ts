"use server";

import { z } from "zod";
import { deleteExpense, deleteOwnerEntry, recordOwnerEntry } from "@/lib/services/ledger";
import { recordStartupCost } from "@/lib/services/startup-costs";
import { getSessionUser } from "@/lib/auth/session";
import { mutate } from "./mutate";
import { fail, parseForm, zCurrency, zDate, zId, zMoney, zOptId, zText, type ActionResult } from "./result";

const schema = z.object({
  type: z.enum(["contribution", "loan", "reimbursement", "draw"]),
  date: zDate,
  currency: zCurrency,
  amountCents: zMoney,
  llcAccountId: zOptId,
  description: zText,
});

export async function saveOwnerEntryAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(schema, form);
  if (!p.data) return fail(p.error);
  const e = p.data;
  if (!(await getSessionUser())?.isOwner) return fail("Solo el dueño puede registrar esto.");
  return mutate("owner_equity", "write", "owner_ledger", "create", async (tx, userId) => {
    const id = await recordOwnerEntry(tx, { ...e, userId });
    return { id, message: "Movimiento del dueño registrado" };
  });
}

export async function deleteOwnerEntryAction(id: string): Promise<ActionResult> {
  if (!zId.safeParse(id).success) return fail("Registro inválido");
  if (!(await getSessionUser())?.isOwner) return fail("Solo el dueño puede modificar esto.");
  return mutate("owner_equity", "write", "owner_ledger", "delete", async (tx) => {
    await deleteOwnerEntry(tx, id);
    return { id, message: "Movimiento eliminado" };
  });
}

// ── Puesta en marcha (capital inicial) ──────────────────────────────────────
const startupSchema = z.object({
  date: zDate,
  description: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string()),
  amountCents: zMoney,
  currency: zCurrency,
  categoryId: zOptId,
  contractId: zOptId,
});

/** Pago del dueño antes del inicio de operaciones: aporte de capital, fuera de la operación. */
export async function saveStartupCostAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(startupSchema, form);
  if (!p.data) return fail(p.error);
  if (!(await getSessionUser())?.isOwner) return fail("Solo el dueño puede registrar esto.");
  return mutate("owner_equity", "write", "startup_costs", "create", async (tx, userId) => {
    const id = await recordStartupCost(tx, { ...p.data, userId });
    return { id, message: "Sumado al capital inicial de puesta en marcha", diff: { date: p.data.date, amountCents: p.data.amountCents } };
  });
}

export async function deleteStartupCostAction(id: string): Promise<ActionResult> {
  if (!zId.safeParse(id).success) return fail("Registro inválido");
  if (!(await getSessionUser())?.isOwner) return fail("Solo el dueño puede modificar esto.");
  return mutate("owner_equity", "write", "startup_costs", "delete", async (tx) => {
    await deleteExpense(tx, id);
    return { id, message: "Quitado de la puesta en marcha" };
  });
}

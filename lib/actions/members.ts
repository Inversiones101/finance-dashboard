"use server";

import { z } from "zod";

import * as s from "@/db/schema";
import { ownerPersonalAccountId } from "@/lib/services/ledger";
import { cancelMember, chargeMember, deleteMember, reactivateMember, saveMember } from "@/lib/services/members";
import { mutate } from "./mutate";
import { fail, parseForm, zCurrency, zDate, zId, zMoney, zOptDate, zOptId, zOptMoney, zOptText, zText, type ActionResult } from "./result";

const memberSchema = z.object({
  id: zOptId,
  name: zText,
  productId: zId,
  billingInterval: z.enum(["monthly", "quarterly", "annual"]),
  currency: zCurrency,
  priceCents: zMoney,
  startedOn: zDate,
  currentPeriodEnd: zOptDate,
  notes: zOptText,
});

export async function saveMemberAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(memberSchema, form);
  if (!p.data) return fail(p.error);
  const { id, ...input } = p.data;
  return mutate("revenue", "write", "members", id ? "update" : "create", async (tx) => {
    const saved = await saveMember(tx, input, id ?? undefined);
    return { id: saved, message: id ? "Miembro actualizado" : "Miembro agregado: ya suma al MRR" };
  });
}

const cancelSchema = z.object({ id: zId, date: zDate, when: z.enum(["period_end", "now"]) });

export async function cancelMemberAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(cancelSchema, form);
  if (!p.data) return fail(p.error);
  const { id, date, when } = p.data;
  return mutate("revenue", "write", "members", "cancel", async (tx) => {
    await cancelMember(tx, id, { date, accessUntil: when === "now" ? date : null });
    return { id, message: when === "now" ? "Dado de baja: ya no cuenta en el MRR" : "Dado de baja: deja de contar al terminar su periodo pagado" };
  });
}

export async function reactivateMemberAction(id: string, date: string): Promise<ActionResult> {
  if (!zId.safeParse(id).success || !zDate.safeParse(date).success) return fail("Registro inválido");
  return mutate("revenue", "write", "members", "reactivate", async (tx) => {
    await reactivateMember(tx, id, { date });
    return { id, message: "Reactivado: vuelve a sumar al MRR" };
  });
}

const chargeSchema = z.object({
  id: zId,
  date: zDate,
  grossCents: zMoney,
  processorFeeCents: zOptMoney,
  affiliateFeeCents: zOptMoney,
  depositAccountId: z.preprocess((v) => (v === undefined || v === "" ? null : v), z.union([z.literal("owner"), z.string().uuid()]).nullable()),
});

export async function chargeMemberAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(chargeSchema, form);
  if (!p.data) return fail(p.error);
  const { id, depositAccountId, ...charge } = p.data;
  return mutate("revenue", "write", "members", "charge", async (tx, userId) => {
    const deposit = depositAccountId === "owner" ? await ownerPersonalAccountId(tx) : depositAccountId;
    const revenueId = await chargeMember(tx, id, { ...charge, depositAccountId: deposit, userId });
    return { id: revenueId, message: "Renovación registrada como ingreso" };
  });
}

export async function deleteMemberAction(id: string): Promise<ActionResult> {
  if (!zId.safeParse(id).success) return fail("Registro inválido");
  return mutate("revenue", "admin", "members", "delete", async (tx) => {
    await deleteMember(tx, id);
    return { id, message: "Miembro eliminado (sus cobros se conservan)" };
  });
}

/** Churn mensual supuesto para el pronóstico (mientras no haya historial de bajas). */
export async function saveChurnAssumptionAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const pct = Number(String(form.get("pct") ?? "").replace(",", "."));
  if (!Number.isFinite(pct) || pct < 0 || pct > 50) return fail("Escribe un porcentaje entre 0 y 50.");
  return mutate("revenue", "write", "settings", "update", async (tx) => {
    await tx
      .insert(s.settings)
      .values({ key: "forecast_churn_pct", value: pct })
      .onConflictDoUpdate({ target: s.settings.key, set: { value: pct, updatedAt: new Date() } });
    return { message: `Churn supuesto: ${pct}% mensual` };
  });
}


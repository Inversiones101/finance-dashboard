"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { mutate } from "./mutate";
import { fail, parseForm, zDate, zId, zMoney, zOptId, zOptText, zText, type ActionResult } from "./result";

const budgetSchema = z.object({
  id: zOptId,
  categoryId: zId,
  month: z.preprocess((v) => (v === "" || v === undefined || v === "todos" ? null : v), z.string().regex(/^\d{4}-\d{2}$/, "Mes inválido").nullable()),
  amountCents: zMoney,
  notes: zOptText,
});

export async function saveBudgetAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(budgetSchema, form);
  if (!p.data) return fail(p.error);
  const { id, ...v } = p.data;
  return mutate("planning", "write", "budgets", id ? "update" : "create", async (tx) => {
    try {
      if (id) {
        await tx.update(s.budgets).set({ ...v, updatedAt: new Date() }).where(eq(s.budgets.id, id));
        return { id, message: "Presupuesto actualizado" };
      }
      const [row] = await tx.insert(s.budgets).values(v).returning();
      return { id: row.id, message: "Presupuesto creado" };
    } catch (e) {
      if (e instanceof Error && /unique|duplicate/i.test(e.message)) throw new Error("Esa categoría ya tiene presupuesto para ese periodo; edítalo.");
      throw e;
    }
  });
}

export async function deleteBudgetAction(id: string): Promise<ActionResult> {
  if (!zId.safeParse(id).success) return fail("Registro inválido");
  return mutate("planning", "write", "budgets", "delete", async (tx) => {
    await tx.delete(s.budgets).where(eq(s.budgets.id, id));
    return { id, message: "Presupuesto eliminado" };
  });
}

const goalSchema = z.object({
  id: zOptId,
  name: zText,
  metric: z.enum(["gross_revenue", "net_revenue", "net_profit", "mrr", "active_members", "new_members", "cash"]),
  target: z.preprocess((v) => (typeof v === "string" ? Number(v.replace(/[,$\s]/g, "")) : v), z.number({ message: "Meta inválida" }).positive("La meta debe ser mayor que cero")),
  periodStart: zDate,
  periodEnd: zDate,
  status: z.preprocess((v) => v ?? "active", z.enum(["active", "archived"])),
  notes: zOptText,
});

export async function saveGoalAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(goalSchema, form);
  if (!p.data) return fail(p.error);
  const { id, target, ...v } = p.data;
  if (v.periodEnd < v.periodStart) return fail("La fecha límite debe ser posterior al inicio.");
  const values = { ...v, target: String(target) };
  return mutate("planning", "write", "goals", id ? "update" : "create", async (tx) => {
    if (id) {
      await tx.update(s.goals).set({ ...values, updatedAt: new Date() }).where(eq(s.goals.id, id));
      return { id, message: "Meta actualizada" };
    }
    const [row] = await tx.insert(s.goals).values(values).returning();
    return { id: row.id, message: "Meta creada" };
  });
}

export async function deleteGoalAction(id: string): Promise<ActionResult> {
  if (!zId.safeParse(id).success) return fail("Registro inválido");
  return mutate("planning", "write", "goals", "delete", async (tx) => {
    await tx.delete(s.goals).where(eq(s.goals.id, id));
    return { id, message: "Meta eliminada" };
  });
}

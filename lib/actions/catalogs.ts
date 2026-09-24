"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { mutate } from "./mutate";
import { fail, parseForm, zDate, zId, zInterval, zOptId, zOptMoney, zOptText, zText, type ActionResult } from "./result";

/** Traduce el error de FK de Postgres a algo entendible. */
function inUse(e: unknown): never {
  const msg = e instanceof Error ? e.message : "";
  if (/foreign key|violates/i.test(msg)) throw new Error("Está en uso por otros registros. Desactívalo o reasígnalos primero.");
  throw e;
}

// ── Productos ───────────────────────────────────────────────────────────────
const productSchema = z.object({
  id: zOptId,
  name: zText,
  line: zOptText,
  categoryId: zId,
  defaultBillingInterval: zInterval,
  platform: zOptText,
  isActive: z.preprocess((v) => v === "on", z.boolean()),
});

export async function saveProductAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(productSchema, form);
  if (!p.data) return fail(p.error);
  const { id, ...v } = p.data;
  return mutate("settings", "write", "products", id ? "update" : "create", async (tx) => {
    if (id) {
      await tx.update(s.products).set({ ...v, updatedAt: new Date() }).where(eq(s.products.id, id));
      return { id, message: "Producto actualizado" };
    }
    const [row] = await tx.insert(s.products).values(v).returning();
    return { id: row.id, message: "Producto creado" };
  });
}

export async function deleteProductAction(id: string): Promise<ActionResult> {
  if (!zId.safeParse(id).success) return fail("Registro inválido");
  return mutate("settings", "admin", "products", "delete", async (tx) => {
    await tx.delete(s.products).where(eq(s.products.id, id)).catch(inUse);
    return { id, message: "Producto eliminado" };
  });
}

// ── Categorías ──────────────────────────────────────────────────────────────
const categorySchema = z.object({
  id: zOptId,
  name: zText,
  kind: z.enum(["revenue", "cogs", "opex"]),
  isTaxDeductible: z.preprocess((v) => v === "on", z.boolean()),
});

export async function saveCategoryAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(categorySchema, form);
  if (!p.data) return fail(p.error);
  const { id, ...v } = p.data;
  return mutate("settings", "write", "categories", id ? "update" : "create", async (tx) => {
    try {
      if (id) {
        await tx.update(s.categories).set({ ...v, updatedAt: new Date() }).where(eq(s.categories.id, id));
        return { id, message: "Categoría actualizada" };
      }
      const [row] = await tx.insert(s.categories).values(v).returning();
      return { id: row.id, message: "Categoría creada" };
    } catch (e) {
      if (e instanceof Error && /unique|duplicate/i.test(e.message)) throw new Error("Ya existe una categoría con ese nombre y tipo.");
      throw e;
    }
  });
}

export async function deleteCategoryAction(id: string): Promise<ActionResult> {
  if (!zId.safeParse(id).success) return fail("Registro inválido");
  return mutate("settings", "admin", "categories", "delete", async (tx) => {
    await tx.delete(s.categories).where(eq(s.categories.id, id)).catch(inUse);
    return { id, message: "Categoría eliminada" };
  });
}

// ── Contrapartes (proveedores, clientes, acreedores…) ───────────────────────
const counterpartySchema = z.object({
  id: zOptId,
  name: zText,
  type: z.enum(["customer", "vendor", "creditor", "tax_authority", "processor"]),
  email: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().email("Correo inválido").nullable()),
  country: z.preprocess((v) => (v === "" || v === undefined ? null : typeof v === "string" ? v.toUpperCase() : v), z.string().length(2, "Código de 2 letras").nullable()),
  notes: zOptText,
});

export async function saveCounterpartyAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(counterpartySchema, form);
  if (!p.data) return fail(p.error);
  const { id, ...v } = p.data;
  return mutate("settings", "write", "counterparties", id ? "update" : "create", async (tx) => {
    if (id) {
      await tx.update(s.counterparties).set({ ...v, updatedAt: new Date() }).where(eq(s.counterparties.id, id));
      return { id, message: "Contacto actualizado" };
    }
    const [row] = await tx.insert(s.counterparties).values(v).returning();
    return { id: row.id, message: "Contacto creado" };
  });
}

export async function deleteCounterpartyAction(id: string): Promise<ActionResult> {
  if (!zId.safeParse(id).success) return fail("Registro inválido");
  return mutate("settings", "admin", "counterparties", "delete", async (tx) => {
    await tx.delete(s.counterparties).where(eq(s.counterparties.id, id)).catch(inUse);
    return { id, message: "Contacto eliminado" };
  });
}

// ── Recordatorios ───────────────────────────────────────────────────────────
const reminderSchema = z.object({ id: zOptId, dueOn: zDate, title: zText, detail: zOptText, amountCents: zOptMoney });

export async function saveReminderAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(reminderSchema, form);
  if (!p.data) return fail(p.error);
  const { id, amountCents, ...v } = p.data;
  const values = { ...v, amountCents: amountCents || null };
  return mutate("settings", "write", "reminders", id ? "update" : "create", async (tx) => {
    if (id) {
      await tx.update(s.reminders).set({ ...values, updatedAt: new Date() }).where(eq(s.reminders.id, id));
      return { id, message: "Recordatorio actualizado" };
    }
    const [row] = await tx.insert(s.reminders).values(values).returning();
    return { id: row.id, message: "Recordatorio creado" };
  });
}

export async function completeReminderAction(id: string): Promise<ActionResult> {
  if (!zId.safeParse(id).success) return fail("Registro inválido");
  return mutate("settings", "write", "reminders", "complete", async (tx) => {
    await tx.update(s.reminders).set({ doneAt: new Date() }).where(eq(s.reminders.id, id));
    return { id, message: "Recordatorio completado" };
  });
}

export async function deleteReminderAction(id: string): Promise<ActionResult> {
  if (!zId.safeParse(id).success) return fail("Registro inválido");
  return mutate("settings", "write", "reminders", "delete", async (tx) => {
    await tx.delete(s.reminders).where(eq(s.reminders.id, id));
    return { id, message: "Recordatorio eliminado" };
  });
}

// ── Empresa ─────────────────────────────────────────────────────────────────
const opsSchema = z.object({ operationsStart: z.preprocess((v) => (v === "" || v === undefined ? null : v), zDate.nullable()) });

/** Fecha de inicio de operaciones: lo pagado por el dueño antes cuenta como puesta en marcha. */
export async function saveOperationsStartAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(opsSchema, form);
  if (!p.data) return fail(p.error);
  const value = p.data.operationsStart;
  return mutate("settings", "admin", "settings", "update", async (tx) => {
    if (value === null) {
      await tx.delete(s.settings).where(eq(s.settings.key, "operations_start_date"));
      return { message: "Sin fecha de inicio: todo cuenta como operación" };
    }
    await tx
      .insert(s.settings)
      .values({ key: "operations_start_date", value })
      .onConflictDoUpdate({ target: s.settings.key, set: { value, updatedAt: new Date() } });
    return { message: "Fecha de inicio de operaciones guardada" };
  });
}

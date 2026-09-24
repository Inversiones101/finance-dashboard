"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { deleteRevenue, ownerPersonalAccountId, saveRevenue } from "@/lib/services/ledger";
import { ensureMemberForRevenue } from "@/lib/services/members";
import { mutate } from "./mutate";
import { fail, parseForm, zCurrency, zDate, zId, zInterval, zMoney, zOptDate, zOptId, zOptMoney, zOptText, type ActionResult } from "./result";

const schema = z.object({
  id: zOptId,
  revenueDate: zDate,
  productId: zOptId,
  categoryId: zOptId,
  customerName: zOptText,
  billingInterval: zInterval,
  serviceStart: zOptDate,
  currency: zCurrency,
  grossCents: zMoney,
  processorFeeCents: zOptMoney,
  affiliateFeeCents: zOptMoney,
  status: z.enum(["pending", "available", "paid_out", "refunded", "disputed"]),
  depositAccountId: z.preprocess((v) => (v === undefined || v === "" ? null : v), z.union([z.literal("owner"), z.string().uuid()]).nullable()),
  notes: zOptText,
});

export async function saveRevenueAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(schema, form);
  if (!p.data) return fail(p.error);
  const { id, ...input } = p.data;
  if (input.processorFeeCents + input.affiliateFeeCents > input.grossCents) return fail("Las comisiones no pueden superar el monto bruto.");

  return mutate("revenue", "write", "revenues", id ? "update" : "create", async (tx, userId) => {
    // La categoría sale del producto si no se eligió una.
    let categoryId = input.categoryId;
    if (!categoryId && input.productId) {
      const [prod] = await tx.select().from(s.products).where(eq(s.products.id, input.productId));
      categoryId = prod?.categoryId ?? null;
    }
    if (!categoryId) throw new Error("Elige un producto o una categoría de ingreso.");
    // "Retiro del dueño": el cobro cayó en una cuenta personal (no se muestra cuál).
    const depositAccountId = input.depositAccountId === "owner" ? await ownerPersonalAccountId(tx) : input.depositAccountId;
    const memberId = await ensureMemberForRevenue(tx, { ...input });
    const savedId = await saveRevenue(tx, { ...input, depositAccountId, memberId, categoryId, createdBy: userId }, id ?? undefined);
    return { id: savedId, message: id ? "Ingreso actualizado" : "Ingreso registrado", diff: input };
  });
}

export async function deleteRevenueAction(id: string): Promise<ActionResult> {
  const v = zId.safeParse(id);
  if (!v.success) return fail("Registro inválido");
  return mutate("revenue", "write", "revenues", "delete", async (tx) => {
    await deleteRevenue(tx, id);
    return { id, message: "Ingreso eliminado" };
  });
}

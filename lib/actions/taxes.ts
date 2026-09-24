"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { findOrCreateCounterparty, payTax } from "@/lib/services/ledger";
import { mutate } from "./mutate";
import { fail, parseForm, zCurrency, zDate, zId, zMoney, zOptDate, zOptId, zOptMoney, zOptText, zText, type ActionResult } from "./result";

const schema = z.object({
  id: zOptId,
  name: zText,
  authorityName: zText,
  jurisdiction: zText,
  periodStart: zOptDate,
  periodEnd: zOptDate,
  dueDate: zDate,
  currency: zCurrency,
  estimatedCents: zOptMoney,
  status: z.enum(["upcoming", "in_progress", "filed", "paid", "overdue", "not_required"]),
  filedOn: zOptDate,
  notes: zOptText,
});

export async function saveTaxAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(schema, form);
  if (!p.data) return fail(p.error);
  const { id, authorityName, ...input } = p.data;
  return mutate("taxes", "write", "tax_obligations", id ? "update" : "create", async (tx) => {
    const values = { ...input, authorityId: await findOrCreateCounterparty(tx, authorityName, "tax_authority") };
    if (id) {
      await tx.update(s.taxObligations).set({ ...values, updatedAt: new Date() }).where(eq(s.taxObligations.id, id));
      return { id, message: "Obligación actualizada" };
    }
    const [row] = await tx.insert(s.taxObligations).values(values).returning();
    return { id: row.id, message: "Obligación creada" };
  });
}

const paySchema = z.object({ taxId: zId, date: zDate, amountCents: zMoney, accountId: zOptId, categoryId: zOptId });

export async function payTaxAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(paySchema, form);
  if (!p.data) return fail(p.error);
  const { taxId, ...pay } = p.data;
  return mutate("taxes", "write", "tax_obligations", "payment", async (tx, userId) => {
    await payTax(tx, taxId, { ...pay, userId });
    return { id: taxId, message: "Pago registrado" };
  });
}

export async function deleteTaxAction(id: string): Promise<ActionResult> {
  if (!zId.safeParse(id).success) return fail("Registro inválido");
  return mutate("taxes", "admin", "tax_obligations", "delete", async (tx) => {
    await tx.delete(s.taxObligations).where(eq(s.taxObligations.id, id));
    return { id, message: "Obligación eliminada" };
  });
}

"use server";

import { z } from "zod";
import { deleteExpense, saveExpense } from "@/lib/services/ledger";
import { mutate } from "./mutate";
import { fail, parseForm, zCurrency, zDate, zId, zInterval, zMoney, zOptDate, zOptId, zOptText, zText, type ActionResult } from "./result";

const schema = z.object({
  id: zOptId,
  expenseDate: zDate,
  description: zText,
  categoryId: zId,
  vendorId: zOptId,
  frequency: zInterval,
  currency: zCurrency,
  amountCents: zMoney,
  paymentAccountId: zOptId,
  status: z.enum(["pending", "paid"]),
  dueDate: zOptDate,
  paidOn: zOptDate,
  subscriptionId: zOptId,
  contractId: zOptId,
  productId: zOptId,
  notes: zOptText,
});

export async function saveExpenseAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(schema, form);
  if (!p.data) return fail(p.error);
  const { id, ...input } = p.data;
  return mutate("expenses", "write", "expenses", id ? "update" : "create", async (tx, userId) => {
    const savedId = await saveExpense(tx, { ...input, createdBy: userId }, id ?? undefined);
    return { id: savedId, message: id ? "Gasto actualizado" : "Gasto registrado", diff: input };
  });
}

export async function deleteExpenseAction(id: string): Promise<ActionResult> {
  if (!zId.safeParse(id).success) return fail("Registro inválido");
  return mutate("expenses", "write", "expenses", "delete", async (tx) => {
    await deleteExpense(tx, id);
    return { id, message: "Gasto eliminado" };
  });
}

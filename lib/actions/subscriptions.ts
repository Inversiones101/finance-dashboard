"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { chargeSubscription, findOrCreateCounterparty, fundingForAccount } from "@/lib/services/ledger";
import { mutate } from "./mutate";
import { fail, parseForm, zCurrency, zDate, zId, zMoney, zOptDate, zOptId, zOptText, zText, type ActionResult } from "./result";

const schema = z.object({
  id: zOptId,
  name: zText,
  vendorName: zText,
  categoryId: zId,
  billingInterval: z.enum(["monthly", "quarterly", "annual"]),
  currency: zCurrency,
  amountCents: zMoney,
  startedOn: zDate,
  nextRenewalOn: zDate,
  defaultPaymentAccountId: zOptId,
  status: z.enum(["active", "paused", "canceled"]),
  canceledOn: zOptDate,
  notes: zOptText,
});

export async function saveSubscriptionAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(schema, form);
  if (!p.data) return fail(p.error);
  const { id, vendorName, ...input } = p.data;
  return mutate("subscriptions", "write", "subscriptions", id ? "update" : "create", async (tx) => {
    const values = {
      ...input,
      vendorId: await findOrCreateCounterparty(tx, vendorName, "vendor"),
      defaultFundingSource: await fundingForAccount(tx, input.defaultPaymentAccountId),
      canceledOn: input.status === "canceled" ? (input.canceledOn ?? new Date().toISOString().slice(0, 10)) : null,
    };
    if (id) {
      await tx.update(s.subscriptions).set({ ...values, updatedAt: new Date() }).where(eq(s.subscriptions.id, id));
      return { id, message: "Suscripción actualizada" };
    }
    const [row] = await tx.insert(s.subscriptions).values(values).returning();
    return { id: row.id, message: "Suscripción creada" };
  });
}

const chargeSchema = z.object({ id: zId, date: zDate, accountId: zOptId });

export async function chargeSubscriptionAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(chargeSchema, form);
  if (!p.data) return fail(p.error);
  const { id, date, accountId } = p.data;
  return mutate("subscriptions", "write", "subscriptions", "charge", async (tx, userId) => {
    const expenseId = await chargeSubscription(tx, id, { date, accountId, userId });
    return { id: expenseId, message: "Cobro registrado como gasto" };
  });
}

export async function deleteSubscriptionAction(id: string): Promise<ActionResult> {
  if (!zId.safeParse(id).success) return fail("Registro inválido");
  return mutate("subscriptions", "admin", "subscriptions", "delete", async (tx) => {
    // Los gastos históricos se conservan; solo pierden el vínculo.
    await tx.delete(s.subscriptions).where(eq(s.subscriptions.id, id));
    return { id, message: "Suscripción eliminada" };
  });
}

"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { mercuryClient } from "@/lib/mercury/client";
import { acceptAllSuggestions, resolveInboxItem, syncBank, type Suggestion } from "@/lib/services/bank-sync";
import { todayIn } from "@/lib/today";
import { checkbox, mutate } from "./mutate";
import { fail, parseForm, zId, zOptId, zOptText, type ActionResult } from "./result";

export async function syncBankAction(): Promise<ActionResult> {
  return mutate("banking", "write", "bank_inbox", "sync", async (tx) => {
    const r = await syncBank(tx, mercuryClient(), todayIn());
    const off = r.balances.filter((b) => b.bankCents !== b.booksCents).length;
    const parts = [
      r.added ? `${r.added} transacciones nuevas por clasificar` : "No hay transacciones nuevas",
      off ? `${off} cuenta(s) con saldo distinto al del banco` : null,
      r.unlinked.length ? `sin enlazar: ${r.unlinked.join(", ")}` : null,
    ].filter(Boolean);
    return { message: parts.join(" · "), diff: { added: r.added } };
  });
}

const resolveSchema = z.object({
  id: zId,
  as: z.enum(["owner_contribution", "owner_draw", "revenue", "expense", "other_income", "bank_fee", "adjustment", "match", "transfer", "payout", "ignore"]),
  description: zOptText,
  categoryId: zOptId,
  productId: zOptId,
});

export async function resolveInboxAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(resolveSchema, form);
  if (!p.data) return fail(p.error);
  const { id, ...r } = p.data;
  return mutate("banking", "write", "bank_inbox", "resolve", async (tx, userId) => {
    await resolveInboxItem(tx, id, { ...r, remember: checkbox(form, "remember") }, userId);
    return { id, message: r.as === "ignore" ? "Ignorada" : "Clasificada: los reportes ya la reflejan" };
  });
}

export async function acceptAllSuggestionsAction(): Promise<ActionResult> {
  return mutate("banking", "write", "bank_inbox", "accept_all", async (tx, userId) => {
    const r = await acceptAllSuggestions(tx, userId);
    return { message: `${r.ok} clasificadas${r.failed.length ? ` · ${r.failed.length} necesitan revisión: ${r.failed.join("; ")}` : ""}`, diff: r };
  });
}

/** Acepta la sugerencia de una sola transacción (botón ✓ de la bandeja). */
export async function acceptSuggestionAction(id: string): Promise<ActionResult> {
  if (!zId.safeParse(id).success) return fail("Registro inválido");
  return mutate("banking", "write", "bank_inbox", "resolve", async (tx, userId) => {
    const [item] = await tx.select().from(s.bankInbox).where(eq(s.bankInbox.id, id));
    const sug = item?.suggestion as Suggestion | null;
    if (!sug) throw new Error("Esta transacción no tiene sugerencia; clasifícala a mano.");
    await resolveInboxItem(tx, id, { as: sug.as, description: sug.description, categoryId: sug.categoryId, productId: sug.productId }, userId);
    return { id, message: "Registrada" };
  });
}

"use server";

import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import type { Proposal } from "@/lib/assistant/tools";
import { todayIn } from "@/lib/today";
import { saveExpenseAction } from "./expenses";
import { saveRevenueAction } from "./revenue";
import { cancelMemberAction, reactivateMemberAction } from "./members";
import { saveReminderAction } from "./catalogs";
import { classifyMovementAction } from "./banking";
import { saveBudgetAction, saveGoalAction } from "./planning";
import { fail, type ActionResult } from "./result";

const form = (fields: Record<string, unknown>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v === null || v === undefined ? "" : String(v));
  return f;
};

/**
 * Aplica una propuesta del asistente que el usuario confirmó. Pasa por las mismas server
 * actions que los formularios: se vuelven a validar datos y permisos en el servidor.
 */
export async function executeProposalAction(p: Pick<Proposal, "kind" | "payload">): Promise<ActionResult> {
  const d = p.payload as Record<string, string | number | boolean>;
  switch (p.kind) {
    case "expense":
      return saveExpenseAction(
        null,
        form({
          expenseDate: d.date,
          description: d.description,
          categoryId: d.categoryId,
          frequency: "one_time",
          currency: d.currency,
          amountCents: d.amount,
          paymentAccountId: d.account,
          status: d.card ? "pending" : "paid",
          notes: "Registrado con el asistente",
        })
      );
    case "revenue":
      return saveRevenueAction(
        null,
        form({
          revenueDate: d.date,
          productId: d.productId,
          categoryId: d.categoryId,
          customerName: d.customer,
          billingInterval: d.interval,
          currency: "USD",
          grossCents: d.gross,
          processorFeeCents: d.processorFee,
          affiliateFeeCents: d.affiliateFee,
          status: "available",
          depositAccountId: d.deposit,
          notes: "Registrado con el asistente",
        })
      );
    case "cancel_member":
      return cancelMemberAction(null, form({ id: d.memberId, date: todayIn(), when: d.when }));
    case "reactivate_member":
      return reactivateMemberAction(String(d.memberId), todayIn());
    case "reminder":
      return saveReminderAction(null, form({ title: d.title, dueOn: d.dueOn, detail: d.detail }));
    case "classify_movement":
      return classifyMovementAction(null, form({ id: d.id, as: d.as, description: d.description, categoryId: d.categoryId, productId: d.productId }));
    case "budget": {
      // Si ya existe presupuesto para esa categoría y periodo, se actualiza.
      const db = await getDb();
      const month = d.month === "todos" ? null : String(d.month);
      const existing = (await db.select().from(s.budgets).where(eq(s.budgets.categoryId, String(d.categoryId)))).find((b) => b.month === month);
      return saveBudgetAction(null, form({ id: existing?.id, categoryId: d.categoryId, month: month ?? "", amountCents: d.amount }));
    }
    case "goal":
      return saveGoalAction(null, form({ name: d.name, metric: d.metric, target: d.target, periodStart: d.periodStart, periodEnd: d.periodEnd, status: "active" }));
  }
  return fail("Acción desconocida");
}

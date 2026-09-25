"use server";

import { closeMonth, reopenMonth } from "@/lib/services/month-close";
import { todayIn } from "@/lib/today";
import { mutate } from "./mutate";
import { fail, type ActionResult } from "./result";

export async function closeMonthAction(month: string): Promise<ActionResult> {
  if (!/^\d{4}-\d{2}$/.test(month)) return fail("Mes inválido");
  return mutate("reports", "write", "books", "close_month", async (tx) => {
    await closeMonth(tx, month, todayIn());
    return { message: "Mes cerrado: sus números ya no cambian", diff: { month } };
  });
}

/** Solo Administrador (nivel admin en Reportes); queda en la bitácora. */
export async function reopenMonthAction(): Promise<ActionResult> {
  return mutate("reports", "admin", "books", "reopen_month", async (tx) => {
    const month = await reopenMonth(tx);
    return { message: "Mes reabierto: ya se puede editar", diff: { month } };
  });
}

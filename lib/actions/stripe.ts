"use server";

import { z } from "zod";
import { stripeConfigured, stripeGateway } from "@/lib/stripe/client";
import { accountBalanceCents } from "@/lib/services/ledger";
import { importStripeHistory, storeStripeBalance, stripeAccountId } from "@/lib/services/stripe-sync";
import { completeAccessTask, dismissAccessTask, setConfirmedLevel } from "@/lib/services/access-tasks";
import { todayIn } from "@/lib/today";
import { mutate } from "./mutate";
import { fail, type ActionResult } from "./result";

const zId = z.string().uuid();

/** Trae de Stripe las facturas pagadas y los payouts desde el 1 de enero de 2026. Solo lee de Stripe. */
export async function importStripeHistoryAction(): Promise<ActionResult> {
  if (!stripeConfigured()) return fail("Falta STRIPE_SECRET_KEY en Vercel.");
  return mutate("revenue", "write", "stripe", "import_history", async (tx) => {
    const today = todayIn();
    const gw = stripeGateway();
    const r = await importStripeHistory(tx, gw, Math.floor(Date.parse("2026-01-01T00:00:00Z") / 1000), today);
    await storeStripeBalance(tx, gw, today, await accountBalanceCents(tx, await stripeAccountId(tx), today));
    return { message: `Stripe: ${r.invoices} cobros y ${r.payouts} payouts revisados (sin duplicar)`, diff: r };
  });
}

/** Confirmar que se hizo en Skool: es lo único que cambia el nivel de acceso registrado. */
export async function completeAccessTaskAction(taskId: string): Promise<ActionResult> {
  if (!zId.safeParse(taskId).success) return fail("Tarea inválida");
  return mutate("revenue", "write", "access_tasks", "complete", async (tx, userId) => {
    const t = await completeAccessTask(tx, taskId, userId);
    return { id: taskId, message: t.kind === "grant_level" ? "Acceso confirmado en Skool" : "Tarea completada", diff: { kind: t.kind, level: t.level } };
  });
}

export async function dismissAccessTaskAction(taskId: string): Promise<ActionResult> {
  if (!zId.safeParse(taskId).success) return fail("Tarea inválida");
  return mutate("revenue", "write", "access_tasks", "dismiss", async (tx) => {
    await dismissAccessTask(tx, taskId);
    return { id: taskId, message: "Tarea descartada" };
  });
}

/** Para clientes que ya tenían acceso antes de conectar Stripe (ej. ya tiene los módulos 1–4). */
export async function setConfirmedLevelAction(contractId: string, level: number): Promise<ActionResult> {
  if (!zId.safeParse(contractId).success || !Number.isInteger(level) || level < 0 || level > 24) return fail("Datos inválidos");
  return mutate("revenue", "write", "customer_contracts", "set_access_level", async (tx) => {
    await setConfirmedLevel(tx, contractId, level);
    return { id: contractId, message: `Nivel de acceso registrado: ${level}`, diff: { level } };
  });
}

/**
 * Tareas manuales de acceso en Skool. Confirmar una tarea es la única forma de cambiar el nivel
 * de acceso registrado de un contrato: el sistema nunca da por hecho un cambio en Skool.
 */
import { and, eq, lt } from "drizzle-orm";
import * as s from "@/db/schema";
import type { Tx } from "./ledger";

export async function completeAccessTask(tx: Tx, taskId: string, userId: string | null) {
  const [task] = await tx.select().from(s.accessTasks).where(eq(s.accessTasks.id, taskId));
  if (!task) throw new Error("La tarea no existe.");
  if (task.status !== "pendiente") throw new Error("Esta tarea ya se cerró.");
  await tx.update(s.accessTasks).set({ status: "hecha", doneAt: new Date(), doneBy: userId, updatedAt: new Date() }).where(eq(s.accessTasks.id, taskId));

  const [c] = await tx.select().from(s.customerContracts).where(eq(s.customerContracts.id, task.contractId));
  if (task.kind === "grant_level" && task.level && task.level > c.accessLevelConfirmed) {
    await tx.update(s.customerContracts).set({ accessLevelConfirmed: task.level, updatedAt: new Date() }).where(eq(s.customerContracts.id, c.id));
    // Un nivel confirmado deja sin sentido las tareas pendientes de niveles menores.
    await tx
      .update(s.accessTasks)
      .set({ status: "descartada", updatedAt: new Date() })
      .where(and(eq(s.accessTasks.contractId, c.id), eq(s.accessTasks.kind, "grant_level"), eq(s.accessTasks.status, "pendiente"), lt(s.accessTasks.level, task.level)));
  }
  if (task.kind === "restrict_access") {
    await tx.update(s.customerContracts).set({ accessLevelConfirmed: 0, updatedAt: new Date() }).where(eq(s.customerContracts.id, c.id));
  }
  return task;
}

export async function dismissAccessTask(tx: Tx, taskId: string) {
  await tx.update(s.accessTasks).set({ status: "descartada", updatedAt: new Date() }).where(and(eq(s.accessTasks.id, taskId), eq(s.accessTasks.status, "pendiente")));
}

/** Registrar a mano el nivel que ya tiene un cliente (ej. el que ya tenía acceso antes de conectar Stripe). */
export async function setConfirmedLevel(tx: Tx, contractId: string, level: number) {
  await tx.update(s.customerContracts).set({ accessLevelConfirmed: level, updatedAt: new Date() }).where(eq(s.customerContracts.id, contractId));
  await tx
    .update(s.accessTasks)
    .set({ status: "descartada", updatedAt: new Date() })
    .where(and(eq(s.accessTasks.contractId, contractId), eq(s.accessTasks.kind, "grant_level"), eq(s.accessTasks.status, "pendiente"), lt(s.accessTasks.level, level + 1)));
}

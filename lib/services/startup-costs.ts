/**
 * Puesta en marcha: lo que el dueño pagó de su bolsillo ANTES del inicio de operaciones.
 * Es aporte de capital, no gasto de la operación: no toca utilidad bruta, EBITDA, márgenes,
 * burn ni presupuestos, y no aparece en Gastos. Contablemente sí necesita su contrapartida
 * (el capital aportado se usó en algo), así que queda en su propia línea "cubierta con capital
 * inicial" y el balance cuadra. Desde el inicio de operaciones, todo es gasto normal.
 */
import { and, asc, eq, lt, sql, sum } from "drizzle-orm";
import * as s from "@/db/schema";
import { saveExpense, type Tx } from "./ledger";

export async function operationsStart(tx: Tx): Promise<string | null> {
  const [row] = await tx.select().from(s.settings).where(eq(s.settings.key, "operations_start_date"));
  return typeof row?.value === "string" ? row.value : null;
}

/** Condición SQL: pagado por el dueño antes del inicio de operaciones. */
export const isStartupCost = (start: string) => and(eq(s.expenses.fundingSource, "owner_personal"), lt(s.expenses.expenseDate, start));

export async function listStartupCosts(tx: Tx) {
  const start = await operationsStart(tx);
  if (!start) return { start, rows: [] as (typeof s.expenses.$inferSelect)[] };
  const rows = await tx.select().from(s.expenses).where(and(isStartupCost(start), sql`${s.expenses.status} <> 'void'`)).orderBy(asc(s.expenses.expenseDate));
  return { start, rows };
}

export type StartupInput = {
  date: string;
  description: string;
  amountCents: number;
  currency: "USD" | "HNL";
  categoryId: string | null;
  contractId: string | null;
  userId?: string | null;
};

/** Registra un pago de puesta en marcha (aporte de capital). Si es cuota de un contrato, baja el compromiso. */
export async function recordStartupCost(tx: Tx, input: StartupInput) {
  const start = await operationsStart(tx);
  if (!start) throw new Error("Define primero la fecha de inicio de operaciones (Catálogos → Empresa).");
  if (input.date >= start) throw new Error(`Desde el ${start} ya es operación: regístralo como gasto normal.`);

  let categoryId = input.categoryId;
  let vendorId: string | null = null;
  let description = input.description;
  if (input.contractId) {
    const [ct] = await tx.select().from(s.vendorContracts).where(eq(s.vendorContracts.id, input.contractId));
    if (!ct) throw new Error("El contrato no existe");
    categoryId ??= ct.categoryId;
    vendorId = ct.vendorId;
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.expenses).where(eq(s.expenses.contractId, ct.id));
    description = description || `Cuota ${n + 1} · ${ct.name}`;
  }
  if (!categoryId) throw new Error("Elige la categoría o el contrato.");

  const id = await saveExpense(tx, {
    expenseDate: input.date,
    description,
    categoryId,
    vendorId,
    frequency: "one_time",
    currency: input.currency,
    amountCents: input.amountCents,
    paymentAccountId: null, // sin cuenta = lo pagó el dueño ⇒ aporte de capital automático
    status: "paid",
    dueDate: null,
    paidOn: input.date,
    contractId: input.contractId,
    notes: "Puesta en marcha · aporte de capital inicial",
    createdBy: input.userId ?? null,
  });

  if (input.contractId) {
    const [ct] = await tx.select().from(s.vendorContracts).where(eq(s.vendorContracts.id, input.contractId));
    const [{ paid }] = await tx.select({ paid: sum(s.expenses.amountCents) }).from(s.expenses).where(eq(s.expenses.contractId, input.contractId));
    if (Number(paid ?? 0) >= ct.totalCents) await tx.update(s.vendorContracts).set({ status: "completed", updatedAt: new Date() }).where(eq(s.vendorContracts.id, ct.id));
  }
  return id;
}

"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { classifyMovement, payCard, payout, reconcile, transfer } from "@/lib/services/ledger";
import { mutate } from "./mutate";
import { fail, parseForm, zCurrency, zDate, zId, zInt, zMoney, zOptDate, zOptId, zOptMoney, zOptText, zText, type ActionResult } from "./result";

const accountSchema = z.object({
  id: zOptId,
  name: zText,
  institution: zOptText,
  owner: z.preprocess((v) => v ?? "llc", z.enum(["llc", "personal"])),
  type: z.enum(["checking", "savings", "credit_card", "processor", "cash"]),
  currency: zCurrency,
  last4: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().regex(/^\d{4}$/, "Últimos 4 dígitos").nullable()),
  openingBalanceCents: zOptMoney,
  openingDate: zOptDate,
  creditLimitCents: zOptMoney,
  paymentDueDay: zInt,
  repaymentTerms: zOptText,
  cashbackPct: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.number().min(0).max(20).nullable()),
  status: z.enum(["active", "pending_opening", "closed"]),
  sortOrder: z.preprocess((v) => (v === "" || v === undefined ? 0 : v), z.coerce.number().int()),
});

export async function saveAccountAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(accountSchema, form);
  if (!p.data) return fail(p.error);
  const { id, cashbackPct, creditLimitCents, ...input } = p.data;
  const values = {
    ...input,
    cashbackPct: cashbackPct === null ? null : String(cashbackPct),
    creditLimitCents: input.type === "credit_card" && creditLimitCents ? creditLimitCents : null,
  };
  return mutate("banking", "admin", "financial_accounts", id ? "update" : "create", async (tx) => {
    if (id) {
      await tx.update(s.financialAccounts).set({ ...values, updatedAt: new Date() }).where(eq(s.financialAccounts.id, id));
      return { id, message: "Cuenta actualizada" };
    }
    const [row] = await tx.insert(s.financialAccounts).values(values).returning();
    return { id: row.id, message: "Cuenta creada" };
  });
}

const CLASSES = ["owner_contribution", "owner_draw", "revenue", "expense", "other_income", "bank_fee", "adjustment"] as const;
const INFLOW = new Set(["owner_contribution", "revenue", "other_income"]);

const movementSchema = z.object({
  accountId: zId,
  date: zDate,
  as: z.enum(CLASSES),
  direction: z.enum(["in", "out"]).optional(),
  amountCents: zMoney,
  description: zText,
  categoryId: zOptId,
  productId: zOptId,
});

/** Movimiento del estado de cuenta: se registra como lo que realmente es. */
export async function addMovementAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(movementSchema, form);
  if (!p.data) return fail(p.error);
  const m = p.data;
  const inflow = m.as === "adjustment" ? m.direction !== "out" : INFLOW.has(m.as);
  return mutate("banking", "write", "cash_movements", "create", async (tx, userId) => {
    const [a] = await tx.select().from(s.financialAccounts).where(eq(s.financialAccounts.id, m.accountId));
    const [row] = await tx
      .insert(s.cashMovements)
      .values({ accountId: m.accountId, movementDate: m.date, type: "adjustment", amountCents: inflow ? m.amountCents : -m.amountCents, currency: a.currency, description: m.description, createdBy: userId })
      .returning();
    await classifyMovement(tx, row.id, { as: m.as, description: m.description, categoryId: m.categoryId, productId: m.productId, userId });
    return { id: row.id, message: "Movimiento registrado" };
  });
}

const classifySchema = z.object({ id: zId, as: z.enum(CLASSES), description: zText, categoryId: zOptId, productId: zOptId });

export async function classifyMovementAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(classifySchema, form);
  if (!p.data) return fail(p.error);
  const { id, ...c } = p.data;
  return mutate("banking", "write", "cash_movements", "classify", async (tx, userId) => {
    await classifyMovement(tx, id, { ...c, userId });
    return { id, message: "Movimiento clasificado: los reportes ya lo reflejan" };
  });
}

export async function deleteMovementAction(id: string): Promise<ActionResult> {
  if (!zId.safeParse(id).success) return fail("Registro inválido");
  return mutate("banking", "admin", "cash_movements", "delete", async (tx) => {
    const [m] = await tx.select().from(s.cashMovements).where(eq(s.cashMovements.id, id));
    if (!m) return { id };
    if (m.revenueId || m.expenseId || m.debtPaymentId || m.ownerLedgerId || m.taxObligationId) {
      throw new Error("Este movimiento viene de otro registro (ingreso, gasto, pago…). Edítalo desde ahí.");
    }
    if (m.transferGroupId) await tx.delete(s.cashMovements).where(eq(s.cashMovements.transferGroupId, m.transferGroupId));
    else await tx.delete(s.cashMovements).where(eq(s.cashMovements.id, id));
    return { id, message: "Movimiento eliminado" };
  });
}

const transferSchema = z.object({ fromId: zId, toId: zId, date: zDate, amountCents: zMoney, description: zOptText });

export async function transferAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(transferSchema, form);
  if (!p.data) return fail(p.error);
  if (p.data.fromId === p.data.toId) return fail("Elige dos cuentas distintas.");
  const t = p.data;
  return mutate("banking", "write", "cash_movements", "transfer", async (tx, userId) => {
    await transfer(tx, { ...t, userId });
    return { message: "Transferencia registrada" };
  });
}

const payCardSchema = z.object({ cardId: zId, fromAccountId: zId, date: zDate });

export async function payCardAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(payCardSchema, form);
  if (!p.data) return fail(p.error);
  const d = p.data;
  return mutate("banking", "write", "cash_movements", "card_payment", async (tx, userId) => {
    const r = await payCard(tx, { ...d, userId });
    if (r.count === 0) return { message: "La tarjeta no tiene cargos pendientes" };
    const fmt = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
    return { message: `Pagados ${r.count} cargos por ${fmt(r.total)}${r.cashback ? ` · cashback ${fmt(r.cashback)}` : ""}` };
  });
}

const reconcileSchema = z.object({ accountId: zId, date: zDate, statementBalanceCents: z.preprocess((v) => (typeof v === "string" ? Number(v.replace(/[,$\s]/g, "")) : v), z.number().finite().transform((n) => Math.round(n * 100))) });

export async function reconcileAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(reconcileSchema, form);
  if (!p.data) return fail(p.error);
  const r = p.data;
  return mutate("banking", "admin", "account_statements", "reconcile", async (tx, userId) => {
    const { diff } = await reconcile(tx, { ...r, userId });
    return {
      message: diff === 0 ? "¡Cuadra perfecto! Cuenta conciliada." : `Conciliada con un ajuste de ${(diff / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}`,
    };
  });
}


const payoutSchema = z.object({
  platformId: zId,
  toAccountId: z.preprocess((v) => (v === "owner" || v === "" ? null : v), z.string().uuid().nullable()),
  date: zDate,
  amountCents: zMoney,
});

/** Payout de Skool: a Mercury (entra a la caja) o al dueño (retiro). */
export async function payoutAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(payoutSchema, form);
  if (!p.data) return fail(p.error);
  if (p.data.amountCents === 0) return fail("El monto no puede ser cero.");
  const d = p.data;
  return mutate("banking", "write", "cash_movements", "payout", async (tx, userId) => {
    await payout(tx, { ...d, userId });
    return { message: d.toAccountId ? "Payout registrado: el dinero ya está en la caja" : "Payout al dueño registrado como retiro" };
  });
}

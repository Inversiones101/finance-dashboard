"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { deleteDebtPayment, findOrCreateCounterparty, payContractInstallment, recordDebtPayment } from "@/lib/services/ledger";
import { checkbox, mutate } from "./mutate";
import { fail, parseForm, zCurrency, zDate, zId, zInt, zMoney, zOptDate, zOptId, zOptMoney, zOptText, zText, type ActionResult } from "./result";

// ── Deudas de la LLC con terceros ───────────────────────────────────────────

const debtSchema = z.object({
  id: zOptId,
  name: zText,
  creditorName: zText,
  currency: zCurrency,
  principalCents: zMoney,
  upfrontFeeCents: zOptMoney,
  annualRatePct: z.preprocess((v) => (v === "" || v === undefined ? "0" : v), z.coerce.number().min(0).max(200)),
  installmentsTotal: zInt,
  installmentAmountCents: zOptMoney,
  startDate: zDate,
  firstDueDate: zOptDate,
  accountId: zOptId,
  status: z.enum(["active", "paid_off", "defaulted", "renegotiated"]),
  notes: zOptText,
});

export async function saveDebtAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(debtSchema, form);
  if (!p.data) return fail(p.error);
  const { id, creditorName, annualRatePct, installmentAmountCents, ...input } = p.data;
  const disbursed = checkbox(form, "disbursed");
  return mutate("debts", "write", "debts", id ? "update" : "create", async (tx, userId) => {
    const values = {
      ...input,
      creditorId: await findOrCreateCounterparty(tx, creditorName, "creditor"),
      annualRatePct: String(annualRatePct),
      installmentAmountCents: installmentAmountCents || null,
    };
    if (id) {
      await tx.update(s.debts).set({ ...values, updatedAt: new Date() }).where(eq(s.debts.id, id));
      return { id, message: "Deuda actualizada" };
    }
    const [row] = await tx.insert(s.debts).values(values).returning();
    // Si el préstamo se depositó en una cuenta de la LLC, entra a la caja.
    if (disbursed && input.accountId) {
      await tx.insert(s.cashMovements).values({
        accountId: input.accountId,
        movementDate: input.startDate,
        type: "debt_disbursement",
        amountCents: input.principalCents,
        currency: input.currency,
        description: `Desembolso ${input.name}`,
        createdBy: userId,
      });
    }
    return { id: row.id, message: "Deuda registrada" };
  });
}

const paymentSchema = z.object({
  debtId: zId,
  date: zDate,
  principalCents: zOptMoney,
  interestCents: zOptMoney,
  feeCents: zOptMoney,
  accountId: zOptId,
});

export async function payDebtAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(paymentSchema, form);
  if (!p.data) return fail(p.error);
  const { debtId, ...pay } = p.data;
  if (pay.principalCents + pay.interestCents + pay.feeCents === 0) return fail("El pago no puede ser cero.");
  return mutate("debts", "write", "debt_payments", "create", async (tx, userId) => {
    const id = await recordDebtPayment(tx, debtId, { ...pay, userId });
    return { id, message: "Pago registrado" };
  });
}

export async function deleteDebtPaymentAction(id: string): Promise<ActionResult> {
  if (!zId.safeParse(id).success) return fail("Registro inválido");
  return mutate("debts", "write", "debt_payments", "delete", async (tx) => {
    await deleteDebtPayment(tx, id);
    return { id, message: "Pago eliminado" };
  });
}

export async function deleteDebtAction(id: string): Promise<ActionResult> {
  if (!zId.safeParse(id).success) return fail("Registro inválido");
  return mutate("debts", "admin", "debts", "delete", async (tx) => {
    const payments = await tx.select().from(s.debtPayments).where(eq(s.debtPayments.debtId, id));
    for (const pay of payments) await deleteDebtPayment(tx, pay.id);
    await tx.delete(s.debts).where(eq(s.debts.id, id));
    return { id, message: "Deuda eliminada" };
  });
}

// ── Contratos con proveedores (compromisos) ─────────────────────────────────

const contractSchema = z.object({
  id: zOptId,
  name: zText,
  vendorName: zText,
  categoryId: zId,
  currency: zCurrency,
  totalCents: zMoney,
  signedOn: zDate,
  installmentDay: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.number().int().min(1).max(31).nullable()),
  installmentAmountCents: zOptMoney,
  status: z.enum(["active", "completed", "canceled"]),
  notes: zOptText,
});

export async function saveContractAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(contractSchema, form);
  if (!p.data) return fail(p.error);
  const { id, vendorName, installmentAmountCents, ...input } = p.data;
  return mutate("debts", "write", "vendor_contracts", id ? "update" : "create", async (tx) => {
    const values = { ...input, installmentAmountCents: installmentAmountCents || null, vendorId: await findOrCreateCounterparty(tx, vendorName, "vendor") };
    if (id) {
      await tx.update(s.vendorContracts).set({ ...values, updatedAt: new Date() }).where(eq(s.vendorContracts.id, id));
      return { id, message: "Compromiso actualizado" };
    }
    const [row] = await tx.insert(s.vendorContracts).values(values).returning();
    return { id: row.id, message: "Compromiso creado" };
  });
}

const installmentSchema = z.object({ contractId: zId, date: zDate, amountCents: zMoney, accountId: zOptId });

export async function payInstallmentAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(installmentSchema, form);
  if (!p.data) return fail(p.error);
  const { contractId, ...pay } = p.data;
  if (pay.amountCents === 0) return fail("El monto no puede ser cero.");
  return mutate("debts", "write", "vendor_contracts", "installment", async (tx, userId) => {
    const id = await payContractInstallment(tx, contractId, { ...pay, userId });
    return { id, message: "Cuota registrada como gasto" };
  });
}

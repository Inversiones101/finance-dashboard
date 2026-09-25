/**
 * Miembros (suscriptores). El MRR se calcula con los planes activos, así que dar de baja
 * o reactivar a alguien aquí actualiza el MRR, el ARR y el pronóstico al instante.
 */
import { and, eq, sql } from "drizzle-orm";
import * as s from "@/db/schema";
import { addMonthsToDate, saveRevenue, type Tx } from "./ledger";
import { priceOn } from "./pricing";

type Interval = "monthly" | "quarterly" | "annual";
const MONTHS: Record<Interval, number> = { monthly: 1, quarterly: 3, annual: 12 };

export type MemberInput = {
  name: string;
  productId: string;
  billingInterval: Interval;
  currency: "USD" | "HNL";
  priceCents: number;
  startedOn: string;
  currentPeriodEnd: string | null;
  notes: string | null;
};

export async function saveMember(tx: Tx, input: MemberInput, id?: string) {
  const values = { ...input, currentPeriodEnd: input.currentPeriodEnd ?? addMonthsToDate(input.startedOn, MONTHS[input.billingInterval]) };
  if (id) {
    await tx.update(s.members).set({ ...values, updatedAt: new Date() }).where(eq(s.members.id, id));
    return id;
  }
  const [row] = await tx.insert(s.members).values(values).returning({ id: s.members.id });
  return row.id;
}

/**
 * Da de baja: deja de contar en el MRR a partir de `accessUntil` (por defecto, el fin del
 * periodo que ya pagó; si quieres sacarlo ya, usa la fecha de hoy).
 */
export async function cancelMember(tx: Tx, id: string, { date, accessUntil }: { date: string; accessUntil?: string | null }) {
  const [m] = await tx.select().from(s.members).where(eq(s.members.id, id));
  if (!m) throw new Error("El miembro no existe");
  await tx
    .update(s.members)
    .set({ status: "canceled", canceledOn: date, accessUntil: accessUntil ?? m.currentPeriodEnd, updatedAt: new Date() })
    .where(eq(s.members.id, id));
}

/** Lo vuelve a sumar al MRR. Si su periodo ya venció, arranca uno nuevo desde `date`. */
export async function reactivateMember(tx: Tx, id: string, { date }: { date: string }) {
  const [m] = await tx.select().from(s.members).where(eq(s.members.id, id));
  if (!m) throw new Error("El miembro no existe");
  const currentPeriodEnd = m.currentPeriodEnd >= date ? m.currentPeriodEnd : addMonthsToDate(date, MONTHS[m.billingInterval as Interval]);
  await tx
    .update(s.members)
    .set({ status: "active", canceledOn: null, accessUntil: null, currentPeriodEnd, updatedAt: new Date() })
    .where(eq(s.members.id, id));
}

/** Registra la renovación/cobro de un miembro como ingreso y adelanta su próximo periodo. */
export async function chargeMember(
  tx: Tx,
  id: string,
  p: { date: string; grossCents: number; processorFeeCents: number; affiliateFeeCents: number; depositAccountId: string | null; userId?: string | null }
) {
  const [m] = await tx.select().from(s.members).where(eq(s.members.id, id));
  if (!m) throw new Error("El miembro no existe");
  const [product] = await tx.select().from(s.products).where(eq(s.products.id, m.productId));
  const interval = m.billingInterval as Interval;

  const revenueId = await saveRevenue(tx, {
    revenueDate: p.date,
    productId: m.productId,
    categoryId: product.categoryId,
    customerName: m.name,
    memberId: m.id,
    billingInterval: interval,
    serviceStart: p.date,
    currency: m.currency,
    grossCents: p.grossCents,
    processorFeeCents: p.processorFeeCents,
    affiliateFeeCents: p.affiliateFeeCents,
    status: "available",
    depositAccountId: p.depositAccountId,
    notes: "Renovación",
    createdBy: p.userId ?? null,
  });
  const base = m.currentPeriodEnd > p.date ? m.currentPeriodEnd : p.date;
  await tx
    .update(s.members)
    .set({ currentPeriodEnd: addMonthsToDate(base, MONTHS[interval]), status: "active", canceledOn: null, accessUntil: null, updatedAt: new Date() })
    .where(eq(s.members.id, id));
  return revenueId;
}

/**
 * Un ingreso recurrente con nombre de cliente queda ligado a su miembro (lo crea si no existe),
 * para que el MRR no dependa de acordarse de darlo de alta aparte.
 */
export async function ensureMemberForRevenue(
  tx: Tx,
  r: { customerName: string | null; productId: string | null; billingInterval: string; currency: "USD" | "HNL"; grossCents: number; revenueDate: string; serviceStart: string | null }
) {
  if (!r.customerName?.trim() || !r.productId || r.billingInterval === "one_time") return null;
  const interval = r.billingInterval as Interval;
  const start = r.serviceStart ?? r.revenueDate;
  const periodEnd = addMonthsToDate(start, MONTHS[interval]);
  const [existing] = await tx.select().from(s.members).where(sql`lower(trim(${s.members.name})) = lower(trim(${r.customerName}))`);
  // Precio de lista vigente el día del cobro: los precios cambian con cada lanzamiento.
  const listPrice = (await priceOn(tx, r.productId, start)) ?? r.grossCents;

  if (existing) {
    if (periodEnd > existing.currentPeriodEnd) {
      // Mismo plan: conserva su precio (quien ya está no sube). Cambió de plan: toma el precio vigente.
      const samePlan = existing.productId === r.productId && existing.billingInterval === interval;
      await tx
        .update(s.members)
        .set({ productId: r.productId, billingInterval: interval, priceCents: samePlan ? existing.priceCents : listPrice, currentPeriodEnd: periodEnd, status: "active", canceledOn: null, accessUntil: null, updatedAt: new Date() })
        .where(and(eq(s.members.id, existing.id)));
    }
    return existing.id;
  }
  return saveMember(tx, {
    name: r.customerName.trim(),
    productId: r.productId,
    billingInterval: interval,
    currency: r.currency,
    priceCents: listPrice,
    startedOn: r.revenueDate,
    currentPeriodEnd: periodEnd,
    notes: null,
  });
}

export async function deleteMember(tx: Tx, id: string) {
  // Los cobros históricos se conservan; solo pierden el vínculo.
  await tx.delete(s.members).where(eq(s.members.id, id));
}

/**
 * Miembros (suscriptores). El MRR se calcula con los planes activos, así que dar de baja
 * o reactivar a alguien aquí actualiza el MRR, el ARR y el pronóstico al instante.
 */
import { and, eq, gt, sql } from "drizzle-orm";
import * as s from "@/db/schema";
import { addMonthsToDate, saveRevenue, type Tx } from "./ledger";
import { priceOn } from "./pricing";

type Interval = "monthly" | "quarterly" | "annual";
const MONTHS: Record<Interval, number> = { monthly: 1, quarterly: 3, annual: 12 };

type Row = typeof s.members.$inferSelect;

/** MRR que aporta un plan (centavos al mes). */
export const planMrr = (m: Pick<Row, "priceCents" | "billingInterval">) => Math.round(m.priceCents / (MONTHS[m.billingInterval as Interval] ?? 1));
const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Deja constancia de cuánto movió el MRR un cambio en el miembro (alta, cambio de plan o precio,
 * baja, reactivación). Una baja que aún no se cumplía y se revierte no cuenta como churn.
 */
export async function logMemberTransition(tx: Tx, before: Row | null, after: Row, date: string) {
  const log = (type: "new" | "change" | "cancel" | "reactivate", delta: number, eventDate = date) =>
    delta || type !== "change" ? tx.insert(s.memberEvents).values({ memberId: after.id, eventDate, type, mrrDeltaCents: delta }) : null;

  if (!before) return log("new", after.status === "active" ? planMrr(after) : 0, after.startedOn);
  if (before.status === "active" && after.status === "canceled") return log("cancel", -planMrr(before), after.accessUntil ?? date);
  if (before.status === "canceled" && after.status === "active") {
    // ¿Su baja todavía no se cumplía? Entonces nunca se fue: se borra y solo cuenta el cambio de plan.
    const undone = await tx
      .delete(s.memberEvents)
      .where(and(eq(s.memberEvents.memberId, after.id), eq(s.memberEvents.type, "cancel"), gt(s.memberEvents.eventDate, date)))
      .returning();
    if (undone.length) return log("change", planMrr(after) - planMrr(before));
    return log("reactivate", planMrr(after));
  }
  if (before.status === "active" && after.status === "active") return log("change", planMrr(after) - planMrr(before));
}

/** Ejecuta un cambio sobre un miembro y registra su efecto en el MRR. */
export async function trackMember<T>(tx: Tx, id: string | null, date: string, fn: () => Promise<T>): Promise<T> {
  const before = id ? ((await tx.select().from(s.members).where(eq(s.members.id, id)))[0] ?? null) : null;
  const result = await fn();
  const afterId = id ?? (typeof result === "string" ? result : null);
  if (afterId) {
    const [after] = await tx.select().from(s.members).where(eq(s.members.id, afterId));
    if (after) await logMemberTransition(tx, before, after, date);
  }
  return result;
}

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
  return trackMember(tx, id ?? null, id ? todayIso() : input.startedOn, async () => {
    if (id) {
      await tx.update(s.members).set({ ...values, updatedAt: new Date() }).where(eq(s.members.id, id));
      return id;
    }
    const [row] = await tx.insert(s.members).values(values).returning({ id: s.members.id });
    return row.id;
  });
}

/**
 * Da de baja: deja de contar en el MRR a partir de `accessUntil` (por defecto, el fin del
 * periodo que ya pagó; si quieres sacarlo ya, usa la fecha de hoy).
 */
export async function cancelMember(tx: Tx, id: string, { date, accessUntil }: { date: string; accessUntil?: string | null }) {
  const [m] = await tx.select().from(s.members).where(eq(s.members.id, id));
  if (!m) throw new Error("El miembro no existe");
  if (m.status === "canceled") return;
  await trackMember(tx, id, date, () =>
    tx
      .update(s.members)
      .set({ status: "canceled", canceledOn: date, accessUntil: accessUntil ?? m.currentPeriodEnd, updatedAt: new Date() })
      .where(eq(s.members.id, id))
  );
}

/** Lo vuelve a sumar al MRR. Si su periodo ya venció, arranca uno nuevo desde `date`. */
export async function reactivateMember(tx: Tx, id: string, { date }: { date: string }) {
  const [m] = await tx.select().from(s.members).where(eq(s.members.id, id));
  if (!m) throw new Error("El miembro no existe");
  const currentPeriodEnd = m.currentPeriodEnd >= date ? m.currentPeriodEnd : addMonthsToDate(date, MONTHS[m.billingInterval as Interval]);
  await trackMember(tx, id, date, () =>
    tx.update(s.members).set({ status: "active", canceledOn: null, accessUntil: null, currentPeriodEnd, updatedAt: new Date() }).where(eq(s.members.id, id))
  );
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
  await trackMember(tx, id, p.date, () =>
    tx
      .update(s.members)
      .set({ currentPeriodEnd: addMonthsToDate(base, MONTHS[interval]), status: "active", canceledOn: null, accessUntil: null, updatedAt: new Date() })
      .where(eq(s.members.id, id))
  );
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
      const productId = r.productId;
      const samePlan = existing.productId === productId && existing.billingInterval === interval;
      await trackMember(tx, existing.id, r.revenueDate, () =>
        tx
          .update(s.members)
          .set({ productId, billingInterval: interval, priceCents: samePlan ? existing.priceCents : listPrice, currentPeriodEnd: periodEnd, status: "active", canceledOn: null, accessUntil: null, updatedAt: new Date() })
          .where(eq(s.members.id, existing.id))
      );
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

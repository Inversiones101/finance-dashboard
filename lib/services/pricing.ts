/**
 * Precios de lista con historial. Regla: quien entra paga el precio vigente ese día y lo
 * conserva; subir el precio solo afecta a los miembros nuevos (así funciona Skool).
 */
import { and, asc, desc, eq, lte } from "drizzle-orm";
import * as s from "@/db/schema";
import type { Tx } from "./ledger";

/** Precio de lista de un producto en una fecha (historial; si no hay, el precio de respaldo). */
export async function priceOn(tx: Tx, productId: string, date: string): Promise<number | null> {
  const [row] = await tx
    .select({ c: s.productPrices.priceCents })
    .from(s.productPrices)
    .where(and(eq(s.productPrices.productId, productId), lte(s.productPrices.effectiveFrom, date)))
    .orderBy(desc(s.productPrices.effectiveFrom))
    .limit(1);
  if (row) return row.c;
  const [p] = await tx.select({ c: s.products.listPriceCents }).from(s.products).where(eq(s.products.id, productId));
  return p?.c ?? null;
}

export type PriceSchedule = { current: number | null; next: { priceCents: number; from: string } | null; history: { id: string; priceCents: number; from: string; note: string | null }[] };

/** Por producto: precio vigente hoy, el próximo cambio programado y el historial. */
export async function priceSchedules(tx: Tx, today: string): Promise<Map<string, PriceSchedule>> {
  const [products, prices] = await Promise.all([
    tx.select({ id: s.products.id, fallback: s.products.listPriceCents }).from(s.products),
    tx.select().from(s.productPrices).orderBy(asc(s.productPrices.effectiveFrom)),
  ]);
  const out = new Map<string, PriceSchedule>();
  for (const p of products) {
    const history = prices.filter((x) => x.productId === p.id).map((x) => ({ id: x.id, priceCents: x.priceCents, from: x.effectiveFrom, note: x.note }));
    const past = history.filter((h) => h.from <= today);
    const future = history.find((h) => h.from > today);
    out.set(p.id, { current: past.at(-1)?.priceCents ?? p.fallback ?? null, next: future ? { priceCents: future.priceCents, from: future.from } : null, history });
  }
  return out;
}

/** Programa (o corrige) un precio desde una fecha. Los miembros actuales conservan el suyo. */
export async function setPrice(tx: Tx, p: { productId: string; priceCents: number; effectiveFrom: string; note: string | null }, today: string) {
  await tx
    .insert(s.productPrices)
    .values(p)
    .onConflictDoUpdate({ target: [s.productPrices.productId, s.productPrices.effectiveFrom], set: { priceCents: p.priceCents, note: p.note, updatedAt: new Date() } });
  // El respaldo sigue al precio vigente para lo que lea `list_price_cents` directamente.
  const current = await priceOn(tx, p.productId, today);
  await tx.update(s.products).set({ listPriceCents: current, updatedAt: new Date() }).where(eq(s.products.id, p.productId));
}

/** Aplica los cambios de precio programados que ya entraron en vigor (lo llama el cron diario). */
export async function syncListPrices(tx: Tx, today: string) {
  for (const [productId, sch] of await priceSchedules(tx, today)) {
    if (sch.history.length) await tx.update(s.products).set({ listPriceCents: sch.current }).where(eq(s.products.id, productId));
  }
}

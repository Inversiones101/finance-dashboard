/**
 * Comisión que Skool cobra por cada pago (ej. 2.9% + $0.30). Se guarda en settings y se aplica
 * a los cobros que entran por Skool: importación del CSV y renovaciones registradas a mano.
 */
import { and, eq, sql } from "drizzle-orm";
import * as s from "@/db/schema";
import { syncRevenue, type Tx } from "./ledger";

/** `affiliatePct`: comisión que Skool le paga al afiliado (se descuenta de tu cobro). */
export type PlatformFee = { pct: number; fixedCents: number; affiliatePct?: number | null };
const KEY = "platform_fee_skool";

export async function getSkoolFee(tx: Tx): Promise<PlatformFee | null> {
  const [row] = await tx.select().from(s.settings).where(eq(s.settings.key, KEY));
  const v = row?.value as Partial<PlatformFee> | undefined;
  return v && typeof v.pct === "number" ? { pct: v.pct, fixedCents: v.fixedCents ?? 0, affiliatePct: v.affiliatePct ?? null } : null;
}

export async function saveSkoolFee(tx: Tx, fee: PlatformFee | null) {
  if (!fee) return tx.delete(s.settings).where(eq(s.settings.key, KEY));
  await tx.insert(s.settings).values({ key: KEY, value: fee }).onConflictDoUpdate({ target: s.settings.key, set: { value: fee, updatedAt: new Date() } });
}

export const affiliateFeeFor = (grossCents: number, fee: PlatformFee | null) => (fee?.affiliatePct ? Math.round((grossCents * fee.affiliatePct) / 100) : 0);

export const feeFor = (grossCents: number, fee: PlatformFee | null) => (fee ? Math.min(grossCents, Math.round((grossCents * fee.pct) / 100) + fee.fixedCents) : 0);

/** Cobros depositados en el saldo de Skool que se registraron sin comisión. */
async function skoolChargesWithoutFee(tx: Tx) {
  return tx
    .select({ id: s.revenues.id, gross: s.revenues.grossCents })
    .from(s.revenues)
    .innerJoin(s.financialAccounts, eq(s.financialAccounts.id, s.revenues.depositAccountId))
    .where(and(eq(s.revenues.processorFeeCents, 0), eq(s.financialAccounts.type, "processor"), sql`lower(${s.financialAccounts.name}) like '%skool%'`));
}

export async function countSkoolChargesWithoutFee(tx: Tx) {
  return (await skoolChargesWithoutFee(tx)).length;
}

/** Aplica la comisión configurada a los cobros de Skool que no la tienen (corrige el margen). */
export async function backfillSkoolFees(tx: Tx) {
  const fee = await getSkoolFee(tx);
  if (!fee) throw new Error("Primero guarda la comisión de Skool.");
  const rows = await skoolChargesWithoutFee(tx);
  let total = 0;
  for (const r of rows) {
    const cents = feeFor(r.gross, fee);
    if (!cents) continue;
    await tx.update(s.revenues).set({ processorFeeCents: cents, updatedAt: new Date() }).where(eq(s.revenues.id, r.id));
    await syncRevenue(tx, r.id);
    total += cents;
  }
  return { count: rows.length, totalCents: total };
}

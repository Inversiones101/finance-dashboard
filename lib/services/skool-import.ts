/**
 * Aplica el export de Skool: altas, cambios de plan, bajas, reactivaciones y los cobros que
 * falten en los libros (según el LTV que reporta Skool). El plan se recalcula aquí, dentro de
 * la transacción, así que lo que se aplica siempre coincide con el estado real de la base.
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import * as s from "@/db/schema";
import { parseSkoolCsv, planSkoolImport, type Charge, type ImportPlan, type Interval, type SkoolRow } from "@/lib/import/skool-csv";
import { saveRevenue, type Tx } from "./ledger";
import { cancelMember, trackMember } from "./members";
import { feeFor, getSkoolFee } from "./platform-fee";

type Context = { products: Record<Interval, typeof s.products.$inferSelect>; skoolAccountId: string | null };

async function context(tx: Tx): Promise<Context> {
  const recurring = await tx.select().from(s.products).where(and(eq(s.products.isActive, true), inArray(s.products.defaultBillingInterval, ["monthly", "annual"])));
  const pick = (i: Interval) => recurring.find((p) => p.defaultBillingInterval === i && p.platform?.toLowerCase() === "skool") ?? recurring.find((p) => p.defaultBillingInterval === i);
  const monthly = pick("monthly");
  const annual = pick("annual");
  if (!monthly || !annual) throw new Error("Falta un producto de membresía mensual o anual activo (Catálogos → Productos).");
  const [skool] = await tx
    .select({ id: s.financialAccounts.id })
    .from(s.financialAccounts)
    .where(and(eq(s.financialAccounts.type, "processor"), eq(s.financialAccounts.owner, "llc"), sql`(lower(${s.financialAccounts.institution}) = 'skool' or lower(${s.financialAccounts.name}) like '%skool%')`));
  return { products: { monthly, annual }, skoolAccountId: skool?.id ?? null };
}

/** Miembros de las membresías de Skool con lo que ya tienen cobrado. */
async function existingMembers(tx: Tx, ctx: Context) {
  const productIds = [ctx.products.monthly.id, ctx.products.annual.id];
  const rows = await tx.select().from(s.members).where(inArray(s.members.productId, productIds));
  const paid = await tx
    .select({ memberId: s.revenues.memberId, total: sql<string>`coalesce(sum(${s.revenues.grossCents}), 0)` })
    .from(s.revenues)
    .where(and(isNotNull(s.revenues.memberId), sql`${s.revenues.status} not in ('refunded', 'disputed')`))
    .groupBy(s.revenues.memberId);
  const recorded = new Map(paid.map((p) => [p.memberId, Number(p.total)]));
  return rows.map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    billingInterval: m.billingInterval,
    priceCents: m.priceCents,
    status: m.status,
    currentPeriodEnd: m.currentPeriodEnd,
    recordedCents: recorded.get(m.id) ?? 0,
  }));
}

export async function previewSkoolImport(tx: Tx, csv: string, today: string): Promise<ImportPlan> {
  const { rows, error } = parseSkoolCsv(csv);
  if (error) throw new Error(error);
  const ctx = await context(tx);
  const plan = planSkoolImport(rows, await existingMembers(tx, ctx), today);
  if (!ctx.skoolAccountId && plan.items.some((i) => "charges" in i && i.charges.length)) {
    plan.warnings.push("No encontré la cuenta \"Saldo Skool\": los cobros se registrarán sin cuenta de depósito.");
  }
  return plan;
}

async function recordCharges(tx: Tx, ctx: Context, memberId: string, row: SkoolRow, charges: Charge[], userId: string | null) {
  const product = ctx.products[row.interval!];
  const fee = await getSkoolFee(tx);
  for (const c of charges) {
    await saveRevenue(tx, {
      revenueDate: c.date,
      productId: product.id,
      categoryId: product.categoryId,
      customerName: row.name,
      memberId,
      billingInterval: row.interval!,
      serviceStart: c.date,
      currency: "USD",
      grossCents: c.amountCents,
      processorFeeCents: feeFor(c.amountCents, fee),
      affiliateFeeCents: 0,
      status: "available",
      depositAccountId: ctx.skoolAccountId,
      notes: `${c.label} · importado de Skool`,
      createdBy: userId,
    });
  }
}

export async function applySkoolImport(tx: Tx, csv: string, today: string, userId: string | null) {
  const plan = await previewSkoolImport(tx, csv, today);
  const ctx = await context(tx);
  const count = { new: 0, update: 0, reactivate: 0, cancel: 0, charges: 0 };

  for (const item of plan.items) {
    if (item.kind === "unchanged") continue;
    if (item.kind === "cancel") {
      await cancelMember(tx, item.member.id, { date: today, accessUntil: null });
      count.cancel++;
      continue;
    }
    const { row } = item;
    const product = ctx.products[row.interval!];
    const values = {
      name: row.name,
      email: row.email,
      productId: product.id,
      billingInterval: row.interval!,
      priceCents: row.priceCents,
      currentPeriodEnd: item.periodEnd,
      status: "active" as const,
      canceledOn: null,
      accessUntil: null,
      updatedAt: new Date(),
    };
    const memberId = await trackMember(tx, item.kind === "new" ? null : item.member.id, today, async () => {
      if (item.kind === "new") {
        const [m] = await tx.insert(s.members).values({ ...values, currency: "USD", startedOn: row.joinedOn }).returning({ id: s.members.id });
        return m.id;
      }
      await tx.update(s.members).set(values).where(eq(s.members.id, item.member.id));
      return item.member.id;
    });
    await recordCharges(tx, ctx, memberId, row, item.charges, userId);
    count[item.kind]++;
    count.charges += item.charges.length;
  }
  return count;
}

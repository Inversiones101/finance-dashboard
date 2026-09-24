import { beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { seed } from "@/db/seed";
import { loadFinanceData } from "@/lib/data/finance-data";
import { computeDashboard } from "@/lib/finance/engine";
import type { Tx } from "@/lib/services/ledger";
import * as members from "@/lib/services/members";

let db: Tx;
let monthly: typeof s.products.$inferSelect;
let annual: typeof s.products.$inferSelect;

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema: s });
  await migrate(d, { migrationsFolder: path.join(__dirname, "..", "db", "migrations") });
  await seed(d);
  db = d as unknown as Tx;
  [monthly] = await db.select().from(s.products).where(eq(s.products.name, "Membresía mensual"));
  [annual] = await db.select().from(s.products).where(eq(s.products.name, "Membresía anual"));
});

const mrr = async (asOf = "2026-09-22") => computeDashboard(await loadFinanceData(db), { asOf, hnlPerUsd: 26.86, churnAssumption: 0 }).kpis.mrr;

describe("miembros", () => {
  it("un ingreso recurrente con nombre crea el miembro y el MRR usa el precio de lista", async () => {
    const r = { customerName: "Ana Pérez", productId: annual.id, billingInterval: "annual", currency: "USD" as const, grossCents: 16700, revenueDate: "2026-09-10", serviceStart: null };
    const id = await members.ensureMemberForRevenue(db, r);
    const [m] = await db.select().from(s.members).where(eq(s.members.id, id!));
    expect(m).toMatchObject({ priceCents: 19700, billingInterval: "annual", currentPeriodEnd: "2027-09-10" });
    expect(await mrr()).toBeCloseTo(197 / 12, 1);
  });

  it("dar de baja y reactivar actualiza el MRR", async () => {
    const id = await members.saveMember(db, { name: "Luis", productId: monthly.id, billingInterval: "monthly", currency: "USD", priceCents: 3700, startedOn: "2026-09-01", currentPeriodEnd: null, notes: null });
    expect(await mrr()).toBe(37);
    await members.cancelMember(db, id, { date: "2026-09-22", accessUntil: "2026-09-22" });
    expect(await mrr("2026-09-23")).toBe(0);
    await members.reactivateMember(db, id, { date: "2026-09-25" });
    expect(await mrr("2026-09-25")).toBe(37);
  });

  it("registrar la renovación crea el ingreso y adelanta el periodo", async () => {
    const id = await members.saveMember(db, { name: "Eva", productId: monthly.id, billingInterval: "monthly", currency: "USD", priceCents: 3700, startedOn: "2026-09-05", currentPeriodEnd: null, notes: null });
    const [skool] = await db.select().from(s.financialAccounts).where(eq(s.financialAccounts.name, "Saldo Skool"));
    await members.chargeMember(db, id, { date: "2026-10-05", grossCents: 3700, processorFeeCents: 100, affiliateFeeCents: 0, depositAccountId: skool.id });
    const [m] = await db.select().from(s.members).where(eq(s.members.id, id));
    expect(m.currentPeriodEnd).toBe("2026-11-05");
    const revs = await db.select().from(s.revenues).where(eq(s.revenues.memberId, id));
    expect(revs).toHaveLength(1);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { seed } from "@/db/seed";
import { loadFinanceData } from "@/lib/data/finance-data";
import { computeBalanceSheet, computePnlReport } from "@/lib/finance/engine";
import type { Tx } from "@/lib/services/ledger";
import { listStartupCosts, recordStartupCost } from "@/lib/services/startup-costs";

let db: Tx;
let contract: typeof s.vendorContracts.$inferSelect;

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema: s });
  await migrate(d, { migrationsFolder: path.join(__dirname, "..", "db", "migrations") });
  await seed(d);
  db = d as unknown as Tx;
  await db.insert(s.settings).values({ key: "operations_start_date", value: "2026-09-20" }).onConflictDoUpdate({ target: s.settings.key, set: { value: "2026-09-20" } });
  [contract] = await db.select().from(s.vendorContracts).limit(1);
});

describe("puesta en marcha", () => {
  it("una cuota pagada por el dueño antes de operar suma al capital, baja el contrato y no toca la operación", async () => {
    const before = computePnlReport(await loadFinanceData(db), { from: "2026-09", to: "2026-09", granularity: "month" }).total;
    const paidBefore = (await db.select().from(s.expenses).where(eq(s.expenses.contractId, contract.id))).reduce((a, e) => a + e.amountCents, 0);

    await recordStartupCost(db, { date: "2026-09-15", description: "", amountCents: 50_000, currency: "USD", categoryId: null, contractId: contract.id });

    const data = await loadFinanceData(db);
    const after = computePnlReport(data, { from: "2026-09", to: "2026-09", granularity: "month" }).total;
    expect(after.opex).toBe(before.opex); // va en su propia línea, no en gastos de operación
    expect(after.ebit).toBe(before.ebit - 500); // US GAAP: sí es gasto del periodo
    expect(after.preOperating).toBe(before.preOperating + 500);

    const paidAfter = (await db.select().from(s.expenses).where(eq(s.expenses.contractId, contract.id))).reduce((a, e) => a + e.amountCents, 0);
    expect(paidAfter - paidBefore).toBe(50_000); // el compromiso baja $500
    const [owner] = await db.select().from(s.ownerLedger).where(eq(s.ownerLedger.amountCents, 50_000));
    expect(owner.type).toBe("contribution");
    expect(computeBalanceSheet(data, { asOf: "2026-09-30", hnlPerUsd: 26.9 }).difference).toBe(0);
    expect((await listStartupCosts(db)).rows.some((e) => e.expenseDate === "2026-09-15" && e.amountCents === 50_000)).toBe(true);
  });

  it("desde el inicio de operaciones ya no es puesta en marcha", async () => {
    await expect(recordStartupCost(db, { date: "2026-09-20", description: "x", amountCents: 100, currency: "USD", categoryId: null, contractId: contract.id })).rejects.toThrow(/gasto normal/);
  });
});

describe("contrato con periodo de servicio (US GAAP)", () => {
  it("reparte el costo por día entre puesta en marcha y operación, y el balance cuadra", async () => {
    await db.update(s.vendorContracts).set({ totalCents: 773_000, serviceStart: "2026-08-14", serviceEnd: "2026-12-14" }).where(eq(s.vendorContracts.id, contract.id));
    const data = await loadFinanceData(db);
    const ct = data.contracts.find((c) => c.id === contract.id)!;
    const { contractRecognition } = await import("@/lib/finance/engine");
    const parts = contractRecognition(ct, "2026-09-20");
    expect(parts.reduce((a, p) => a + p.cents, 0)).toBe(773_000);
    expect(parts.reduce((a, p) => a + p.days, 0)).toBe(123);
    expect(parts.filter((p) => p.preOperating).reduce((a, p) => a + p.days, 0)).toBe(37); // 14 ago – 19 sep

    const pnl = computePnlReport(data, { from: "2026-08", to: "2026-12", granularity: "month" }).total;
    expect(Math.round((pnl.preOperating + pnl.opex + pnl.cogs) * 100)).toBeGreaterThanOrEqual(773_000);
    for (const asOf of ["2026-08-31", "2026-09-30", "2026-10-31", "2026-12-31"]) {
      expect(computeBalanceSheet(data, { asOf, hnlPerUsd: 25 }).difference).toBeCloseTo(0, 2);
    }
  });
});

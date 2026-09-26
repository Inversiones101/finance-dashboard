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
    expect(after.opex).toBe(before.opex); // no es gasto operativo
    expect(after.ebitda).toBe(before.ebitda);
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

import { beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { seed } from "@/db/seed";
import type { BankClient, MercuryTransaction } from "@/lib/mercury/client";
import { acceptAllSuggestions, resolveInboxItem, syncBank, type Suggestion } from "@/lib/services/bank-sync";
import { accountBalanceCents, saveRevenue, type Tx } from "@/lib/services/ledger";

const TODAY = "2026-09-25";
let db: Tx;
let acc: Record<string, typeof s.financialAccounts.$inferSelect>;

const t = (id: string, amount: number, date: string, counterpartyName: string, extra: Partial<MercuryTransaction> = {}): MercuryTransaction => ({
  id, amount, status: "sent", createdAt: `${date}T10:00:00Z`, postedAt: `${date}T12:00:00Z`, counterpartyName, bankDescription: null, note: null, kind: "externalTransfer", ...extra,
});

function fake(txs: Record<string, MercuryTransaction[]>, balances: Record<string, number> = {}): BankClient {
  return {
    accounts: async () => [
      { id: "m-chk", name: "Mercury Checking ••1234", kind: "checking", status: "active", currentBalance: balances["m-chk"] ?? 0, availableBalance: 0 },
      { id: "m-sav", name: "Mercury Savings ••5678", kind: "savings", status: "active", currentBalance: balances["m-sav"] ?? 0, availableBalance: 0 },
    ],
    transactions: async (id) => txs[id] ?? [],
  };
}

const inbox = () => db.select().from(s.bankInbox);

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema: s });
  await migrate(d, { migrationsFolder: path.join(__dirname, "..", "db", "migrations") });
  await seed(d);
  db = d as unknown as Tx;
  acc = Object.fromEntries((await db.select().from(s.financialAccounts)).map((a) => [a.name, a]));
});

describe("sincronización con Mercury", () => {
  it("enlaza las cuentas, trae solo lo asentado y no duplica al re-sincronizar", async () => {
    const client = fake({
      "m-chk": [t("a", 50, "2026-09-20", "Wise"), t("b", -10, "2026-09-21", "Loom", { status: "pending" }), t("c", -5, "2026-09-22", "X", { status: "failed" })],
    });
    const r = await syncBank(db, client, TODAY);
    expect(r.linked.sort()).toEqual(["Mercury Checking", "Mercury Savings"]);
    expect(r.added).toBe(1);
    const [chk] = await db.select().from(s.financialAccounts).where(eq(s.financialAccounts.name, "Mercury Checking"));
    expect(chk).toMatchObject({ externalId: "m-chk", status: "active" });

    expect((await syncBank(db, client, TODAY)).added).toBe(0);
    expect(await inbox()).toHaveLength(1);
  });

  it("guarda el saldo del banco junto al de los libros", async () => {
    const r = await syncBank(db, fake({}, { "m-chk": 123.45 }), TODAY);
    expect(r.balances.find((b) => b.account === "Mercury Checking")).toEqual({ account: "Mercury Checking", bankCents: 12345, booksCents: 0 });
  });

  it("clasificar crea el registro contable y 'recordar' aprende la regla", async () => {
    const [software] = await db.select().from(s.categories).where(eq(s.categories.kind, "opex")).limit(1);
    await syncBank(db, fake({ "m-chk": [t("a", 100, "2026-09-18", "Wise"), t("b", -20, "2026-09-20", "Anthropic, PBC")] }), TODAY);
    const items = await inbox();
    const exp = items.find((i) => i.externalId === "b")!;
    await resolveInboxItem(db, items.find((i) => i.externalId === "a")!.id, { as: "owner_contribution" }, null);
    await resolveInboxItem(db, exp.id, { as: "expense", categoryId: software.id, description: "Claude", remember: true }, null);

    const expenses = await db.select().from(s.expenses).where(eq(s.expenses.description, "Claude"));
    expect(expenses).toHaveLength(1);
    const [mov] = await db.select().from(s.cashMovements).where(eq(s.cashMovements.externalId, "b"));
    expect(mov).toMatchObject({ expenseId: expenses[0].id, amountCents: -2000 });
    expect(await accountBalanceCents(db, acc["Mercury Checking"].id, TODAY)).toBe(8000);

    // El mes siguiente, Anthropic llega ya sugerido con su categoría.
    await syncBank(db, fake({ "m-chk": [t("c", -20, "2026-10-20", "Anthropic, PBC")] }), "2026-10-25");
    const [next] = (await inbox()).filter((i) => i.externalId === "c");
    expect(next.suggestion as Suggestion).toMatchObject({ as: "expense", categoryId: software.id, description: "Claude" });
  });

  it("reconoce lo que ya registraste a mano y lo enlaza sin duplicar", async () => {
    const [manual] = await db
      .insert(s.cashMovements)
      .values({ accountId: acc["Mercury Checking"].id, movementDate: "2026-09-17", type: "owner_contribution", amountCents: 6467, description: "Nas.com" })
      .returning();
    await syncBank(db, fake({ "m-chk": [t("n", 64.67, "2026-09-18", "NAS.COM")] }), TODAY);
    const [i] = await inbox();
    expect(i.suggestion as Suggestion).toMatchObject({ as: "match", movementId: manual.id });
    await acceptAllSuggestions(db, null);
    expect(await db.select().from(s.cashMovements).where(eq(s.cashMovements.accountId, acc["Mercury Checking"].id))).toHaveLength(1);
    const [linked] = await db.select().from(s.cashMovements).where(eq(s.cashMovements.id, manual.id));
    expect(linked.externalId).toBe("n");
  });

  it("empareja transferencias entre cuentas y payouts de Skool", async () => {
    await saveRevenue(db, {
      revenueDate: "2026-09-10", productId: null, categoryId: (await db.select().from(s.categories).where(eq(s.categories.kind, "revenue")).limit(1))[0].id,
      customerName: null, billingInterval: "one_time", serviceStart: null, currency: "USD", grossCents: 50000, processorFeeCents: 0, affiliateFeeCents: 0,
      status: "available", depositAccountId: acc["Saldo Skool"].id, notes: null,
    });
    const skoolBefore = await accountBalanceCents(db, acc["Saldo Skool"].id, TODAY);
    await syncBank(
      db,
      fake({
        "m-chk": [t("p", 300, "2026-09-19", "Skool Inc"), t("x", -100, "2026-09-21", "Mercury Savings")],
        "m-sav": [t("y", 100, "2026-09-21", "Mercury Checking")],
      }),
      TODAY
    );
    const r = await acceptAllSuggestions(db, null);
    expect(r).toEqual({ ok: 2, failed: [] }); // payout + transferencia (las dos puntas en una)
    expect((await inbox()).every((i) => i.status === "classified")).toBe(true);
    expect(await accountBalanceCents(db, acc["Mercury Checking"].id, TODAY)).toBe(20000);
    expect(await accountBalanceCents(db, acc["Mercury Savings"].id, TODAY)).toBe(10000);
    expect(await accountBalanceCents(db, acc["Saldo Skool"].id, TODAY)).toBe(skoolBefore - 30000);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { seed } from "@/db/seed";
import { saveRevenue, type Tx } from "@/lib/services/ledger";
import * as members from "@/lib/services/members";
import { priceOn, priceSchedules, setPrice } from "@/lib/services/pricing";
import { backfillSkoolFees, countSkoolChargesWithoutFee, feeFor, saveSkoolFee } from "@/lib/services/platform-fee";
import { bankAlerts } from "@/lib/services/bank-sync";

let db: Tx;
let monthly: typeof s.products.$inferSelect;

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema: s });
  await migrate(d, { migrationsFolder: path.join(__dirname, "..", "db", "migrations") });
  await seed(d);
  db = d as unknown as Tx;
  [monthly] = await db.select().from(s.products).where(eq(s.products.name, "Membresía mensual"));
});

const charge = (name: string, date: string, gross = 3700) =>
  members.ensureMemberForRevenue(db, { customerName: name, productId: monthly.id, billingInterval: "monthly", currency: "USD", grossCents: gross, revenueDate: date, serviceStart: null });

describe("precios que cambian con cada lanzamiento", () => {
  it("el precio depende de la fecha y se puede programar a futuro", async () => {
    await setPrice(db, { productId: monthly.id, priceCents: 4700, effectiveFrom: "2026-11-01", note: "Lanzamiento" }, "2026-09-25");
    expect(await priceOn(db, monthly.id, "2026-10-31")).toBe(3700); // respaldo: precio de lista original
    expect(await priceOn(db, monthly.id, "2026-11-01")).toBe(4700);
    const sch = (await priceSchedules(db, "2026-09-25")).get(monthly.id)!;
    expect(sch).toMatchObject({ current: 3700, next: { priceCents: 4700, from: "2026-11-01" } });
    // Todavía no está vigente: el precio de lista de hoy no cambia.
    const [p] = await db.select().from(s.products).where(eq(s.products.id, monthly.id));
    expect(p.listPriceCents).toBe(3700);
  });

  it("quien ya estaba conserva su precio al renovar; quien entra después paga el nuevo", async () => {
    await setPrice(db, { productId: monthly.id, priceCents: 3700, effectiveFrom: "2026-01-01", note: null }, "2026-09-25");
    await setPrice(db, { productId: monthly.id, priceCents: 4700, effectiveFrom: "2026-11-01", note: null }, "2026-09-25");

    const ana = await charge("Ana", "2026-09-10");
    await charge("Ana", "2026-11-10"); // renueva después del aumento
    const luis = await charge("Luis", "2026-11-05", 4700);

    const rows = await db.select().from(s.members);
    expect(rows.find((m) => m.id === ana)!.priceCents).toBe(3700);
    expect(rows.find((m) => m.id === luis)!.priceCents).toBe(4700);
  });
});

describe("comisión de Skool", () => {
  it("calcula porcentaje + fijo y corrige los cobros que no la tenían", async () => {
    expect(feeFor(3700, { pct: 2.9, fixedCents: 30 })).toBe(137);
    expect(feeFor(3700, null)).toBe(0);

    const [skool] = await db.select().from(s.financialAccounts).where(eq(s.financialAccounts.name, "Saldo Skool"));
    const id = await saveRevenue(db, {
      revenueDate: "2026-09-10", productId: monthly.id, categoryId: monthly.categoryId, customerName: "Eva", billingInterval: "monthly", serviceStart: null,
      currency: "USD", grossCents: 3700, processorFeeCents: 0, affiliateFeeCents: 0, status: "available", depositAccountId: skool.id, notes: null,
    });
    const before = await countSkoolChargesWithoutFee(db);
    expect(before).toBeGreaterThan(0);

    await saveSkoolFee(db, { pct: 2.9, fixedCents: 30 });
    await backfillSkoolFees(db);
    expect(await countSkoolChargesWithoutFee(db)).toBe(0);

    const [r] = await db.select().from(s.revenues).where(eq(s.revenues.id, id));
    expect(r.processorFeeCents).toBe(137);
    const [mov] = await db.select().from(s.cashMovements).where(eq(s.cashMovements.revenueId, id));
    expect(mov.amountCents).toBe(3700 - 137); // el saldo de Skool baja a lo recibido de verdad
  });
});

describe("alertas del banco en el dashboard", () => {
  it("avisa de lo pendiente por clasificar y de saldos que no cuadran", async () => {
    const csv = "Importa el CSV de miembros de Skool"; // recordatorio semanal (nunca se ha importado)
    expect((await bankAlerts(db)).map((a) => a.title)).toEqual([csv]);
    const [chk] = await db.select().from(s.financialAccounts).where(eq(s.financialAccounts.name, "Mercury Checking"));
    await db.insert(s.bankInbox).values({ accountId: chk.id, externalId: "t1", postedOn: "2026-09-20", amountCents: -500 });
    await db.insert(s.accountStatements).values({ accountId: chk.id, statementDate: "2026-09-25", closingBalanceCents: 1000, computedBalanceCents: 1500 });
    const alerts = await bankAlerts(db);
    expect(alerts.map((a) => a.title)).toEqual([csv, "1 movimiento de Mercury por clasificar", "Mercury Checking no cuadra con el banco"]);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { asc, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { seed } from "@/db/seed";
import { loadFinanceData } from "@/lib/data/finance-data";
import { computeCommunity } from "@/lib/finance/engine";
import type { Tx } from "@/lib/services/ledger";
import * as members from "@/lib/services/members";
import { setPrice } from "@/lib/services/pricing";

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
  // El seed trae sus propios miembros: estas pruebas parten de cero.
  await db.delete(s.members);
});

const add = (name: string, startedOn: string, product = monthly, priceCents = 3700) =>
  members.saveMember(db, { name, productId: product.id, billingInterval: product === annual ? "annual" : "monthly", currency: "USD", priceCents, startedOn, currentPeriodEnd: null, notes: null });

const events = () => db.select().from(s.memberEvents).orderBy(asc(s.memberEvents.eventDate));
const metrics = async (asOf: string) => computeCommunity(await loadFinanceData(db), { asOf, hnlPerUsd: 26.9, churnAssumption: 0.05 });

describe("bitácora del MRR", () => {
  it("registra altas, bajas (el día que dejan de contar), cambios y reactivaciones", async () => {
    const ana = await add("Ana", "2026-08-05");
    await members.cancelMember(db, ana, { date: "2026-09-10", accessUntil: null }); // cuenta hasta 2026-09-05
    await members.reactivateMember(db, ana, { date: "2026-10-01" }); // ya se había ido → reactivación
    const luis = await add("Luis", "2026-09-01");
    await members.saveMember(db, { name: "Luis", productId: annual.id, billingInterval: "annual", currency: "USD", priceCents: 19700, startedOn: "2026-09-01", currentPeriodEnd: null, notes: null }, luis);

    const e = await events();
    expect(e.map((x) => [x.type, x.mrrDeltaCents])).toEqual(
      expect.arrayContaining([
        ["new", 3700],
        ["cancel", -3700],
        ["reactivate", 3700],
        ["new", 3700],
        ["change", 1642 - 3700], // pasó a anual: 197/12 al mes
      ])
    );
    expect(e.find((x) => x.type === "cancel")!.eventDate).toBe("2026-09-05");
  });

  it("revertir una baja que aún no se cumplía no cuenta como churn", async () => {
    const ana = await add("Ana", "2026-09-05");
    await members.cancelMember(db, ana, { date: "2026-09-20", accessUntil: null }); // dejaría de contar el 10/05
    await members.reactivateMember(db, ana, { date: "2026-09-25" });
    expect((await events()).map((x) => x.type)).toEqual(["new"]);
  });

  it("subir el precio de lista no toca el MRR de los miembros actuales", async () => {
    await add("Ana", "2026-09-05");
    await setPrice(db, { productId: monthly.id, priceCents: 4700, effectiveFrom: "2026-10-01", note: null }, "2026-10-01");
    await members.ensureMemberForRevenue(db, { customerName: "Ana", productId: monthly.id, billingInterval: "monthly", currency: "USD", grossCents: 3700, revenueDate: "2026-10-05", serviceStart: null });
    await members.ensureMemberForRevenue(db, { customerName: "Beto", productId: monthly.id, billingInterval: "monthly", currency: "USD", grossCents: 4700, revenueDate: "2026-10-06", serviceStart: null });
    const m = await metrics("2026-10-20");
    const oct = m.movement.find((x) => x.month === "2026-10")!;
    expect(oct).toMatchObject({ new: 47, expansion: 0, churn: 0 });
    expect(m.mrr).toBe(84);
  });
});

describe("métricas de comunidad", () => {
  it("movimiento del MRR, ARPU, mezcla y cohortes", async () => {
    await add("A", "2026-08-03");
    await add("B", "2026-08-10");
    const c = await add("C", "2026-09-02");
    await add("D", "2026-09-04", annual, 19700);
    await members.cancelMember(db, c, { date: "2026-09-15", accessUntil: "2026-09-15" });

    const m = await metrics("2026-09-25");
    const sep = m.movement.find((x) => x.month === "2026-09")!;
    expect(sep).toMatchObject({ new: 37 + 16.42, churn: -37 });
    expect(m.activeCount).toBe(3);
    expect(m.arpu).toBeCloseTo((37 + 37 + 16.42) / 3, 1);
    expect(m.mix.map((x) => [x.interval, x.members])).toEqual([["monthly", 2], ["annual", 1]]);

    const aug = m.cohorts.find((x) => x.month === "2026-08")!;
    expect(aug).toMatchObject({ size: 2, retention: [1, 1] });
    const sepCohort = m.cohorts.find((x) => x.month === "2026-09")!;
    expect(sepCohort.retention).toEqual([0.5]);
  });

  it("sin gasto en marketing el CAC no se inventa", async () => {
    await add("A", "2026-09-03");
    const m = await metrics("2026-09-25");
    expect(m.marketing).toBe(0);
    expect(m.ltvToCac).toBeNull();
  });
});

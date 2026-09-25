import { beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { seed } from "@/db/seed";
import { nextRenewal, parseCsv, parseSkoolCsv, planSkoolImport } from "@/lib/import/skool-csv";
import type { Tx } from "@/lib/services/ledger";
import * as members from "@/lib/services/members";
import { applySkoolImport, previewSkoolImport } from "@/lib/services/skool-import";

const HEADER = "FirstName,LastName,Email,Invited By,JoinedDate,Question1,Answer1,Price,Recurring Interval,Tier,LTV";
const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");
const TODAY = "2026-09-25";

describe("parser del CSV de Skool", () => {
  it("respeta comillas, comas y saltos de línea dentro de campos", () => {
    expect(parseCsv('a,"b, c","d ""x""\ny"\n1,2,3')).toEqual([["a", "b, c", 'd "x"\ny'], ["1", "2", "3"]]);
  });

  it("lee el export real: nombre, correo, plan y LTV; $1 y gratis no son planes", () => {
    const { rows, error } = parseSkoolCsv(
      csv(
        'Ana,Pérez,ANA@x.com,,2026-09-16 05:22:42,"¿Teléfono?, dinos",999,$37,month,standard,$37',
        "Beto,Ruiz,beto@x.com,,2026-09-01 10:00:00,,,$197,year,standard,$197",
        "Test,Uno,t@x.com,,2026-09-02 10:00:00,,,$1,month,standard,$1",
        "Gratis,Dos,g@x.com,,2026-09-03 10:00:00,,,,,standard,"
      )
    );
    expect(error).toBeNull();
    expect(rows[0]).toEqual({ name: "Ana Pérez", email: "ana@x.com", joinedOn: "2026-09-16", interval: "monthly", priceCents: 3700, ltvCents: 3700 });
    expect(rows[1]).toMatchObject({ interval: "annual", priceCents: 19700 });
    expect(rows[2]).toMatchObject({ interval: null, priceCents: 0 });
    expect(rows[3]).toMatchObject({ interval: null, priceCents: 0 });
  });

  it("rechaza un archivo que no es el export de miembros", () => {
    expect(parseSkoolCsv("fecha,monto\n2026-09-01,10").error).toMatch(/export de miembros/);
  });

  it("la próxima renovación es el primer aniversario después de hoy", () => {
    expect(nextRenewal("2026-08-31", "monthly", TODAY)).toBe("2026-09-30");
    expect(nextRenewal("2026-07-10", "monthly", TODAY)).toBe("2026-10-10");
    expect(nextRenewal("2026-09-25", "monthly", TODAY)).toBe("2026-10-25");
    expect(nextRenewal("2026-09-01", "annual", TODAY)).toBe("2027-09-01");
  });

  it("el plan detecta altas, bajas, cambios de plan, cobros faltantes y avisa de bajas masivas", () => {
    const { rows } = parseSkoolCsv(
      csv(
        "Nuevo,Uno,n1@x.com,,2026-08-10 10:00:00,,,$37,month,standard,$75", // 2 meses + $1 de prueba
        "Viejo,Anual,v@x.com,,2026-08-01 10:00:00,,,$197,year,standard,$234" // tenía mensual 37 y subió a anual
      )
    );
    const existing = [
      { id: "1", name: "Viejo  ANUAL", email: null, billingInterval: "monthly", priceCents: 3700, status: "active" as const, currentPeriodEnd: "2026-10-01", recordedCents: 3700 },
      { id: "2", name: "Se Fue", email: null, billingInterval: "monthly", priceCents: 3700, status: "active" as const, currentPeriodEnd: "2026-10-05", recordedCents: 3700 },
    ];
    const plan = planSkoolImport(rows, existing, TODAY);
    const byKind = (k: string) => plan.items.filter((i) => i.kind === k);

    const [nuevo] = byKind("new");
    expect(nuevo).toMatchObject({ periodEnd: "2026-10-10" });
    expect("charges" in nuevo && nuevo.charges).toEqual([
      { date: "2026-08-10", amountCents: 3700, label: "Alta en Skool" },
      { date: TODAY, amountCents: 3800, label: "Renovación (según LTV de Skool)" },
    ]);

    const [upd] = byKind("update");
    expect(upd.kind === "update" && upd.changes).toContain("Cambió a plan anual");
    expect(upd.kind === "update" && upd.charges).toEqual([{ date: TODAY, amountCents: 19700, label: "Renovación (según LTV de Skool)" }]);

    expect(byKind("cancel").map((i) => i.kind === "cancel" && i.member.name)).toEqual(["Se Fue"]);
    expect(plan.warnings).toEqual([]);

    const mass = planSkoolImport([], [...existing, { ...existing[1], id: "3" }, { ...existing[1], id: "4" }], TODAY);
    expect(mass.warnings[0]).toMatch(/daría de baja a 4 de 4/);
  });
});

describe("aplicar la importación", () => {
  let db: Tx;
  let monthly: typeof s.products.$inferSelect;

  beforeEach(async () => {
    const d = drizzle(new PGlite(), { schema: s });
    await migrate(d, { migrationsFolder: path.join(__dirname, "..", "db", "migrations") });
    await seed(d);
    db = d as unknown as Tx;
    [monthly] = await db.select().from(s.products).where(eq(s.products.name, "Membresía mensual"));
  });

  it("crea, actualiza y da de baja; es idempotente (re-importar no duplica)", async () => {
    // Estado previo: un miembro creado a mano (sin correo) con su cobro, y otro que ya se fue de Skool.
    const skool = (await db.select().from(s.financialAccounts).where(eq(s.financialAccounts.name, "Saldo Skool")))[0];
    const eva = await members.saveMember(db, { name: "Eva Díaz", productId: monthly.id, billingInterval: "monthly", currency: "USD", priceCents: 3700, startedOn: "2026-08-20", currentPeriodEnd: null, notes: null });
    await members.chargeMember(db, eva, { date: "2026-08-20", grossCents: 3700, processorFeeCents: 0, affiliateFeeCents: 0, depositAccountId: skool.id });
    const ido = await members.saveMember(db, { name: "Ido Gone", productId: monthly.id, billingInterval: "monthly", currency: "USD", priceCents: 3700, startedOn: "2026-09-01", currentPeriodEnd: null, notes: null });
    const before = (await db.select().from(s.revenues)).length;

    const file = csv(
      "Eva,Diaz,eva@x.com,,2026-08-20 09:00:00,,,$37,month,standard,$74",
      "Nora,Luz,nora@x.com,,2026-09-18 09:00:00,,,$197,year,standard,$197"
    );
    const c = await applySkoolImport(db, file, TODAY, null);
    expect(c).toEqual({ new: 1, update: 1, reactivate: 0, cancel: 1, charges: 2 });

    const all = await db.select().from(s.members);
    const evaRow = all.find((m) => m.id === eva)!;
    expect(evaRow).toMatchObject({ email: "eva@x.com", currentPeriodEnd: "2026-10-20", status: "active" });
    expect(all.find((m) => m.id === ido)).toMatchObject({ status: "canceled" });
    expect(all.find((m) => m.email === "nora@x.com")).toMatchObject({ billingInterval: "annual", priceCents: 19700, currentPeriodEnd: "2027-09-18" });

    const revs = await db.select().from(s.revenues);
    expect(revs.length - before).toBe(2);
    expect(revs.every((r) => r.depositAccountId === skool.id)).toBe(true);

    // Segunda vez con el mismo archivo: nada que hacer.
    const again = await previewSkoolImport(db, file, TODAY);
    expect(again.items.filter((i) => i.kind !== "unchanged")).toEqual([]);
  });
});

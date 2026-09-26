import { describe, expect, it } from "vitest";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as s from "@/db/schema";
import { seed } from "@/db/seed";
import { loadFinanceData } from "@/lib/data/finance-data";
import { buildReportFacts } from "@/lib/finance/report-facts";
import { ReportSchema } from "@/lib/services/monthly-report";

describe("informe mensual", () => {
  it("los hechos del mes cuadran con el estado de resultados y avisan si el mes está en curso", async () => {
    const d = drizzle(new PGlite(), { schema: s });
    await migrate(d, { migrationsFolder: path.join(__dirname, "..", "db", "migrations") });
    await seed(d);
    const data = await loadFinanceData(d);
    const f = buildReportFacts(data, "2026-09", { asOf: "2026-09-26", hnlPerUsd: 26.9, churnAssumption: 0.05, company: "Inversiones 101 LLC" });
    expect(f.mes_completo).toBe(false);
    expect(f.resultados.ingreso_neto).toBeCloseTo(f.resultados.facturacion_bruta - f.resultados.comisiones_plataforma - f.resultados.comisiones_afiliados, 2);
    expect(f.comunidad.churn_es_supuesto).toBe(true);
    expect(JSON.stringify(f)).not.toMatch(/undefined|NaN/);

    const closed = buildReportFacts(data, "2026-08", { asOf: "2026-09-26", hnlPerUsd: 26.9, churnAssumption: 0.05, company: "X" });
    expect(closed.mes_completo).toBe(true);
  });

  it("valida el formato que devuelve el modelo", () => {
    expect(ReportSchema.safeParse({ titular: "t", resumen: "r", secciones: [{ titulo: "a", contenido: "b", puntos: ["c"] }], vigilar: [], proximos_pasos: [] }).success).toBe(true);
    expect(ReportSchema.safeParse({ titular: "t" }).success).toBe(false);
  });
});

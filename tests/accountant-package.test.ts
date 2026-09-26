import { describe, expect, it } from "vitest";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { unzipSync, strFromU8 } from "fflate";
import ExcelJS from "exceljs";
import * as s from "@/db/schema";
import { seed } from "@/db/seed";
import type { Tx } from "@/lib/services/ledger";
import { buildAccountantPackage } from "@/lib/services/accountant-package";

describe("paquete para el contador", () => {
  it("trae el Excel con todas las hojas y los recibos con nombre que cruza con la hoja de gastos", async () => {
    const d = drizzle(new PGlite(), { schema: s });
    await migrate(d, { migrationsFolder: path.join(__dirname, "..", "db", "migrations") });
    await seed(d);
    const db = d as unknown as Tx;
    const [exp] = await db.select().from(s.expenses).limit(1);
    await db.insert(s.expenseAttachments).values({ expenseId: exp.id, blobPath: "recibos/x/factura.pdf", fileName: "factura.pdf", contentType: "application/pdf", sizeBytes: 4 });

    const r = await buildAccountantPackage(db, { from: "2026-01-01", to: "2026-12-31", hnlPerUsd: 26.9, readBlob: async () => new Uint8Array([37, 80, 68, 70]) });
    expect(r.receipts).toBe(1);
    const files = unzipSync(r.zip);
    const receipt = Object.keys(files).find((f) => f.startsWith("recibos/"))!;
    expect(receipt).toMatch(new RegExp(`^recibos/${exp.expenseDate}_.+_1\\.pdf$`));
    expect(strFromU8(files["LEEME.txt"])).toContain("Form 5472");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(files["paquete.xlsx"].buffer.slice(files["paquete.xlsx"].byteOffset) as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Resumen (Summary)", "Resultados (P&L)", "Balance (Balance sheet)", "Flujo (Cash flow)", "Gastos (Expenses)", "Ingresos (Revenue)", "Bancos (Bank activity)", "Dueño (Owner transactions)",
    ]);
    const gastos = wb.getWorksheet("Gastos (Expenses)")!;
    const linked = gastos.getColumn(13).values.map(String);
    expect(linked).toContain(receipt);
    const check = wb.getWorksheet("Balance (Balance sheet)")!.lastRow!.getCell(2).value;
    expect(check).toBe(0); // el balance cuadra
  });
});

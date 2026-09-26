"use client";

import { useState } from "react";
import { FileArchive, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Descarga del paquete para el contador: año completo o un rango. */
export function AccountantPackage({ firstYear, currentYear }: { firstYear: number; currentYear: number }) {
  const years = Array.from({ length: currentYear - firstYear + 1 }, (_, i) => currentYear - i);
  const [year, setYear] = useState(String(currentYear));
  const [custom, setCustom] = useState({ from: "", to: "" });
  const range = year === "custom" ? custom : { from: `${year}-01-01`, to: `${year}-12-31` };
  const ready = !!range.from && !!range.to && range.from <= range.to;

  return (
    <section className="flex flex-col gap-3 rounded-3xl border bg-surface px-4 py-3.5 shadow-card md:flex-row md:items-center md:justify-between md:px-5">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <FileArchive className="size-4" />
        </span>
        <div>
          <p className="text-sm font-semibold">Paquete para el contador</p>
          <p className="text-xs text-muted-foreground">ZIP con Excel (resultados, balance, flujo, gastos, ingresos, bancos, transacciones con el dueño) y todos los recibos.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Periodo" className="h-8 rounded-lg border bg-transparent px-2 text-sm">
          {years.map((y) => (
            <option key={y} value={y}>
              Año {y}
            </option>
          ))}
          <option value="custom">Otro rango…</option>
        </select>
        {year === "custom" && (
          <>
            <input type="date" aria-label="Desde" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="h-8 rounded-lg border bg-transparent px-2 text-sm" />
            <input type="date" aria-label="Hasta" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="h-8 rounded-lg border bg-transparent px-2 text-sm" />
          </>
        )}
        <Button asChild size="sm" disabled={!ready} className={!ready ? "pointer-events-none opacity-50" : undefined}>
          <a href={ready ? `/api/contador?desde=${range.from}&hasta=${range.to}` : undefined} download>
            <Download className="size-3.5" /> Descargar ZIP
          </a>
        </Button>
      </div>
    </section>
  );
}

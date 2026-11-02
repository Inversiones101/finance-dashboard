"use client";

import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Row = { key: string; label: string; strong?: boolean; out?: boolean; memo?: boolean; detail?: string; help?: string };
type Period = { key: string; label: string; values: Record<string, number>; details: Record<string, Record<string, number>>; netMargin: number | null };

type View = "amount" | "share" | "change";
const VIEWS: { key: View; label: string; title: string }[] = [
  { key: "amount", label: "Montos", title: "Cifras en dinero" },
  { key: "share", label: "% de ventas", title: "Análisis vertical: cada línea como % de las ventas netas. En los beneficios es el margen." },
  { key: "change", label: "Cambio %", title: "Análisis horizontal: variación contra el periodo anterior (columna de la izquierda)." },
];
const pct = (n: number) => `${n < 0 ? "−" : n > 0 ? "+" : ""}${Math.abs(n * 100).toLocaleString("en-US", { maximumFractionDigits: Math.abs(n) < 0.1 ? 1 : 0 })}%`;

/** Estado de resultados con líneas desplegables (desglose por producto o categoría). */
export function PnlTable({ rows, periods, total, rate, symbol }: { rows: readonly Row[]; periods: Period[]; total: Period | null; rate: number; symbol: string }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<View>("amount");
  const cols = total ? [...periods, total] : periods;
  const money = (v: number) => {
    if (!v) return "—";
    const n = v * rate;
    return `${n < 0 ? "−" : ""}${symbol}${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  };
  // Muestra una celda según la vista; `out` = línea que resta (un aumento es malo).
  const cell = (v: number, i: number, get: (p: Period) => number, out?: boolean) => {
    const p = cols[i];
    if (view === "share") {
      const sales = p.values.revenue ?? 0;
      if (!v || !sales) return { text: "—", tone: "" };
      return { text: `${Math.round((v / sales) * 1000) / 10}%`, tone: v < 0 ? "text-money-out-text" : "" };
    }
    if (view === "change") {
      if (p === total || i === 0) return { text: "—", tone: "" };
      const prev = get(cols[i - 1]);
      if (!prev) return { text: v ? "nuevo" : "—", tone: "text-muted-foreground" };
      const c = (v - prev) / Math.abs(prev);
      const good = out ? c < 0 : c > 0;
      return { text: pct(c), tone: c === 0 ? "" : good ? "text-money-net" : "text-money-out-text" };
    }
    return { text: money(v), tone: (out && v > 0) || v < 0 ? "text-money-out-text" : "" };
  };

  return (
    <div className="overflow-x-auto">
      <div className="mb-3 inline-flex rounded-full bg-surface-2 p-0.5 text-xs">
        {VIEWS.map((o) => (
          <button key={o.key} type="button" title={o.title} onClick={() => setView(o.key)} aria-pressed={view === o.key} className={cn("rounded-full px-3 py-1", view === o.key ? "bg-surface font-medium shadow-card" : "text-muted-foreground")}>
            {o.label}
          </button>
        ))}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 bg-surface">Concepto</TableHead>
            {cols.map((p) => (
              <TableHead key={p.key} className={cn("text-right whitespace-nowrap", p === total && "font-semibold")}>
                {p.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const names = r.detail ? [...new Set(cols.flatMap((p) => Object.keys(p.details[r.detail!] ?? {})))].sort() : [];
            const expandable = names.length > 0;
            const isOpen = !!open[r.key];
            return (
              <Fragment key={r.key}>
                <TableRow className={r.memo ? "border-t-2 border-dashed text-xs italic" : r.strong ? "bg-surface-2/50" : ""}>
                  <TableCell className={cn("sticky left-0 z-10 bg-surface whitespace-nowrap", r.strong && "bg-surface-2 font-semibold", !r.strong && "text-muted-foreground")}>
                    {expandable ? (
                      <button
                        type="button"
                        onClick={() => setOpen((o) => ({ ...o, [r.key]: !o[r.key] }))}
                        aria-expanded={isOpen}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        <ChevronRight className={cn("size-3.5 transition-transform", isOpen && "rotate-90")} />
                        {r.label}
                      </button>
                    ) : (
                      <span title={r.help} className={cn(!r.strong && "pl-[18px]", r.help && "cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-4")}>{r.label}</span>
                    )}
                  </TableCell>
                  {cols.map((p, i) => {
                    const c = cell(p.values[r.key] ?? 0, i, (q) => q.values[r.key] ?? 0, r.out);
                    return (
                      <TableCell key={p.key} className={cn("text-right tabular", r.strong && "font-semibold", c.tone)}>
                        {c.text}
                      </TableCell>
                    );
                  })}
                </TableRow>
                {isOpen &&
                  names.map((name) => (
                    <TableRow key={`${r.key}-${name}`} className="text-xs">
                      <TableCell className="sticky left-0 z-10 bg-surface pl-10 text-muted-foreground">{name}</TableCell>
                      {cols.map((p, i) => {
                        const get = (q: Period) => q.details[r.detail!]?.[name] ?? 0;
                        const c = cell(get(p), i, get, r.out);
                        return (
                          <TableCell key={p.key} className={cn("text-right tabular", c.tone || "text-muted-foreground")}>
                            {c.text}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
              </Fragment>
            );
          })}
          <TableRow>
            <TableCell className="sticky left-0 z-10 bg-surface pl-[30px] text-muted-foreground">Margen neto</TableCell>
            {cols.map((p) => (
              <TableCell key={p.key} className="text-right text-muted-foreground tabular">
                {p.netMargin === null ? "—" : `${Math.round(p.netMargin * 100)}%`}
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

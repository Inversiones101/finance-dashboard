"use client";

import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Row = { key: string; label: string; strong?: boolean; out?: boolean; detail?: string };
type Period = { key: string; label: string; values: Record<string, number>; details: Record<string, Record<string, number>>; netMargin: number | null };

/** Estado de resultados con líneas desplegables (desglose por producto o categoría). */
export function PnlTable({ rows, periods, total, rate, symbol }: { rows: readonly Row[]; periods: Period[]; total: Period | null; rate: number; symbol: string }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const cols = total ? [...periods, total] : periods;
  const money = (v: number) => {
    if (!v) return "—";
    const n = v * rate;
    return `${n < 0 ? "−" : ""}${symbol}${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  };

  return (
    <div className="overflow-x-auto">
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
                <TableRow className={r.strong ? "bg-surface-2/50" : ""}>
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
                      <span className={cn(!r.strong && "pl-[18px]")}>{r.label}</span>
                    )}
                  </TableCell>
                  {cols.map((p) => {
                    const v = p.values[r.key] ?? 0;
                    return (
                      <TableCell key={p.key} className={cn("text-right tabular", r.strong && "font-semibold", (r.out && v > 0) || v < 0 ? "text-money-out-text" : "")}>
                        {money(v)}
                      </TableCell>
                    );
                  })}
                </TableRow>
                {isOpen &&
                  names.map((name) => (
                    <TableRow key={`${r.key}-${name}`} className="text-xs">
                      <TableCell className="sticky left-0 z-10 bg-surface pl-10 text-muted-foreground">{name}</TableCell>
                      {cols.map((p) => (
                        <TableCell key={p.key} className="text-right text-muted-foreground tabular">
                          {money(p.details[r.detail!]?.[name] ?? 0)}
                        </TableCell>
                      ))}
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

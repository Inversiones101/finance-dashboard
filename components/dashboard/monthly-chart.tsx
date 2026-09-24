"use client";

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatUSD } from "@/lib/format";

type Row = { label: string; gross: number; revenue: number; expenses: number; net: number };

/** Misma semántica de color en toda la app: ver --money-* en globals.css. */
const SERIES = [
  { key: "gross", label: "Facturación bruta", color: "var(--money-gross)", fill: "var(--money-gross)" },
  { key: "revenue", label: "Ingreso neto", color: "var(--money-net)", fill: "var(--money-net)" },
  { key: "expenses", label: "Gastos", color: "var(--money-out)", fill: "url(#hatch-expense)" },
] as const;

function Swatch({ k, color }: { k: string; color: string }) {
  // Los gastos llevan rayas también en la leyenda: se distinguen aunque no se perciba el rojo.
  return k === "expenses" ? (
    <span
      className="size-2.5 rounded-sm"
      style={{ background: `repeating-linear-gradient(135deg, ${color} 0 3px, color-mix(in oklab, ${color} 55%, white) 3px 5px)` }}
    />
  ) : (
    <span className="size-2.5 rounded-sm" style={{ background: color }} />
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { payload: Row }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-xl border bg-popover px-3 py-2 text-xs shadow-card">
      <p className="mb-1 font-medium">{label}</p>
      {SERIES.map((s) => (
        <p key={s.key} className="flex items-center gap-2">
          <Swatch k={s.key} color={s.color} />
          <span className="text-muted-foreground">{s.label}</span>
          <span className="ml-auto pl-3 font-medium tabular">{formatUSD(row[s.key])}</span>
        </p>
      ))}
      <p className="mt-1 border-t pt-1 text-muted-foreground">
        Utilidad neta{" "}
        <span className={`font-medium tabular ${row.net < 0 ? "text-money-out-text" : "text-foreground"}`}>{formatUSD(row.net)}</span>
      </p>
    </div>
  );
}

export function MonthlyChart({ data }: { data: Row[] }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <Swatch k={s.key} color={s.color} />
            {s.label}
          </span>
        ))}
      </div>

      <div className="mt-3 min-h-56 flex-1" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2} barCategoryGap="28%" margin={{ top: 20, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <pattern id="hatch-expense" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="var(--money-out)" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--surface)" strokeOpacity="0.35" strokeWidth="2" />
              </pattern>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
            <YAxis
              width={44}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickFormatter={(v: number) => `$${v / 1000}k`}
            />
            <Tooltip cursor={{ fill: "var(--surface-2)", radius: 8 }} content={<ChartTooltip />} />
            {SERIES.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.fill} radius={[4, 4, 0, 0]} maxBarSize={44}>
                <LabelList
                  dataKey={s.key}
                  position="top"
                  className="tabular"
                  style={{ fill: "var(--foreground)", fontSize: 11 }}
                  formatter={(v) => (Number(v) > 0 ? formatUSD(Number(v)) : "")}
                />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <table className="sr-only">
        <caption>Facturación, ingreso neto y gastos por mes</caption>
        <thead>
          <tr>
            <th>Mes</th>
            <th>Facturación bruta</th>
            <th>Ingreso neto</th>
            <th>Gastos</th>
            <th>Utilidad neta</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td>{formatUSD(r.gross)}</td>
              <td>{formatUSD(r.revenue)}</td>
              <td>{formatUSD(r.expenses)}</td>
              <td>{formatUSD(r.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

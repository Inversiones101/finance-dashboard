"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatUSD } from "@/lib/format";

type Row = { label: string; new: number; expansion: number; reactivation: number; churn: number; contraction: number; net: number; endMrr: number };

/** Lo que suma arriba de la línea, lo que resta abajo. Las bajas llevan rayas (no dependen del rojo). */
const SERIES = [
  { key: "new", label: "Nuevos", fill: "var(--money-net)" },
  { key: "expansion", label: "Expansión", fill: "var(--chart-3)" },
  { key: "reactivation", label: "Reactivaciones", fill: "var(--chart-4)" },
  { key: "churn", label: "Bajas", fill: "url(#hatch-churn)", swatch: "var(--money-out)" },
  { key: "contraction", label: "Contracción", fill: "color-mix(in oklab, var(--money-out) 55%, var(--surface))" },
] as const;

function Swatch({ s }: { s: (typeof SERIES)[number] }) {
  return s.key === "churn" ? (
    <span className="size-2.5 rounded-sm" style={{ background: "repeating-linear-gradient(135deg, var(--money-out) 0 3px, color-mix(in oklab, var(--money-out) 55%, white) 3px 5px)" }} />
  ) : (
    <span className="size-2.5 rounded-sm" style={{ background: s.fill }} />
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { payload: Row }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const shown = SERIES.filter((s) => row[s.key] !== 0);
  return (
    <div className="rounded-xl border bg-popover px-3 py-2 text-xs shadow-card">
      <p className="mb-1 font-medium">{label}</p>
      {shown.length === 0 && <p className="text-muted-foreground">Sin movimiento</p>}
      {shown.map((s) => (
        <p key={s.key} className="flex items-center gap-2">
          <Swatch s={s} />
          <span className="text-muted-foreground">{s.label}</span>
          <span className="ml-auto pl-3 font-medium tabular">
            {row[s.key] > 0 ? "+" : ""}
            {formatUSD(row[s.key])}
          </span>
        </p>
      ))}
      <p className="mt-1 flex justify-between gap-3 border-t pt-1">
        <span className="text-muted-foreground">Crecimiento neto</span>
        <span className={`font-medium tabular ${row.net < 0 ? "text-money-out-text" : ""}`}>
          {row.net > 0 ? "+" : ""}
          {formatUSD(row.net)}
        </span>
      </p>
      <p className="flex justify-between gap-3">
        <span className="text-muted-foreground">MRR al cierre</span>
        <span className="font-medium tabular">{formatUSD(row.endMrr)}</span>
      </p>
    </div>
  );
}

export function MrrMovementChart({ data }: { data: Row[] }) {
  const used = SERIES.filter((s) => data.some((r) => r[s.key] !== 0));
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(used.length ? used : SERIES.slice(0, 1)).map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <Swatch s={s} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="mt-3 h-60" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} stackOffset="sign" barCategoryGap="32%" margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <pattern id="hatch-churn" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="var(--money-out)" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--surface)" strokeOpacity="0.35" strokeWidth="2" />
              </pattern>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
            <YAxis width={48} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(v: number) => formatUSD(v)} />
            <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.5} />
            <Tooltip cursor={{ fill: "var(--surface-2)", radius: 8 }} content={<ChartTooltip />} />
            {SERIES.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} stackId="mrr" fill={s.fill} stroke="var(--surface)" strokeWidth={1} maxBarSize={44} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Movimiento del MRR por mes</caption>
        <thead>
          <tr>
            <th>Mes</th>
            {SERIES.map((s) => (
              <th key={s.key}>{s.label}</th>
            ))}
            <th>Neto</th>
            <th>MRR al cierre</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              {SERIES.map((s) => (
                <td key={s.key}>{formatUSD(r[s.key])}</td>
              ))}
              <td>{formatUSD(r.net)}</td>
              <td>{formatUSD(r.endMrr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

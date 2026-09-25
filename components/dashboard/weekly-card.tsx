import { CalendarDays } from "lucide-react";
import type { Weekly } from "@/lib/finance/weekly";
import { formatUSD } from "@/lib/format";
import { cn } from "@/lib/utils";

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatUSD(Math.abs(v))}`;

/** "Tu semana": lo que pasó en los últimos 7 días. Los lunes se destaca como resumen semanal. */
export function WeeklyCard({ w }: { w: Weekly }) {
  const rows = [
    { label: "Ingreso neto", value: formatUSD(w.revenue), hint: w.revenuePrev ? `vs ${formatUSD(w.revenuePrev)} la semana anterior` : undefined },
    { label: "Gastos de la LLC", value: formatUSD(w.expenses) },
    { label: "Caja en bancos", value: signed(w.cashChange), tone: w.cashChange < 0 ? "out" : undefined },
    { label: "Miembros", value: `+${w.newMembers} / −${w.cancellations}`, hint: "altas / bajas" },
    { label: "MRR", value: signed(w.mrrChange), tone: w.mrrChange < 0 ? "out" : w.mrrChange > 0 ? "in" : undefined },
  ];
  return (
    <section className={cn("h-full rounded-3xl border bg-surface p-5 shadow-card", w.isMonday && "ring-2 ring-accent")}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <CalendarDays className="size-4 text-muted-foreground" /> {w.isMonday ? "Resumen de tu semana" : "Últimos 7 días"}
        </h2>
        <span className="text-xs text-muted-foreground">
          {w.from.slice(8)}/{w.from.slice(5, 7)} – {w.to.slice(8)}/{w.to.slice(5, 7)}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
        {rows.map((r) => (
          <div key={r.label}>
            <dt className="text-xs text-muted-foreground">{r.label}</dt>
            <dd className={cn("font-heading text-lg font-bold tabular", r.tone === "out" && "text-money-out-text", r.tone === "in" && "text-success")}>{r.value}</dd>
            {r.hint && <dd className="text-[11px] text-muted-foreground">{r.hint}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}

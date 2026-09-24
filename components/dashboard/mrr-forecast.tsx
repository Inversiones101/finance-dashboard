import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatUSD } from "@/lib/format";

type Point = { month: string; label: string; committed: number; expected: number };

/**
 * Pronóstico de MRR: "comprometido" = miembros activos (los cancelados salen al vencer su periodo);
 * "esperado" = aplicando el churn mensual. Barras con su valor escrito: se lee sin depender del color.
 */
export function MrrForecast({ points, churn, isAssumption, active }: { points: Point[]; churn: number; isAssumption: boolean; active: number }) {
  const max = Math.max(1, ...points.map((p) => p.committed));
  return (
    <div className="rounded-3xl border bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Pronóstico de MRR</h2>
          <p className="text-xs text-muted-foreground">
            {active} miembros activos · churn {(churn * 100).toFixed(1)}% {isAssumption ? "(supuesto)" : "(real)"}
          </p>
        </div>
        <Link href="/miembros" className="text-muted-foreground hover:text-foreground" aria-label="Ver miembros">
          <ArrowRight className="size-4" />
        </Link>
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-money-net/35" /> Comprometido
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-money-net" /> Esperado con churn
        </span>
      </div>
      <ul className="mt-2 flex flex-col gap-2">
        {points.map((p) => (
          <li key={p.month} className="grid grid-cols-[2.5rem_1fr_4.5rem] items-center gap-2 text-xs" title={`${p.label}: comprometido ${formatUSD(p.committed)}, esperado ${formatUSD(p.expected)}`}>
            <span className="text-muted-foreground">{p.label}</span>
            <span className="relative h-2.5 overflow-hidden rounded-full bg-surface-2">
              <span className="absolute inset-y-0 left-0 rounded-full bg-money-net/35" style={{ width: `${(p.committed / max) * 100}%` }} />
              <span className="absolute inset-y-0 left-0 rounded-full bg-money-net" style={{ width: `${(p.expected / max) * 100}%` }} />
            </span>
            <span className="text-right font-medium tabular">{formatUSD(p.expected)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

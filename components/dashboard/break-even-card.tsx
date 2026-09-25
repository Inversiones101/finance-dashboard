import Link from "next/link";
import { Target } from "lucide-react";
import type { computeCommunity } from "@/lib/finance/engine";
import { formatUSD } from "@/lib/format";

/** Widget del dashboard: cuántos miembros faltan para cubrir los costos fijos. */
export function BreakEvenCard({ m }: { m: ReturnType<typeof computeCommunity> }) {
  const be = m.breakEven;
  return (
    <Link href="/miembros?vista=metricas" className="flex h-full flex-col justify-between gap-4 rounded-3xl border bg-surface p-6 shadow-card transition-transform hover:-translate-y-0.5">
      <div>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Target className="size-4" /> Punto de equilibrio
        </p>
        {be.membersNeeded === null ? (
          <p className="mt-2 text-sm text-muted-foreground">Se calcula cuando haya gastos y miembros registrados.</p>
        ) : (
          <>
            <p className="mt-2 font-heading text-4xl font-bold tabular">
              {m.activeCount}
              <span className="text-lg font-medium text-muted-foreground"> / {be.membersNeeded}</span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {be.missing === 0 ? "La comunidad ya cubre tus costos fijos." : `Faltan ${be.missing} miembro${be.missing === 1 ? "" : "s"} para cubrir ${formatUSD(be.fixedCosts)} al mes.`}
            </p>
          </>
        )}
      </div>
      {be.progress !== null && (
        <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(be.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Avance al punto de equilibrio">
          <div className="h-full rounded-full bg-money-net" style={{ width: `${be.progress * 100}%` }} />
        </div>
      )}
    </Link>
  );
}

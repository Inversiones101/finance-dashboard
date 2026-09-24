import Link from "next/link";
import { ArrowRight, PiggyBank, Target } from "lucide-react";
import type { GoalProgress } from "@/lib/finance/engine";
import { formatUSD } from "@/lib/format";
import { cn } from "@/lib/utils";

type BudgetRow = { categoryId: string; name: string; budget: number; actual: number; pct: number | null };

export function BudgetWidget({ rows, pct }: { rows: BudgetRow[]; pct: number | null }) {
  return (
    <div className="h-full rounded-3xl border bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <PiggyBank className="size-4 text-muted-foreground" /> Presupuesto del mes
        </h2>
        <Link href="/presupuestos" className="text-muted-foreground hover:text-foreground" aria-label="Ver presupuestos">
          <ArrowRight className="size-4" />
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Sin presupuestos.{" "}
          <Link href="/presupuestos" className="text-primary hover:underline">
            Crea el primero
          </Link>
        </p>
      ) : (
        <>
          {pct !== null && <p className="mt-1 text-xs text-muted-foreground">Usado {Math.round(pct * 100)}% del total</p>}
          <ul className="mt-3 flex flex-col gap-3">
            {rows.slice(0, 4).map((r) => (
              <li key={r.categoryId}>
                <div className="flex justify-between gap-2 text-xs">
                  <span className="truncate">{r.name}</span>
                  <span className={cn("tabular", (r.pct ?? 0) > 1 && "text-money-out-text")}>
                    {formatUSD(r.actual)} / {formatUSD(r.budget)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                  <div className={cn("h-full rounded-full", (r.pct ?? 0) > 1 ? "bg-money-out" : (r.pct ?? 0) > 0.85 ? "bg-warning" : "bg-primary")} style={{ width: `${Math.min(100, (r.pct ?? 0) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function GoalsWidget({ goals }: { goals: GoalProgress[] }) {
  const fmt = (g: GoalProgress, v: number) => (g.kind === "money" ? formatUSD(v) : String(Math.round(v)));
  return (
    <div className="h-full rounded-3xl border bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Target className="size-4 text-muted-foreground" /> Metas
        </h2>
        <Link href="/metas" className="text-muted-foreground hover:text-foreground" aria-label="Ver metas">
          <ArrowRight className="size-4" />
        </Link>
      </div>
      {goals.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Sin metas activas.{" "}
          <Link href="/metas" className="text-primary hover:underline">
            Define una
          </Link>
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {goals.slice(0, 4).map((g) => (
            <li key={g.id}>
              <div className="flex justify-between gap-2 text-xs">
                <span className="truncate font-medium">{g.name}</span>
                <span className="tabular text-muted-foreground">
                  {fmt(g, g.value)} / {fmt(g, g.target)}
                </span>
              </div>
              <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <div className={cn("h-full rounded-full", g.status === "achieved" ? "bg-success" : g.status === "behind" ? "bg-warning" : "bg-primary")} style={{ width: `${Math.min(100, Math.max(0, g.progress) * 100)}%` }} />
                {g.expected !== null && g.status !== "achieved" && <span className="absolute inset-y-0 w-0.5 bg-foreground/50" style={{ left: `${g.expected * 100}%` }} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

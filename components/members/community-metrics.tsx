import { Coins, Gauge, HeartHandshake, Megaphone, Target } from "lucide-react";
import type { computeCommunity } from "@/lib/finance/engine";
import { formatPct, formatUSD } from "@/lib/format";
import { Panel, StatPill } from "@/components/crud/page-header";
import { MrrMovementChart } from "./mrr-movement-chart";
import { cn } from "@/lib/utils";

type Metrics = ReturnType<typeof computeCommunity>;

const INTERVAL_LABEL: Record<string, string> = { monthly: "Mensual", annual: "Anual", quarterly: "Trimestral" };

/** Pestaña "Métricas" de Miembros: todo explicado, y honesto cuando aún no hay datos suficientes. */
export function CommunityMetrics({ m }: { m: Metrics }) {
  const be = m.breakEven;
  const reached = be.membersNeeded !== null && be.missing === 0;
  const months = `${m.windowMonths} ${m.windowMonths === 1 ? "mes" : "meses"}`;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Punto de equilibrio ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-3xl bg-highlight p-5 text-highlight-foreground shadow-card md:p-6">
        <div className="pointer-events-none absolute -top-14 -right-10 size-44 rounded-full bg-accent/20 blur-2xl" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm opacity-80">
              <Target className="size-4" /> Punto de equilibrio
            </p>
            {be.membersNeeded === null ? (
              <p className="mt-2 max-w-md text-sm opacity-90">Se calcula cuando haya gastos operativos y miembros pagando registrados.</p>
            ) : (
              <>
                <p className="mt-2 font-heading text-4xl font-bold tabular">
                  {m.activeCount} <span className="text-xl font-medium opacity-70">de {be.membersNeeded} miembros</span>
                </p>
                <p className="mt-1 text-sm opacity-80">
                  {reached
                    ? "Ya cubres tus costos fijos con la comunidad."
                    : `Te faltan ${be.missing} miembro${be.missing === 1 ? "" : "s"} para cubrir ${formatUSD(be.fixedCosts)} de costos fijos al mes.`}
                </p>
              </>
            )}
          </div>
          {be.mrrNeeded !== null && be.fixedCosts > 0 && (
            <p className="text-sm opacity-80 md:text-right">
              MRR necesario <span className="font-semibold tabular">{formatUSD(be.mrrNeeded)}</span>
              <br />
              MRR actual <span className="font-semibold tabular">{formatUSD(m.mrr)}</span>
            </p>
          )}
        </div>
        {be.progress !== null && (
          <div className="relative mt-4 h-2.5 overflow-hidden rounded-full bg-highlight-foreground/15" role="progressbar" aria-valuenow={Math.round(be.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${be.progress * 100}%` }} />
          </div>
        )}
        <p className="relative mt-2 text-[11px] opacity-60">
          Costos fijos = promedio de gastos operativos y costos directos de los últimos {months}. Cada miembro aporta su ARPU menos comisiones.
        </p>
      </section>

      {/* ── Economía por miembro ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatPill label="ARPU" value={m.arpu !== null ? formatUSD(m.arpu, { cents: true }) : "—"} icon={Coins} hint="Ingreso promedio mensual por miembro" />
        <StatPill
          label="LTV"
          value={m.ltv !== null ? formatUSD(m.ltv) : "—"}
          icon={HeartHandshake}
          tone="in"
          hint={m.ltv === null ? "Necesita churn para calcularse" : `Con churn ${formatPct(m.churn)}${m.churnIsAssumption ? " (supuesto)" : ""}`}
        />
        <StatPill
          label="Costo por miembro (CAC)"
          value={m.cac !== null && m.marketing > 0 ? formatUSD(m.cac) : m.newMembers > 0 ? "Orgánico" : "—"}
          icon={Megaphone}
          hint={m.marketing > 0 ? `${formatUSD(m.marketing)} en marketing · ${m.newMembers} altas` : `Sin gasto en marketing · ${m.newMembers} altas en ${months}`}
        />
        <StatPill
          label="LTV / CAC"
          value={m.ltvToCac !== null ? `${m.ltvToCac.toFixed(1)}×` : "—"}
          icon={Gauge}
          tone={m.ltvToCac === null ? "neutral" : m.ltvToCac >= 3 ? "in" : "out"}
          hint={m.paybackMonths !== null ? `Recuperas el CAC en ${m.paybackMonths.toFixed(1)} meses` : "Sano: 3× o más"}
        />
      </div>
      {m.churnIsAssumption && (
        <p className="-mt-1 text-xs text-muted-foreground">
          El LTV usa el churn supuesto ({formatPct(m.churn)}) porque todavía no hay suficientes bajas para medirlo. Cambia el supuesto en la vista de Miembros.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ── Movimiento del MRR ────────────────────────────────────────── */}
        <Panel className="lg:col-span-2" title="Movimiento del MRR" description="Qué sumó y qué restó cada mes. Un aumento de precio solo cuenta como expansión si un miembro actual paga más.">
          {m.hasMovement ? <MrrMovementChart data={m.movement} /> : <p className="text-sm text-muted-foreground">Aparece en cuanto haya altas o bajas registradas.</p>}
        </Panel>

        {/* ── Mezcla de planes ──────────────────────────────────────────── */}
        <Panel title="Mezcla de planes" description="El anual reduce el churn: conviene que crezca.">
          {m.mix.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin miembros activos.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {[
                { label: "Miembros", values: m.mix.map((x) => ({ key: x.interval, v: x.members, text: String(x.members) })) },
                { label: "MRR", values: m.mix.map((x) => ({ key: x.interval, v: x.mrr, text: formatUSD(x.mrr) })) },
              ].map((row) => {
                const total = row.values.reduce((a, x) => a + x.v, 0) || 1;
                return (
                  <div key={row.label}>
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">{row.label}</p>
                    <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
                      {row.values.map((x, i) => (
                        <div key={x.key} className="h-full" style={{ width: `${(x.v / total) * 100}%`, background: `var(--chart-${i + 1})` }} />
                      ))}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs">
                      {row.values.map((x, i) => (
                        <span key={x.key} className="flex items-center gap-1.5">
                          <span className="size-2 rounded-sm" style={{ background: `var(--chart-${i + 1})` }} />
                          {INTERVAL_LABEL[x.key]} <span className="font-medium tabular">{x.text}</span>
                          <span className="text-muted-foreground tabular">({Math.round((x.v / total) * 100)}%)</span>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      {/* ── Cohortes ──────────────────────────────────────────────────────── */}
      <Panel title="Retención por cohorte" description="De los que entraron cada mes, qué porcentaje sigue activo en los meses siguientes. Se llena solo mes a mes.">
        {m.cohorts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin miembros todavía.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-separate border-spacing-1 text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium">Entraron</th>
                  <th className="text-right font-medium">Miembros</th>
                  {Array.from({ length: Math.max(...m.cohorts.map((c) => c.retention.length)) }, (_, k) => (
                    <th key={k} className="font-medium">
                      Mes {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m.cohorts.map((c) => (
                  <tr key={c.month}>
                    <td className="pr-2 font-medium whitespace-nowrap">{c.label}</td>
                    <td className="pr-2 text-right tabular">{c.size}</td>
                    {c.retention.map((r, k) => (
                      <td
                        key={k}
                        title={r === null ? "" : `${Math.round(r * 100)}% sigue activo en el mes ${k}`}
                        className={cn("h-8 min-w-12 rounded-md text-center font-medium tabular", r !== null && r >= 0.6 && "text-highlight-foreground")}
                        style={{ background: r === null ? undefined : `color-mix(in oklab, var(--money-net) ${Math.round(15 + r * 85)}%, var(--surface))` }}
                      >
                        {r === null ? "" : `${Math.round(r * 100)}%`}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {m.cohorts.length > 0 && m.cohorts.every((c) => c.retention.length <= 2) && (
          <p className="mt-2 text-xs text-muted-foreground">Con pocos meses de historia la tabla es corta; en 3–4 meses ya muestra tendencias.</p>
        )}
      </Panel>
    </div>
  );
}

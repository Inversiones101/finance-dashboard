"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarClock, ChevronDown, Hourglass, Loader2, RotateCcw, Save, Target, TrendingUp, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import type { FinanceData } from "@/lib/finance/engine";
import { computeProjection, type Projection, type Scenario } from "@/lib/finance/projection";
import { deleteScenarioAction, saveScenarioAction, type SavedScenario } from "@/lib/actions/projection";
import { formatUSD } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Panel, StatPill } from "@/components/crud/page-header";
import { cn } from "@/lib/utils";

type Props = {
  data: FinanceData;
  asOf: string;
  hnlPerUsd: number;
  churnAssumption: number;
  minCashCents: number;
  saved: SavedScenario[];
  canWrite: boolean;
};

type Controls = { newPerMonth: number; churnPct: number; monthlyPrice: string; annualPrice: string; priceFrom: string; extraMonthly: number };

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const monthName = (m: string | null) => (m ? `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` : null);
const cents = (v: string) => (v.trim() === "" ? null : Math.round(Number(v.replace(/[$,\s]/g, "")) * 100) || null);

function Slider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{label}</span>
        <span className="font-semibold tabular">{format(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--money-net)]" />
    </label>
  );
}

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: i.dashed ? `repeating-linear-gradient(90deg, ${i.color} 0 4px, transparent 4px 7px)` : i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function ChartTip({ active, payload, label, rows }: { active?: boolean; payload?: { dataKey: string; value: number; color: string; name: string }[]; label?: string; rows?: (k: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border bg-popover px-3 py-2 text-xs shadow-card">
      <p className="mb-1 font-medium">{rows ? rows(label ?? "") : label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2">
          <span className="h-0.5 w-3 rounded" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto pl-3 font-medium tabular">{formatUSD(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

export function ProjectionView({ data, asOf, hnlPerUsd, churnAssumption, minCashCents, saved, canWrite }: Props) {
  const router = useRouter();
  const base = useMemo(() => computeProjection(data, { asOf, hnlPerUsd, churnAssumption, minCashCents }), [data, asOf, hnlPerUsd, churnAssumption, minCashCents]);

  const defaults: Controls = {
    newPerMonth: Math.round(base.assumptions.recentNewPerMonth * 2) / 2,
    churnPct: Math.round(base.assumptions.churn * 1000) / 10,
    monthlyPrice: "",
    annualPrice: "",
    priceFrom: "",
    extraMonthly: 0,
  };
  const [c, setC] = useState<Controls>(defaults);
  const [name, setName] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const set = (patch: Partial<Controls>) => setC((x) => ({ ...x, ...patch }));

  const changed = JSON.stringify(c) !== JSON.stringify(defaults);
  const scen: Projection = useMemo(() => {
    if (!changed) return base;
    const scenario: Scenario = {
      newPerMonth: c.newPerMonth,
      churn: c.churnPct / 100,
      priceChange: (c.monthlyPrice || c.annualPrice) && c.priceFrom ? { monthlyCents: cents(c.monthlyPrice), annualCents: cents(c.annualPrice), from: c.priceFrom } : null,
      extraMonthlyCents: c.extraMonthly * 100,
    };
    return computeProjection(data, { asOf, hnlPerUsd, churnAssumption, minCashCents }, scenario);
  }, [c, changed, base, data, asOf, hnlPerUsd, churnAssumption, minCashCents]);

  const weekly = base.weeks.map((w, i) => ({ label: w.label, base: w.endCash, scenario: scen.weeks[i].endCash }));
  const monthly = base.months.map((m, i) => ({ label: m.label, base: m.mrr, scenario: scen.months[i].mrr }));
  const low = scen.lowestWeek;

  const save = () =>
    start(async () => {
      const r = await saveScenarioAction({
        name,
        newPerMonth: c.newPerMonth,
        churn: c.churnPct / 100,
        monthlyPriceCents: cents(c.monthlyPrice),
        annualPriceCents: cents(c.annualPrice),
        priceFrom: c.priceFrom || null,
        extraMonthlyCents: c.extraMonthly * 100,
      });
      if (r.ok) {
        toast.success(r.message);
        setName("");
        router.refresh();
      } else toast.error(r.error);
    });

  const load = (s: SavedScenario) =>
    setC({
      newPerMonth: s.newPerMonth,
      churnPct: Math.round(s.churn * 1000) / 10,
      monthlyPrice: s.monthlyPriceCents ? String(s.monthlyPriceCents / 100) : "",
      annualPrice: s.annualPriceCents ? String(s.annualPriceCents / 100) : "",
      priceFrom: s.priceFrom ?? "",
      extraMonthly: Math.round(s.extraMonthlyCents / 100),
    });

  return (
    <div className="flex flex-col gap-4">
      {/* ── Resumen ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatPill label="Caja hoy" value={formatUSD(base.startCash)} icon={Wallet} hint="Bancos + saldo de Skool por cobrar" />
        <StatPill
          label="Semana más baja"
          value={formatUSD(low.endCash)}
          icon={CalendarClock}
          tone={scen.firstBelowMin ? "out" : "neutral"}
          hint={scen.firstBelowMin ? `Baja de tu mínimo la semana del ${scen.firstBelowMin.label}` : `Semana del ${low.label}`}
        />
        <StatPill
          label="MRR en 12 meses"
          value={formatUSD(scen.mrrIn12 ?? 0)}
          icon={TrendingUp}
          tone="in"
          hint={changed ? `Base ${formatUSD(base.mrrIn12 ?? 0)}` : `En 6 meses ${formatUSD(scen.mrrIn6 ?? 0)}`}
        />
        <StatPill
          label="Punto de equilibrio"
          value={scen.breakEvenMonth ? (monthName(scen.breakEvenMonth) ?? "") : "Más de 12 meses"}
          icon={Target}
          hint={scen.runwayMonths !== null ? `Caja se agota en ${scen.runwayMonths} meses` : "La caja no se agota en 12 meses"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* ── Caja 13 semanas ─────────────────────────────────────────── */}
        <Panel
          className="xl:col-span-2"
          title="Caja proyectada · 13 semanas"
          description="Saldo al cierre de cada semana con renovaciones, cuotas, suscripciones y gastos conocidos. Las renovaciones ya descuentan comisión y churn."
        >
          <Legend
            items={[
              ...(changed ? [{ label: "Escenario", color: "var(--money-net)" }, { label: "Base", color: "var(--muted-foreground)", dashed: true }] : [{ label: "Caja proyectada", color: "var(--money-net)" }]),
              ...(minCashCents > 0 ? [{ label: `Caja mínima ${formatUSD(minCashCents / 100)}`, color: "var(--warning)", dashed: true }] : []),
            ]}
          />
          <div className="mt-3 h-64" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weekly} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis width={56} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(v: number) => formatUSD(v)} />
                {minCashCents > 0 && <ReferenceLine y={minCashCents / 100} stroke="var(--warning)" strokeDasharray="4 3" />}
                <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.4} />
                <Tooltip content={<ChartTip rows={(l) => `Semana del ${l}`} />} />
                {changed && <Line type="monotone" dataKey="base" name="Base" stroke="var(--muted-foreground)" strokeWidth={2} strokeDasharray="5 4" dot={false} />}
                <Line type="monotone" dataKey="scenario" name={changed ? "Escenario" : "Caja"} stroke="var(--money-net)" strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: "var(--money-net)" }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Detalle por semana */}
          <div className="mt-4 divide-y rounded-2xl border">
            {scen.weeks.map((w, i) => (
              <div key={w.from}>
                <button
                  type="button"
                  onClick={() => setOpen(open === i ? null : i)}
                  aria-expanded={open === i}
                  className={cn("flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2/60", w.belowMin && "bg-warning/8")}
                >
                  <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open === i && "rotate-180")} />
                  <span className="w-24 shrink-0 font-medium">Sem. {w.label}</span>
                  <span className="flex-1 text-xs text-muted-foreground tabular">
                    <span className="text-success">+{formatUSD(w.inflow)}</span> · <span className="text-money-out-text">{formatUSD(w.outflow)}</span>
                  </span>
                  <span className={cn("font-semibold tabular", w.endCash < 0 && "text-money-out-text")}>{formatUSD(w.endCash)}</span>
                </button>
                {open === i && (
                  <div className="grid gap-3 bg-surface-2/40 px-4 py-3 text-xs sm:grid-cols-2">
                    <ul className="flex flex-col gap-1">
                      {w.byKind.length === 0 && <li className="text-muted-foreground">Sin movimientos</li>}
                      {w.byKind.map((k) => (
                        <li key={k.kind} className="flex justify-between gap-3">
                          <span className="text-muted-foreground">{k.label}</span>
                          <span className={cn("font-medium tabular", k.amount < 0 && "text-money-out-text")}>{formatUSD(k.amount)}</span>
                        </li>
                      ))}
                    </ul>
                    {w.notable.length > 0 && (
                      <ul className="flex flex-col gap-1">
                        {w.notable.map((n, j) => (
                          <li key={j} className="flex justify-between gap-3">
                            <span className="truncate">{n.label}</span>
                            <span className="font-medium tabular text-money-out-text">{formatUSD(n.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>

        {/* ── Simulador ───────────────────────────────────────────────── */}
        <Panel
          title="Simulador"
          description="Mueve los supuestos y compara contra la base (tu situación actual)."
          actions={
            changed ? (
              <Button variant="ghost" size="sm" onClick={() => setC(defaults)}>
                <RotateCcw className="size-3.5" /> Base
              </Button>
            ) : undefined
          }
        >
          <div className="flex flex-col gap-5">
            {saved.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {saved.map((s) => (
                  <span key={s.id} className="inline-flex items-center rounded-full border bg-surface-2 text-xs">
                    <button type="button" onClick={() => load(s)} className="rounded-l-full py-1 pr-1 pl-3 hover:underline">
                      {s.name}
                    </button>
                    {canWrite && (
                      <button
                        type="button"
                        aria-label={`Eliminar ${s.name}`}
                        onClick={() => start(async () => {
                          const r = await deleteScenarioAction(s.id);
                          if (r.ok) router.refresh();
                        })}
                        className="rounded-r-full py-1 pr-2 pl-1 text-muted-foreground hover:text-danger"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}

            <Slider label="Altas por mes" value={c.newPerMonth} min={0} max={40} step={0.5} onChange={(v) => set({ newPerMonth: v })} format={(v) => `${v} miembros`} />
            <p className="-mt-3 text-[11px] text-muted-foreground">Promedio real reciente: {base.assumptions.recentNewPerMonth.toFixed(1)} al mes</p>
            <Slider label="Churn mensual" value={c.churnPct} min={0} max={20} step={0.5} onChange={(v) => set({ churnPct: v })} format={(v) => `${v}%`} />
            <Slider label="Gasto nuevo al mes" value={c.extraMonthly} min={0} max={3000} step={50} onChange={(v) => set({ extraMonthly: v })} format={(v) => formatUSD(v)} />

            <fieldset className="flex flex-col gap-2 rounded-2xl border p-3">
              <legend className="px-1 text-sm font-medium">Nuevo precio (lanzamiento)</legend>
              <p className="text-[11px] text-muted-foreground">
                Hoy: {formatUSD(base.assumptions.monthlyPrice)} mensual · {formatUSD(base.assumptions.annualPrice)} anual. Solo aplica a quien entre desde la fecha; los actuales conservan su precio.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs">
                  Mensual
                  <input inputMode="decimal" value={c.monthlyPrice} onChange={(e) => set({ monthlyPrice: e.target.value })} placeholder={String(base.assumptions.monthlyPrice)} className="h-8 rounded-lg border bg-transparent px-2 text-sm" />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  Anual
                  <input inputMode="decimal" value={c.annualPrice} onChange={(e) => set({ annualPrice: e.target.value })} placeholder={String(base.assumptions.annualPrice)} className="h-8 rounded-lg border bg-transparent px-2 text-sm" />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-xs">
                Desde
                <input type="date" value={c.priceFrom} min={asOf} onChange={(e) => set({ priceFrom: e.target.value })} className="h-8 rounded-lg border bg-transparent px-2 text-sm" />
              </label>
              {(c.monthlyPrice || c.annualPrice) && !c.priceFrom && <p className="text-[11px] text-warning">Elige la fecha del lanzamiento para aplicarlo.</p>}
            </fieldset>

            {canWrite && changed && (
              <div className="flex gap-2">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del escenario" className="h-9 min-w-0 flex-1 rounded-lg border bg-transparent px-3 text-sm" />
                <Button size="sm" onClick={save} disabled={!name.trim() || pending}>
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Guardar
                </Button>
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* ── 12 meses ──────────────────────────────────────────────────────── */}
      <Panel title="MRR esperado · 12 meses" description="Miembros actuales a su precio, menos churn, más las altas del escenario al precio vigente en su fecha.">
        <Legend items={changed ? [{ label: "Escenario", color: "var(--money-net)" }, { label: "Base", color: "var(--muted-foreground)", dashed: true }] : [{ label: "MRR esperado", color: "var(--money-net)" }]} />
        <div className="mt-3 h-56" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthly} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
              <YAxis width={56} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(v: number) => formatUSD(v)} />
              <Tooltip content={<ChartTip />} />
              {changed && <Line type="monotone" dataKey="base" name="Base" stroke="var(--muted-foreground)" strokeWidth={2} strokeDasharray="5 4" dot={false} />}
              <Line type="monotone" dataKey="scenario" name={changed ? "Escenario" : "MRR"} stroke="var(--money-net)" strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: "var(--money-net)" }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 text-left font-medium">Mes</th>
                {scen.months.map((m) => (
                  <th key={m.month} className="py-1 text-right font-medium">
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular">
              {[
                { label: "Miembros", get: (m: Projection["months"][number]) => String(m.members) },
                { label: "MRR", get: (m: Projection["months"][number]) => formatUSD(m.mrr) },
                { label: "Caja", get: (m: Projection["months"][number]) => formatUSD(m.cash) },
              ].map((row) => (
                <tr key={row.label} className="border-t">
                  <td className="py-1.5 font-medium">{row.label}</td>
                  {scen.months.map((m) => (
                    <td key={m.month} className={cn("py-1.5 text-right", row.label === "Caja" && m.cash < 0 && "text-money-out-text")}>
                      {row.get(m)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 flex items-start gap-2 text-[11px] text-muted-foreground">
          <Hourglass className="mt-0.5 size-3 shrink-0" />
          Supuestos: comisión {Math.round(scen.assumptions.feeRate * 1000) / 10}% · {Math.round(scen.assumptions.annualShare * 100)}% de altas anuales · otros gastos{" "}
          {formatUSD(scen.assumptions.otherMonthly)}/mes (promedio de gastos que no son suscripciones ni cuotas). Es una estimación: el churn se aplica como probabilidad.
        </p>
      </Panel>
    </div>
  );
}

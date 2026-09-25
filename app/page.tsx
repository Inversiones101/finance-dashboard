import {
  ArrowDownRight,
  ArrowUpRight,
  BadgePercent,
  Bell,
  CalendarClock,
  CircleDollarSign,
  CreditCard,
  FileText,
  Flame,
  Hourglass,
  Landmark,
  Receipt,
  Repeat,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Greeting } from "@/components/dashboard/greeting";
import { CashHero } from "@/components/dashboard/cash-hero";
import { PlatformCard } from "@/components/dashboard/platform-card";
import { InsightsPanel } from "@/components/dashboard/insights-panel";
import { MrrForecast } from "@/components/dashboard/mrr-forecast";
import { KpiTile } from "@/components/dashboard/kpi-tile";
import { MonthlyChart } from "@/components/dashboard/monthly-chart";
import { BreakdownCard } from "@/components/dashboard/breakdown-card";
import { CustomizeDashboard } from "@/components/dashboard/customize-dashboard";
import { BudgetWidget, GoalsWidget } from "@/components/dashboard/planning-widgets";
import { BreakEvenCard } from "@/components/dashboard/break-even-card";
import { MrrMovementChart } from "@/components/members/mrr-movement-chart";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { resolvePrefs, type WidgetId } from "@/lib/dashboard-widgets";
import { getDashboard } from "@/lib/data/dashboard";
import { requirePage } from "@/lib/auth/session";
import { formatPct, formatShortDate, formatUSD } from "@/lib/format";
import { cn } from "@/lib/utils";

// Lee la BD en cada visita: los números siempre reflejan lo último capturado.
export const dynamic = "force-dynamic";

const UPCOMING_ICON: Record<string, LucideIcon> = {
  reminder: Bell,
  subscription: Repeat,
  contract: Landmark,
  card: CreditCard,
  debt: Landmark,
  tax: FileText,
  renewal: Users,
};

export default async function DashboardPage() {
  const user = await requirePage("dashboard");
  const [d, [prefRow]] = await Promise.all([getDashboard(), getDb().then((db) => db.select({ p: users.dashboardPrefs }).from(users).where(eq(users.id, user.id)))]);
  const prefs = resolvePrefs(prefRow?.p);
  const { kpis, liabilities, month, members } = d;
  const monthShort = d.period.name.split(" ")[0];
  const capitalized = d.period.name.charAt(0).toUpperCase() + d.period.name.slice(1);

  const runway = kpis.runwayMonths === null ? "∞" : `${kpis.runwayMonths.toFixed(1)} meses`;
  const topCommitment = liabilities.commitments[0];
  const obligationsTotal = liabilities.debtTotal + liabilities.commitmentsTotal;
  const cardsOwed = d.cash.llcCards.reduce((a, c) => a + c.balance, 0);

  const quickAlerts: { label: string; value: string; hint: string; icon: LucideIcon; tone?: "warn" | "out"; progress?: number }[] = [
    {
      label: "Gastos del mes",
      value: formatUSD(month.expenses),
      hint: `${month.expenseCount} ${month.expenseCount === 1 ? "cargo" : "cargos"} en ${monthShort}`,
      icon: Receipt,
      tone: "out",
    },
    {
      label: "Comisiones de plataformas",
      value: formatUSD(kpis.platformFees),
      hint: kpis.revenueGross > 0 ? `${formatPct(kpis.platformFees / kpis.revenueGross)} de la facturación` : "Sin ventas este mes",
      icon: BadgePercent,
    },
    {
      label: "Deuda y compromisos",
      value: formatUSD(obligationsTotal),
      hint: obligationsTotal === 0 ? "La LLC no debe nada 🎉" : topCommitment ? `${topCommitment.name} · ${formatPct(topCommitment.progress)} pagado` : `${liabilities.debt.length} deudas activas`,
      icon: Landmark,
      progress: topCommitment && obligationsTotal === topCommitment.pending ? topCommitment.progress : undefined,
    },
    {
      label: "Cuentas por pagar (LLC)",
      value: formatUSD(liabilities.llcPayables),
      hint: cardsOwed > 0 ? `${formatUSD(cardsOwed)} en tarjetas de la LLC` : "Tarjetas y facturas pendientes",
      icon: CalendarClock,
      tone: liabilities.llcPayables > 0 ? "warn" : undefined,
    },
  ];

  // Cada widget declara su ancho en una grilla de 5 columnas; el orden y la visibilidad los elige el usuario.
  const widgets: Record<WidgetId, { span: "full" | "wide" | "narrow"; node: React.ReactNode }> = {
    money: {
      span: "full",
      node: (
      <section className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <CashHero total={d.cash.total} accounts={d.cash.accounts} cards={d.cash.llcCards} />
        </div>
        <div className="lg:col-span-2">
          <PlatformCard total={d.platforms.total} accounts={d.platforms.accounts} />
        </div>
      </section>
      ),
    },
    alerts: { span: "wide", node: <InsightsPanel insights={d.insights} prefs={prefs} /> },
    breakeven: { span: "narrow", node: <BreakEvenCard m={d.community} /> },
    movement: {
      span: "wide",
      node: (
        <div className="h-full rounded-3xl border bg-surface p-5 shadow-card">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">Movimiento del MRR</h2>
              <p className="text-xs text-muted-foreground">Qué sumó y qué restó cada mes</p>
            </div>
            <Link href="/miembros?vista=metricas" className="text-xs text-muted-foreground hover:text-foreground">
              Ver métricas →
            </Link>
          </div>
          {d.community.hasMovement ? <MrrMovementChart data={d.community.movement} /> : <p className="text-sm text-muted-foreground">Aparece en cuanto haya altas o bajas.</p>}
        </div>
      ),
    },
    results: {
      span: "narrow",
      node: (
        <div className="flex flex-col justify-between gap-4 rounded-3xl border bg-surface p-6 shadow-card h-full">
          <div>
            <p className="text-sm text-muted-foreground">Utilidad neta · {monthShort}</p>
            <p className={cn("mt-2 font-heading text-4xl font-bold tabular", kpis.netProfit < 0 && "text-money-out-text")}>{formatUSD(kpis.netProfit)}</p>
            {kpis.netProfit >= 0 ? (
              <p className="mt-1 inline-flex items-center gap-1 text-sm text-success">
                <ArrowUpRight className="size-4" /> Mes en verde
                {kpis.netMargin !== null && <> · margen neto de {formatPct(kpis.netMargin)}</>}
              </p>
            ) : (
              <p className="mt-1 inline-flex items-center gap-1 text-sm text-money-out-text">
                <ArrowDownRight className="size-4" /> Los gastos superan a los ingresos este mes
              </p>
            )}
            {kpis.preOperating > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">Incluye {formatUSD(kpis.preOperating)} de puesta en marcha cubiertos con tu capital inicial.</p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-surface-2 p-3">
              <p className="text-xs text-muted-foreground">EBITDA</p>
              <p className="font-heading text-lg font-bold tabular">{formatUSD(kpis.ebitda)}</p>
            </div>
            <div className="rounded-2xl bg-surface-2 p-3">
              <p className="text-xs text-muted-foreground">MRR</p>
              <p className="font-heading text-lg font-bold tabular">{formatUSD(kpis.mrr)}</p>
            </div>
            <div className="rounded-2xl bg-surface-2 p-3">
              <p className="text-xs text-muted-foreground">ARR</p>
              <p className="font-heading text-lg font-bold tabular">{formatUSD(kpis.arr)}</p>
            </div>
          </div>
        </div>
      ),
    },
    kpis: {
      span: "full",
      node: (
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Ingreso neto" value={formatUSD(kpis.revenue)} hint={`${formatUSD(kpis.revenueGross)} facturación bruta`} icon={TrendingUp} dot="var(--money-net)" />
        <KpiTile label="Utilidad bruta" value={formatUSD(kpis.grossProfit)} hint="Ingreso neto − costos directos" icon={CircleDollarSign} />
        <KpiTile
          label="Margen neto"
          value={kpis.netMargin === null ? "—" : formatPct(kpis.netMargin)}
          hint="Utilidad neta ÷ ingreso neto"
          icon={BadgePercent}
          trend={kpis.netMargin === null ? "flat" : kpis.netMargin >= 0 ? "up" : "down"}
        />
        <KpiTile label="Burn rate" value={formatUSD(kpis.grossBurn)} hint="Gasto mensual promedio" icon={Flame} dot="var(--money-out)" />
        <KpiTile
          label="Burn neto"
          value={formatUSD(kpis.netBurn)}
          hint={kpis.netBurn === 0 ? "Los ingresos cubren los gastos" : "Caja que se consume al mes"}
          icon={Repeat}
          trend={kpis.netBurn === 0 ? "up" : "down"}
        />
        <KpiTile
          label="Runway"
          value={runway}
          hint={kpis.runwayMonths === null ? "No estás quemando caja" : "Meses de caja + Skool al ritmo actual"}
          icon={Hourglass}
          trend={kpis.runwayMonths === null || kpis.runwayMonths > 12 ? "up" : "down"}
        />
      </section>
      ),
    },
    summary: {
      span: "full",
      node: (
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {quickAlerts.map(({ label, value, hint, icon: Icon, tone, progress }) => (
          <div key={label} className={cn("flex items-center gap-3 rounded-2xl border bg-surface p-4 shadow-card", tone === "warn" && "border-warning/50")}>
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2",
                tone === "warn" && "bg-warning/15 text-warning",
                tone === "out" && "bg-money-out/15 text-money-out-text"
              )}
            >
              <Icon className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={cn("font-heading text-lg font-bold tabular", tone === "out" && "text-money-out-text")}>{value}</p>
              <p className="truncate text-xs text-muted-foreground">{hint}</p>
              {progress !== undefined && (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                  <div className="h-full rounded-full bg-primary" style={{ width: `${progress * 100}%` }} />
                </div>
              )}
            </div>
          </div>
        ))}
      </section>
      ),
    },
    chart: {
      span: "wide",
      node: (
          <div className="flex h-full flex-col rounded-3xl border bg-surface p-5 shadow-card md:p-6">
            <div className="mb-3">
              <h2 className="text-lg font-semibold">Evolución mensual</h2>
              <p className="text-sm text-muted-foreground">Facturación, ingreso neto y gastos (P&L)</p>
            </div>
            <div className="flex-1">
              <MonthlyChart data={d.series} />
            </div>
          </div>
      ),
    },
    upcoming: {
      span: "narrow",
      node: (
          <div className="h-full rounded-3xl border bg-surface p-5 shadow-card">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Próximos movimientos</h2>
              <CalendarClock className="size-4 text-muted-foreground" />
            </div>
            {d.upcoming.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Nada en las próximas semanas.</p>
            ) : (
              <ul className="mt-3 flex flex-col">
                {d.upcoming.slice(0, 7).map((u) => {
                  const Icon = UPCOMING_ICON[u.kind] ?? Bell;
                  const [day, mon] = formatShortDate(u.date).split(" ");
                  return (
                    <li key={u.date + u.title} className="flex items-center gap-3 border-b py-2.5 last:border-0">
                      <div className="flex w-11 shrink-0 flex-col items-center rounded-xl bg-surface-2 py-1 leading-tight">
                        <span className="font-heading text-sm font-bold">{day}</span>
                        <span className="text-[10px] text-muted-foreground uppercase">{mon}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-sm font-medium">
                          <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="truncate">{u.title}</span>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{u.detail}</p>
                      </div>
                      {u.amount !== null && <span className="text-sm font-medium tabular">{formatUSD(u.amount, { cents: u.amount % 1 !== 0 })}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
      ),
    },
    breakdowns: {
      span: "wide",
      node: (
          <div className="grid gap-4 sm:grid-cols-2">
            <BreakdownCard title="Ingresos por producto" items={month.revenueByProduct} color="var(--money-net)" empty="Sin ingresos este mes" />
            <BreakdownCard title="Gastos por categoría" items={month.expensesByCategory} color="var(--money-out)" empty="Sin gastos este mes" />
          </div>
      ),
    },
    forecast: {
      span: "narrow",
      node: members.hasMembers ? <MrrForecast points={members.forecast} churn={members.churnUsed} isAssumption={members.churnIsAssumption} active={members.active} /> : null,
    },
    budgets: { span: "narrow", node: <BudgetWidget rows={d.budgets.rows} pct={d.budgets.pct} /> },
    goals: { span: "wide", node: <GoalsWidget goals={d.goals} /> },
  };
  const SPAN = { full: "lg:col-span-5", wide: "lg:col-span-3", narrow: "lg:col-span-2" } as const;

  return (
    <div className="flex flex-col gap-6">
      {/* Encabezado */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <Greeting name={user.name.split(" ")[0]} />
        <div className="flex items-center gap-2">
          <span className="w-fit rounded-full border bg-surface px-3 py-1.5 text-xs font-medium">{capitalized}</span>
          <CustomizeDashboard prefs={prefs} />
        </div>
      </div>

      <div className="grid grid-flow-row-dense gap-4 lg:grid-cols-5">
        {prefs.order
          .filter((id) => !prefs.hidden.includes(id) && widgets[id].node)
          .map((id) => (
            <div key={id} className={SPAN[widgets[id].span]}>
              {widgets[id].node}
            </div>
          ))}
      </div>

      {/* Pie discreto */}
      <footer className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-t pt-4 text-[11px] text-muted-foreground">
        <span>Montos en USD · tipo de cambio del día L{d.fx.hnlPerUsd.toFixed(2)} por dólar</span>
        {d.nextTax && (
          <span>
            Próxima obligación fiscal: {d.nextTax.name} · {formatShortDate(d.nextTax.dueDate)} {d.nextTax.dueDate.slice(0, 4)}
          </span>
        )}
      </footer>
    </div>
  );
}

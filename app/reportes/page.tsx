import { ArrowDownRight, ArrowUpRight, Minus, Scale } from "lucide-react";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { MonthClosePanel } from "@/components/reports/month-close-panel";
import { AccountantPackage } from "@/components/reports/accountant-package";
import { getDb } from "@/db/client";
import { loadFinanceData } from "@/lib/data/finance-data";
import {
  CASHFLOW_ROWS,
  PNL_ROWS,
  computeBalanceSheet,
  computeCashFlow,
  computePnlReport,
  type Granularity,
  type PnlKey,
} from "@/lib/finance/engine";
import { getUsdHnlRate } from "@/lib/fx";
import { todayIn } from "@/lib/today";
import { formatDate, formatPct } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, Panel, Empty } from "@/components/crud/page-header";
import { ReportFilters, ReportTabs } from "@/components/reports/report-filters";
import { PnlTable } from "@/components/reports/pnl-table";
import { cn } from "@/lib/utils";

const VIEW_TO_G: Record<string, Granularity> = { mes: "month", trimestre: "quarter", anio: "year" };
const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const isMonth = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}$/.test(v);
const lastDay = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`;
};

function Change({ now, before, label, money }: { now: number; before: number | undefined | null; label: string; money: (v: number) => string }) {
  if (before === undefined || before === null) return <p className="text-xs text-muted-foreground">{label}: sin datos</p>;
  // Un % contra una base cero o negativa no significa nada (de −$99 a $3,787 no es "+3925%").
  if (before <= 0) {
    return (
      <p className={cn("text-xs", now > before ? "text-success" : now < before ? "text-money-out-text" : "text-muted-foreground")}>
        {label}: {before === 0 ? "sin movimiento" : money(before)} → {money(now)}
      </p>
    );
  }
  const pct = (now - before) / before;
  const Icon = pct > 0.005 ? ArrowUpRight : pct < -0.005 ? ArrowDownRight : Minus;
  return (
    <p className={cn("inline-flex items-center gap-0.5 text-xs", pct > 0.005 ? "text-success" : pct < -0.005 ? "text-money-out-text" : "text-muted-foreground")}>
      <Icon className="size-3" /> {formatPct(pct)} {label}
    </p>
  );
}

function Line({ label, value, money, strong, indent, out }: { label: string; value: number; money: (v: number) => string; strong?: boolean; indent?: boolean; out?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-1.5 text-sm", strong && "border-t pt-2 font-semibold", indent && "pl-4 text-muted-foreground")}>
      <span>{label}</span>
      <span className={cn("tabular", (out || value < 0) && value !== 0 && "text-money-out-text")}>{value === 0 && !strong ? "—" : money(value)}</span>
    </div>
  );
}

export default async function ReportesPage({ searchParams }: PageProps<"/reportes">) {
  const user = await requirePage("reports");
  const q = await searchParams;
  const report = q.reporte === "flujo" || q.reporte === "balance" ? q.reporte : "resultados";
  const view = typeof q.vista === "string" && VIEW_TO_G[q.vista] ? q.vista : "mes";
  const granularity = VIEW_TO_G[view];
  const today = todayIn();
  const currentMonth = today.slice(0, 7);
  const to = isMonth(q.hasta) ? q.hasta : currentMonth;
  const from = isMonth(q.desde) ? q.desde : granularity === "month" ? shiftMonth(to, -5) : `${to.slice(0, 4)}-01`;
  const currency = q.moneda === "HNL" ? "HNL" : "USD";

  const [data, fx] = await Promise.all([getDb().then(loadFinanceData), getUsdHnlRate()]);
  const rate = currency === "HNL" ? fx.hnlPerUsd : 1;
  const symbol = currency === "HNL" ? "L" : "$";
  const money = (v: number) => {
    const n = v * rate;
    return `${n < 0 ? "−" : ""}${symbol}${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  };
  const range = { from: from <= to ? from : to, to, granularity };
  const fxNote = currency === "HNL" ? `Convertido a lempiras con la tasa de hoy (L${fx.hnlPerUsd.toFixed(2)}).` : "En dólares, con la tasa de cada movimiento.";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Reportes" description="Estados financieros de la LLC: resultados, flujo de efectivo y balance general.">
        <ReportFilters view={view} from={from} to={to} currency={currency} hideView={report === "balance"} />
      </PageHeader>
      <AccountantPackage firstYear={2026} currentYear={Number(todayIn().slice(0, 4))} />
      <MonthClosePanel canClose={can(user.permissions, "reports", "write")} canReopen={can(user.permissions, "reports", "admin")} />
      <ReportTabs report={report} />

      {report === "resultados" &&
        (() => {
          const r = computePnlReport(data, range);
          const last = r.periods[r.periods.length - 1];
          const toPeriod = (p: (typeof r.periods)[number] | typeof r.total, key: string, label: string) => ({
            key,
            label,
            values: Object.fromEntries(PNL_ROWS.map((row) => [row.key, p[row.key]])),
            details: p.details,
            netMargin: p.netMargin,
          });
          return (
            <>
              {last && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {(
                    [
                      ["Ingreso neto", "revenue"],
                      ["Utilidad bruta", "grossProfit"],
                      ["EBITDA", "ebitda"],
                      ["Utilidad neta", "netProfit"],
                    ] as [string, PnlKey][]
                  ).map(([label, key]) => (
                    <div key={key} className="rounded-2xl border bg-surface p-4 shadow-card">
                      <p className="text-xs text-muted-foreground">
                        {label} · {last.label}
                      </p>
                      <p className={cn("font-heading text-2xl font-bold tabular", last[key] < 0 && "text-money-out-text")}>{money(last[key])}</p>
                      <div className="mt-1 flex flex-wrap gap-x-3">
                        <Change money={money} now={last[key]} before={last.prev[key]} label={granularity === "month" ? "vs mes anterior" : granularity === "quarter" ? "vs trimestre anterior" : "vs año anterior"} />
                        {granularity !== "year" && <Change money={money} now={last[key]} before={last.yoy?.[key]} label="vs año pasado" />}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Panel title="Estado de resultados (P&L)" description={`${fxNote} Toca una línea con flecha para ver su desglose.`}>
                {r.periods.length === 0 ? (
                  <Empty>Sin datos en este rango.</Empty>
                ) : (
                  <PnlTable
                    rows={PNL_ROWS}
                    periods={r.periods.map((p) => toPeriod(p, p.key, p.label))}
                    total={r.periods.length > 1 ? toPeriod(r.total, "total", "Total") : null}
                    rate={rate}
                    symbol={symbol}
                  />
                )}
              </Panel>
              {last && (
                <div className="grid gap-3 sm:grid-cols-3">
                  {(
                    [
                      ["Margen bruto", last.grossMargin],
                      ["Margen EBITDA", last.ebitdaMargin],
                      ["Margen neto", last.netMargin],
                    ] as const
                  ).map(([label, v]) => (
                    <div key={label} className="rounded-2xl border bg-surface px-4 py-3 shadow-card">
                      <p className="text-xs text-muted-foreground">
                        {label} · {last.label}
                      </p>
                      <p className="font-heading text-xl font-bold tabular">{v === null ? "—" : formatPct(v)}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          );
        })()}

      {report === "flujo" &&
        (() => {
          const f = computeCashFlow(data, range);
          const section = (title: string, rows: readonly { key: string; label: string }[], total: "operating" | "investing" | "financing") => (
            <>
              <TableRow className="bg-surface-2/50">
                <TableCell colSpan={f.periods.length + 1} className="font-semibold">
                  {title}
                </TableCell>
              </TableRow>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="sticky left-0 bg-surface pl-6 text-muted-foreground">{r.label}</TableCell>
                  {f.periods.map((p) => {
                    const v = p.rows[r.key] ?? 0;
                    return (
                      <TableCell key={p.key} className={cn("text-right tabular", v < 0 && "text-money-out-text")}>
                        {v === 0 ? "—" : money(v)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="sticky left-0 bg-surface font-medium">Flujo neto de {title.toLowerCase()}</TableCell>
                {f.periods.map((p) => (
                  <TableCell key={p.key} className={cn("text-right font-medium tabular", p[total] < 0 && "text-money-out-text")}>
                    {money(p[total])}
                  </TableCell>
                ))}
              </TableRow>
            </>
          );
          return (
            <Panel title="Flujo de efectivo (método directo)" description={`Solo cuentas bancarias de la LLC. Los payouts de Skool entran como cobros de clientes. ${fxNote}`}>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 bg-surface">Concepto</TableHead>
                      {f.periods.map((p) => (
                        <TableHead key={p.key} className="text-right whitespace-nowrap">
                          {p.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="sticky left-0 bg-surface text-muted-foreground">Caja al inicio</TableCell>
                      {f.periods.map((p) => (
                        <TableCell key={p.key} className="text-right tabular text-muted-foreground">
                          {money(p.openingCash)}
                        </TableCell>
                      ))}
                    </TableRow>
                    {section("Operación", CASHFLOW_ROWS.operating, "operating")}
                    {section("Inversión", CASHFLOW_ROWS.investing, "investing")}
                    {section("Financiamiento", CASHFLOW_ROWS.financing, "financing")}
                    <TableRow className="bg-surface-2/50">
                      <TableCell className="sticky left-0 bg-surface-2 font-semibold">Variación de caja</TableCell>
                      {f.periods.map((p) => (
                        <TableCell key={p.key} className={cn("text-right font-semibold tabular", p.netChange < 0 && "text-money-out-text")}>
                          {money(p.netChange)}
                        </TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableCell className="sticky left-0 bg-surface font-semibold">Caja al cierre</TableCell>
                      {f.periods.map((p) => (
                        <TableCell key={p.key} className="text-right font-semibold tabular">
                          {money(p.closingCash)}
                        </TableCell>
                      ))}
                    </TableRow>
                    <TableRow className="text-xs">
                      <TableCell className="sticky left-0 bg-surface text-muted-foreground">Nota: gastos pagados con aportes del dueño (no pasan por la caja)</TableCell>
                      {f.periods.map((p) => (
                        <TableCell key={p.key} className="text-right text-muted-foreground tabular">
                          {p.nonCashOwnerFunded ? money(p.nonCashOwnerFunded) : "—"}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </Panel>
          );
        })()}

      {report === "balance" &&
        (() => {
          const asOf = to >= currentMonth ? today : lastDay(to);
          const b = computeBalanceSheet(data, { asOf, hnlPerUsd: fx.hnlPerUsd });
          return (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="Activos" description={`Al ${formatDate(asOf)}`}>
                  <p className="text-xs font-medium text-muted-foreground">Efectivo en bancos</p>
                  {b.assets.cash.length === 0 ? <Line label="Sin saldo en bancos" value={0} money={money} indent /> : b.assets.cash.map((c) => <Line key={c.name} label={c.name} value={c.amount} money={money} indent />)}
                  <p className="mt-2 text-xs font-medium text-muted-foreground">Por cobrar</p>
                  {b.assets.platforms.map((c) => (
                    <Line key={c.name} label={`${c.name} (pendiente de payout)`} value={c.amount} money={money} indent />
                  ))}
                  <Line label="Cobros sin depositar" value={b.assets.receivables} money={money} indent />
                  <Line label="Total activos" value={b.assets.total} money={money} strong />
                </Panel>
                <div className="flex flex-col gap-4">
                  <Panel title="Pasivos">
                    {b.liabilities.cards.map((c) => (
                      <Line key={c.name} label={`Tarjeta ${c.name}`} value={c.amount} money={money} indent />
                    ))}
                    <Line label="Cuentas por pagar" value={b.liabilities.payables} money={money} indent />
                    {b.liabilities.debts.map((d) => (
                      <Line key={d.name} label={d.name} value={d.amount} money={money} indent />
                    ))}
                    {b.liabilities.ownerLoans !== 0 && <Line label="Préstamos de socios" value={b.liabilities.ownerLoans} money={money} indent />}
                    <Line label="Total pasivos" value={b.liabilities.total} money={money} strong />
                  </Panel>
                  <Panel title="Patrimonio">
                    <Line label="Capital social (aportes del dueño)" value={b.equity.capital} money={money} indent />
                    {b.equity.openingBalances !== 0 && <Line label="Saldos iniciales de cuentas" value={b.equity.openingBalances} money={money} indent />}
                    <Line label="Resultado de operación acumulado" value={b.equity.retained} money={money} indent />
                    {b.equity.preOperating !== 0 && <Line label="Gastos de puesta en marcha" value={-b.equity.preOperating} money={money} indent />}
                    <Line label="Retiros del dueño" value={-b.equity.draws} money={money} indent />
                    <Line label="Total patrimonio" value={b.equity.total} money={money} strong />
                  </Panel>
                </div>
              </div>
              <div
                className={cn(
                  "flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm",
                  b.difference === 0 ? "border-success/40 bg-success/10 text-success" : "border-danger/40 bg-danger/10 text-danger"
                )}
              >
                <Scale className="size-4" />
                {b.difference === 0
                  ? `Cuadra: activos ${money(b.assets.total)} = pasivos ${money(b.liabilities.total)} + patrimonio ${money(b.equity.total)}`
                  : `Diferencia de ${money(b.difference)}: revisa movimientos sin registrar.`}
              </div>
            </>
          );
        })()}
    </div>
  );
}

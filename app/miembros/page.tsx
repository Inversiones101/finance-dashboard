import Link from "next/link";
import { asc } from "drizzle-orm";
import { CalendarClock, Percent, RefreshCcw, TrendingUp, UserMinus, UserPlus, Users } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getFormOptions, type FormOptions } from "@/lib/data/options";
import { loadFinanceData } from "@/lib/data/finance-data";
import { getChurnAssumptionPct } from "@/lib/data/dashboard";
import { computeCommunity, computeMembers } from "@/lib/finance/engine";
import { CommunityMetrics } from "@/components/members/community-metrics";
import { getUsdHnlRate } from "@/lib/fx";
import { todayIn } from "@/lib/today";
import { daysUntil, formatDate, formatMoney, formatUSD } from "@/lib/format";
import { CURRENCY_OPTIONS, INTERVAL, RECURRING_OPTIONS } from "@/lib/labels";
import {
  cancelMemberAction,
  chargeMemberAction,
  deleteMemberAction,
  reactivateMemberAction,
  saveChurnAssumptionAction,
  saveMemberAction,
} from "@/lib/actions/members";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, Panel, Empty, StatPill } from "@/components/crud/page-header";
import { FormDialog } from "@/components/crud/form-dialog";
import { ConfirmButton } from "@/components/crud/confirm-button";
import { RowActions } from "@/components/crud/row-actions";
import { StatusBadge } from "@/components/crud/status-badge";
import { FieldRow, Hidden, MoneyField, SelectField, TextareaField, TextField } from "@/components/crud/fields";
import { MrrForecast } from "@/components/dashboard/mrr-forecast";
import { priceSchedules } from "@/lib/services/pricing";
import { feeFor, getSkoolFee } from "@/lib/services/platform-fee";
import type { Tx } from "@/lib/services/ledger";
import { SkoolImportDialog } from "@/components/members/skool-import-dialog";
import { cn } from "@/lib/utils";

type Member = typeof s.members.$inferSelect;

function MemberFields({ o, d, today }: { o: FormOptions; d?: Member; today: string }) {
  const recurring = o.products.filter((p) => p.defaultBillingInterval !== "one_time" || p.id === d?.productId);
  return (
    <>
      {d && <Hidden name="id" value={d.id} />}
      <FieldRow>
        <TextField label="Nombre" name="name" defaultValue={d?.name} required />
        <SelectField
          label="Plan"
          name="productId"
          options={recurring.map((p) => ({ value: p.id, label: `${p.name}${p.listPriceCents ? ` · ${formatMoney(p.listPriceCents)}` : ""}` }))}
          defaultValue={d?.productId}
          placeholder="Elige…"
          required
        />
      </FieldRow>
      <FieldRow>
        <SelectField label="Frecuencia de cobro" name="billingInterval" options={RECURRING_OPTIONS} defaultValue={d?.billingInterval ?? "monthly"} />
        <MoneyField label="Precio del plan" name="priceCents" defaultCents={d?.priceCents} required hint="Lo que paga este miembro (conserva su precio aunque el plan suba). Es la base del MRR." />
      </FieldRow>
      <FieldRow>
        <TextField label="Miembro desde" name="startedOn" type="date" defaultValue={d?.startedOn ?? today} required />
        <TextField label="Próxima renovación" name="currentPeriodEnd" type="date" defaultValue={d?.currentPeriodEnd} hint="Vacío = se calcula con la frecuencia." />
      </FieldRow>
      <SelectField label="Moneda" name="currency" options={CURRENCY_OPTIONS} defaultValue={d?.currency ?? "USD"} />
      <TextareaField label="Notas" name="notes" defaultValue={d?.notes} />
    </>
  );
}

const FILTERS = [
  { value: "activos", label: "Activos" },
  { value: "bajas", label: "Bajas" },
  { value: "todos", label: "Todos" },
];

export default async function MiembrosPage({ searchParams }: PageProps<"/miembros">) {
  const user = await requirePage("revenue");
  const canWrite = can(user.permissions, "revenue", "write");
  const canAdmin = can(user.permissions, "revenue", "admin");
  const today = todayIn();
  const { estado, vista } = await searchParams;
  const view = vista === "metricas" ? "metricas" : "miembros";
  const filter = typeof estado === "string" && FILTERS.some((f) => f.value === estado) ? estado : "activos";

  const db = await getDb();
  const [o, rows, data, fx, churnPct, prices, skoolFee] = await Promise.all([
    getFormOptions(),
    db.select().from(s.members).orderBy(asc(s.members.name)),
    loadFinanceData(db),
    getUsdHnlRate(),
    getChurnAssumptionPct(),
    priceSchedules(db as unknown as Tx, today),
    getSkoolFee(db as unknown as Tx),
  ]);
  const m = computeMembers(data, { asOf: today, hnlPerUsd: fx.hnlPerUsd, churnAssumption: churnPct / 100 });
  const metrics = view === "metricas" ? computeCommunity(data, { asOf: today, hnlPerUsd: fx.hnlPerUsd, churnAssumption: churnPct / 100 }) : null;
  const counts = (x: Member) => x.status === "active" || (!!x.accessUntil && x.accessUntil > today);
  const shown = rows.filter((x) => (filter === "activos" ? counts(x) : filter === "bajas" ? x.status === "canceled" : true));
  const defaultDeposit = o.platforms.find((p) => p.status === "active")?.id;
  const productName = new Map(o.products.map((p) => [p.id, p.name]));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Miembros y MRR"
        description="Tu MRR sale de aquí: la suma de los planes activos. Da de baja a quien cancele (deja de contar al terminar su periodo pagado) y reactívalo si vuelve."
      >
        {canWrite && <SkoolImportDialog />}
        {canWrite && (
          <FormDialog title="Nuevo miembro" action={saveMemberAction} wide trigger={<Button><UserPlus className="size-4" /> Nuevo miembro</Button>}>
            <MemberFields o={o} today={today} />
          </FormDialog>
        )}
      </PageHeader>

      <nav className="flex w-fit rounded-full border bg-surface-2 p-0.5 text-sm" aria-label="Vista">
        {[
          { value: "miembros", label: "Miembros", href: "/miembros" },
          { value: "metricas", label: "Métricas", href: "/miembros?vista=metricas" },
        ].map((v) => (
          <Link
            key={v.value}
            href={v.href}
            aria-current={view === v.value ? "page" : undefined}
            className={cn("rounded-full px-4 py-1.5", view === v.value ? "bg-surface font-medium shadow-card" : "text-muted-foreground")}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {metrics ? (
        <CommunityMetrics m={metrics} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatPill label="MRR" value={formatUSD(m.mrr / 100)} tone="in" icon={TrendingUp} hint={`ARR ${formatUSD((m.mrr * 12) / 100)}`} />
            <StatPill label="Miembros activos" value={String(m.activeCount)} icon={Users} hint={`${m.byInterval.monthly} mensuales · ${m.byInterval.annual} anuales`} />
            <StatPill label="Bajas este mes" value={String(m.canceledThisMonth)} icon={UserMinus} tone={m.canceledThisMonth ? "out" : "neutral"} />
            <StatPill
              label="Churn mensual"
              value={`${(m.churnUsed * 100).toFixed(1)}%`}
              icon={Percent}
              hint={m.churnIsAssumption ? "Supuesto (aún no hay historial)" : "Real, últimos 3 meses"}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Panel
                title="Miembros"
                actions={
                  <div className="flex rounded-full border bg-surface-2 p-0.5 text-xs">
                    {FILTERS.map((f) => (
                      <Link key={f.value} href={`/miembros?estado=${f.value}`} className={cn("rounded-full px-3 py-1", filter === f.value ? "bg-surface font-medium shadow-card" : "text-muted-foreground")}>
                        {f.label}
                      </Link>
                    ))}
                  </div>
                }
              >
                {shown.length === 0 ? (
                  <Empty>{rows.length === 0 ? "Aún no hay miembros. Se crean solos al registrar un ingreso recurrente con nombre de cliente." : "Nadie en esta lista."}</Empty>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Miembro</TableHead>
                          <TableHead>Plan</TableHead>
                          <TableHead>Renovación</TableHead>
                          <TableHead className="text-right">MRR</TableHead>
                          <TableHead className="w-32" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {shown.map((x) => {
                          const monthly = x.billingInterval === "annual" ? x.priceCents / 12 : x.billingInterval === "quarterly" ? x.priceCents / 3 : x.priceCents;
                          const days = daysUntil(x.currentPeriodEnd, today);
                          const active = x.status === "active";
                          return (
                            <TableRow key={x.id} className={cn(!counts(x) && "opacity-60")}>
                              <TableCell>
                                <p className="font-medium">{x.name}</p>
                                <p className="text-xs text-muted-foreground">{x.email ? `${x.email} · ` : ""}desde {formatDate(x.startedOn)}</p>
                              </TableCell>
                              <TableCell>
                                <p>{productName.get(x.productId)}</p>
                                <p className="text-xs text-muted-foreground">
                                  {formatMoney(x.priceCents, x.currency)} · {INTERVAL[x.billingInterval].toLowerCase()}
                                  {(() => {
                                    // Entró con un precio menor al vigente y lo conserva.
                                    const now = prices.get(x.productId)?.current;
                                    return now != null && x.priceCents < now ? (
                                      <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground" title={`Hoy el plan cuesta ${formatMoney(now)}`}>
                                        precio anterior
                                      </span>
                                    ) : null;
                                  })()}
                                </p>
                              </TableCell>
                              <TableCell>
                                {active ? (
                                  <>
                                    <p>{formatDate(x.currentPeriodEnd)}</p>
                                    <p className={cn("text-xs", days < 0 ? "text-danger" : days <= 7 ? "text-warning" : "text-muted-foreground")}>
                                      {days < 0 ? `vencida hace ${-days} días` : days === 0 ? "hoy" : `en ${days} días`}
                                    </p>
                                  </>
                                ) : (
                                  <>
                                    <StatusBadge label="Baja" tone="bad" />
                                    <p className="mt-0.5 text-xs text-muted-foreground">
                                      {x.accessUntil && x.accessUntil > today ? `cuenta hasta ${formatDate(x.accessUntil)}` : `desde ${formatDate(x.canceledOn)}`}
                                    </p>
                                  </>
                                )}
                              </TableCell>
                              <TableCell className={cn("text-right font-medium tabular", !counts(x) && "line-through")}>{formatMoney(Math.round(monthly), x.currency)}</TableCell>
                              <TableCell>
                                <RowActions
                                  canEdit={canWrite}
                                  canDelete={canAdmin}
                                  wide
                                  editTitle={`Editar ${x.name}`}
                                  editAction={saveMemberAction}
                                  editFields={<MemberFields o={o} d={x} today={today} />}
                                  deleteAction={deleteMemberAction.bind(null, x.id)}
                                  deleteLabel={`a ${x.name}`}
                                  extra={
                                    canWrite ? (
                                      active ? (
                                        <>
                                          <FormDialog
                                            title={`Renovación de ${x.name}`}
                                            description="Registra el cobro como ingreso y adelanta su próxima renovación."
                                            action={chargeMemberAction}
                                            submitLabel="Registrar cobro"
                                            trigger={<Button variant="ghost" size="icon" className="size-8" aria-label="Registrar renovación" title="Registrar renovación"><RefreshCcw className="size-3.5" /></Button>}
                                          >
                                            <Hidden name="id" value={x.id} />
                                            <FieldRow>
                                              <TextField label="Fecha del cobro" name="date" type="date" defaultValue={x.currentPeriodEnd <= today ? x.currentPeriodEnd : today} required />
                                              <MoneyField label="Monto cobrado" name="grossCents" defaultCents={x.priceCents} required />
                                            </FieldRow>
                                            <FieldRow>
                                              <MoneyField label="Comisión de la plataforma" name="processorFeeCents" defaultCents={feeFor(x.priceCents, skoolFee) || undefined} hint={skoolFee ? `Skool: ${skoolFee.pct}% + ${formatMoney(skoolFee.fixedCents)}` : undefined} />
                                              <MoneyField label="Comisión de afiliados" name="affiliateFeeCents" />
                                            </FieldRow>
                                            <SelectField label="¿Dónde cayó el dinero?" name="depositAccountId" options={o.depositAccounts} defaultValue={defaultDeposit} />
                                          </FormDialog>
                                          <FormDialog
                                            title={`Dar de baja a ${x.name}`}
                                            description="Deja de sumar al MRR y al pronóstico. Si vuelve, lo reactivas con un clic."
                                            action={cancelMemberAction}
                                            submitLabel="Dar de baja"
                                            trigger={<Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-danger" aria-label="Dar de baja" title="Dar de baja"><UserMinus className="size-3.5" /></Button>}
                                          >
                                            <Hidden name="id" value={x.id} />
                                            <TextField label="Fecha de la cancelación" name="date" type="date" defaultValue={today} required />
                                            <SelectField
                                              label="¿Desde cuándo deja de contar?"
                                              name="when"
                                              options={[
                                                { value: "period_end", label: `Al terminar lo que ya pagó (${formatDate(x.currentPeriodEnd)})` },
                                                { value: "now", label: "Desde ya" },
                                              ]}
                                              defaultValue="period_end"
                                            />
                                          </FormDialog>
                                        </>
                                      ) : (
                                        <ConfirmButton
                                          title={`¿Reactivar a ${x.name}?`}
                                          description="Vuelve a sumar al MRR. Si su periodo ya venció, empieza uno nuevo hoy."
                                          confirmLabel="Reactivar"
                                          action={reactivateMemberAction.bind(null, x.id, today)}
                                          trigger={<Button variant="ghost" size="icon" className="size-8" aria-label="Reactivar" title="Reactivar"><UserPlus className="size-3.5" /></Button>}
                                        />
                                      )
                                    ) : null
                                  }
                                />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Panel>
            </div>

            <div className="flex flex-col gap-4">
              <MrrForecast points={m.forecast} churn={m.churnUsed} isAssumption={m.churnIsAssumption} active={m.activeCount} />
              <Panel title="Supuesto de churn" description="Se usa para el pronóstico mientras no haya historial de bajas. Con historial, se usa el real.">
                <p className="text-sm">
                  Actual: <span className="font-semibold">{churnPct}% mensual</span>
                </p>
                {canWrite && (
                  <FormDialog title="Churn supuesto" action={saveChurnAssumptionAction} trigger={<Button variant="outline" size="sm" className="mt-3"><Percent className="size-4" /> Cambiar</Button>}>
                    <TextField label="Churn mensual (%)" name="pct" type="number" defaultValue={churnPct} required />
                  </FormDialog>
                )}
              </Panel>
              {m.renewalsSoon.length > 0 && (
                <Panel title="Renovaciones anuales próximas" description="Buen momento para escribirles.">
                  <ul className="flex flex-col gap-2 text-sm">
                    {m.renewalsSoon.map((r) => (
                      <li key={r.name} className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <CalendarClock className="size-3.5 text-muted-foreground" /> {r.name}
                        </span>
                        <span className="text-muted-foreground">{formatDate(r.date)}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

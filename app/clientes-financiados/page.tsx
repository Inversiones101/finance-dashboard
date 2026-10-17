import { asc, desc, eq, inArray } from "drizzle-orm";
import { AlertTriangle, CalendarClock, CheckCircle2, CircleDashed, DownloadCloud, HandCoins, ListChecks, Users, X } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { stripeConfigured, webhookConfigured } from "@/lib/stripe/client";
import { GRACE_DAYS, levelLabel } from "@/lib/services/stripe-sync";
import { completeAccessTaskAction, dismissAccessTaskAction, importStripeHistoryAction, setConfirmedLevelAction } from "@/lib/actions/stripe";
import { todayIn } from "@/lib/today";
import { daysUntil, formatDate, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Empty, StatPill } from "@/components/crud/page-header";
import { StatusBadge } from "@/components/crud/status-badge";
import { ActionButton } from "@/components/crud/action-button";
import { ConfirmButton } from "@/components/crud/confirm-button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "good" | "warn" | "bad" | "muted" | "info" }> = {
  al_dia: { label: "Al día", tone: "good" },
  pendiente: { label: "Pago pendiente", tone: "warn" },
  fallido: { label: "Pago fallido", tone: "bad" },
  vencido: { label: "Vencido", tone: "bad" },
  completado: { label: "Completado", tone: "info" },
  cancelado: { label: "Cancelado", tone: "muted" },
};
const INSTALLMENT: Record<string, string> = { pagada: "bg-success text-white", fallida: "bg-danger text-white", reembolsada: "bg-muted-foreground/40 text-white", pendiente: "border border-dashed" };

export default async function ClientesFinanciadosPage() {
  const user = await requirePage("revenue");
  const canWrite = can(user.permissions, "revenue", "write");
  const today = todayIn();
  const db = await getDb();
  const contracts = await db
    .select({ c: s.customerContracts, m: s.members, p: s.products })
    .from(s.customerContracts)
    .innerJoin(s.members, eq(s.members.id, s.customerContracts.memberId))
    .innerJoin(s.products, eq(s.products.id, s.customerContracts.productId))
    .orderBy(asc(s.customerContracts.nextDueDate), desc(s.customerContracts.createdAt));
  const ids = contracts.map((r) => r.c.id);
  const [installments, tasks] = ids.length
    ? await Promise.all([
        db.select().from(s.contractInstallments).where(inArray(s.contractInstallments.contractId, ids)).orderBy(asc(s.contractInstallments.number)),
        db.select().from(s.accessTasks).where(inArray(s.accessTasks.contractId, ids)).orderBy(desc(s.accessTasks.createdAt)),
      ])
    : [[], []];

  const paidOf = (id: string) => installments.filter((i) => i.contractId === id && i.status === "pagada").reduce((a, i) => a + i.amountCents, 0);
  const open = contracts.filter((r) => !["completado", "cancelado"].includes(r.c.status));
  const scheduled = open.reduce((a, r) => a + Math.max(0, r.c.totalCents - paidOf(r.c.id)), 0);
  const overdue = installments.filter((i) => i.status === "fallida").reduce((a, i) => a + i.amountCents, 0);
  const next = open.filter((r) => r.c.nextDueDate).sort((a, b) => a.c.nextDueDate!.localeCompare(b.c.nextDueDate!))[0];
  const pending = tasks.filter((t) => t.status === "pendiente");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Clientes financiados"
        description="Membresías pagadas en cuotas con Stripe. Los estados solo cambian cuando Stripe confirma un pago; el acceso en Skool solo cambia cuando confirmas que lo hiciste."
      >
        {canWrite && stripeConfigured() && (
          <ActionButton action={importStripeHistoryAction} variant="outline" pendingLabel="Leyendo Stripe…">
            <DownloadCloud className="size-4" /> Importar historial de Stripe
          </ActionButton>
        )}
      </PageHeader>

      {(!stripeConfigured() || !webhookConfigured()) && (
        <Panel title="Conectar Stripe" description="Solo lectura: el sistema no hace cobros. Las claves quedan en Vercel, nunca aquí.">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li className={cn(stripeConfigured() && "text-muted-foreground line-through")}>Guarda tu clave secreta de Stripe en Vercel como STRIPE_SECRET_KEY.</li>
            <li className={cn(webhookConfigured() && "text-muted-foreground line-through")}>
              En Stripe → Desarrolladores → Webhooks, agrega el destino https://finance.inversiones101.lat/api/webhooks/stripe y guarda su secreto como STRIPE_WEBHOOK_SECRET.
            </li>
            <li>En Catálogos → Productos, enlaza el producto de Stripe y pon el número de cuotas y los niveles de acceso.</li>
          </ol>
        </Panel>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatPill label="Clientes financiados" value={String(open.length)} icon={Users} hint={`${contracts.length - open.length} terminados o cancelados`} />
        <StatPill label="Por cobrar programado" value={formatMoney(scheduled)} icon={HandCoins} tone="in" hint="Cuotas futuras: aún no es dinero ni ingreso" />
        <StatPill label="Cuotas vencidas" value={formatMoney(overdue)} icon={AlertTriangle} tone={overdue ? "out" : "neutral"} hint={overdue ? `Gracia de ${GRACE_DAYS} días antes de restringir` : "Ninguna"} />
        <StatPill
          label="Próximo cobro"
          value={next ? formatDate(next.c.nextDueDate) : "—"}
          icon={CalendarClock}
          hint={next ? `${next.m.name} · ${daysUntil(next.c.nextDueDate!, today) <= 0 ? "hoy" : `en ${daysUntil(next.c.nextDueDate!, today)} días`}` : "Sin cobros programados"}
        />
      </div>

      {pending.length > 0 && (
        <Panel title={`Tareas en Skool (${pending.length})`} description="Hazlas en Skool y confirma aquí. El nivel de acceso del cliente solo cambia al confirmar." actions={<ListChecks className="size-4 text-muted-foreground" />}>
          <ul className="divide-y">
            {pending.map((t) => (
              <li key={t.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.detail} · {formatDate(t.createdAt.toISOString().slice(0, 10))}
                  </p>
                </div>
                {canWrite && (
                  <div className="flex shrink-0 gap-1.5">
                    <ConfirmButton
                      title="¿Ya lo hiciste en Skool?"
                      description="Confirma solo si el cambio ya está hecho en Skool. Queda registrado quién lo confirmó."
                      confirmLabel="Sí, ya está hecho"
                      action={completeAccessTaskAction.bind(null, t.id)}
                      trigger={
                        <Button size="sm">
                          <CheckCircle2 className="size-3.5" /> Hecho en Skool
                        </Button>
                      }
                    />
                    <ActionButton action={dismissAccessTaskAction.bind(null, t.id)} size="sm" variant="ghost" aria-label="Descartar">
                      <X className="size-3.5" />
                    </ActionButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Contratos">
        {contracts.length === 0 ? (
          <Empty>Aún no hay clientes financiados. Aparecen solos cuando Stripe confirma la primera cuota de un producto con cuotas.</Empty>
        ) : (
          <div className="flex flex-col divide-y">
            {contracts.map(({ c, m, p }) => {
              const own = installments.filter((i) => i.contractId === c.id);
              const paid = paidOf(c.id);
              const st = STATUS[c.status];
              return (
                <details key={c.id} className="group py-3">
                  <summary className="flex cursor-pointer list-none flex-col gap-2 md:flex-row md:items-center md:gap-4">
                    <div className="min-w-0 md:w-56">
                      <p className="truncate font-medium">{m.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{m.email ?? "sin correo"}</p>
                    </div>
                    <div className="flex items-center gap-1" aria-label={`${own.filter((i) => i.status === "pagada").length} de ${c.installments} cuotas pagadas`}>
                      {Array.from({ length: c.installments }, (_, k) => {
                        const i = own.find((x) => x.number === k + 1);
                        return (
                          <span key={k} title={i ? `Cuota ${k + 1}: ${i.status}` : `Cuota ${k + 1}: programada`} className={cn("flex size-6 items-center justify-center rounded-full text-[11px] font-semibold", INSTALLMENT[i?.status ?? "pendiente"])}>
                            {k + 1}
                          </span>
                        );
                      })}
                    </div>
                    <div className="text-sm tabular md:w-44">
                      <span className="font-semibold">{formatMoney(paid)}</span>
                      <span className="text-muted-foreground"> de {formatMoney(c.totalCents)}</span>
                      <p className="text-xs text-muted-foreground">Saldo {formatMoney(Math.max(0, c.totalCents - paid))}</p>
                    </div>
                    <div className="text-sm md:w-36">
                      {c.nextDueDate ? (
                        <>
                          <p>{formatDate(c.nextDueDate)}</p>
                          <p className="text-xs text-muted-foreground">próximo cobro</p>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">Sin cobros pendientes</p>
                      )}
                    </div>
                    <div className="flex flex-1 flex-wrap items-center gap-2 md:justify-end">
                      <StatusBadge label={st.label} tone={st.tone} />
                      <span className="text-xs text-muted-foreground">
                        Acceso: {c.accessLevelConfirmed ? levelLabel(p, c.accessLevelConfirmed) : "sin confirmar"}
                      </span>
                    </div>
                  </summary>

                  <div className="mt-3 grid gap-4 rounded-2xl bg-surface-2/50 p-4 text-sm lg:grid-cols-3">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                      <dt className="text-muted-foreground">Producto</dt>
                      <dd>{p.name}</dd>
                      <dt className="text-muted-foreground">Acceso anual</dt>
                      <dd>
                        {formatDate(c.accessStart)} → {formatDate(c.accessEnd)}
                      </dd>
                      <dt className="text-muted-foreground">Cliente Stripe</dt>
                      <dd className="font-mono">{c.stripeCustomerId ?? "—"}</dd>
                      <dt className="text-muted-foreground">Suscripción</dt>
                      <dd className="font-mono">{c.stripeSubscriptionId ?? "—"}</dd>
                      {c.failedSince && (
                        <>
                          <dt className="text-muted-foreground">Sin pagar desde</dt>
                          <dd className="text-danger">{formatDate(c.failedSince)}</dd>
                        </>
                      )}
                    </dl>
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Cuotas</p>
                      <ul className="flex flex-col gap-1 text-xs">
                        {own.length === 0 && <li className="text-muted-foreground">Sin cuotas registradas.</li>}
                        {own.map((i) => (
                          <li key={i.id} className="flex justify-between gap-2">
                            <span>
                              Cuota {i.number} · {i.status}
                              {i.attempts > 1 && ` · ${i.attempts} intentos`}
                            </span>
                            <span className="tabular">
                              {formatMoney(i.amountCents)} · {i.paidAt ? formatDate(i.paidAt.toISOString().slice(0, 10)) : i.dueDate ? formatDate(i.dueDate) : "—"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Nivel de acceso confirmado en Skool</p>
                      <div className="flex flex-wrap gap-1.5">
                        {Array.from({ length: c.installments + 1 }, (_, lvl) => (
                          <ConfirmButton
                            key={lvl}
                            title={lvl ? `¿Ya tiene "${levelLabel(p, lvl)}" en Skool?` : "¿Sin acceso en Skool?"}
                            description="Registra el nivel que el cliente tiene hoy en Skool (por ejemplo, si ya le diste acceso antes de conectar Stripe)."
                            confirmLabel="Registrar"
                            action={setConfirmedLevelAction.bind(null, c.id, lvl)}
                            trigger={
                              <button
                                type="button"
                                disabled={!canWrite}
                                className={cn("rounded-full border px-2.5 py-1 text-xs", lvl === c.accessLevelConfirmed ? "bg-highlight text-highlight-foreground" : "text-muted-foreground hover:bg-surface")}
                              >
                                {lvl ? levelLabel(p, lvl) : "Sin acceso"}
                              </button>
                            }
                          />
                        ))}
                      </div>
                      <ul className="mt-3 flex flex-col gap-1 text-xs text-muted-foreground">
                        {tasks
                          .filter((t) => t.contractId === c.id && t.status !== "pendiente")
                          .slice(0, 4)
                          .map((t) => (
                            <li key={t.id} className="flex items-center gap-1.5">
                              {t.status === "hecha" ? <CheckCircle2 className="size-3 text-success" /> : <CircleDashed className="size-3" />}
                              {t.title.split(" — ")[0]} · {t.status}
                              {t.doneAt && ` ${formatDate(t.doneAt.toISOString().slice(0, 10))}`}
                            </li>
                          ))}
                      </ul>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

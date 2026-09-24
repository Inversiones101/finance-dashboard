import { asc } from "drizzle-orm";
import { CalendarClock, Layers, Plus, Receipt, Repeat } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getFormOptions, type FormOptions } from "@/lib/data/options";
import { todayIn } from "@/lib/today";
import { getUsdHnlRate } from "@/lib/fx";
import { daysUntil, formatDate, formatMoney } from "@/lib/format";
import { INTERVAL, RECURRING_OPTIONS, CURRENCY_OPTIONS, SUB_STATUS, toOptions } from "@/lib/labels";
import { chargeSubscriptionAction, deleteSubscriptionAction, saveSubscriptionAction } from "@/lib/actions/subscriptions";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, Panel, Empty, StatPill } from "@/components/crud/page-header";
import { FormDialog } from "@/components/crud/form-dialog";
import { RowActions } from "@/components/crud/row-actions";
import { StatusBadge } from "@/components/crud/status-badge";
import { FieldRow, Hidden, MoneyField, SelectField, TextareaField, TextField } from "@/components/crud/fields";

type Sub = typeof s.subscriptions.$inferSelect;
const MONTHS = { one_time: 0, monthly: 1, quarterly: 3, annual: 12 } as const;

function SubscriptionFields({ o, d, today }: { o: FormOptions; d?: Sub; today: string }) {
  return (
    <>
      {d && <Hidden name="id" value={d.id} />}
      <FieldRow>
        <TextField label="Nombre" name="name" defaultValue={d?.name} required placeholder="Ej. Claude Max" />
        <TextField label="Proveedor" name="vendorName" defaultValue={d ? o.names.counterparty.get(d.vendorId) : undefined} required placeholder="Ej. Anthropic" />
      </FieldRow>
      <FieldRow>
        <MoneyField label="Monto" name="amountCents" defaultCents={d?.amountCents} required />
        <SelectField label="Moneda" name="currency" options={CURRENCY_OPTIONS} defaultValue={d?.currency ?? "USD"} />
      </FieldRow>
      <FieldRow>
        <SelectField label="Frecuencia" name="billingInterval" options={RECURRING_OPTIONS} defaultValue={d?.billingInterval ?? "monthly"} />
        <SelectField label="Categoría" name="categoryId" options={o.expenseCategories} defaultValue={d?.categoryId} placeholder="Elige…" required />
      </FieldRow>
      <FieldRow>
        <TextField label="Inicio" name="startedOn" type="date" defaultValue={d?.startedOn ?? today} required />
        <TextField label="Próxima renovación" name="nextRenewalOn" type="date" defaultValue={d?.nextRenewalOn} required />
      </FieldRow>
      <FieldRow>
        <SelectField
          label="Se cobra en"
          name="defaultPaymentAccountId"
          options={o.paymentAccounts}
          defaultValue={d ? o.paymentValue(d.defaultPaymentAccountId) : undefined}
          placeholder="Elige…"
          required
        />
        <SelectField label="Estado" name="status" options={toOptions(SUB_STATUS)} defaultValue={d?.status ?? "active"} />
      </FieldRow>
      <TextareaField label="Notas" name="notes" defaultValue={d?.notes} />
    </>
  );
}

export default async function SuscripcionesPage() {
  const user = await requirePage("subscriptions");
  const canWrite = can(user.permissions, "subscriptions", "write");
  const canAdmin = can(user.permissions, "subscriptions", "admin");
  const today = todayIn();
  const db = await getDb();
  const [o, subs, fx] = await Promise.all([getFormOptions(), db.select().from(s.subscriptions).orderBy(asc(s.subscriptions.nextRenewalOn)), getUsdHnlRate()]);

  const active = subs.filter((x) => x.status === "active");
  const monthlyUsd = active.reduce((a, x) => a + (x.currency === "USD" ? x.amountCents : x.amountCents / fx.hnlPerUsd) / MONTHS[x.billingInterval], 0);
  const next30 = active.filter((x) => daysUntil(x.nextRenewalOn, today) <= 30).reduce((a, x) => a + x.amountCents, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Suscripciones" description="Pagos recurrentes de herramientas y plataformas. Cuando llegue el cobro, regístralo con un clic: se crea el gasto y avanza la renovación.">
        {canWrite && (
          <FormDialog title="Nueva suscripción" action={saveSubscriptionAction} wide trigger={<Button><Plus className="size-4" /> Nueva suscripción</Button>}>
            <SubscriptionFields o={o} today={today} />
          </FormDialog>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatPill label="Activas" value={String(active.length)} icon={Layers} />
        <StatPill label="Costo mensual equivalente" value={formatMoney(Math.round(monthlyUsd))} tone="out" icon={Repeat} />
        <StatPill label="Por renovar en 30 días" value={formatMoney(next30)} icon={CalendarClock} />
      </div>

      <Panel>
        {subs.length === 0 ? (
          <Empty>Aún no hay suscripciones.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Suscripción</TableHead>
                  <TableHead>Frecuencia</TableHead>
                  <TableHead>Se cobra en</TableHead>
                  <TableHead>Próxima renovación</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {subs.map((x) => {
                  const days = daysUntil(x.nextRenewalOn, today);
                  return (
                    <TableRow key={x.id}>
                      <TableCell>
                        <p className="font-medium">{x.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {o.names.counterparty.get(x.vendorId)} · {o.names.category.get(x.categoryId)}
                        </p>
                      </TableCell>
                      <TableCell>{INTERVAL[x.billingInterval]}</TableCell>
                      <TableCell>{o.accountName(x.defaultPaymentAccountId)}</TableCell>
                      <TableCell>
                        {x.status === "active" ? (
                          <>
                            <p>{formatDate(x.nextRenewalOn)}</p>
                            <p className={`text-xs ${days < 0 ? "text-danger" : "text-muted-foreground"}`}>
                              {days < 0 ? `hace ${-days} días, ¿ya se cobró?` : days === 0 ? "hoy" : `en ${days} días`}
                            </p>
                          </>
                        ) : (
                          <StatusBadge label={SUB_STATUS[x.status]} />
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap text-money-out-text tabular">{formatMoney(x.amountCents, x.currency)}</TableCell>
                      <TableCell>
                        <RowActions
                          canEdit={canWrite}
                          canDelete={canAdmin}
                          wide
                          editTitle="Editar suscripción"
                          editAction={saveSubscriptionAction}
                          editFields={<SubscriptionFields o={o} d={x} today={today} />}
                          deleteAction={deleteSubscriptionAction.bind(null, x.id)}
                          deleteLabel={`la suscripción ${x.name}`}
                          extra={
                            canWrite && x.status === "active" ? (
                              <FormDialog
                                title={`Registrar cobro de ${x.name}`}
                                description="Crea el gasto con los datos de la suscripción y mueve la próxima renovación."
                                action={chargeSubscriptionAction}
                                submitLabel="Registrar cobro"
                                trigger={
                                  <Button variant="ghost" size="icon" className="size-8" aria-label="Registrar cobro" title="Registrar cobro">
                                    <Receipt className="size-3.5" />
                                  </Button>
                                }
                              >
                                <Hidden name="id" value={x.id} />
                                <TextField label="Fecha del cobro" name="date" type="date" defaultValue={x.nextRenewalOn <= today ? x.nextRenewalOn : today} required />
                                <SelectField label="Se cobró en" name="accountId" options={o.paymentAccounts} defaultValue={o.paymentValue(x.defaultPaymentAccountId)} />
                              </FormDialog>
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
  );
}

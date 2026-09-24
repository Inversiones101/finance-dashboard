import { asc } from "drizzle-orm";
import { Banknote, Plus } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getFormOptions, type FormOptions } from "@/lib/data/options";
import { todayIn } from "@/lib/today";
import { daysUntil, formatDate, formatMoney } from "@/lib/format";
import { CURRENCY_OPTIONS, TAX_STATUS, toOptions } from "@/lib/labels";
import { deleteTaxAction, payTaxAction, saveTaxAction } from "@/lib/actions/taxes";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, Panel, Empty } from "@/components/crud/page-header";
import { FormDialog } from "@/components/crud/form-dialog";
import { RowActions } from "@/components/crud/row-actions";
import { StatusBadge } from "@/components/crud/status-badge";
import { FieldRow, Hidden, MoneyField, SelectField, TextareaField, TextField } from "@/components/crud/fields";

type Tax = typeof s.taxObligations.$inferSelect;

function TaxFields({ o, d }: { o: FormOptions; d?: Tax }) {
  return (
    <>
      {d && <Hidden name="id" value={d.id} />}
      <TextField label="Obligación" name="name" defaultValue={d?.name} required placeholder="Ej. Form 5472 + 1120 pro forma" />
      <FieldRow>
        <TextField label="Autoridad" name="authorityName" defaultValue={d?.authorityId ? o.names.counterparty.get(d.authorityId) : undefined} required placeholder="Ej. IRS" />
        <TextField label="Jurisdicción" name="jurisdiction" defaultValue={d?.jurisdiction} required placeholder="US-FED, US-WY, HN" />
      </FieldRow>
      <FieldRow>
        <TextField label="Periodo desde" name="periodStart" type="date" defaultValue={d?.periodStart} />
        <TextField label="Periodo hasta" name="periodEnd" type="date" defaultValue={d?.periodEnd} />
      </FieldRow>
      <FieldRow>
        <TextField label="Fecha límite" name="dueDate" type="date" defaultValue={d?.dueDate} required />
        <SelectField label="Estado" name="status" options={toOptions(TAX_STATUS)} defaultValue={d?.status ?? "upcoming"} />
      </FieldRow>
      <FieldRow>
        <MoneyField label="Monto estimado" name="estimatedCents" defaultCents={d?.estimatedCents} hint="0 si solo hay que presentarla." />
        <SelectField label="Moneda" name="currency" options={CURRENCY_OPTIONS} defaultValue={d?.currency ?? "USD"} />
      </FieldRow>
      <TextField label="Presentada el" name="filedOn" type="date" defaultValue={d?.filedOn} />
      <TextareaField label="Notas" name="notes" defaultValue={d?.notes} />
    </>
  );
}

export default async function ImpuestosPage() {
  const user = await requirePage("taxes");
  const canWrite = can(user.permissions, "taxes", "write");
  const canAdmin = can(user.permissions, "taxes", "admin");
  const today = todayIn();
  const db = await getDb();
  const [o, rows] = await Promise.all([getFormOptions(), db.select().from(s.taxObligations).orderBy(asc(s.taxObligations.dueDate))]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Impuestos y obligaciones" description="Declaraciones, reportes anuales y pagos. Informativo: confirma fechas y montos con doola o tu contador.">
        {canWrite && (
          <FormDialog title="Nueva obligación" action={saveTaxAction} wide trigger={<Button><Plus className="size-4" /> Nueva obligación</Button>}>
            <TaxFields o={o} />
          </FormDialog>
        )}
      </PageHeader>

      <Panel>
        {rows.length === 0 ? (
          <Empty>Sin obligaciones registradas.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Obligación</TableHead>
                  <TableHead>Vence</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Estimado</TableHead>
                  <TableHead className="text-right">Pagado</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => {
                  const days = daysUntil(t.dueDate, today);
                  const open = !["paid", "filed", "not_required"].includes(t.status);
                  return (
                    <TableRow key={t.id}>
                      <TableCell>
                        <p className="font-medium">{t.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {t.jurisdiction}
                          {t.authorityId && ` · ${o.names.counterparty.get(t.authorityId)}`}
                        </p>
                        {t.notes && <p className="mt-0.5 max-w-md text-xs text-muted-foreground">{t.notes}</p>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(t.dueDate)}
                        {open && <p className={`text-xs ${days < 30 ? "text-warning" : "text-muted-foreground"}`}>{days < 0 ? `vencida hace ${-days} días` : `en ${days} días`}</p>}
                      </TableCell>
                      <TableCell>
                        <StatusBadge label={TAX_STATUS[t.status]} tone={t.status === "paid" || t.status === "filed" ? "good" : t.status === "overdue" ? "bad" : t.status === "not_required" ? "muted" : "info"} />
                      </TableCell>
                      <TableCell className="text-right tabular">{t.estimatedCents ? formatMoney(t.estimatedCents, t.currency) : "—"}</TableCell>
                      <TableCell className="text-right tabular">{t.paidCents ? formatMoney(t.paidCents, t.currency) : "—"}</TableCell>
                      <TableCell>
                        <RowActions
                          canEdit={canWrite}
                          canDelete={canAdmin}
                          wide
                          editTitle="Editar obligación"
                          editAction={saveTaxAction}
                          editFields={<TaxFields o={o} d={t} />}
                          deleteAction={deleteTaxAction.bind(null, t.id)}
                          deleteLabel="esta obligación"
                          extra={
                            canWrite && open ? (
                              <FormDialog
                                title={`Registrar pago · ${t.name}`}
                                action={payTaxAction}
                                submitLabel="Registrar pago"
                                trigger={<Button variant="ghost" size="icon" className="size-8" aria-label="Registrar pago" title="Registrar pago"><Banknote className="size-3.5" /></Button>}
                              >
                                <Hidden name="taxId" value={t.id} />
                                <FieldRow>
                                  <MoneyField label="Monto" name="amountCents" defaultCents={Math.max(0, t.estimatedCents - t.paidCents)} required />
                                  <TextField label="Fecha" name="date" type="date" defaultValue={today} required />
                                </FieldRow>
                                <SelectField label="¿Con qué se pagó?" name="accountId" options={o.paymentAccounts} placeholder="Elige…" required />
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

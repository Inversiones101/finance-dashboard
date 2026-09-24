import { asc, desc, isNotNull } from "drizzle-orm";
import { Banknote, Handshake, Landmark, Plus, Scale, Trash2 } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getFormOptions, type FormOptions } from "@/lib/data/options";
import { todayIn } from "@/lib/today";
import { formatDate, formatMoney } from "@/lib/format";
import { CONTRACT_STATUS, CURRENCY_OPTIONS, DEBT_STATUS, toOptions } from "@/lib/labels";
import { addMonthsToDate, nextDayOfMonth } from "@/lib/services/ledger";
import { deleteDebtAction, deleteDebtPaymentAction, payDebtAction, payInstallmentAction, saveContractAction, saveDebtAction } from "@/lib/actions/debts";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, Panel, Empty, StatPill } from "@/components/crud/page-header";
import { FormDialog } from "@/components/crud/form-dialog";
import { ConfirmButton } from "@/components/crud/confirm-button";
import { RowActions } from "@/components/crud/row-actions";
import { StatusBadge } from "@/components/crud/status-badge";
import { CheckboxField, FieldRow, Hidden, MoneyField, SelectField, TextareaField, TextField } from "@/components/crud/fields";

type Debt = typeof s.debts.$inferSelect;
type Contract = typeof s.vendorContracts.$inferSelect;

function ContractFields({ o, d, today }: { o: FormOptions; d?: Contract; today: string }) {
  return (
    <>
      {d && <Hidden name="id" value={d.id} />}
      <FieldRow>
        <TextField label="Nombre" name="name" defaultValue={d?.name} required placeholder="Ej. Consultoría Skool Scaling" />
        <TextField label="Proveedor" name="vendorName" defaultValue={d ? o.names.counterparty.get(d.vendorId) : undefined} required />
      </FieldRow>
      <FieldRow>
        <MoneyField label="Total del contrato" name="totalCents" defaultCents={d?.totalCents} required />
        <SelectField label="Moneda" name="currency" options={CURRENCY_OPTIONS} defaultValue={d?.currency ?? "USD"} />
      </FieldRow>
      <FieldRow>
        <TextField label="Día de pago de cada cuota" name="installmentDay" type="number" defaultValue={d?.installmentDay} hint="Ej. 15" />
        <MoneyField label="Cuota sugerida" name="installmentAmountCents" defaultCents={d?.installmentAmountCents} />
      </FieldRow>
      <FieldRow>
        <SelectField label="Categoría del gasto" name="categoryId" options={o.expenseCategories} defaultValue={d?.categoryId} placeholder="Elige…" required />
        <TextField label="Fecha de firma" name="signedOn" type="date" defaultValue={d?.signedOn ?? today} required />
      </FieldRow>
      <SelectField label="Estado" name="status" options={toOptions(CONTRACT_STATUS)} defaultValue={d?.status ?? "active"} />
      <TextareaField label="Notas" name="notes" defaultValue={d?.notes} />
    </>
  );
}

function DebtFields({ o, d, today }: { o: FormOptions; d?: Debt; today: string }) {
  return (
    <>
      {d && <Hidden name="id" value={d.id} />}
      <FieldRow>
        <TextField label="Nombre" name="name" defaultValue={d?.name} required placeholder="Ej. Préstamo Mercury" />
        <TextField label="Acreedor" name="creditorName" defaultValue={d ? o.names.counterparty.get(d.creditorId) : undefined} required />
      </FieldRow>
      <FieldRow>
        <MoneyField label="Capital prestado" name="principalCents" defaultCents={d?.principalCents} required />
        <SelectField label="Moneda" name="currency" options={CURRENCY_OPTIONS} defaultValue={d?.currency ?? "USD"} />
      </FieldRow>
      <FieldRow>
        <TextField label="Tasa anual %" name="annualRatePct" type="number" defaultValue={d?.annualRatePct} />
        <MoneyField label="Comisión inicial" name="upfrontFeeCents" defaultCents={d?.upfrontFeeCents} />
      </FieldRow>
      <FieldRow>
        <TextField label="Número de cuotas" name="installmentsTotal" type="number" defaultValue={d?.installmentsTotal} />
        <MoneyField label="Cuota" name="installmentAmountCents" defaultCents={d?.installmentAmountCents} />
      </FieldRow>
      <FieldRow>
        <TextField label="Fecha de inicio" name="startDate" type="date" defaultValue={d?.startDate ?? today} required />
        <TextField label="Primer vencimiento" name="firstDueDate" type="date" defaultValue={d?.firstDueDate} />
      </FieldRow>
      <FieldRow>
        <SelectField label="Cuenta asociada" name="accountId" options={o.llcBankAccounts} defaultValue={d?.accountId} placeholder="(ninguna)" />
        <SelectField label="Estado" name="status" options={toOptions(DEBT_STATUS)} defaultValue={d?.status ?? "active"} />
      </FieldRow>
      {!d && <CheckboxField name="disbursed" label="El dinero se depositó en la cuenta asociada" hint="Suma el capital a la caja de la LLC." />}
      <TextareaField label="Notas" name="notes" defaultValue={d?.notes} />
    </>
  );
}

export default async function DeudasPage() {
  const user = await requirePage("debts");
  const canWrite = can(user.permissions, "debts", "write");
  const canAdmin = can(user.permissions, "debts", "admin");
  const today = todayIn();
  const db = await getDb();
  const [o, debts, payments, contracts, contractExpenses] = await Promise.all([
    getFormOptions(),
    db.select().from(s.debts).orderBy(asc(s.debts.startDate)),
    db.select().from(s.debtPayments).orderBy(desc(s.debtPayments.dueDate)),
    db.select().from(s.vendorContracts).orderBy(asc(s.vendorContracts.signedOn)),
    db.select().from(s.expenses).where(isNotNull(s.expenses.contractId)).orderBy(asc(s.expenses.expenseDate)),
  ]);

  const debtBalance = (d: Debt) => d.principalCents - payments.filter((p) => p.debtId === d.id && p.paidOn).reduce((a, p) => a + p.principalCents, 0);
  const contractPaid = (c: Contract) => contractExpenses.filter((e) => e.contractId === c.id).reduce((a, e) => a + e.amountCents, 0);
  const activeDebt = debts.filter((d) => d.status === "active").reduce((a, d) => a + debtBalance(d), 0);
  const pendingCommit = contracts.filter((c) => c.status === "active").reduce((a, c) => a + Math.max(0, c.totalCents - contractPaid(c)), 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Deudas y compromisos"
        description="Solo obligaciones de la LLC con terceros. Lo que adelantas de tu bolsillo va en Aportes del dueño, no aquí."
      >
        {canWrite && (
          <>
            <FormDialog title="Nuevo compromiso con proveedor" description="Un servicio que se paga por partes (ej. consultoría en cuotas)." action={saveContractAction} wide trigger={<Button variant="outline"><Plus className="size-4" /> Compromiso</Button>}>
              <ContractFields o={o} today={today} />
            </FormDialog>
            <FormDialog title="Nueva deuda" description="Préstamos, financiamiento bancario, líneas de crédito." action={saveDebtAction} wide trigger={<Button><Plus className="size-4" /> Deuda</Button>}>
              <DebtFields o={o} today={today} />
            </FormDialog>
          </>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatPill label="Deuda de la LLC" value={formatMoney(activeDebt)} tone={activeDebt ? "out" : undefined} icon={Landmark} />
        <StatPill label="Compromisos pendientes" value={formatMoney(pendingCommit)} tone={pendingCommit ? "out" : undefined} icon={Handshake} />
        <StatPill label="Total por pagar" value={formatMoney(activeDebt + pendingCommit)} icon={Scale} />
      </div>

      <Panel title="Compromisos con proveedores" description="Cada cuota pagada se registra como gasto del mes.">
        {contracts.length === 0 ? (
          <Empty>Sin compromisos.</Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {contracts.map((c) => {
              const paid = contractPaid(c);
              const pending = Math.max(0, c.totalCents - paid);
              const pct = c.totalCents ? paid / c.totalCents : 1;
              const installments = contractExpenses.filter((e) => e.contractId === c.id);
              // Si ya se pagó la cuota de este mes, la próxima es la del mes siguiente.
              const paidThisMonth = installments.some((e) => e.expenseDate.slice(0, 7) === today.slice(0, 7));
              const next =
                c.status === "active" && c.installmentDay
                  ? nextDayOfMonth(paidThisMonth ? addMonthsToDate(today.slice(0, 8) + "01", 1) : today, c.installmentDay)
                  : null;
              const suggested = Math.min(c.installmentAmountCents ?? pending, pending);
              return (
                <div key={c.id} className="rounded-2xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {o.names.counterparty.get(c.vendorId)} · {formatMoney(c.totalCents, c.currency)} total
                        {c.installmentDay && ` · cuotas cada día ${c.installmentDay}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge label={CONTRACT_STATUS[c.status]} tone={c.status === "completed" ? "good" : c.status === "active" ? "info" : "muted"} />
                      {canWrite && c.status === "active" && (
                        <FormDialog
                          title={`Pagar cuota · ${c.name}`}
                          description={`Pendiente: ${formatMoney(pending, c.currency)}. Puedes pagar más para liquidar antes.`}
                          action={payInstallmentAction}
                          submitLabel="Registrar cuota"
                          trigger={<Button size="sm"><Banknote className="size-4" /> Pagar cuota</Button>}
                        >
                          <Hidden name="contractId" value={c.id} />
                          <FieldRow>
                            <MoneyField label="Monto" name="amountCents" defaultCents={suggested} required />
                            <TextField label="Fecha" name="date" type="date" defaultValue={today} required />
                          </FieldRow>
                          <SelectField label="¿Con qué se pagó?" name="accountId" options={o.paymentAccounts} placeholder="Elige…" required />
                        </FormDialog>
                      )}
                      <RowActions canEdit={canWrite} wide editTitle="Editar compromiso" editAction={saveContractAction} editFields={<ContractFields o={o} d={c} today={today} />} canDelete={false} />
                    </div>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct * 100}%` }} />
                  </div>
                  <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      Pagado {formatMoney(paid, c.currency)} ({Math.round(pct * 100)}%) · {installments.length} cuotas
                    </span>
                    <span>
                      Falta <span className="font-medium text-foreground">{formatMoney(pending, c.currency)}</span>
                      {next && pending > 0 && ` · próxima ${formatDate(next)}`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel title="Deudas de la LLC">
        {debts.length === 0 ? (
          <Empty>La LLC no tiene deudas. 🎉</Empty>
        ) : (
          <div className="flex flex-col gap-4">
            {debts.map((d) => {
              const bal = debtBalance(d);
              const ps = payments.filter((p) => p.debtId === d.id);
              return (
                <div key={d.id} className="rounded-2xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{d.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {o.names.counterparty.get(d.creditorId)} · {formatMoney(d.principalCents, d.currency)} al {Number(d.annualRatePct)}% anual
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-heading text-lg font-bold text-money-out-text tabular">{formatMoney(bal, d.currency)}</span>
                      <StatusBadge label={DEBT_STATUS[d.status]} tone={d.status === "paid_off" ? "good" : d.status === "defaulted" ? "bad" : "info"} />
                      {canWrite && d.status === "active" && (
                        <FormDialog title={`Pago · ${d.name}`} description="Capital reduce el saldo; intereses y comisiones son gasto financiero del mes." action={payDebtAction} submitLabel="Registrar pago" trigger={<Button size="sm"><Banknote className="size-4" /> Pagar</Button>}>
                          <Hidden name="debtId" value={d.id} />
                          <FieldRow>
                            <MoneyField label="Capital" name="principalCents" defaultCents={d.installmentAmountCents} />
                            <MoneyField label="Intereses" name="interestCents" />
                          </FieldRow>
                          <FieldRow>
                            <MoneyField label="Comisiones" name="feeCents" />
                            <TextField label="Fecha" name="date" type="date" defaultValue={today} required />
                          </FieldRow>
                          <SelectField label="¿Con qué se pagó?" name="accountId" options={o.paymentAccounts} placeholder="Elige…" required />
                        </FormDialog>
                      )}
                      <RowActions
                        canEdit={canWrite}
                        canDelete={canAdmin}
                        wide
                        editTitle="Editar deuda"
                        editAction={saveDebtAction}
                        editFields={<DebtFields o={o} d={d} today={today} />}
                        deleteAction={deleteDebtAction.bind(null, d.id)}
                        deleteLabel="esta deuda y sus pagos"
                      />
                    </div>
                  </div>
                  {ps.length > 0 && (
                    <Table className="mt-3">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead className="text-right">Capital</TableHead>
                          <TableHead className="text-right">Intereses + comisiones</TableHead>
                          <TableHead className="w-12" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ps.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="text-muted-foreground">{formatDate(p.paidOn ?? p.dueDate)}</TableCell>
                            <TableCell className="text-right tabular">{formatMoney(p.principalCents, d.currency)}</TableCell>
                            <TableCell className="text-right text-money-out-text tabular">{formatMoney(p.interestCents + p.feeCents, d.currency)}</TableCell>
                            <TableCell>
                              {canWrite && (
                                <ConfirmButton
                                  title="¿Eliminar pago?"
                                  destructive
                                  confirmLabel="Eliminar"
                                  action={deleteDebtPaymentAction.bind(null, p.id)}
                                  trigger={<Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-danger" aria-label="Eliminar"><Trash2 className="size-3.5" /></Button>}
                                />
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

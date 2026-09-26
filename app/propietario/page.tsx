import { desc } from "drizzle-orm";
import { ArrowDownLeft, ArrowUpRight, HandCoins, Lock, Plus, Scale, Trash2 } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireOwner } from "@/lib/auth/session";
import { getFormOptions } from "@/lib/data/options";
import { todayIn } from "@/lib/today";
import { formatDate, formatMoney } from "@/lib/format";
import { CURRENCY_OPTIONS, OWNER_ENTRY, toOptions } from "@/lib/labels";
import { deleteOwnerEntryAction, deleteStartupCostAction, saveOwnerEntryAction, saveStartupCostAction } from "@/lib/actions/owner";
import { listStartupCosts } from "@/lib/services/startup-costs";
import type { Tx } from "@/lib/services/ledger";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, Panel, Empty, StatPill } from "@/components/crud/page-header";
import { FormDialog } from "@/components/crud/form-dialog";
import { ConfirmButton } from "@/components/crud/confirm-button";
import { StatusBadge } from "@/components/crud/status-badge";
import { FieldRow, MoneyField, SelectField, TextField } from "@/components/crud/fields";
import { cn } from "@/lib/utils";

export default async function PropietarioPage() {
  await requireOwner();
  const canWrite = true;
  const today = todayIn();
  const db = await getDb();
  const [o, rows, startup, contracts] = await Promise.all([
    getFormOptions(),
    db.select().from(s.ownerLedger).orderBy(desc(s.ownerLedger.entryDate), desc(s.ownerLedger.createdAt)),
    listStartupCosts(db as unknown as Tx),
    db.select({ id: s.vendorContracts.id, name: s.vendorContracts.name, status: s.vendorContracts.status }).from(s.vendorContracts),
  ]);
  const startupTotal = startup.rows.reduce((a, e) => a + Math.round(e.amountCents * Number(e.fxRateToUsd)), 0);
  const startupIds = new Set(startup.rows.map((e) => e.id));
  const dayBefore = startup.start ? new Date(Date.parse(`${startup.start}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10) : today;

  const usd = (r: (typeof rows)[number]) => Math.round(r.amountCents * Number(r.fxRateToUsd));
  const sumType = (t: keyof typeof OWNER_ENTRY) => rows.filter((r) => r.type === t).reduce((a, r) => a + usd(r), 0);
  const contributed = sumType("contribution");
  const draws = sumType("draw");
  const owed = sumType("loan") - sumType("reimbursement");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Lock className="size-3.5" /> Sección privada</div>
      <PageHeader
        title="Capital del dueño"
        description="Privado: solo tú ves esta sección. Tu capital social en la LLC: lo que aportas (incluidos los gastos que pagas de tu bolsillo, que llegan aquí solos) y lo que retiras."
      >
        {canWrite && (
          <FormDialog
            title="Nuevo movimiento del dueño"
            description="Para depósitos que haces a la LLC o dinero que retiras de ella."
            action={saveOwnerEntryAction}
            trigger={<Button><Plus className="size-4" /> Registrar movimiento</Button>}
          >
            <SelectField label="Tipo" name="type" options={toOptions(OWNER_ENTRY)} defaultValue="contribution" hint="Aporte: no se devuelve. Préstamo: la LLC te lo debe." />
            <FieldRow>
              <MoneyField label="Monto" name="amountCents" required />
              <SelectField label="Moneda" name="currency" options={CURRENCY_OPTIONS} defaultValue="USD" />
            </FieldRow>
            <FieldRow>
              <TextField label="Fecha" name="date" type="date" defaultValue={today} required />
              <SelectField label="Cuenta de la LLC" name="llcAccountId" options={o.llcBankAccounts} placeholder="(no pasó por una cuenta LLC)" hint="Si eliges una, se mueve su saldo." />
            </FieldRow>
            <TextField label="Descripción" name="description" required placeholder="Ej. Depósito inicial a Mercury" />
          </FormDialog>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatPill label="Capital aportado" value={formatMoney(contributed)} tone="in" icon={ArrowDownLeft} />
        <StatPill label="Retiros" value={formatMoney(draws)} tone="out" icon={ArrowUpRight} />
        <StatPill label="Capital neto" value={formatMoney(contributed - draws)} icon={HandCoins} />
        <StatPill label="Préstamos a la LLC" value={formatMoney(owed)} icon={Scale} />
      </div>

      <Panel
        title="Puesta en marcha · capital inicial"
        description={
          startup.start
            ? `Lo que pagaste de tu bolsillo antes del inicio de operaciones (${formatDate(startup.start)}). Cuenta como aporte de capital, no como gasto: no aparece en Gastos ni afecta utilidad bruta, EBITDA, márgenes, burn o presupuestos. Desde esa fecha, todo gasto de la empresa se registra normal en Gastos.`
            : "Define la fecha de inicio de operaciones en Catálogos → Empresa."
        }
        actions={
          canWrite && startup.start ? (
            <FormDialog
              title="Pago de puesta en marcha"
              description="Algo que pagaste tú antes de que la LLC empezara a operar. Se suma a tu capital inicial."
              action={saveStartupCostAction}
              submitLabel="Sumar al capital inicial"
              trigger={<Button variant="outline" size="sm"><Plus className="size-4" /> Agregar</Button>}
            >
              <FieldRow>
                <TextField label="Fecha" name="date" type="date" defaultValue={dayBefore} required hint={`Antes del ${formatDate(startup.start)}.`} />
                <MoneyField label="Monto" name="amountCents" required />
              </FieldRow>
              <SelectField label="¿Es cuota de un contrato?" name="contractId" options={contracts.filter((c) => c.status !== "canceled").map((c) => ({ value: c.id, label: c.name }))} placeholder="No" hint="Si lo es, baja lo que queda por pagar del contrato." />
              <FieldRow>
                <SelectField label="Categoría" name="categoryId" options={o.expenseCategories} placeholder="(la del contrato)" />
                <SelectField label="Moneda" name="currency" options={CURRENCY_OPTIONS} defaultValue="USD" />
              </FieldRow>
              <TextField label="Concepto" name="description" placeholder="Ej. Cuota 2 · Consultoría Skool Scaling" hint="Vacío con contrato = “Cuota N · contrato”." />
            </FormDialog>
          ) : undefined
        }
      >
        {startup.rows.length === 0 ? (
          <Empty>Sin pagos de puesta en marcha.</Empty>
        ) : (
          <>
            <ul className="divide-y">
              {startup.rows.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="w-24 shrink-0 text-muted-foreground">{formatDate(e.expenseDate)}</span>
                  <span className="min-w-0 flex-1 truncate">{e.description}</span>
                  <span className="font-medium tabular">{formatMoney(e.amountCents, e.currency)}</span>
                  {canWrite && (
                    <ConfirmButton
                      title="¿Quitar de la puesta en marcha?"
                      description="Se quita del capital inicial (y, si era cuota de un contrato, vuelve a quedar pendiente)."
                      destructive
                      confirmLabel="Quitar"
                      action={deleteStartupCostAction.bind(null, e.id)}
                      trigger={<Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-danger" aria-label="Quitar"><Trash2 className="size-3.5" /></Button>}
                    />
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 flex justify-between border-t pt-2 text-sm font-semibold">
              <span>Total puesta en marcha</span>
              <span className="tabular">{formatMoney(startupTotal)}</span>
            </p>
          </>
        )}
      </Panel>

      <Panel title="Todos los movimientos">
        {rows.length === 0 ? (
          <Empty>Sin movimientos.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Origen</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const auto = !!(r.expenseId || r.revenueId || r.debtPaymentId);
                  const outflow = r.type === "draw" || r.type === "reimbursement";
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(r.entryDate)}</TableCell>
                      <TableCell>
                        {r.description}
                      </TableCell>
                      <TableCell>
                        <StatusBadge label={OWNER_ENTRY[r.type]} tone={outflow ? "warn" : "good"} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{auto ? (r.expenseId ? (startupIds.has(r.expenseId) ? "Automático · puesta en marcha" : "Automático · gasto pagado por ti") : r.revenueId ? "Automático · ingreso" : "Automático · pago de deuda") : "Manual"}</TableCell>
                      <TableCell className={cn("text-right font-medium whitespace-nowrap tabular", outflow ? "text-money-out-text" : "")}>
                        {formatMoney(r.amountCents, r.currency)}
                      </TableCell>
                      <TableCell>
                        {canWrite && !auto && (
                          <ConfirmButton
                            title="¿Eliminar movimiento?"
                            destructive
                            confirmLabel="Eliminar"
                            action={deleteOwnerEntryAction.bind(null, r.id)}
                            trigger={<Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-danger" aria-label="Eliminar"><Trash2 className="size-3.5" /></Button>}
                          />
                        )}
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

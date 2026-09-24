import { desc } from "drizzle-orm";
import { ArrowDownLeft, ArrowUpRight, HandCoins, Lock, Plus, Scale, Trash2 } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireOwner } from "@/lib/auth/session";
import { getFormOptions } from "@/lib/data/options";
import { todayIn } from "@/lib/today";
import { formatDate, formatMoney } from "@/lib/format";
import { CURRENCY_OPTIONS, OWNER_ENTRY, toOptions } from "@/lib/labels";
import { deleteOwnerEntryAction, saveOwnerEntryAction } from "@/lib/actions/owner";
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
  const [o, rows] = await Promise.all([getFormOptions(), db.select().from(s.ownerLedger).orderBy(desc(s.ownerLedger.entryDate), desc(s.ownerLedger.createdAt))]);

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

      <Panel>
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
                      <TableCell className="text-xs text-muted-foreground">{auto ? (r.expenseId ? "Automático · gasto" : r.revenueId ? "Automático · ingreso" : "Automático · pago de deuda") : "Manual"}</TableCell>
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

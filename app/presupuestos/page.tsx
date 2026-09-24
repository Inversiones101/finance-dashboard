import { asc } from "drizzle-orm";
import { PiggyBank, Plus, Receipt, Wallet } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getFormOptions, type FormOptions } from "@/lib/data/options";
import { loadFinanceData } from "@/lib/data/finance-data";
import { monthFromParams } from "@/lib/data/period";
import { computeBudgets } from "@/lib/finance/engine";
import { todayIn } from "@/lib/today";
import { formatMoney, formatUSD } from "@/lib/format";
import { deleteBudgetAction, saveBudgetAction } from "@/lib/actions/planning";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, Panel, Empty, StatPill } from "@/components/crud/page-header";
import { MonthFilter } from "@/components/crud/month-filter";
import { FormDialog } from "@/components/crud/form-dialog";
import { RowActions } from "@/components/crud/row-actions";
import { FieldRow, Hidden, MoneyField, SelectField, TextareaField, TextField } from "@/components/crud/fields";
import { cn } from "@/lib/utils";

type Budget = typeof s.budgets.$inferSelect;

function BudgetFields({ o, d, month }: { o: FormOptions; d?: Budget; month: string }) {
  return (
    <>
      {d && <Hidden name="id" value={d.id} />}
      <SelectField label="Categoría" name="categoryId" options={o.expenseCategories} defaultValue={d?.categoryId} placeholder="Elige…" required />
      <FieldRow>
        <MoneyField label="Tope mensual" name="amountCents" defaultCents={d?.amountCents} required />
        <TextField label="Mes (vacío = todos los meses)" name="month" type="month" defaultValue={d ? (d.month ?? "") : month} />
      </FieldRow>
      <TextareaField label="Notas" name="notes" defaultValue={d?.notes} />
    </>
  );
}

export default async function PresupuestosPage({ searchParams }: PageProps<"/presupuestos">) {
  const user = await requirePage("planning");
  const canWrite = can(user.permissions, "planning", "write");
  const month = monthFromParams((await searchParams).mes) ?? todayIn().slice(0, 7);
  const db = await getDb();
  const [o, rows, data] = await Promise.all([getFormOptions(), db.select().from(s.budgets).orderBy(asc(s.budgets.month)), loadFinanceData(db)]);
  const b = computeBudgets(data, month);
  const catName = new Map(o.categories.map((c) => [c.id, c.name]));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Presupuestos" description="Topes de gasto por categoría. Un presupuesto de un mes específico reemplaza al general de esa categoría.">
        <MonthFilter month={month} />
        {canWrite && (
          <FormDialog title="Nuevo presupuesto" action={saveBudgetAction} trigger={<Button><Plus className="size-4" /> Presupuesto</Button>}>
            <BudgetFields o={o} month={month} />
          </FormDialog>
        )}
      </PageHeader>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatPill label="Presupuestado" value={formatUSD(b.budgetTotal)} icon={PiggyBank} />
        <StatPill label="Gastado en categorías con presupuesto" value={formatUSD(b.actualTotal)} icon={Receipt} tone={b.pct !== null && b.pct > 1 ? "out" : "neutral"} hint={b.pct !== null ? `${Math.round(b.pct * 100)}% del total` : undefined} />
        <StatPill label="Gasto sin presupuesto" value={formatUSD(b.unbudgeted)} icon={Wallet} hint="Categorías sin tope este mes" />
      </div>

      <Panel title="Presupuesto vs. real">
        {b.rows.length === 0 ? (
          <Empty>No hay presupuestos para este mes. Crea uno por categoría para controlar el gasto.</Empty>
        ) : (
          <ul className="flex flex-col gap-4">
            {b.rows.map((r) => {
              const pct = r.pct ?? 0;
              return (
                <li key={r.categoryId}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">{r.name}</span>
                    <span className="tabular">
                      <span className={cn(pct > 1 && "text-money-out-text")}>{formatUSD(r.actual, { cents: true })}</span>
                      <span className="text-muted-foreground"> / {formatUSD(r.budget)}</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                    <div className={cn("h-full rounded-full", pct > 1 ? "bg-money-out" : pct > 0.85 ? "bg-warning" : "bg-primary")} style={{ width: `${Math.min(100, pct * 100)}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {pct > 1 ? `Excedido por ${formatUSD(r.actual - r.budget, { cents: true })}` : `Quedan ${formatUSD(r.budget - r.actual, { cents: true })}`} · {Math.round(pct * 100)}%
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Presupuestos configurados">
        {rows.length === 0 ? (
          <Empty>Aún no hay presupuestos.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Categoría</TableHead>
                <TableHead>Aplica</TableHead>
                <TableHead className="text-right">Tope</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{catName.get(r.categoryId)}</TableCell>
                  <TableCell>{r.month ?? "Todos los meses"}</TableCell>
                  <TableCell className="text-right tabular">{formatMoney(r.amountCents)}</TableCell>
                  <TableCell>
                    <RowActions canEdit={canWrite} editTitle="Editar presupuesto" editAction={saveBudgetAction} editFields={<BudgetFields o={o} d={r} month={month} />} deleteAction={deleteBudgetAction.bind(null, r.id)} deleteLabel="este presupuesto" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

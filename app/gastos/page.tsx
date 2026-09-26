import { and, desc, gte, inArray, lte } from "drizzle-orm";
import { Briefcase, CalendarClock, Package, Plus, Receipt } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getFormOptions } from "@/lib/data/options";
import { monthFromParams, monthRange } from "@/lib/data/period";
import { todayIn } from "@/lib/today";
import { formatDate, formatMoney } from "@/lib/format";
import { EXPENSE_STATUS } from "@/lib/labels";
import { deleteExpenseAction, saveExpenseAction } from "@/lib/actions/expenses";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, Panel, Empty, StatPill } from "@/components/crud/page-header";
import { MonthFilter } from "@/components/crud/month-filter";
import { FormDialog } from "@/components/crud/form-dialog";
import { RowActions } from "@/components/crud/row-actions";
import { ReceiptsButton } from "@/components/expenses/receipts-button";
import { StatusBadge } from "@/components/crud/status-badge";
import { ExpenseFields } from "@/components/forms/expense-fields";

export default async function GastosPage({ searchParams }: PageProps<"/gastos">) {
  const user = await requirePage("expenses");
  const canWrite = can(user.permissions, "expenses", "write");
  const month = monthFromParams((await searchParams).mes);
  const today = todayIn();

  const db = await getDb();
  const [o, rows] = await Promise.all([
    getFormOptions(),
    db
      .select()
      .from(s.expenses)
      .where(month ? and(gte(s.expenses.expenseDate, monthRange(month).from), lte(s.expenses.expenseDate, monthRange(month).to)) : undefined)
      .orderBy(desc(s.expenses.expenseDate), desc(s.expenses.createdAt)),
  ]);

  const receipts = rows.length
    ? await db
        .select({ id: s.expenseAttachments.id, expenseId: s.expenseAttachments.expenseId, fileName: s.expenseAttachments.fileName, contentType: s.expenseAttachments.contentType, sizeBytes: s.expenseAttachments.sizeBytes })
        .from(s.expenseAttachments)
        .where(inArray(s.expenseAttachments.expenseId, rows.map((r) => r.id)))
    : [];
  const receiptsOf = (id: string) => receipts.filter((r) => r.expenseId === id);

  const kindOf = new Map(o.categories.map((c) => [c.id, c.kind]));
  const usd = (e: (typeof rows)[number]) => Math.round(e.amountCents * Number(e.fxRateToUsd));
  const active = rows.filter((e) => e.status !== "void");
  const total = active.reduce((a, e) => a + usd(e), 0);
  const cogs = active.filter((e) => kindOf.get(e.categoryId) === "cogs").reduce((a, e) => a + usd(e), 0);
  const llcPending = active.filter((e) => e.status === "pending" && e.fundingSource !== "owner_personal").reduce((a, e) => a + usd(e), 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Gastos" description="Costos directos y gastos operativos. Elige con qué se pagó y el sistema decide si sale de la caja de la LLC o cuenta como aporte tuyo.">
        <MonthFilter month={month} allowAll />
        {canWrite && (
          <FormDialog
            title="Nuevo gasto"
            action={saveExpenseAction}
            wide
            trigger={
              <Button>
                <Plus className="size-4" /> Nuevo gasto
              </Button>
            }
          >
            <ExpenseFields o={o} today={today} />
          </FormDialog>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatPill label="Total del periodo" value={formatMoney(total)} tone="out" icon={Receipt} />
        <StatPill label="Costos directos" value={formatMoney(cogs)} icon={Package} />
        <StatPill label="Gastos operativos" value={formatMoney(total - cogs)} icon={Briefcase} />
        <StatPill label="Por pagar (LLC)" value={formatMoney(llcPending)} icon={CalendarClock} tone={llcPending ? "out" : "neutral"} />
      </div>

      <Panel>
        {rows.length === 0 ? (
          <Empty>No hay gastos en este periodo.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Pagado con</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(e.expenseDate)}</TableCell>
                    <TableCell>
                      <p className="font-medium">{e.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {o.names.category.get(e.categoryId)}
                        {kindOf.get(e.categoryId) === "cogs" && " · costo directo"}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p>{e.fundingSource === "owner_personal" ? "Aporte del dueño" : o.accountName(e.paymentAccountId)}</p>
                      <p className="text-xs text-muted-foreground">
                        {e.fundingSource === "owner_personal" ? "No sale de la caja" : e.fundingSource === "llc_credit" ? "Tarjeta LLC" : "Caja LLC"}
                      </p>
                    </TableCell>
                    <TableCell>
                      {e.fundingSource === "owner_personal" ? (
                        <StatusBadge label="Aporte" tone="info" />
                      ) : (
                        <StatusBadge label={EXPENSE_STATUS[e.status]} tone={e.status === "paid" ? "good" : e.status === "pending" ? "warn" : "muted"} />
                      )}
                      {e.status === "pending" && e.dueDate && <p className="mt-0.5 text-xs text-muted-foreground">vence {formatDate(e.dueDate)}</p>}
                    </TableCell>
                    <TableCell className="text-right font-medium whitespace-nowrap text-money-out-text tabular">
                      {formatMoney(e.amountCents, e.currency)}
                      {e.currency !== "USD" && <p className="text-xs font-normal text-muted-foreground">{formatMoney(usd(e))}</p>}
                    </TableCell>
                    <TableCell>
                      <RowActions
                        canEdit={canWrite}
                        wide
                        editTitle="Editar gasto"
                        editAction={saveExpenseAction}
                        editFields={<ExpenseFields o={o} d={e} today={today} />}
                        deleteAction={deleteExpenseAction.bind(null, e.id)}
                        deleteLabel="este gasto"
                        extra={<ReceiptsButton expenseId={e.id} label={`${e.description} · ${formatMoney(e.amountCents, e.currency)} · ${formatDate(e.expenseDate)}`} receipts={receiptsOf(e.id)} canWrite={canWrite} />}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
    </div>
  );
}

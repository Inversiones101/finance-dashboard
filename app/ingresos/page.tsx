import { and, desc, gte, lte } from "drizzle-orm";
import { BadgePercent, Plus, Repeat, TrendingUp, Wallet } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getFormOptions } from "@/lib/data/options";
import { monthFromParams, monthRange } from "@/lib/data/period";
import { todayIn } from "@/lib/today";
import { formatDate, formatMoney } from "@/lib/format";
import { INTERVAL, REVENUE_STATUS } from "@/lib/labels";
import { deleteRevenueAction, saveRevenueAction } from "@/lib/actions/revenue";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, Panel, Empty, StatPill } from "@/components/crud/page-header";
import { MonthFilter } from "@/components/crud/month-filter";
import { FormDialog } from "@/components/crud/form-dialog";
import { RowActions } from "@/components/crud/row-actions";
import { StatusBadge } from "@/components/crud/status-badge";
import { RevenueFields } from "@/components/forms/revenue-fields";

export default async function IngresosPage({ searchParams }: PageProps<"/ingresos">) {
  const user = await requirePage("revenue");
  const canWrite = can(user.permissions, "revenue", "write");
  const month = monthFromParams((await searchParams).mes);
  const today = todayIn();

  const db = await getDb();
  const [o, rows] = await Promise.all([
    getFormOptions(),
    db
      .select()
      .from(s.revenues)
      .where(month ? and(gte(s.revenues.revenueDate, monthRange(month).from), lte(s.revenues.revenueDate, monthRange(month).to)) : undefined)
      .orderBy(desc(s.revenues.revenueDate), desc(s.revenues.createdAt)),
  ]);
  const defaultDeposit = o.accounts.find((a) => a.owner === "llc" && a.type === "processor" && a.status === "active")?.id;

  const usd = (c: number, fx: string) => Math.round(c * Number(fx));
  const live = rows.filter((r) => r.status !== "refunded");
  const gross = live.reduce((a, r) => a + usd(r.grossCents, r.fxRateToUsd), 0);
  const fees = live.reduce((a, r) => a + usd(r.processorFeeCents + r.affiliateFeeCents, r.fxRateToUsd), 0);
  const recurring = live.filter((r) => r.billingInterval !== "one_time").reduce((a, r) => a + usd(r.netCents, r.fxRateToUsd), 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Ingresos" description="Cada cobro por producto. Facturación bruta − comisiones = ingreso neto. Los cobros mensuales y anuales alimentan el MRR.">
        <MonthFilter month={month} allowAll />
        {canWrite && (
          <FormDialog
            title="Nuevo ingreso"
            action={saveRevenueAction}
            wide
            trigger={
              <Button>
                <Plus className="size-4" /> Nuevo ingreso
              </Button>
            }
          >
            <RevenueFields o={o} today={today} defaultDeposit={defaultDeposit} />
          </FormDialog>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatPill label="Facturación bruta" value={formatMoney(gross)} icon={Wallet} />
        <StatPill label="Comisiones" value={formatMoney(fees)} tone="out" icon={BadgePercent} />
        <StatPill label="Ingreso neto" value={formatMoney(gross - fees)} tone="in" icon={TrendingUp} />
        <StatPill label="Neto recurrente" value={formatMoney(recurring)} icon={Repeat} />
      </div>

      <Panel>
        {rows.length === 0 ? (
          <Empty>No hay ingresos en este periodo.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Depositado en</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Bruto</TableHead>
                  <TableHead className="text-right">Comisiones</TableHead>
                  <TableHead className="text-right">Neto</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(r.revenueDate)}</TableCell>
                    <TableCell>
                      <p className="font-medium">{r.productId ? o.names.product.get(r.productId) : o.names.category.get(r.categoryId)}</p>
                      <p className="text-xs text-muted-foreground">
                        {INTERVAL[r.billingInterval]}
                        {r.customerName && ` · ${r.customerName}`}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm">{r.depositAccountId ? o.accountName(r.depositAccountId, "deposit") : "Por cobrar"}</TableCell>
                    <TableCell>
                      <StatusBadge label={REVENUE_STATUS[r.status]} tone={r.status === "refunded" || r.status === "disputed" ? "bad" : r.status === "pending" ? "warn" : "good"} />
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular">{formatMoney(r.grossCents, r.currency)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap text-money-out-text tabular">
                      {r.processorFeeCents + r.affiliateFeeCents ? `−${formatMoney(r.processorFeeCents + r.affiliateFeeCents, r.currency)}` : "—"}
                    </TableCell>
                    <TableCell className="text-right font-medium whitespace-nowrap text-success tabular">{formatMoney(r.netCents, r.currency)}</TableCell>
                    <TableCell>
                      <RowActions
                        canEdit={canWrite}
                        wide
                        editTitle="Editar ingreso"
                        editAction={saveRevenueAction}
                        editFields={<RevenueFields o={o} d={r} today={today} />}
                        deleteAction={deleteRevenueAction.bind(null, r.id)}
                        deleteLabel="este ingreso"
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

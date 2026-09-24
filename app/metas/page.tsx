import { asc } from "drizzle-orm";
import { CheckCircle2, Clock, Plus, Target, TrendingDown } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { loadFinanceData } from "@/lib/data/finance-data";
import { getChurnAssumptionPct } from "@/lib/data/dashboard";
import { computeGoals, GOAL_METRICS } from "@/lib/finance/engine";
import { getUsdHnlRate } from "@/lib/fx";
import { todayIn } from "@/lib/today";
import { formatDate, formatUSD } from "@/lib/format";
import { deleteGoalAction, saveGoalAction } from "@/lib/actions/planning";
import { Button } from "@/components/ui/button";
import { PageHeader, Empty } from "@/components/crud/page-header";
import { FormDialog } from "@/components/crud/form-dialog";
import { RowActions } from "@/components/crud/row-actions";
import { StatusBadge } from "@/components/crud/status-badge";
import { FieldRow, Hidden, SelectField, TextareaField, TextField } from "@/components/crud/fields";
import { cn } from "@/lib/utils";

type Goal = typeof s.goals.$inferSelect;
const METRIC_OPTIONS = Object.entries(GOAL_METRICS).map(([value, m]) => ({ value, label: m.label }));
const STATUS = {
  achieved: { label: "Cumplida", tone: "good" as const, icon: CheckCircle2 },
  on_track: { label: "En camino", tone: "info" as const, icon: Target },
  behind: { label: "Atrasada", tone: "warn" as const, icon: TrendingDown },
  missed: { label: "Vencida", tone: "bad" as const, icon: Clock },
};

function GoalFields({ d, today }: { d?: Goal; today: string }) {
  const yearEnd = `${today.slice(0, 4)}-12-31`;
  return (
    <>
      {d && <Hidden name="id" value={d.id} />}
      <TextField label="Nombre" name="name" defaultValue={d?.name} required placeholder="Ej. Llegar a 100 miembros" />
      <FieldRow>
        <SelectField label="Métrica" name="metric" options={METRIC_OPTIONS} defaultValue={d?.metric ?? "gross_revenue"} />
        <TextField label="Objetivo" name="target" type="number" defaultValue={d?.target} required hint="En dólares, o número de miembros." />
      </FieldRow>
      <FieldRow>
        <TextField label="Desde" name="periodStart" type="date" defaultValue={d?.periodStart ?? today} required />
        <TextField label="Fecha límite" name="periodEnd" type="date" defaultValue={d?.periodEnd ?? yearEnd} required />
      </FieldRow>
      {d && (
        <SelectField label="Estado" name="status" options={[{ value: "active", label: "Activa" }, { value: "archived", label: "Archivada" }]} defaultValue={d.status} />
      )}
      <TextareaField label="Notas" name="notes" defaultValue={d?.notes} />
    </>
  );
}

export default async function MetasPage() {
  const user = await requirePage("planning");
  const canWrite = can(user.permissions, "planning", "write");
  const today = todayIn();
  const db = await getDb();
  const [rows, data, fx, churn] = await Promise.all([db.select().from(s.goals).orderBy(asc(s.goals.periodEnd)), loadFinanceData(db), getUsdHnlRate(), getChurnAssumptionPct()]);
  const progress = new Map(computeGoals(data, { asOf: today, hnlPerUsd: fx.hnlPerUsd, churnAssumption: churn / 100 }).map((g) => [g.id, g]));
  const archived = rows.filter((g) => g.status === "archived");
  const active = rows.filter((g) => g.status === "active");
  const fmtValue = (metric: keyof typeof GOAL_METRICS, v: number) => (GOAL_METRICS[metric].kind === "money" ? formatUSD(v) : String(Math.round(v)));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Metas" description="Objetivos de facturación, utilidad, MRR, miembros o caja. Las acumulativas se comparan contra el ritmo esperado a la fecha.">
        {canWrite && (
          <FormDialog title="Nueva meta" action={saveGoalAction} wide trigger={<Button><Plus className="size-4" /> Nueva meta</Button>}>
            <GoalFields today={today} />
          </FormDialog>
        )}
      </PageHeader>

      {active.length === 0 ? (
        <Empty>Aún no hay metas. Por ejemplo: facturación de $50,000 este año, o 100 miembros activos.</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {active.map((g) => {
            const p = progress.get(g.id);
            if (!p) return null;
            const st = STATUS[p.status as keyof typeof STATUS];
            const Icon = st.icon;
            return (
              <div key={g.id} className="rounded-3xl border bg-surface p-5 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", p.status === "achieved" ? "bg-success/15 text-success" : p.status === "behind" || p.status === "missed" ? "bg-warning/15 text-warning" : "bg-accent text-accent-foreground")}>
                      <Icon className="size-4.5" />
                    </span>
                    <div>
                      <p className="font-semibold">{g.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.label} · {formatDate(g.periodStart)} → {formatDate(g.periodEnd)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <StatusBadge label={st.label} tone={st.tone} />
                    <RowActions canEdit={canWrite} wide editTitle="Editar meta" editAction={saveGoalAction} editFields={<GoalFields d={g} today={today} />} deleteAction={deleteGoalAction.bind(null, g.id)} deleteLabel="esta meta" />
                  </div>
                </div>
                <p className="mt-4 font-heading text-2xl font-bold tabular">
                  {fmtValue(g.metric, p.value)} <span className="text-base font-medium text-muted-foreground">/ {fmtValue(g.metric, p.target)}</span>
                </p>
                <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-surface-2">
                  <div className={cn("h-full rounded-full", p.status === "achieved" ? "bg-success" : p.status === "behind" ? "bg-warning" : "bg-primary")} style={{ width: `${Math.min(100, Math.max(0, p.progress) * 100)}%` }} />
                  {p.expected !== null && p.status !== "achieved" && (
                    <span className="absolute inset-y-0 w-0.5 bg-foreground/50" style={{ left: `${p.expected * 100}%` }} title="Ritmo esperado a hoy" />
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {Math.round(p.progress * 100)}% cumplido
                  {p.expected !== null && ` · ritmo esperado ${Math.round(p.expected * 100)}%`}
                  {p.daysLeft > 0 && ` · quedan ${p.daysLeft} días`}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {archived.length > 0 && <p className="text-xs text-muted-foreground">{archived.length} meta(s) archivada(s).</p>}
    </div>
  );
}

"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileUp, Loader2, RefreshCcw, UserCheck, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { applySkoolImportAction, previewSkoolImportAction } from "@/lib/actions/skool-import";
import type { ImportPlan, PlanItem } from "@/lib/import/skool-csv";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const GROUPS = [
  { kind: "new", title: "Nuevos", icon: UserPlus, tone: "text-success" },
  { kind: "update", title: "Con cambios", icon: RefreshCcw, tone: "text-accent" },
  { kind: "reactivate", title: "Vuelven", icon: UserCheck, tone: "text-success" },
  { kind: "cancel", title: "Bajas", icon: UserMinus, tone: "text-danger" },
] as const;

function detail(i: PlanItem) {
  const charges = "charges" in i ? i.charges : [];
  const money = charges.length ? ` · +${formatMoney(charges.reduce((a, c) => a + c.amountCents, 0))} en cobros` : "";
  switch (i.kind) {
    case "new":
      return `${i.row.interval === "annual" ? "Anual" : "Mensual"} ${formatMoney(i.row.priceCents)} · desde ${formatDate(i.row.joinedOn)}${money}`;
    case "update":
      return i.changes.join(" · ") + (charges.length ? money : "");
    case "reactivate":
      return `${i.row.interval === "annual" ? "Anual" : "Mensual"} ${formatMoney(i.row.priceCents)}${money}`;
    case "cancel":
      return `${i.reason} · deja de contar el ${formatDate(i.member.currentPeriodEnd)}`;
    default:
      return "";
  }
}

const nameOf = (i: PlanItem) => ("row" in i ? i.row.name : i.member.name);

/** Sube el export de miembros de Skool, muestra qué cambiaría y lo aplica al confirmar. */
export function SkoolImportDialog() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reset = () => {
    setCsv(null);
    setPlan(null);
    setError(null);
    setFileName("");
    if (input.current) input.current.value = "";
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setFileName(file.name);
    setError(null);
    setPlan(null);
    start(async () => {
      const r = await previewSkoolImportAction(text);
      if (r.error) setError(r.error);
      else {
        setCsv(text);
        setPlan(r.plan);
      }
    });
  };

  const apply = () =>
    start(async () => {
      if (!csv) return;
      const r = await applySkoolImportAction(csv);
      if (!r.ok) return setError(r.error);
      toast.success(r.message ?? "Importado");
      setOpen(false);
      reset();
      router.refresh();
    });

  const changes = plan?.items.filter((i) => i.kind !== "unchanged") ?? [];
  const unchanged = (plan?.items.length ?? 0) - changes.length;

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), o || reset())}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileUp className="size-4" /> Importar de Skool
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar miembros de Skool</DialogTitle>
          <DialogDescription>
            En Skool: Settings → Members → Export. Sube el CSV y revisa los cambios antes de aplicarlos. Los cobros de prueba de $1 se ignoran.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60dvh] flex-col gap-4 overflow-y-auto px-1 pb-2">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed bg-surface-2 px-4 py-6 text-center text-sm hover:bg-surface-2/70">
            <FileUp className="size-5 text-muted-foreground" />
            <span className="font-medium">{fileName || "Elige el archivo .csv"}</span>
            <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>

          {pending && !plan && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Comparando con tus miembros…
            </p>
          )}
          {error && <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

          {plan && (
            <>
              {plan.warnings.map((w) => (
                <p key={w} className="flex gap-2 rounded-xl bg-warning/10 px-3 py-2 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /> {w}
                </p>
              ))}
              <p className="text-sm text-muted-foreground">
                {changes.length === 0 ? "Todo está al día: no hay nada que cambiar." : `${changes.length} cambios`}
                {unchanged > 0 && ` · ${unchanged} sin cambios`}
                {plan.skipped.free > 0 && ` · ${plan.skipped.free} miembros gratis o de prueba ignorados`}
              </p>
              {GROUPS.map((g) => {
                const list = changes.filter((i) => i.kind === g.kind);
                if (!list.length) return null;
                return (
                  <section key={g.kind}>
                    <h3 className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
                      <g.icon className={cn("size-4", g.tone)} /> {g.title} ({list.length})
                    </h3>
                    <ul className="divide-y rounded-xl border text-sm">
                      {list.map((i) => (
                        <li key={nameOf(i) + i.kind} className="flex flex-col px-3 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                          <span className="font-medium">{nameOf(i)}</span>
                          <span className="text-xs text-muted-foreground">{detail(i)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={apply} disabled={!plan || changes.length === 0 || pending}>
            {pending && plan && <Loader2 className="size-4 animate-spin" />} Aplicar {changes.length || ""} cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

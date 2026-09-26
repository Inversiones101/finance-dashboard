import Link from "next/link";
import { CircleCheck, CircleDashed, Lock, LockOpen } from "lucide-react";
import { getDb } from "@/db/client";
import type { Tx } from "@/lib/services/ledger";
import { closeChecklist, closedThrough, nextToClose } from "@/lib/services/month-close";
import { closeMonthAction, reopenMonthAction } from "@/lib/actions/month-close";
import { todayIn } from "@/lib/today";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/crud/confirm-button";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const name = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** Franja de cierre de mes en Reportes: estado, revisión previa y botones de cerrar / reabrir. */
export async function MonthClosePanel({ canClose, canReopen }: { canClose: boolean; canReopen: boolean }) {
  const db = (await getDb()) as unknown as Tx;
  const [closed, next] = await Promise.all([closedThrough(db), nextToClose(db, todayIn())]);
  const checks = next ? await closeChecklist(db, next) : [];
  const pending = checks.filter((c) => !c.ok);

  return (
    <section className="flex flex-col gap-3 rounded-3xl border bg-surface px-4 py-3.5 shadow-card md:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-surface-2 text-foreground/70">
            <Lock className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">{closed ? `Libros cerrados hasta ${name(closed)}` : "Ningún mes cerrado"}</p>
            <p className="text-xs text-muted-foreground">
              {closed ? "Lo que tenga fecha de esos meses ya no se puede registrar, editar ni borrar." : "Al cerrar un mes, sus números quedan fijos."}
              {closed && (
                <>
                  {" "}
                  <Link href={`/informes?mes=${closed}`} className="font-medium text-foreground underline-offset-2 hover:underline">
                    Ver el informe de {MONTHS[Number(closed.slice(5, 7)) - 1]} →
                  </Link>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canReopen && closed && (
            <ConfirmButton
              title={`¿Reabrir ${name(closed)}?`}
              description="Se podrá volver a editar. Queda registrado en la bitácora quién lo reabrió."
              confirmLabel="Reabrir"
              action={reopenMonthAction}
              trigger={
                <Button variant="ghost" size="sm">
                  <LockOpen className="size-3.5" /> Reabrir {MONTHS[Number(closed.slice(5, 7)) - 1]}
                </Button>
              }
            />
          )}
          {canClose && next && (
            <ConfirmButton
              title={`¿Cerrar ${name(next)}?`}
              description={
                pending.length
                  ? `Quedan pendientes: ${pending.map((p) => p.detail ?? p.label).join(" · ")}. Puedes cerrar igual, pero esos números quedarían fijos así.`
                  : "Todo está revisado. Después de cerrar, nadie podrá cambiar movimientos de ese mes (solo un Administrador puede reabrirlo)."
              }
              confirmLabel={`Cerrar ${MONTHS[Number(next.slice(5, 7)) - 1]}`}
              action={closeMonthAction.bind(null, next)}
              trigger={
                <Button size="sm" variant={pending.length ? "outline" : "default"}>
                  <Lock className="size-3.5" /> Cerrar {MONTHS[Number(next.slice(5, 7)) - 1]}
                </Button>
              }
            />
          )}
        </div>
      </div>
      {next && (
        <ul className="grid gap-1.5 text-xs sm:grid-cols-2 lg:grid-cols-4">
          {checks.map((c) => (
            <li key={c.label} className="flex items-start gap-1.5">
              {c.ok ? <CircleCheck className="mt-px size-3.5 shrink-0 text-success" /> : <CircleDashed className="mt-px size-3.5 shrink-0 text-warning" />}
              <span>
                <span className={c.ok ? "text-muted-foreground" : "font-medium"}>{c.label}</span>
                {c.detail && c.href && (
                  <>
                    {" · "}
                    <Link href={c.href} className="text-muted-foreground underline-offset-2 hover:underline">
                      {c.detail}
                    </Link>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

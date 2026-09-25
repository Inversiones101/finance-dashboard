import { desc, eq, isNotNull } from "drizzle-orm";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  CircleCheck,
  Landmark,
  Link2,
  RefreshCw,
  Sparkles,
  Store,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import type { FormOptions } from "@/lib/data/options";
import { mercuryConfigured } from "@/lib/mercury/client";
import type { InboxAs, Suggestion } from "@/lib/services/bank-sync";
import { acceptAllSuggestionsAction, acceptSuggestionAction, resolveInboxAction, syncBankAction } from "@/lib/actions/bank-sync";
import { formatDate, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/crud/form-dialog";
import { ActionButton } from "@/components/crud/action-button";
import { CheckboxField, Hidden, TextField } from "@/components/crud/fields";
import { ClassifyFields } from "@/components/forms/classify-fields";
import { cn } from "@/lib/utils";

const EXTRA_LABEL: Record<string, string> = {
  match: "Ya está registrado (solo enlazar)",
  transfer: "Transferencia entre mis cuentas",
  payout: "Payout de Skool",
  ignore: "Ignorar (no registrar)",
};

/** Cómo se ve cada sugerencia: una etiqueta corta y su ícono. */
const SUGGESTION: Record<InboxAs, { label: string; icon: LucideIcon }> = {
  match: { label: "Ya registrado", icon: Link2 },
  transfer: { label: "Transferencia", icon: ArrowLeftRight },
  payout: { label: "Payout de Skool", icon: Store },
  owner_contribution: { label: "Aporte del dueño", icon: ArrowDownLeft },
  owner_draw: { label: "Retiro del dueño", icon: ArrowUpRight },
  revenue: { label: "Ingreso", icon: ArrowDownLeft },
  expense: { label: "Gasto", icon: ArrowUpRight },
  other_income: { label: "Cashback / intereses", icon: Sparkles },
  bank_fee: { label: "Comisión bancaria", icon: Landmark },
  adjustment: { label: "Ajuste", icon: Landmark },
};

const TZ = "America/Tegucigalpa";

function ago(iso: string) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
}

const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-HN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** Barra de Mercury + bandeja "Por clasificar". */
export async function BankInbox({ o, canWrite }: { o: FormOptions; canWrite: boolean }) {
  const configured = mercuryConfigured();
  const db = await getDb();
  const [items, [lastSync], statements] = await Promise.all([
    db.select().from(s.bankInbox).where(eq(s.bankInbox.status, "pending")).orderBy(desc(s.bankInbox.postedOn)),
    db.select().from(s.settings).where(eq(s.settings.key, "bank_last_sync")),
    db.select().from(s.accountStatements).where(isNotNull(s.accountStatements.computedBalanceCents)).orderBy(desc(s.accountStatements.statementDate)),
  ]);

  if (!configured && items.length === 0) {
    return (
      <section className="flex items-center gap-3 rounded-3xl border border-dashed bg-surface px-4 py-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-foreground/60">
          <Landmark className="size-4" />
        </span>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Conecta Mercury</span> para traer tus movimientos cada mañana: crea un token <em>Read only</em> y guárdalo en
          Vercel como <code className="rounded bg-surface-2 px-1 text-xs">MERCURY_API_TOKEN</code>.
        </p>
      </section>
    );
  }

  const accountName = new Map(o.accounts.map((a) => [a.id, a.name]));
  const latest = new Map<string, (typeof statements)[number]>();
  for (const st of statements) if (!latest.has(st.accountId)) latest.set(st.accountId, st);
  const balances = [...latest.values()];
  const withSuggestion = items.filter((i) => {
    const sug = i.suggestion as Suggestion | null;
    return sug && !(sug.as === "expense" && !sug.categoryId);
  });
  const lastIso = lastSync ? String(lastSync.value) : null;

  const byDay = new Map<string, typeof items>();
  for (const i of items) byDay.set(i.postedOn, [...(byDay.get(i.postedOn) ?? []), i]);

  return (
    <section className="overflow-hidden rounded-3xl border bg-surface shadow-card">
      {/* ── Barra de sincronización ─────────────────────────────────────── */}
      <div className="flex flex-col gap-3 border-b bg-surface-2/50 px-4 py-3.5 md:flex-row md:items-center md:justify-between md:px-5">
        <div className="flex items-center gap-3">
          <span className="relative flex size-10 shrink-0 items-center justify-center rounded-2xl bg-highlight text-highlight-foreground">
            <Landmark className="size-4.5" />
            <span className={cn("absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-surface", configured ? "bg-success" : "bg-warning")} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Mercury {configured ? "conectado" : "sin token"}</p>
            <p className="text-xs text-muted-foreground">
              {lastIso ? (
                <>
                  Sincronizado{" "}
                  <time dateTime={lastIso} title={new Date(lastIso).toLocaleString("es-HN", { dateStyle: "long", timeStyle: "short", timeZone: TZ })}>
                    {ago(lastIso)}
                  </time>
                </>
              ) : (
                "Aún no se ha sincronizado"
              )}
              {configured && " · automático cada día a las 6:00 a. m."}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {balances.map((st) => {
            const diff = st.closingBalanceCents - (st.computedBalanceCents ?? 0);
            const ok = diff === 0;
            return (
              <span
                key={st.id}
                title={ok ? "El saldo del banco coincide con tus libros" : `Banco ${formatMoney(st.closingBalanceCents)} · libros ${formatMoney(st.computedBalanceCents ?? 0)}`}
                className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs", ok ? "bg-success/12 text-success" : "bg-warning/15 text-foreground")}
              >
                {ok ? <CircleCheck className="size-3.5" /> : <TriangleAlert className="size-3.5 text-warning" />}
                {accountName.get(st.accountId)?.replace(/^Mercury\s+/, "")}
                {!ok && <span className="font-medium tabular">{diff > 0 ? "+" : "−"}{formatMoney(Math.abs(diff))}</span>}
              </span>
            );
          })}
          {canWrite && configured && (
            <ActionButton action={syncBankAction} size="sm" variant="outline" pendingLabel="Sincronizando…">
              <RefreshCw className="size-3.5" /> Sincronizar
            </ActionButton>
          )}
        </div>
      </div>

      {/* ── Bandeja ─────────────────────────────────────────────────────── */}
      {items.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-4 md:px-5">
          <span className="flex size-9 items-center justify-center rounded-full bg-success/12 text-success">
            <Check className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium">Todo al día</p>
            <p className="text-xs text-muted-foreground">Cada movimiento de Mercury ya está en tus libros.</p>
          </div>
        </div>
      ) : (
        <div className="px-4 pt-3.5 pb-2 md:px-5">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold">
                Por clasificar
                <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground tabular">{items.length}</span>
              </h2>
              <p className="text-xs text-muted-foreground">
                No cuentan en tus libros hasta que las confirmes.
                {withSuggestion.length > 0 && ` ${withSuggestion.length} ya tienen sugerencia.`}
              </p>
            </div>
            {canWrite && withSuggestion.length > 1 && (
              <ActionButton action={acceptAllSuggestionsAction} size="sm" pendingLabel="Registrando…">
                <CheckCheck className="size-4" /> Aceptar {withSuggestion.length} sugerencias
              </ActionButton>
            )}
          </div>

          {[...byDay.entries()].map(([day, list]) => (
            <div key={day}>
              <p className="pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase first-letter:uppercase">{dayLabel(day)}</p>
              <ul className="divide-y divide-border/60">
                {list.map((i) => {
                  const sug = i.suggestion as Suggestion | null;
                  const ready = !!sug && !(sug.as === "expense" && !sug.categoryId);
                  const inflow = i.amountCents > 0;
                  const Kind = sug ? SUGGESTION[sug.as].icon : inflow ? ArrowDownLeft : ArrowUpRight;
                  const extra = [...(sug?.as === "match" ? ["match"] : []), ...(sug?.as === "transfer" ? ["transfer"] : []), ...(inflow ? ["payout"] : []), "ignore"].map((v) => ({
                    value: v,
                    label: EXTRA_LABEL[v],
                  }));
                  const title = i.counterparty ?? i.description ?? "Movimiento";
                  return (
                    <li key={i.id} className="group flex items-center gap-3 py-2.5">
                      <span
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-xl",
                          inflow ? "bg-success/12 text-success" : "bg-money-out/12 text-money-out-text"
                        )}
                      >
                        <Kind className="size-4" />
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{title}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span>{accountName.get(i.accountId)?.replace(/^Mercury\s+/, "")}</span>
                          {sug ? (
                            <span
                              title={sug.label}
                              className="inline-flex items-center gap-1 rounded-full bg-accent/60 px-2 py-0.5 font-medium text-accent-foreground"
                            >
                              <Sparkles className="size-3" />
                              {SUGGESTION[sug.as].label}
                              {sug.as === "expense" && sug.categoryId && ` · ${o.names.category.get(sug.categoryId) ?? ""}`}
                            </span>
                          ) : (
                            <span className="rounded-full border border-dashed px-2 py-0.5">Sin sugerencia</span>
                          )}
                        </div>
                      </div>

                      <span className={cn("shrink-0 text-sm font-semibold tabular", inflow ? "text-success" : "text-money-out-text")}>
                        {inflow ? "+" : "−"}
                        {formatMoney(Math.abs(i.amountCents))}
                      </span>

                      {canWrite && (
                        <div className="flex shrink-0 items-center gap-1">
                          {ready && (
                            <ActionButton
                              action={acceptSuggestionAction.bind(null, i.id)}
                              size="icon"
                              className="size-8 rounded-full"
                              aria-label={`Aceptar: ${SUGGESTION[sug!.as].label}`}
                              title={`Aceptar: ${sug!.label}`}
                            >
                              <Check className="size-4" />
                            </ActionButton>
                          )}
                          <FormDialog
                            title="Clasificar movimiento"
                            description={`${title} · ${inflow ? "+" : "−"}${formatMoney(Math.abs(i.amountCents))} · ${formatDate(i.postedOn)}${i.description && i.counterparty ? ` · ${i.description}` : ""}`}
                            action={resolveInboxAction}
                            submitLabel="Registrar"
                            trigger={
                              <Button size="sm" variant={ready ? "ghost" : "outline"} className={cn(ready && "text-muted-foreground")}>
                                {ready ? "Cambiar" : "Clasificar"}
                              </Button>
                            }
                          >
                            <Hidden name="id" value={i.id} />
                            {sug && (
                              <p className="flex items-center gap-2 rounded-xl bg-accent/40 px-3 py-2 text-xs">
                                <Sparkles className="size-3.5 shrink-0" /> Sugerencia: {sug.label}
                              </p>
                            )}
                            <ClassifyFields
                              products={o.productOptions}
                              categories={o.expenseCategories}
                              direction={inflow ? "in" : "out"}
                              extra={extra}
                              defaults={sug ? { as: sug.as, categoryId: sug.categoryId, productId: sug.productId } : undefined}
                            />
                            <TextField label="Descripción" name="description" defaultValue={sug?.description ?? i.counterparty ?? i.description} />
                            {i.counterparty && <CheckboxField label={`Recordar para “${i.counterparty}”`} name="remember" hint="La próxima vez llega ya sugerido." />}
                          </FormDialog>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

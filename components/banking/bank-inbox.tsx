import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { AlertTriangle, CheckCheck, Inbox, RefreshCw, Sparkles } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import type { FormOptions } from "@/lib/data/options";
import { mercuryConfigured } from "@/lib/mercury/client";
import type { Suggestion } from "@/lib/services/bank-sync";
import { acceptAllSuggestionsAction, resolveInboxAction, syncBankAction } from "@/lib/actions/bank-sync";
import { formatDate, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/crud/page-header";
import { FormDialog } from "@/components/crud/form-dialog";
import { ConfirmButton } from "@/components/crud/confirm-button";
import { CheckboxField, Hidden, TextField } from "@/components/crud/fields";
import { ClassifyFields } from "@/components/forms/classify-fields";
import { cn } from "@/lib/utils";

const EXTRA_LABEL: Record<string, string> = {
  match: "Ya está registrado (solo enlazar)",
  transfer: "Transferencia entre mis cuentas",
  payout: "Payout de Skool",
  ignore: "Ignorar (no registrar)",
};

/** Bandeja "Por clasificar": lo que llegó de Mercury y aún no está en los libros. */
export async function BankInbox({ o, canWrite }: { o: FormOptions; canWrite: boolean }) {
  const db = await getDb();
  const [items, [lastSync], statements] = await Promise.all([
    db.select().from(s.bankInbox).where(eq(s.bankInbox.status, "pending")).orderBy(asc(s.bankInbox.postedOn)),
    db.select().from(s.settings).where(eq(s.settings.key, "bank_last_sync")),
    db
      .select()
      .from(s.accountStatements)
      .where(and(isNotNull(s.accountStatements.computedBalanceCents)))
      .orderBy(desc(s.accountStatements.statementDate)),
  ]);
  const configured = mercuryConfigured();
  if (!configured && items.length === 0) {
    return (
      <Panel title="Sincronización con Mercury" description="Trae tus movimientos de Mercury cada mañana a una bandeja para clasificarlos con un clic.">
        <p className="text-sm text-muted-foreground">
          Para activarla, crea un token <span className="font-medium">Read only</span> en Mercury (Settings → API tokens) y guárdalo en Vercel como{" "}
          <code className="rounded bg-surface-2 px-1">MERCURY_API_TOKEN</code>.
        </p>
      </Panel>
    );
  }

  const accountName = new Map(o.accounts.map((a) => [a.id, a.name]));
  const latest = new Map<string, (typeof statements)[number]>();
  for (const st of statements) if (!latest.has(st.accountId)) latest.set(st.accountId, st);
  const mismatches = [...latest.values()].filter((st) => st.closingBalanceCents !== st.computedBalanceCents);
  const suggested = items.filter((i) => {
    const sug = i.suggestion as Suggestion | null;
    return sug && !(sug.as === "expense" && !sug.categoryId);
  }).length;

  return (
    <Panel
      title={`Por clasificar${items.length ? ` (${items.length})` : ""}`}
      description={`Movimientos de Mercury que aún no están en tus libros.${lastSync ? ` Última sincronización: ${new Date(String(lastSync.value)).toLocaleString("es-HN", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Tegucigalpa" })}.` : ""}`}
      actions={
        canWrite && (
          <div className="flex flex-wrap gap-2">
            {suggested > 0 && (
              <ConfirmButton
                title={`¿Confirmar ${suggested} sugerencias?`}
                description="Se registran tal como las propone el sistema. Las que no se puedan aplicar se quedan en la bandeja."
                confirmLabel="Confirmar todas"
                action={acceptAllSuggestionsAction}
                trigger={<Button size="sm" variant="outline"><CheckCheck className="size-4" /> Confirmar sugeridas ({suggested})</Button>}
              />
            )}
            {configured && (
              <ConfirmButton
                title="¿Sincronizar con Mercury?"
                description="Trae las transacciones nuevas a esta bandeja. No cambia tus libros."
                confirmLabel="Sincronizar"
                action={syncBankAction}
                trigger={<Button size="sm"><RefreshCw className="size-4" /> Sincronizar ahora</Button>}
              />
            )}
          </div>
        )
      }
    >
      {mismatches.map((st) => (
        <p key={st.id} className="mb-3 flex gap-2 rounded-xl bg-warning/10 px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            <span className="font-medium">{accountName.get(st.accountId)}</span>: el banco dice {formatMoney(st.closingBalanceCents)} y tus libros{" "}
            {formatMoney(st.computedBalanceCents ?? 0)} ({formatDate(st.statementDate)}).
            {items.length ? " Clasifica lo pendiente y vuelve a sincronizar." : " Revisa movimientos faltantes o concilia la cuenta."}
          </span>
        </p>
      ))}

      {items.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Inbox className="size-4" /> Todo clasificado.
        </p>
      ) : (
        <ul className="divide-y">
          {items.map((i) => {
            const sug = i.suggestion as Suggestion | null;
            const inflow = i.amountCents > 0;
            const extra = [
              ...(sug?.as === "match" ? ["match"] : []),
              ...(sug?.as === "transfer" ? ["transfer"] : []),
              ...(inflow ? ["payout"] : []),
            ].map((v) => ({ value: v, label: EXTRA_LABEL[v] }));
            return (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-medium">{i.counterparty ?? i.description ?? "Movimiento"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatDate(i.postedOn)} · {accountName.get(i.accountId)}
                    {i.description && i.counterparty ? ` · ${i.description}` : ""}
                  </p>
                  {sug && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <Sparkles className="size-3" /> {sug.label}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={cn("font-medium tabular", inflow ? "text-money-net" : "text-money-out-text")}>
                    {inflow ? "+" : "−"}
                    {formatMoney(Math.abs(i.amountCents))}
                  </span>
                  {canWrite && (
                    <FormDialog
                      title="Clasificar movimiento"
                      description={`${i.counterparty ?? "Movimiento"} · ${inflow ? "+" : "−"}${formatMoney(Math.abs(i.amountCents))} · ${formatDate(i.postedOn)}`}
                      action={resolveInboxAction}
                      submitLabel="Registrar"
                      trigger={<Button size="sm" variant={sug ? "default" : "outline"}>{sug ? "Revisar" : "Clasificar"}</Button>}
                    >
                      <Hidden name="id" value={i.id} />
                      <ClassifyFields
                        products={o.productOptions}
                        categories={o.expenseCategories}
                        direction={inflow ? "in" : "out"}
                        extra={[...extra, { value: "ignore", label: EXTRA_LABEL.ignore }]}
                        defaults={sug ? { as: sug.as, categoryId: sug.categoryId, productId: sug.productId } : undefined}
                      />
                      <TextField label="Descripción" name="description" defaultValue={sug?.description ?? i.counterparty ?? i.description} />
                      {i.counterparty && <CheckboxField label={`Recordar para "${i.counterparty}"`} name="remember" hint="La próxima vez llega ya sugerido." />}
                    </FormDialog>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

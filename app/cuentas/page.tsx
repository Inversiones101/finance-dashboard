import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { ArrowLeftRight, CreditCard, Landmark, PiggyBank, Plus, Scale, Send, Store, Tag, Trash2, Wallet, type LucideIcon } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getFormOptions } from "@/lib/data/options";
import { ClassifyFields } from "@/components/forms/classify-fields";
import { BankInbox } from "@/components/banking/bank-inbox";
import { todayIn } from "@/lib/today";
import { formatDate, formatMoney } from "@/lib/format";
import { ACCOUNT_STATUS, ACCOUNT_TYPE, CURRENCY_OPTIONS, MOVEMENT_TYPE, toOptions } from "@/lib/labels";
import { addMovementAction, classifyMovementAction, deleteMovementAction, payCardAction, payoutAction, reconcileAction, saveAccountAction, transferAction } from "@/lib/actions/banking";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, Panel, Empty } from "@/components/crud/page-header";
import { FormDialog } from "@/components/crud/form-dialog";
import { ConfirmButton } from "@/components/crud/confirm-button";
import { StatusBadge } from "@/components/crud/status-badge";
import { FieldRow, Hidden, MoneyField, SelectField, TextField } from "@/components/crud/fields";
import { cn } from "@/lib/utils";

type Account = typeof s.financialAccounts.$inferSelect;

const TYPE_ICON: Record<Account["type"], LucideIcon> = { checking: Landmark, savings: PiggyBank, credit_card: CreditCard, processor: Store, cash: Wallet };

function AccountFields({ d }: { d?: Account }) {
  return (
    <>
      {d && <Hidden name="id" value={d.id} />}
      <FieldRow>
        <TextField label="Nombre" name="name" defaultValue={d?.name} required placeholder="Ej. Mercury Checking" />
        <TextField label="Institución" name="institution" defaultValue={d?.institution} placeholder="Ej. Mercury" />
      </FieldRow>
      <Hidden name="owner" value="llc" />
      <SelectField label="Tipo" name="type" options={toOptions(ACCOUNT_TYPE)} defaultValue={d?.type ?? "checking"} hint="“Saldo en plataforma” es para Skool u otras plataformas donde facturas: solo sale dinero por payout." />
      <FieldRow>
        <SelectField label="Moneda" name="currency" options={CURRENCY_OPTIONS} defaultValue={d?.currency ?? "USD"} />
        <SelectField label="Estado" name="status" options={toOptions(ACCOUNT_STATUS)} defaultValue={d?.status ?? "active"} />
      </FieldRow>
      <FieldRow>
        <MoneyField label="Saldo inicial" name="openingBalanceCents" defaultCents={d?.openingBalanceCents} hint="Saldo el día que empiezas a registrarla." />
        <TextField label="Fecha del saldo inicial" name="openingDate" type="date" defaultValue={d?.openingDate} />
      </FieldRow>
      <FieldRow>
        <TextField label="Últimos 4 dígitos" name="last4" defaultValue={d?.last4} />
        <TextField label="Orden en listas" name="sortOrder" type="number" defaultValue={d?.sortOrder ?? 0} />
      </FieldRow>
      <p className="text-xs font-medium text-muted-foreground">Solo tarjetas de crédito</p>
      <FieldRow>
        <MoneyField label="Límite de crédito" name="creditLimitCents" defaultCents={d?.creditLimitCents} />
        <TextField label="Día de pago" name="paymentDueDay" type="number" defaultValue={d?.paymentDueDay} hint="Ej. 30. Calcula el vencimiento de cada cargo." />
      </FieldRow>
      <FieldRow>
        <SelectField
          label="Plazo de pago"
          name="repaymentTerms"
          options={[
            { value: "daily", label: "Diario (IO al inicio)" },
            { value: "monthly", label: "Mensual (30 días)" },
          ]}
          defaultValue={d?.repaymentTerms}
          placeholder="—"
        />
        <TextField label="Cashback %" name="cashbackPct" type="number" defaultValue={d?.cashbackPct} hint="Mercury IO: 1.5" />
      </FieldRow>
    </>
  );
}

export default async function CuentasPage({ searchParams }: PageProps<"/cuentas">) {
  const user = await requirePage("banking");
  const canWrite = can(user.permissions, "banking", "write");
  const canAdmin = can(user.permissions, "banking", "admin");
  const today = todayIn();
  const { cuenta, seccion } = await searchParams;
  const db = await getDb();
  const o = await getFormOptions();

  const [movements, pendingCard] = await Promise.all([
    db.select().from(s.cashMovements).orderBy(desc(s.cashMovements.movementDate), desc(s.cashMovements.createdAt)),
    db.select().from(s.expenses).where(eq(s.expenses.fundingSource, "llc_credit")).orderBy(asc(s.expenses.expenseDate)),
  ]);

  const balance = (a: Account) => a.openingBalanceCents + movements.filter((m) => m.accountId === a.id).reduce((x, m) => x + m.amountCents, 0);
  const cardOwed = (a: Account) =>
    pendingCard.filter((e) => e.paymentAccountId === a.id && e.status === "pending").reduce((x, e) => x + Math.round(e.amountCents * Number(e.fxRateToUsd)), 0);

  const llc = o.accounts.filter((a) => a.owner === "llc");
  const banks = llc.filter((a) => a.type !== "processor");
  const platforms = llc.filter((a) => a.type === "processor");
  const selectedId =
    typeof cuenta === "string"
      ? cuenta
      : seccion === "plataformas"
        ? platforms.find((a) => a.status === "active")?.id
        : (banks.find((a) => a.status === "active" && a.type !== "credit_card")?.id ?? platforms.find((a) => a.status === "active")?.id);
  const selected = o.accounts.find((a) => a.id === selectedId);
  const selectedMoves = movements.filter((m) => m.accountId === selectedId);

  const AccountCard = ({ a }: { a: Account }) => {
    const isCard = a.type === "credit_card";
    const owed = isCard ? cardOwed(a) : 0;
    return (
      <Link
        href={`/cuentas?cuenta=${a.id}`}
        scroll={false}
        className={cn(
          "flex flex-col gap-2 rounded-2xl border bg-surface p-4 shadow-card transition-transform hover:-translate-y-0.5",
          a.id === selectedId && "ring-2 ring-primary",
          a.status !== "active" && "opacity-70"
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", a.type === "processor" ? "bg-accent text-accent-foreground" : "bg-surface-2 text-foreground/70")}>
              {(() => {
                const Icon = TYPE_ICON[a.type];
                return <Icon className="size-4" />;
              })()}
            </span>
            <div>
            <p className="font-medium">
              {a.name}
              {a.last4 && <span className="text-muted-foreground"> ••{a.last4}</span>}
            </p>
            <p className="text-xs text-muted-foreground">{ACCOUNT_TYPE[a.type]}</p>
            </div>
          </div>
          {a.status !== "active" && <StatusBadge label={ACCOUNT_STATUS[a.status]} tone="warn" />}
        </div>
        {isCard ? (
          <div>
            <p className={cn("font-heading text-xl font-bold tabular", owed > 0 && "text-money-out-text")}>{formatMoney(owed)}</p>
            <p className="text-xs text-muted-foreground">
              por pagar{a.creditLimitCents ? ` · disponible ${formatMoney(a.creditLimitCents - owed)}` : ""}
              {a.cashbackPct ? ` · ${Number(a.cashbackPct)}% cashback` : ""}
            </p>
          </div>
        ) : (
          <p className="font-heading text-xl font-bold tabular">{formatMoney(balance(a), a.currency)}</p>
        )}
      </Link>
    );
  };

  const bankOptions = o.llcBankAccounts;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Cuentas" description="Bancos y tarjetas de la LLC (medios de pago) y plataformas de cobro como Skool, cuyo saldo solo sale por payout.">
        {canWrite && bankOptions.length > 1 && (
          <FormDialog title="Transferencia entre cuentas de la LLC" action={transferAction} trigger={<Button variant="outline"><ArrowLeftRight className="size-4" /> Transferir</Button>}>
            <FieldRow>
              <SelectField label="Desde" name="fromId" options={bankOptions} required placeholder="Elige…" />
              <SelectField label="Hacia" name="toId" options={bankOptions} required placeholder="Elige…" />
            </FieldRow>
            <FieldRow>
              <MoneyField label="Monto" name="amountCents" required />
              <TextField label="Fecha" name="date" type="date" defaultValue={today} required />
            </FieldRow>
            <TextField label="Descripción" name="description" placeholder="Ej. Payout de Skool a Mercury" />
          </FormDialog>
        )}
        {canAdmin && (
          <FormDialog title="Nueva cuenta" action={saveAccountAction} wide trigger={<Button><Plus className="size-4" /> Nueva cuenta</Button>}>
            <AccountFields />
          </FormDialog>
        )}
      </PageHeader>

      <BankInbox o={o} canWrite={canWrite} />

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Bancos y tarjetas · medios de pago de la LLC</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {banks.map((a) => (
            <AccountCard key={a.id} a={a} />
          ))}
        </div>
      </section>

      {platforms.length > 0 && (
        <section id="plataformas">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Plataformas de cobro · lo facturado que aún no llega al banco</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {platforms.map((a) => (
              <AccountCard key={a.id} a={a} />
            ))}
          </div>
        </section>
      )}

      {selected && (
        <Panel
          title={`Movimientos · ${selected.name}`}
          description={selected.type === "credit_card" ? "Cargos pendientes de pago" : `Saldo actual ${formatMoney(balance(selected), selected.currency)}`}
          actions={
            <div className="flex flex-wrap gap-2">
              {canAdmin && (
                <FormDialog title={`Editar ${selected.name}`} action={saveAccountAction} wide trigger={<Button variant="ghost" size="sm">Editar cuenta</Button>}>
                  <AccountFields d={selected} />
                </FormDialog>
              )}
              {canWrite && selected.type === "credit_card" && selected.owner === "llc" && cardOwed(selected) > 0 && (
                <FormDialog
                  title={`Pagar ${selected.name}`}
                  description={`Marca como pagados todos los cargos pendientes (${formatMoney(cardOwed(selected))}).${selected.cashbackPct ? ` Se registra el ${Number(selected.cashbackPct)}% de cashback.` : ""}`}
                  action={payCardAction}
                  submitLabel="Pagar tarjeta"
                  trigger={<Button size="sm"><CreditCard className="size-4" /> Pagar tarjeta</Button>}
                >
                  <Hidden name="cardId" value={selected.id} />
                  <SelectField label="Pagar desde" name="fromAccountId" options={bankOptions} required placeholder="Elige…" />
                  <TextField label="Fecha" name="date" type="date" defaultValue={today} required />
                </FormDialog>
              )}
              {canWrite && selected.type === "processor" && balance(selected) > 0 && (
                <FormDialog
                  title={`Payout desde ${selected.name}`}
                  description="El dinero de la plataforma solo sale por payout: a una cuenta bancaria de la LLC (entra a la caja) o directo al dueño (se registra como retiro)."
                  action={payoutAction}
                  submitLabel="Registrar payout"
                  trigger={<Button size="sm"><Send className="size-4" /> Registrar payout</Button>}
                >
                  <Hidden name="platformId" value={selected.id} />
                  <SelectField
                    label="Destino"
                    name="toAccountId"
                    options={[...bankOptions.map((b) => ({ ...b, group: "Cuentas de la LLC" })), { value: "owner", label: "Al dueño (retiro)", group: "Dueño" }]}
                    placeholder="Elige…"
                    required
                  />
                  <FieldRow>
                    <MoneyField label="Monto" name="amountCents" defaultCents={balance(selected)} required />
                    <TextField label="Fecha" name="date" type="date" defaultValue={today} required />
                  </FieldRow>
                </FormDialog>
              )}
              {canWrite && selected.type !== "credit_card" && selected.type !== "processor" && selected.owner === "llc" && (
                <FormDialog
                  title="Movimiento del estado de cuenta"
                  description="Registra lo que ves en el banco como lo que realmente es. Ingresos y gastos aparecen en sus módulos y en los reportes."
                  action={addMovementAction}
                  wide
                  trigger={<Button variant="outline" size="sm"><Plus className="size-4" /> Movimiento</Button>}
                >
                  <Hidden name="accountId" value={selected.id} />
                  <ClassifyFields products={o.productOptions} categories={o.expenseCategories} />
                  <FieldRow>
                    <MoneyField label="Monto" name="amountCents" required />
                    <TextField label="Fecha" name="date" type="date" defaultValue={today} required />
                  </FieldRow>
                  <TextField label="Descripción" name="description" required placeholder="Ej. Depósito inicial, Claude Pro…" />
                </FormDialog>
              )}
              {canAdmin && selected.type !== "credit_card" && selected.owner === "llc" && (
                <FormDialog
                  title={`Conciliar ${selected.name}`}
                  description="Escribe el saldo que muestra el banco. Si no coincide con el sistema, se registra un ajuste por la diferencia."
                  action={reconcileAction}
                  submitLabel="Conciliar"
                  trigger={<Button variant="outline" size="sm"><Scale className="size-4" /> Conciliar</Button>}
                >
                  <Hidden name="accountId" value={selected.id} />
                  <FieldRow>
                    <TextField label="Fecha del estado" name="date" type="date" defaultValue={today} required />
                    <MoneyField label="Saldo según el banco" name="statementBalanceCents" required />
                  </FieldRow>
                </FormDialog>
              )}
            </div>
          }
        >
          {selected.type === "credit_card" ? (
            (() => {
              const charges = pendingCard.filter((e) => e.paymentAccountId === selected.id);
              return charges.length === 0 ? (
                <Empty>Sin cargos registrados con esta tarjeta.</Empty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Cargo</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {charges.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-muted-foreground">{formatDate(e.expenseDate)}</TableCell>
                        <TableCell>{e.description}</TableCell>
                        <TableCell>
                          <StatusBadge label={e.status === "paid" ? `Pagado ${formatDate(e.paidOn)}` : "Por pagar"} tone={e.status === "paid" ? "good" : "warn"} />
                        </TableCell>
                        <TableCell className="text-right text-money-out-text tabular">{formatMoney(e.amountCents, e.currency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              );
            })()
          ) : selectedMoves.length === 0 ? (
            <Empty>{selected.status === "pending_opening" ? "Esta cuenta aún no está abierta. Cámbiala a “Activa” cuando la abras." : "Sin movimientos todavía."}</Empty>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Concepto</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedMoves.map((m) => {
                    const linked = !!(m.revenueId || m.expenseId || m.debtPaymentId || m.ownerLedgerId || m.taxObligationId);
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(m.movementDate)}</TableCell>
                        <TableCell>
                          {m.description}
                          {m.reconciled && <span className="ml-1.5 text-xs text-success">✓ conciliado</span>}
                          {m.type === "adjustment" && !linked && !m.transferGroupId && !/conciliaci/i.test(m.description ?? "") && (
                            <span className="ml-1.5 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">sin clasificar</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{MOVEMENT_TYPE[m.type] ?? m.type}</TableCell>
                        <TableCell className={cn("text-right font-medium whitespace-nowrap tabular", m.amountCents < 0 ? "text-money-out-text" : "text-success")}>
                          {m.amountCents > 0 ? "+" : ""}
                          {formatMoney(m.amountCents, m.currency)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {canWrite && !linked && !m.transferGroupId && (
                            <FormDialog
                              title="Clasificar movimiento"
                              description={`${formatDate(m.movementDate)} · ${m.description ?? ""} · ${formatMoney(m.amountCents, m.currency)}`}
                              action={classifyMovementAction}
                              wide
                              submitLabel="Clasificar"
                              trigger={
                                <Button variant="ghost" size="icon" className="size-8" aria-label="Clasificar" title="Clasificar">
                                  <Tag className="size-3.5" />
                                </Button>
                              }
                            >
                              <Hidden name="id" value={m.id} />
                              <ClassifyFields products={o.productOptions} categories={o.expenseCategories} direction={m.amountCents > 0 ? "in" : "out"} />
                              <TextField label="Descripción" name="description" defaultValue={m.description} required />
                            </FormDialog>
                          )}
                          {canAdmin && !linked && (
                            <ConfirmButton
                              title="¿Eliminar movimiento?"
                              description={m.transferGroupId ? "Se eliminan ambos lados de la transferencia." : undefined}
                              destructive
                              confirmLabel="Eliminar"
                              action={deleteMovementAction.bind(null, m.id)}
                              trigger={
                                <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-danger" aria-label="Eliminar">
                                  <Trash2 className="size-3.5" />
                                </Button>
                              }
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
      )}


    </div>
  );
}

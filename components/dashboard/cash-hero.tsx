"use client";

import { useState } from "react";
import { CreditCard, Landmark, PiggyBank, Wallet } from "lucide-react";
import { formatUSD } from "@/lib/format";
import { cn } from "@/lib/utils";

type Account = { name: string; type?: string; status: "active" | "pending_opening" | "closed"; balance: number | null };
type Card = { name: string; status: "active" | "pending_opening" | "closed"; balance: number; available: number | null };

type Selected = { kind: "account"; name: string } | { kind: "card"; name: string } | null;

/**
 * Caja en bancos. Las píldoras no muestran montos: al tocar una, el número grande cambia al
 * saldo de esa cuenta (o a lo que debe la tarjeta). Tocarla otra vez vuelve al total.
 */
export function CashHero({ total, accounts, cards }: { total: number; accounts: Account[]; cards: Card[] }) {
  const [selected, setSelected] = useState<Selected>(null);
  const active = accounts.filter((a) => a.status === "active" && a.balance !== null && a.balance > 0);

  const account = selected?.kind === "account" ? accounts.find((a) => a.name === selected.name) : undefined;
  const card = selected?.kind === "card" ? cards.find((c) => c.name === selected.name) : undefined;

  const label = account ? `Saldo en ${account.name}` : card ? `${card.name} · por pagar` : "Cash disponible en bancos";
  const value = account
    ? account.status === "active"
      ? formatUSD(account.balance ?? 0, { cents: true })
      : account.status === "pending_opening"
        ? "Por abrir"
        : "Cerrada"
    : card
      ? card.status === "active"
        ? formatUSD(card.balance, { cents: true })
        : "Por abrir"
      : formatUSD(total, { cents: true });
  const sub = card?.status === "active" && card.available !== null ? `Crédito disponible ${formatUSD(card.available)}` : null;

  const toggle = (next: NonNullable<Selected>) => setSelected((cur) => (cur?.kind === next.kind && cur.name === next.name ? null : next));
  const pill = "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-all hover:bg-highlight-foreground/20 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none";

  return (
    <div className="relative h-full overflow-hidden rounded-3xl bg-highlight p-6 text-highlight-foreground shadow-card md:p-7">
      {/* Burbujas decorativas: el "toque de diversión" sin distraer. */}
      <div className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-accent/20 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-20 left-1/3 size-40 rounded-full bg-accent/10 blur-2xl" />

      <div className="relative flex items-center gap-2 text-sm opacity-80">
        {card ? <CreditCard className="size-4" /> : account?.type === "savings" ? <PiggyBank className="size-4" /> : account ? <Landmark className="size-4" /> : <Wallet className="size-4" />}
        {label}
      </div>
      <p key={label} className="relative mt-3 animate-in font-heading text-4xl font-bold tabular duration-300 fade-in slide-in-from-bottom-1 md:text-5xl" aria-live="polite">
        {value}
      </p>
      {sub && <p className="relative mt-1 text-xs opacity-75">{sub}</p>}
      {!selected && accounts.every((a) => a.status !== "active") && (
        <p className="relative mt-1 text-xs opacity-75">Las cuentas de Mercury se activan al abrirlas (tras el EIN).</p>
      )}

      {/* Distribución por cuenta: cada cuenta activa ocupa su proporción del total. */}
      <div className="relative mt-5 flex h-2 gap-0.5 overflow-hidden rounded-full bg-highlight-foreground/15">
        {active.map((a, i) => (
          <div
            key={a.name}
            className={cn("h-full rounded-full bg-accent transition-opacity", account && account.name !== a.name && "opacity-30!")}
            style={{ width: `${((a.balance ?? 0) / (total || 1)) * 100}%`, opacity: 1 - i * 0.25 }}
          />
        ))}
      </div>

      <div className="relative mt-5 flex flex-wrap gap-2" role="group" aria-label="Ver saldo por cuenta">
        {accounts.map((a) => {
          const on = account?.name === a.name;
          return (
            <button key={a.name} type="button" aria-pressed={on} onClick={() => toggle({ kind: "account", name: a.name })} className={cn(pill, on ? "bg-accent text-accent-foreground hover:bg-accent" : "bg-highlight-foreground/10")}>
              {a.type === "savings" ? <PiggyBank className="size-3 opacity-70" /> : <Landmark className="size-3 opacity-70" />}
              <span className={a.status === "active" ? "size-1.5 rounded-full bg-accent" : "size-1.5 rounded-full bg-warning"} />
              {a.name}
            </button>
          );
        })}
        {cards.map((c) => {
          const on = card?.name === c.name;
          return (
            <button key={c.name} type="button" aria-pressed={on} onClick={() => toggle({ kind: "card", name: c.name })} className={cn(pill, "border", on ? "border-accent bg-accent text-accent-foreground hover:bg-accent" : "border-highlight-foreground/20")}>
              <CreditCard className="size-3 opacity-70" />
              {c.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

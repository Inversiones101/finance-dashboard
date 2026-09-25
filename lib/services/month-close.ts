/**
 * Cierre de mes. Los meses se cierran en orden: "cerrado hasta septiembre" bloquea septiembre y
 * todo lo anterior (la regla vive en la base: ver migración 0010). Reabrir devuelve el último mes.
 */
import { and, eq, gte, lte, sql } from "drizzle-orm";
import * as s from "@/db/schema";
import type { Tx } from "./ledger";
import { getSkoolFee } from "./platform-fee";

const KEY = "books_closed_through";

const prevMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};
const nextMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
};
const lastDay = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

export async function closedThrough(tx: Tx): Promise<string | null> {
  const [row] = await tx.select().from(s.settings).where(eq(s.settings.key, KEY));
  return typeof row?.value === "string" ? row.value : null;
}

/** Siguiente mes que se puede cerrar: el que sigue al último cerrado, o el mes pasado si nunca se ha cerrado. */
export async function nextToClose(tx: Tx, today: string) {
  const closed = await closedThrough(tx);
  const candidate = closed ? nextMonth(closed) : prevMonth(today.slice(0, 7));
  return candidate < today.slice(0, 7) ? candidate : null; // el mes en curso no se cierra
}

export type CheckItem = { ok: boolean; label: string; detail?: string; href?: string };

/** Revisión antes de cerrar: lo que conviene tener al día para que los números del mes sean finales. */
export async function closeChecklist(tx: Tx, month: string): Promise<CheckItem[]> {
  const from = `${month}-01`;
  const to = lastDay(month);
  const [{ inbox }] = await tx
    .select({ inbox: sql<number>`count(*)::int` })
    .from(s.bankInbox)
    .where(and(eq(s.bankInbox.status, "pending"), gte(s.bankInbox.postedOn, from), lte(s.bankInbox.postedOn, to)));
  const [{ pendingExp }] = await tx
    .select({ pendingExp: sql<number>`count(*)::int` })
    .from(s.expenses)
    .where(and(eq(s.expenses.status, "pending"), eq(s.expenses.fundingSource, "llc_cash"), gte(s.expenses.expenseDate, from), lte(s.expenses.expenseDate, to)));
  const fee = await getSkoolFee(tx);
  const [{ noFee }] = await tx
    .select({ noFee: sql<number>`count(*)::int` })
    .from(s.revenues)
    .innerJoin(s.financialAccounts, eq(s.financialAccounts.id, s.revenues.depositAccountId))
    .where(and(eq(s.revenues.processorFeeCents, 0), eq(s.financialAccounts.type, "processor"), gte(s.revenues.revenueDate, from), lte(s.revenues.revenueDate, to)));
  const statements = await tx
    .select({ st: s.accountStatements, name: s.financialAccounts.name })
    .from(s.accountStatements)
    .innerJoin(s.financialAccounts, eq(s.financialAccounts.id, s.accountStatements.accountId))
    .where(and(gte(s.accountStatements.statementDate, from), sql`${s.accountStatements.computedBalanceCents} is not null`));
  const latest = new Map<string, (typeof statements)[number]>();
  for (const r of statements.sort((a, b) => b.st.statementDate.localeCompare(a.st.statementDate))) if (!latest.has(r.st.accountId)) latest.set(r.st.accountId, r);
  const off = [...latest.values()].filter((r) => r.st.closingBalanceCents !== r.st.computedBalanceCents).map((r) => r.name);

  return [
    { ok: inbox === 0, label: "Movimientos de Mercury clasificados", detail: inbox ? `${inbox} por clasificar de este mes` : undefined, href: "/cuentas" },
    { ok: off.length === 0, label: "Bancos cuadrados con tus libros", detail: off.length ? `No cuadra: ${off.join(", ")}` : undefined, href: "/cuentas" },
    { ok: !fee || noFee === 0, label: "Cobros de Skool con su comisión", detail: fee && noFee ? `${noFee} cobros sin comisión` : undefined, href: "/catalogos" },
    { ok: pendingExp === 0, label: "Gastos del mes pagados", detail: pendingExp ? `${pendingExp} gastos pendientes de pago` : undefined, href: "/gastos" },
  ];
}

export async function closeMonth(tx: Tx, month: string, today: string) {
  const next = await nextToClose(tx, today);
  if (month !== next) throw new Error(next ? `Primero cierra ${next}.` : "No hay meses por cerrar: el mes en curso se cierra cuando termine.");
  await tx.insert(s.settings).values({ key: KEY, value: month }).onConflictDoUpdate({ target: s.settings.key, set: { value: month, updatedAt: new Date() } });
}

/** Reabre el último mes cerrado. */
export async function reopenMonth(tx: Tx) {
  const closed = await closedThrough(tx);
  if (!closed) throw new Error("No hay meses cerrados.");
  await tx.update(s.settings).set({ value: prevMonth(closed), updatedAt: new Date() }).where(eq(s.settings.key, KEY));
  return closed;
}

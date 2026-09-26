/**
 * Sincronización con el banco (Mercury) → bandeja "Por clasificar".
 *
 * 1. `syncBank` trae las transacciones ya asentadas de cada cuenta enlazada y las deja en
 *    `bank_inbox` (sin tocar los libros) y guarda el saldo que reporta el banco.
 * 2. `refreshSuggestions` propone qué es cada una: un movimiento que ya registraste a mano,
 *    una transferencia entre tus cuentas, una regla aprendida o un payout de Skool.
 * 3. `resolveInboxItem` la convierte en el registro contable correcto reutilizando las reglas
 *    de siempre (`classifyMovement`, `transfer`, `payout`).
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import * as s from "@/db/schema";
import { normName } from "@/lib/import/skool-csv";
import type { BankClient } from "@/lib/mercury/client";
import { errorMessage } from "@/lib/actions/result";
import { accountBalanceCents, addMonthsToDate, classifyMovement, payout, transfer, type MovementClass, type Tx } from "./ledger";

export type InboxAs = MovementClass | "match" | "transfer" | "payout";
export type Suggestion = {
  as: InboxAs;
  label: string;
  description?: string | null;
  categoryId?: string | null;
  productId?: string | null;
  movementId?: string; // match
  pairId?: string; // transfer
};

const toCents = (usd: number) => Math.round(usd * 100);
const daysBetween = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

// ── 1. Sincronizar ─────────────────────────────────────────────────────────

export async function syncBank(tx: Tx, client: BankClient, today: string) {
  const ours = await tx
    .select()
    .from(s.financialAccounts)
    .where(and(eq(s.financialAccounts.owner, "llc"), inArray(s.financialAccounts.type, ["checking", "savings"]), sql`lower(coalesce(${s.financialAccounts.institution}, '')) = 'mercury'`));
  const remote = await client.accounts();

  // Enlaza cada cuenta de Mercury con la nuestra: por id guardado o, la primera vez, por tipo.
  const links: { local: (typeof ours)[number]; remote: (typeof remote)[number] }[] = [];
  for (const r of remote) {
    let local = ours.find((a) => a.externalId === r.id);
    if (!local) {
      const candidates = ours.filter((a) => !a.externalId && a.type === r.kind && !links.some((l) => l.local.id === a.id));
      local = candidates.find((a) => normName(r.name).includes(a.type)) ?? (candidates.length === 1 ? candidates[0] : undefined);
      if (!local) continue;
      await tx
        .update(s.financialAccounts)
        .set({ externalId: r.id, status: local.status === "pending_opening" ? "active" : local.status, updatedAt: new Date() })
        .where(eq(s.financialAccounts.id, local.id));
    }
    links.push({ local, remote: r });
  }

  let added = 0;
  const balances: { account: string; bankCents: number; booksCents: number }[] = [];
  for (const { local, remote: r } of links) {
    const [last] = await tx.select({ d: s.bankInbox.postedOn }).from(s.bankInbox).where(eq(s.bankInbox.accountId, local.id)).orderBy(desc(s.bankInbox.postedOn)).limit(1);
    const start = last ? addDays(last.d, -7) : (local.openingDate ?? addMonthsToDate(today, -3));
    const known = new Set(
      (await tx.select({ e: s.cashMovements.externalId }).from(s.cashMovements).where(and(eq(s.cashMovements.accountId, local.id), sql`${s.cashMovements.externalId} is not null`))).map((x) => x.e)
    );
    for (const t of await client.transactions(r.id, start)) {
      if (t.status !== "sent" || !t.postedAt || known.has(t.id)) continue;
      const inserted = await tx
        .insert(s.bankInbox)
        .values({
          accountId: local.id,
          externalId: t.id,
          postedOn: t.postedAt.slice(0, 10),
          amountCents: toCents(t.amount),
          counterparty: t.counterpartyName?.trim() || null,
          description: [t.bankDescription, t.note].filter(Boolean).join(" · ") || null,
        })
        .onConflictDoNothing()
        .returning({ id: s.bankInbox.id });
      added += inserted.length;
    }

    // Saldo del banco vs. libros de hoy → base de la alerta de descuadre.
    const bankCents = toCents(r.currentBalance);
    const booksCents = await accountBalanceCents(tx, local.id, today);
    balances.push({ account: local.name, bankCents, booksCents });
    await tx
      .insert(s.accountStatements)
      .values({ accountId: local.id, statementDate: today, closingBalanceCents: bankCents, computedBalanceCents: booksCents })
      .onConflictDoUpdate({
        target: [s.accountStatements.accountId, s.accountStatements.statementDate],
        set: { closingBalanceCents: bankCents, computedBalanceCents: booksCents, updatedAt: new Date() },
        setWhere: isNull(s.accountStatements.reconciledAt),
      });
  }

  await refreshSuggestions(tx);
  await tx
    .insert(s.settings)
    .values({ key: "bank_last_sync", value: new Date().toISOString() })
    .onConflictDoUpdate({ target: s.settings.key, set: { value: new Date().toISOString(), updatedAt: new Date() } });
  return { linked: links.map((l) => l.local.name), unlinked: remote.filter((r) => !links.some((l) => l.remote.id === r.id)).map((r) => r.name), added, balances };
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── 2. Sugerencias ─────────────────────────────────────────────────────────

export async function refreshSuggestions(tx: Tx) {
  const pending = await tx.select().from(s.bankInbox).where(eq(s.bankInbox.status, "pending")).orderBy(asc(s.bankInbox.postedOn));
  if (!pending.length) return;
  const rules = await tx.select().from(s.classificationRules);
  const accountIds = [...new Set(pending.map((p) => p.accountId))];
  const loose = await tx
    .select()
    .from(s.cashMovements)
    .where(and(inArray(s.cashMovements.accountId, accountIds), isNull(s.cashMovements.externalId)));
  const claimed = new Set<string>();

  for (const item of pending) {
    const text = normName(`${item.counterparty ?? ""} ${item.description ?? ""}`);
    let sug: Suggestion | null = null;

    // a) Ya lo registraste a mano: mismo monto y cuenta, fecha cercana.
    const same = loose
      .filter((m) => !claimed.has(m.id) && m.accountId === item.accountId && m.amountCents === item.amountCents && daysBetween(m.movementDate, item.postedOn) <= 4)
      .sort((a, b) => daysBetween(a.movementDate, item.postedOn) - daysBetween(b.movementDate, item.postedOn))[0];
    if (same) {
      claimed.add(same.id);
      sug = { as: "match", movementId: same.id, label: `Ya registrado: ${same.description ?? "movimiento"} (${same.movementDate})` };
    }

    // b) Transferencia entre tus cuentas: la otra punta está en la bandeja.
    if (!sug) {
      const pair = pending.find((o) => o.id !== item.id && o.accountId !== item.accountId && o.amountCents === -item.amountCents && daysBetween(o.postedOn, item.postedOn) <= 2);
      if (pair) sug = { as: "transfer", pairId: pair.id, label: "Transferencia entre tus cuentas" };
    }

    // c) Regla aprendida por contraparte.
    if (!sug) {
      const rule = rules.filter((r) => text.includes(r.pattern)).sort((a, b) => b.pattern.length - a.pattern.length)[0];
      if (rule) sug = { as: rule.as as InboxAs, categoryId: rule.categoryId, productId: rule.productId, description: rule.description, label: `Regla: "${rule.pattern}"` };
    }

    // d) Conocidos.
    if (!sug && item.amountCents > 0 && text.includes("skool")) sug = { as: "payout", label: "Parece un payout de Skool" };
    if (!sug && item.amountCents > 0 && /cashback|interest|interes/.test(text)) sug = { as: "other_income", label: "Cashback o intereses" };

    await tx.update(s.bankInbox).set({ suggestion: sug, updatedAt: new Date() }).where(eq(s.bankInbox.id, item.id));
  }
}

// ── 3. Resolver ────────────────────────────────────────────────────────────

export type Resolution = {
  as: InboxAs | "ignore";
  description?: string | null;
  categoryId?: string | null;
  productId?: string | null;
  remember?: boolean;
};

async function item(tx: Tx, id: string) {
  const [i] = await tx.select().from(s.bankInbox).where(eq(s.bankInbox.id, id));
  if (!i) throw new Error("La transacción ya no está en la bandeja.");
  if (i.status !== "pending") throw new Error("Esta transacción ya fue clasificada.");
  return i;
}

async function done(tx: Tx, id: string, movementId: string | null, userId: string | null, status: "classified" | "ignored" = "classified") {
  await tx.update(s.bankInbox).set({ status, cashMovementId: movementId, resolvedBy: userId, updatedAt: new Date() }).where(eq(s.bankInbox.id, id));
}

async function movementByGroup(tx: Tx, group: string, accountId: string) {
  const [m] = await tx.select().from(s.cashMovements).where(and(eq(s.cashMovements.transferGroupId, group), eq(s.cashMovements.accountId, accountId)));
  return m;
}

export async function resolveInboxItem(tx: Tx, id: string, r: Resolution, userId: string | null) {
  const i = await item(tx, id);
  const sug = i.suggestion as Suggestion | null;
  const description = r.description?.trim() || i.counterparty || i.description || "Movimiento bancario";

  if (r.as === "ignore") return done(tx, i.id, null, userId, "ignored");

  if (r.as === "match") {
    const movementId = sug?.as === "match" ? sug.movementId : undefined;
    const [m] = movementId ? await tx.select().from(s.cashMovements).where(eq(s.cashMovements.id, movementId)) : [];
    if (!m || m.externalId || m.amountCents !== i.amountCents) throw new Error("No encontré el movimiento ya registrado; clasifícala de otra forma.");
    await tx.update(s.cashMovements).set({ externalId: i.externalId, updatedAt: new Date() }).where(eq(s.cashMovements.id, m.id));
    return done(tx, i.id, m.id, userId);
  }

  if (r.as === "transfer") {
    const pairId = sug?.as === "transfer" ? sug.pairId : undefined;
    const pair = pairId ? await item(tx, pairId) : null;
    if (!pair || pair.amountCents !== -i.amountCents) throw new Error("No encontré la otra punta de la transferencia en la bandeja.");
    const [out, into] = i.amountCents < 0 ? [i, pair] : [pair, i];
    const group = await transfer(tx, { fromId: out.accountId, toId: into.accountId, date: out.postedOn, amountCents: into.amountCents, description: null, userId });
    for (const side of [out, into]) {
      const m = await movementByGroup(tx, group, side.accountId);
      await tx.update(s.cashMovements).set({ externalId: side.externalId }).where(eq(s.cashMovements.id, m.id));
      await done(tx, side.id, m.id, userId);
    }
    return;
  }

  if (r.as === "payout") {
    if (i.amountCents <= 0) throw new Error("Un payout es dinero que entra.");
    const [skool] = await tx
      .select()
      .from(s.financialAccounts)
      .where(and(eq(s.financialAccounts.type, "processor"), eq(s.financialAccounts.owner, "llc"), sql`lower(${s.financialAccounts.name}) like '%skool%'`));
    if (!skool) throw new Error("No encontré la cuenta \"Saldo Skool\".");
    const group = await payout(tx, { platformId: skool.id, toAccountId: i.accountId, date: i.postedOn, amountCents: i.amountCents, userId });
    const m = await movementByGroup(tx, group!, i.accountId);
    await tx.update(s.cashMovements).set({ externalId: i.externalId }).where(eq(s.cashMovements.id, m.id));
    await done(tx, i.id, m.id, userId);
  } else {
    const [a] = await tx.select().from(s.financialAccounts).where(eq(s.financialAccounts.id, i.accountId));
    const [row] = await tx
      .insert(s.cashMovements)
      .values({ accountId: i.accountId, movementDate: i.postedOn, type: "adjustment", amountCents: i.amountCents, currency: a.currency, description, externalId: i.externalId, createdBy: userId })
      .returning();
    await classifyMovement(tx, row.id, { as: r.as, description, categoryId: r.categoryId ?? null, productId: r.productId ?? null, userId });
    const [m] = await tx.select({ id: s.cashMovements.id }).from(s.cashMovements).where(and(eq(s.cashMovements.accountId, i.accountId), eq(s.cashMovements.externalId, i.externalId)));
    await done(tx, i.id, m?.id ?? null, userId);
  }

  if (r.remember && i.counterparty) {
    const pattern = normName(i.counterparty);
    const values = { as: r.as, categoryId: r.categoryId ?? null, productId: r.productId ?? null, description: r.description?.trim() || null };
    await tx.insert(s.classificationRules).values({ pattern, ...values }).onConflictDoUpdate({ target: s.classificationRules.pattern, set: { ...values, updatedAt: new Date() } });
  }
}

/** Confirma de una vez todas las que tienen sugerencia completa. Las que fallen se quedan en la bandeja. */
export async function acceptAllSuggestions(tx: Tx, userId: string | null) {
  const pending = await tx.select().from(s.bankInbox).where(eq(s.bankInbox.status, "pending")).orderBy(asc(s.bankInbox.postedOn));
  let ok = 0;
  const failed: string[] = [];
  for (const p of pending) {
    const sug = p.suggestion as Suggestion | null;
    if (!sug || (sug.as === "expense" && !sug.categoryId)) continue;
    const [fresh] = await tx.select({ status: s.bankInbox.status }).from(s.bankInbox).where(eq(s.bankInbox.id, p.id));
    if (fresh.status !== "pending") continue; // la otra punta de una transferencia ya la resolvió
    try {
      await tx.transaction(async (sp) => resolveInboxItem(sp as unknown as Tx, p.id, { as: sug.as, description: sug.description, categoryId: sug.categoryId, productId: sug.productId }, userId));
      ok++;
    } catch (e) {
      failed.push(`${p.counterparty ?? p.description ?? p.externalId}: ${errorMessage(e)}`);
    }
  }
  return { ok, failed };
}

// ── Alertas para el dashboard ──────────────────────────────────────────────

/** Bandeja pendiente y cuentas cuyo saldo en el banco no cuadra con los libros. */
export async function bankAlerts(tx: Tx): Promise<{ severity: "warning" | "info"; title: string; detail: string; href: string }[]> {
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.bankInbox).where(eq(s.bankInbox.status, "pending"));
  const statements = await tx
    .select({ st: s.accountStatements, name: s.financialAccounts.name })
    .from(s.accountStatements)
    .innerJoin(s.financialAccounts, eq(s.financialAccounts.id, s.accountStatements.accountId))
    .where(sql`${s.accountStatements.computedBalanceCents} is not null`)
    .orderBy(desc(s.accountStatements.statementDate));
  const latest = new Map<string, (typeof statements)[number]>();
  for (const r of statements) if (!latest.has(r.st.accountId)) latest.set(r.st.accountId, r);

  const out: Awaited<ReturnType<typeof bankAlerts>> = [];

  // Recordatorio semanal: el CSV de Skool es la fuente de altas, bajas y cobros.
  const [lastImport] = await tx
    .select({ at: s.auditLog.createdAt })
    .from(s.auditLog)
    .where(eq(s.auditLog.action, "import_skool"))
    .orderBy(desc(s.auditLog.createdAt))
    .limit(1);
  const days = lastImport ? Math.floor((Date.now() - lastImport.at.getTime()) / 86_400_000) : null;
  if (days === null || days >= 7) {
    out.push({
      severity: "info",
      title: days === null ? "Importa el CSV de miembros de Skool" : `Hace ${days} días que no importas el CSV de Skool`,
      detail: "Mantiene al día altas, bajas, cambios de plan y cobros. Skool → Settings → Members → Export, y súbelo en Miembros.",
      href: "/miembros",
    });
  }
  if (n > 0) out.push({ severity: "info", title: `${n} movimiento${n === 1 ? "" : "s"} de Mercury por clasificar`, detail: "No cuentan en tus libros hasta que los confirmes.", href: "/cuentas" });
  for (const { st, name } of latest.values()) {
    const diff = st.closingBalanceCents - (st.computedBalanceCents ?? 0);
    if (diff === 0) continue;
    out.push({
      severity: "warning",
      title: `${name} no cuadra con el banco`,
      detail: `Diferencia de ${(Math.abs(diff) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}${n > 0 ? ": clasifica lo pendiente y vuelve a sincronizar." : "."}`,
      href: "/cuentas",
    });
  }
  return out;
}

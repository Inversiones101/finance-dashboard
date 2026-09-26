/**
 * Importación del export de miembros de Skool (CSV). Todo aquí es puro: lee el archivo y
 * calcula qué cambiaría, sin tocar la base. `lib/services/skool-import.ts` lo aplica.
 *
 * Columnas que usamos: FirstName, LastName, Email, JoinedDate, Price, Recurring Interval, LTV.
 */

export type Interval = "monthly" | "annual";

export type SkoolRow = {
  name: string;
  email: string | null;
  joinedOn: string; // YYYY-MM-DD
  interval: Interval | null; // null = miembro gratis
  priceCents: number; // 0 = gratis
  ltvCents: number;
  invitedBy: string | null; // afiliado que lo refirió ("Invited By")
};

/** Cobros de prueba ($1) y diferencias de centavos no son ingresos reales. */
export const TEST_CHARGE_MAX_CENTS = 100;

// ── CSV ─────────────────────────────────────────────────────────────────────

/** Parser CSV (RFC 4180): comillas, comas y saltos de línea dentro de campos. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const money = (v: string | undefined) => {
  const n = Number((v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

const INTERVALS: Record<string, Interval> = { month: "monthly", monthly: "monthly", year: "annual", annual: "annual", yearly: "annual" };

export function parseSkoolCsv(text: string): { rows: SkoolRow[]; error: string | null } {
  const [header, ...data] = parseCsv(text);
  if (!header) return { rows: [], error: "El archivo está vacío." };
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  const idx = { first: col("FirstName"), last: col("LastName"), email: col("Email"), joined: col("JoinedDate"), price: col("Price"), interval: col("Recurring Interval"), ltv: col("LTV") };
  const invitedCol = col("Invited By"); // opcional
  const missing = Object.entries(idx).filter(([, i]) => i < 0).map(([k]) => k);
  if (missing.length) return { rows: [], error: "No parece el export de miembros de Skool (faltan columnas: FirstName, LastName, Email, JoinedDate, Price, Recurring Interval o LTV)." };

  const rows: SkoolRow[] = [];
  for (const r of data) {
    const name = `${r[idx.first] ?? ""} ${r[idx.last] ?? ""}`.replace(/\s+/g, " ").trim();
    const joined = (r[idx.joined] ?? "").trim().slice(0, 10);
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(joined)) continue;
    const priceCents = money(r[idx.price]);
    const interval = INTERVALS[(r[idx.interval] ?? "").trim().toLowerCase()] ?? null;
    const paying = priceCents > TEST_CHARGE_MAX_CENTS && interval !== null;
    rows.push({
      name,
      email: (r[idx.email] ?? "").trim().toLowerCase() || null,
      joinedOn: joined,
      interval: paying ? interval : null,
      priceCents: paying ? priceCents : 0,
      ltvCents: money(r[idx.ltv]),
      invitedBy: invitedCol >= 0 ? (r[invitedCol] ?? "").trim() || null : null,
    });
  }
  return { rows, error: rows.length ? null : "El archivo no tiene miembros." };
}

// ── Plan de cambios ─────────────────────────────────────────────────────────

export type ExistingMember = {
  id: string;
  name: string;
  email: string | null;
  billingInterval: string;
  priceCents: number;
  status: "active" | "canceled";
  currentPeriodEnd: string;
  recordedCents: number; // Σ cobros ya registrados (bruto)
};

export type Charge = { date: string; amountCents: number; label: string };

export type PlanItem =
  | { kind: "new"; row: SkoolRow; periodEnd: string; charges: Charge[] }
  | { kind: "update"; row: SkoolRow; member: ExistingMember; changes: string[]; periodEnd: string; charges: Charge[] }
  | { kind: "reactivate"; row: SkoolRow; member: ExistingMember; periodEnd: string; charges: Charge[] }
  | { kind: "cancel"; member: ExistingMember; reason: string }
  | { kind: "unchanged"; member: ExistingMember };

export type ImportPlan = { items: PlanItem[]; warnings: string[]; skipped: { free: number } };

export const normName = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const MONTHS: Record<Interval, number> = { monthly: 1, annual: 12 };

function addMonths(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** Próxima renovación: el primer aniversario del alta (por frecuencia) que cae después de hoy. */
export function nextRenewal(joinedOn: string, interval: Interval, today: string) {
  let k = 1;
  let d = addMonths(joinedOn, MONTHS[interval]);
  while (d <= today && k < 1200) d = addMonths(joinedOn, MONTHS[interval] * ++k);
  return d;
}

/**
 * Lo que Skool cobró (LTV) menos lo ya registrado = cobros que faltan en los libros.
 * El primero cae en la fecha de alta; lo demás, hoy, como renovación. Sobrantes de $1 o menos
 * (cobros de prueba) se ignoran.
 */
function missingCharges(row: SkoolRow, recordedCents: number, today: string): Charge[] {
  let missing = row.ltvCents - recordedCents;
  if (missing <= TEST_CHARGE_MAX_CENTS) return [];
  const out: Charge[] = [];
  if (recordedCents === 0) {
    const first = Math.min(missing, row.priceCents);
    out.push({ date: row.joinedOn, amountCents: first, label: "Alta en Skool" });
    missing -= first;
  }
  if (missing > TEST_CHARGE_MAX_CENTS) out.push({ date: today, amountCents: missing, label: "Renovación (según LTV de Skool)" });
  return out;
}

export function planSkoolImport(rows: SkoolRow[], existing: ExistingMember[], today: string): ImportPlan {
  const byEmail = new Map(existing.filter((m) => m.email).map((m) => [m.email!.toLowerCase(), m]));
  const byName = new Map(existing.map((m) => [normName(m.name), m]));
  const seen = new Set<string>();
  const items: PlanItem[] = [];
  const warnings: string[] = [];
  let free = 0;

  for (const row of rows) {
    const member = (row.email && byEmail.get(row.email)) || byName.get(normName(row.name));
    if (member) seen.add(member.id);

    if (!row.interval) {
      free++;
      if (member?.status === "active") items.push({ kind: "cancel", member, reason: "Aparece en Skool sin plan de pago" });
      continue;
    }

    const periodEnd = nextRenewal(row.joinedOn, row.interval, today);
    if (member && member.recordedCents - row.ltvCents > TEST_CHARGE_MAX_CENTS) {
      warnings.push(`${row.name}: tienes registrados más cobros (${member.recordedCents / 100} USD) de lo que Skool reporta (${row.ltvCents / 100} USD). ¿Hubo un reembolso? Revísalo a mano.`);
    }
    const charges = missingCharges(row, member?.recordedCents ?? 0, today);

    if (!member) {
      items.push({ kind: "new", row, periodEnd, charges });
      continue;
    }
    if (member.status === "canceled") {
      items.push({ kind: "reactivate", row, member, periodEnd, charges });
      continue;
    }
    const changes: string[] = [];
    if (member.billingInterval !== row.interval) changes.push(row.interval === "annual" ? "Cambió a plan anual" : "Cambió a plan mensual");
    if (member.priceCents !== row.priceCents) changes.push(`Precio ${member.priceCents / 100} → ${row.priceCents / 100} USD`);
    if (row.email && member.email !== row.email) changes.push("Correo");
    if (member.currentPeriodEnd !== periodEnd) changes.push("Fecha de renovación");
    if (charges.length) changes.push(charges.length === 1 ? "1 cobro nuevo" : `${charges.length} cobros nuevos`);
    items.push(changes.length ? { kind: "update", row, member, changes, periodEnd, charges } : { kind: "unchanged", member });
  }

  // Quien paga en tus libros y ya no aparece en Skool se fue.
  for (const m of existing) {
    if (m.status === "active" && !seen.has(m.id)) items.push({ kind: "cancel", member: m, reason: "Ya no aparece en Skool" });
  }

  const active = existing.filter((m) => m.status === "active").length;
  const cancels = items.filter((i) => i.kind === "cancel").length;
  if (active >= 4 && cancels > active / 2) {
    warnings.push(`El archivo daría de baja a ${cancels} de ${active} miembros activos. Verifica que sea el export completo de miembros.`);
  }
  return { items, warnings, skipped: { free } };
}

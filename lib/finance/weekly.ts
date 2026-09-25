/**
 * Resumen de la semana (los últimos 7 días contra los 7 anteriores). Reemplaza al correo de los
 * lunes: vive en el dashboard y se destaca los lunes.
 */
import type { FinanceData } from "./engine";

const DAY = 86_400_000;
const shift = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function computeWeekly(data: FinanceData, asOf: string) {
  const from = shift(asOf, -6);
  const prevFrom = shift(asOf, -13);
  const prevTo = shift(asOf, -7);
  const inWeek = (d: string) => d >= from && d <= asOf;
  const inPrev = (d: string) => d >= prevFrom && d <= prevTo;
  const banks = new Set(data.accounts.filter((a) => a.owner === "llc" && (a.type === "checking" || a.type === "savings")).map((a) => a.id));

  const revenues = data.revenues.filter((r) => r.status !== "refunded" && r.status !== "disputed");
  const net = (f: (d: string) => boolean) => sum(revenues.filter((r) => f(r.date)).map((r) => Math.round((r.grossCents - r.processorFeeCents - r.affiliateFeeCents) * r.fxRateToUsd)));
  const spent = (f: (d: string) => boolean) =>
    sum(data.expenses.filter((e) => e.status !== "void" && e.fundingSource !== "owner_personal" && f(e.date)).map((e) => Math.round(e.amountCents * e.fxRateToUsd)));
  const events = data.memberEvents ?? [];

  return {
    from,
    to: asOf,
    isMonday: new Date(`${asOf}T12:00:00Z`).getUTCDay() === 1,
    revenue: net(inWeek) / 100,
    revenuePrev: net(inPrev) / 100,
    expenses: spent(inWeek) / 100,
    cashChange: sum(data.movements.filter((m) => banks.has(m.accountId) && inWeek(m.date)).map((m) => Math.round(m.amountCents * m.fxRateToUsd))) / 100,
    newMembers: (data.members ?? []).filter((m) => inWeek(m.startedOn)).length,
    cancellations: events.filter((e) => e.type === "cancel" && inWeek(e.date)).length,
    mrrChange: sum(events.filter((e) => inWeek(e.date)).map((e) => e.mrrDeltaCents)) / 100,
  };
}

export type Weekly = ReturnType<typeof computeWeekly>;

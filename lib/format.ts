const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export function formatUSD(value: number, { cents = false } = {}) {
  return (cents ? usdCents : usd).format(value);
}

export function formatPct(value: number) {
  return `${Math.round(value * 100)}%`;
}

/** "2026-09-30" → "30 sep" sin desfase de zona horaria. */
export function formatShortDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-HN", { day: "numeric", month: "short" }).replace(".", "");
}

export function daysUntil(iso: string, fromIso: string) {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${iso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Monto en centavos con su moneda: $1,234.56 o L2,000.00. */
export function formatMoney(cents: number, currency: "USD" | "HNL" = "USD") {
  const v = (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = cents < 0 ? "−" : "";
  return `${sign}${currency === "HNL" ? "L" : "$"}${v.replace("-", "")}`;
}

/** "2026-09-30" → "30 sep 2026". */
export function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-HN", { day: "numeric", month: "short", year: "numeric" }).replace(".", "");
}

/**
 * Detección de anomalías para las Alertas, sin que nadie pregunte. Puro. Cada regla es
 * conservadora a propósito: mejor pocas alertas ciertas que muchas dudosas.
 */
import type { FinanceData, Insight } from "./engine";

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const money = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function computeAnomalies(data: FinanceData, asOf: string): Insight[] {
  const out: Insight[] = [];
  const expenses = data.expenses
    .filter((e) => e.status !== "void" && e.fundingSource !== "owner_personal" && e.date <= asOf)
    .map((e) => ({ ...e, usd: Math.round(e.amountCents * e.fxRateToUsd), key: norm(e.description) }));
  const recent = (e: { date: string }, n: number) => days(e.date, asOf) <= n;

  // 1. Posible duplicado: mismo concepto y monto, con 3 días o menos de diferencia.
  const seen = new Set<string>();
  for (const a of expenses.filter((e) => recent(e, 45))) {
    const twin = expenses.find((b) => b !== a && b.key === a.key && b.usd === a.usd && days(a.date, b.date) <= 3);
    const id = [a.key, a.usd].join("|");
    if (twin && !seen.has(id)) {
      seen.add(id);
      out.push({ severity: "warning", title: `¿Gasto duplicado? ${a.description}`, detail: `Dos cargos de ${money(a.usd)} (${a.date} y ${twin.date}). Si es un error, bórralo.`, href: "/gastos" });
    }
  }

  // 2. Subió de precio: un gasto recurrente cuyo último cargo es >5% mayor que el anterior.
  const byKey = new Map<string, typeof expenses>();
  for (const e of expenses) byKey.set(e.key, [...(byKey.get(e.key) ?? []), e]);
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    const [last, prev] = [...list].sort((a, b) => b.date.localeCompare(a.date));
    if (!recent(last, 40) || days(last.date, prev.date) < 20 || days(last.date, prev.date) > 400) continue;
    if (last.usd > prev.usd * 1.05 && last.usd - prev.usd >= 100) {
      out.push({ severity: "info", title: `${last.description} subió de precio`, detail: `${money(prev.usd)} → ${money(last.usd)} (+${Math.round((last.usd / prev.usd - 1) * 100)}%). Revisa si el plan cambió.`, href: "/suscripciones" });
    }
  }

  // 3. Renovación vencida sin cobro: miembro activo cuyo periodo terminó hace más de 3 días.
  const overdue = (data.members ?? []).filter((m) => m.status === "active" && days(m.currentPeriodEnd, asOf) > 3 && m.currentPeriodEnd < asOf);
  if (overdue.length) {
    out.push({
      severity: "warning",
      title: `${overdue.length} renovación${overdue.length === 1 ? "" : "es"} vencida${overdue.length === 1 ? "" : "s"} sin cobro`,
      detail: `${overdue.slice(0, 3).map((m) => m.name).join(", ")}${overdue.length > 3 ? "…" : ""}. Importa el CSV de Skool o regístralas; si se fueron, dalos de baja.`,
      href: "/miembros",
    });
  }

  // 4. Fuera de lo normal: un gasto reciente de más de 3× la mediana de su categoría.
  const byCat = new Map<string, number[]>();
  for (const e of expenses.filter((x) => days(x.date, asOf) <= 180 && !recent(x, 30))) byCat.set(e.categoryId, [...(byCat.get(e.categoryId) ?? []), e.usd]);
  const catName = new Map(data.categories.map((c) => [c.id, c.name]));
  for (const e of expenses.filter((x) => recent(x, 30))) {
    const hist = byCat.get(e.categoryId) ?? [];
    if (hist.length < 3) continue;
    const med = median(hist);
    if (e.usd >= 5000 && e.usd > med * 3) {
      out.push({ severity: "info", title: `Gasto fuera de lo normal en ${catName.get(e.categoryId) ?? "una categoría"}`, detail: `${e.description}: ${money(e.usd)}, cuando lo usual es ${money(med)}.`, href: "/gastos" });
    }
  }
  return out;
}

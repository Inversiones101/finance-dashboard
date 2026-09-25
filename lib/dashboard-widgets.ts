/** Widgets del dashboard: el usuario elige cuáles ver y en qué orden. */
export const WIDGETS = [
  { id: "money", label: "Caja y plataformas de cobro" },
  { id: "alerts", label: "Alertas" },
  { id: "results", label: "Resultado del mes" },
  { id: "kpis", label: "Indicadores clave" },
  { id: "summary", label: "Resumen rápido" },
  { id: "chart", label: "Evolución mensual" },
  { id: "upcoming", label: "Próximos movimientos" },
  { id: "breakdowns", label: "Ingresos y gastos por categoría" },
  { id: "forecast", label: "Pronóstico de MRR" },
  { id: "budgets", label: "Presupuesto del mes" },
  { id: "goals", label: "Metas" },
  { id: "breakeven", label: "Punto de equilibrio" },
  { id: "movement", label: "Movimiento del MRR" },
  { id: "weekly", label: "Resumen de la semana" },
] as const;

export type WidgetId = (typeof WIDGETS)[number]["id"];
export type DashboardPrefs = { order: WidgetId[]; hidden: WidgetId[]; alertsCollapsed?: boolean };

const IDS = WIDGETS.map((w) => w.id) as WidgetId[];

/** Normaliza lo guardado: agrega widgets nuevos al final y descarta los que ya no existen. */
export function resolvePrefs(raw: unknown): DashboardPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<DashboardPrefs>;
  const order = (Array.isArray(r.order) ? r.order : []).filter((id): id is WidgetId => IDS.includes(id as WidgetId));
  for (const id of IDS) if (!order.includes(id)) order.push(id);
  const hidden = (Array.isArray(r.hidden) ? r.hidden : []).filter((id): id is WidgetId => IDS.includes(id as WidgetId));
  return { order, hidden, alertsCollapsed: !!r.alertsCollapsed };
}

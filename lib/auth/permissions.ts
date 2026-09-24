export const MODULES = [
  "dashboard",
  "revenue",
  "expenses",
  "subscriptions",
  "debts",
  "banking",
  "owner_equity",
  "taxes",
  "reports",
  "planning",
  "settings",
  "users",
] as const;
export type Module = (typeof MODULES)[number];
export type Level = "none" | "read" | "write" | "admin";
export type Permissions = Record<Module, Level>;

export const MODULE_LABELS: Record<Module, string> = {
  dashboard: "Dashboard",
  revenue: "Ingresos",
  expenses: "Gastos",
  subscriptions: "Suscripciones",
  debts: "Deudas y compromisos",
  banking: "Cuentas",
  owner_equity: "Aportes del dueño",
  taxes: "Impuestos",
  reports: "Reportes",
  planning: "Presupuestos y metas",
  settings: "Catálogos",
  users: "Usuarios",
};

export const LEVEL_LABELS: Record<Level, string> = { none: "Sin acceso", read: "Ver", write: "Editar", admin: "Administrar" };

const RANK: Record<Level, number> = { none: 0, read: 1, write: 2, admin: 3 };

export function can(perms: Permissions | undefined, module: Module, level: Level = "read") {
  return !!perms && RANK[perms[module] ?? "none"] >= RANK[level];
}

/** Página principal de cada módulo, en el orden del menú. */
export const MODULE_HOME: Record<Module, string> = {
  dashboard: "/",
  revenue: "/ingresos",
  expenses: "/gastos",
  subscriptions: "/suscripciones",
  banking: "/cuentas",
  debts: "/deudas",
  owner_equity: "/propietario",
  taxes: "/impuestos",
  reports: "/reportes",
  planning: "/presupuestos",
  settings: "/catalogos",
  users: "/usuarios",
};

/** Primera página que el rol puede ver; `null` si no tiene acceso a nada. */
export function firstAllowedPath(perms: Permissions) {
  // Aportes del dueño no cuenta: es privado del dueño, no un módulo de rol.
  const m = (Object.keys(MODULE_HOME) as Module[]).find((mod) => mod !== "owner_equity" && can(perms, mod, "read"));
  return m ? MODULE_HOME[m] : null;
}

import type { Module } from "@/lib/auth/permissions";
import {
  LayoutDashboard,
  TrendingUp,
  Receipt,
  Repeat,
  Landmark,
  Wallet,
  FileText,
  BarChart3,
  Users,
  UserCog,
  Shapes,
  PiggyBank,
  Target,
  type LucideIcon,
} from "lucide-react";

/** `module` coincide con el enum `app_module`: el menú solo muestra lo que el rol puede ver. */
export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  module: Module;
};

/** Finanzas primero; la comunidad (miembros) va aparte, más abajo. */
export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "General",
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard, module: "dashboard" }],
  },
  {
    label: "Rentabilidad",
    items: [
      { href: "/ingresos", label: "Ingresos", icon: TrendingUp, module: "revenue" },
      { href: "/gastos", label: "Gastos", icon: Receipt, module: "expenses" },
      { href: "/suscripciones", label: "Suscripciones", icon: Repeat, module: "subscriptions" },
    ],
  },
  {
    label: "Caja y balance",
    items: [
      { href: "/cuentas", label: "Cuentas", icon: Wallet, module: "banking" },
      { href: "/deudas", label: "Deudas y compromisos", icon: Landmark, module: "debts" },
      { href: "/impuestos", label: "Impuestos", icon: FileText, module: "taxes" },
    ],
  },
  {
    label: "Planeación",
    items: [
      { href: "/presupuestos", label: "Presupuestos", icon: PiggyBank, module: "planning" },
      { href: "/metas", label: "Metas", icon: Target, module: "planning" },
    ],
  },
  {
    label: "Análisis",
    items: [{ href: "/reportes", label: "Reportes", icon: BarChart3, module: "reports" }],
  },
  {
    label: "Comunidad",
    items: [{ href: "/miembros", label: "Miembros y MRR", icon: Users, module: "revenue" }],
  },
  {
    label: "Configuración",
    items: [
      { href: "/catalogos", label: "Catálogos", icon: Shapes, module: "settings" },
      { href: "/usuarios", label: "Usuarios", icon: UserCog, module: "users" },
    ],
  },
];

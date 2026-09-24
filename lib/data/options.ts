import "server-only";
import { asc } from "drizzle-orm";
import type { Option } from "@/components/crud/fields";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { ACCOUNT_STATUS } from "@/lib/labels";

/** Catálogos para los selectores de los formularios. Todo sale de la BD. */
export async function getFormOptions() {
  const db = await getDb();
  const [accounts, categories, products, counterparties] = await Promise.all([
    db.select().from(s.financialAccounts).orderBy(asc(s.financialAccounts.sortOrder), asc(s.financialAccounts.name)),
    db.select().from(s.categories).orderBy(asc(s.categories.name)),
    db.select().from(s.products).orderBy(asc(s.products.name)),
    db.select().from(s.counterparties).orderBy(asc(s.counterparties.name)),
  ]);

  const accountLabel = (a: (typeof accounts)[number]) =>
    `${a.name}${a.last4 ? ` ••${a.last4}` : ""}${a.status !== "active" ? ` (${ACCOUNT_STATUS[a.status].toLowerCase()})` : ""}`;
  const open = accounts.filter((a) => a.status !== "closed");

  const llc = open.filter((a) => a.owner === "llc");
  const personalIds = new Set(accounts.filter((a) => a.owner === "personal").map((a) => a.id));

  /**
   * Para pagar gastos: bancos y tarjetas de la LLC, o "Aporte del dueño" (dinero personal, sin
   * detallar cuál). Las plataformas de cobro (Skool) no pagan nada: solo hacen payouts.
   */
  const paymentAccounts: Option[] = [
    ...llc.filter((a) => a.type !== "processor" && a.type !== "credit_card").map((a) => ({ value: a.id, label: accountLabel(a), group: "Cuentas de la LLC" })),
    ...llc.filter((a) => a.type === "credit_card").map((a) => ({ value: a.id, label: accountLabel(a), group: "Tarjetas de la LLC" })),
    { value: "personal", label: "Aporte del dueño (dinero personal)", group: "Aporte del dueño" },
  ];

  return {
    accounts: accounts.filter((a) => a.owner === "llc"),
    paymentAccounts,
    /** Dónde cae un cobro: la plataforma (Skool), un banco de la LLC o directo al dueño. */
    depositAccounts: [
      ...llc.filter((a) => a.type === "processor").map((a) => ({ value: a.id, label: accountLabel(a), group: "Plataformas de cobro" })),
      ...llc.filter((a) => a.type !== "credit_card" && a.type !== "processor").map((a) => ({ value: a.id, label: accountLabel(a), group: "Cuentas de la LLC" })),
      { value: "owner", label: "Retiro del dueño (cuenta personal)", group: "Dueño" },
    ] as Option[],
    llcBankAccounts: llc.filter((a) => a.type !== "credit_card" && a.type !== "processor").map((a) => ({ value: a.id, label: accountLabel(a) })) as Option[],
    llcCards: llc.filter((a) => a.type === "credit_card"),
    platforms: llc.filter((a) => a.type === "processor"),
    /** Valor para los <select>: las cuentas personales se muestran como la opción genérica. */
    paymentValue: (id: string | null | undefined) => (!id || personalIds.has(id) ? "personal" : id),
    depositValue: (id: string | null | undefined) => (id && personalIds.has(id) ? "owner" : (id ?? undefined)),
    /** Nombre visible de una cuenta; nunca muestra cuentas personales. */
    accountName: (id: string | null | undefined, kind: "payment" | "deposit" = "payment") =>
      !id || personalIds.has(id) ? (kind === "payment" ? "Aporte del dueño" : "Retiro del dueño") : (accounts.find((a) => a.id === id)?.name ?? "—"),
    categories,
    revenueCategories: categories.filter((c) => c.kind === "revenue").map((c) => ({ value: c.id, label: c.name })) as Option[],
    expenseCategories: categories
      .filter((c) => c.kind !== "revenue")
      .map((c) => ({ value: c.id, label: c.name, group: c.kind === "cogs" ? "Costos directos" : "Gastos operativos" })) as Option[],
    products,
    productOptions: products.filter((p) => p.isActive).map((p) => ({ value: p.id, label: p.name, group: p.line ?? "Sin línea" })) as Option[],
    counterparties,
    vendorOptions: counterparties.filter((c) => c.type !== "customer" && c.type !== "tax_authority").map((c) => ({ value: c.id, label: c.name })) as Option[],
    names: {
      account: new Map(accounts.map((a) => [a.id, a.name])),
      category: new Map(categories.map((c) => [c.id, c.name])),
      product: new Map(products.map((p) => [p.id, p.name])),
      counterparty: new Map(counterparties.map((c) => [c.id, c.name])),
    },
  };
}

export type FormOptions = Awaited<ReturnType<typeof getFormOptions>>;

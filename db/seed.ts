/**
 * Datos iniciales: catálogos base + los movimientos reales de ago–sep 2026 de Inversiones 101 LLC.
 * Solo corre si la BD está vacía (no existe ningún rol). Después, todo se captura desde la app.
 */
import { count } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as s from "./schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<PgQueryResultHKT, typeof s, any>;

const c = (usd: number) => Math.round(usd * 100);

/** Tasa del día de la siembra. Los movimientos nuevos guardarán la tasa de su propia fecha. */
const HNL_PER_USD = 26.86;
const hnlToUsdRate = (1 / HNL_PER_USD).toFixed(6);

const MODULES = s.moduleEnum.enumValues;

export async function seedIfEmpty(db: AnyDb) {
  const [{ n }] = await db.select({ n: count() }).from(s.roles);
  if (n > 0) return false;
  await seed(db);
  return true;
}

export async function seed(db: AnyDb) {
  await db.transaction(async (tx) => {
    // ── Roles y permisos ────────────────────────────────────────────────────
    const [admin, viewer, expenseManager] = await tx
      .insert(s.roles)
      .values([
        { key: "admin", name: "Administrador", description: "Acceso completo, incluye usuarios", isSystem: true },
        { key: "viewer", name: "Solo lectura", description: "Ve todos los módulos financieros", isSystem: true },
        { key: "expense_manager", name: "Gestor de gastos", description: "Registra gastos y suscripciones", isSystem: true },
      ])
      .returning();

    await tx.insert(s.rolePermissions).values([
      ...MODULES.map((module) => ({ roleId: admin.id, module, level: "admin" as const })),
      ...MODULES.map((module) => ({ roleId: viewer.id, module, level: module === "users" ? ("none" as const) : ("read" as const) })),
      ...MODULES.map((module) => ({
        roleId: expenseManager.id,
        module,
        level: (["expenses", "subscriptions"].includes(module) ? "write" : module === "dashboard" ? "read" : "none") as
          | "write"
          | "read"
          | "none",
      })),
    ]);

    // ── Categorías ──────────────────────────────────────────────────────────
    const cat = Object.fromEntries(
      (
        await tx
          .insert(s.categories)
          .values([
            { kind: "revenue", name: "Membresías" },
            { kind: "revenue", name: "Otros ingresos" }, // cashback, intereses
            { kind: "cogs", name: "Plataformas de venta" },
            { kind: "opex", name: "Software y herramientas" },
            { kind: "opex", name: "Consultoría y mentoría" },
            { kind: "opex", name: "Diseño y contenido" },
            { kind: "opex", name: "Legal y constitución" },
            { kind: "opex", name: "Comisiones financieras", pnlLine: "interest" },
            { kind: "opex", name: "Impuestos y licencias" },
            { kind: "opex", name: "Comisiones bancarias" },
            { kind: "opex", name: "Marketing y publicidad" },
          ])
          .returning()
      ).map((r) => [r.name, r.id])
    ) as Record<string, string>;

    // ── Productos (líneas de ingreso) ───────────────────────────────────────
    const [monthlyPlan, annualPlan] = await tx
      .insert(s.products)
      .values([
        { name: "Membresía mensual", line: "Comunidad Skool", categoryId: cat["Membresías"], defaultBillingInterval: "monthly", listPriceCents: c(37), platform: "Skool" },
        { name: "Membresía anual", line: "Comunidad Skool", categoryId: cat["Membresías"], defaultBillingInterval: "annual", listPriceCents: c(197), platform: "Skool" },
      ])
      .returning();

    // ── Contrapartes ────────────────────────────────────────────────────────
    const cp = Object.fromEntries(
      (
        await tx
          .insert(s.counterparties)
          .values([
            { type: "processor", name: "Skool", country: "US" },
            { type: "vendor", name: "Loom", country: "US" },
            { type: "vendor", name: "doola", country: "US" },
            { type: "vendor", name: "Skool Scaling", notes: "Consultoría de escalamiento" },
            { type: "tax_authority", name: "IRS", country: "US" },
            { type: "tax_authority", name: "Wyoming Secretary of State", country: "US" },
          ])
          .returning()
      ).map((r) => [r.name, r.id])
    ) as Record<string, string>;

    // ── Cuentas ─────────────────────────────────────────────────────────────
    const acc = Object.fromEntries(
      (
        await tx
          .insert(s.financialAccounts)
          .values([
            { name: "Saldo Skool", institution: "Skool", owner: "llc", type: "processor", sortOrder: 1 },
            { name: "Mercury Checking", institution: "Mercury", owner: "llc", type: "checking", status: "pending_opening", sortOrder: 2 },
            { name: "Mercury Savings", institution: "Mercury", owner: "llc", type: "savings", status: "pending_opening", sortOrder: 3 },
            {
              name: "Mercury IO",
              institution: "Mercury",
              owner: "llc",
              type: "credit_card",
              status: "pending_opening",
              repaymentTerms: "daily",
              cashbackPct: "1.5",
              sortOrder: 4,
            },
            { name: "AMEX", owner: "personal", type: "credit_card", paymentDueDay: 30, sortOrder: 10 },
            { name: "Visa Infinite", owner: "personal", type: "credit_card", sortOrder: 11 },
            { name: "Visa Occidente", institution: "Banco de Occidente", owner: "personal", type: "credit_card", paymentDueDay: 30, sortOrder: 12 },
            { name: "BAC", institution: "BAC Honduras", owner: "personal", type: "checking", last4: "7351", sortOrder: 13 },
          ])
          .returning()
      ).map((r) => [r.name, r.id])
    ) as Record<string, string>;

    // ── Suscripciones y contratos ───────────────────────────────────────────
    const [loom, skoolPro] = await tx
      .insert(s.subscriptions)
      .values([
        {
          vendorId: cp["Loom"], name: "Loom", categoryId: cat["Software y herramientas"], billingInterval: "monthly",
          amountCents: c(24), startedOn: "2026-08-12", nextRenewalOn: "2026-10-11",
          defaultFundingSource: "owner_personal",
        },
        {
          vendorId: cp["Skool"], name: "Skool Pro", categoryId: cat["Plataformas de venta"], billingInterval: "monthly",
          amountCents: c(99), startedOn: "2026-08-19", nextRenewalOn: "2026-10-19",
          defaultFundingSource: "owner_personal",
        },
      ])
      .returning();

    const [scaling] = await tx
      .insert(s.vendorContracts)
      .values({
        vendorId: cp["Skool Scaling"], name: "Consultoría Skool Scaling", categoryId: cat["Consultoría y mentoría"],
        totalCents: c(7730), signedOn: "2026-08-13", installmentDay: 15, installmentAmountCents: c(500),
        notes: "Cuotas cada día 15 hasta liquidar; se puede pagar antes.",
      })
      .returning();

    // ── Gastos (todos pagados con dinero personal ⇒ aportes del dueño) ──────
    type E = typeof s.expenses.$inferInsert;
    const base = { fundingSource: "owner_personal" as const };
    const expenseRows: E[] = [
      { ...base, expenseDate: "2026-08-12", description: "Loom Suscripción", categoryId: cat["Software y herramientas"], frequency: "monthly", subscriptionId: loom.id, vendorId: cp["Loom"], amountCents: c(24), status: "paid", notes: "Tarjeta de crédito personal" },
      { ...base, expenseDate: "2026-08-13", description: "Cuota 1 · Consultoría Skool Scaling", categoryId: cat["Consultoría y mentoría"], contractId: scaling.id, vendorId: cp["Skool Scaling"], amountCents: c(2000), status: "paid", notes: "Trasladado a minicuotas en tarjeta personal" },
      { ...base, expenseDate: "2026-08-14", description: "Constitución LLC (doola)", categoryId: cat["Legal y constitución"], vendorId: cp["doola"], amountCents: c(399.4), paymentAccountId: acc["AMEX"], status: "paid" },
      { ...base, expenseDate: "2026-08-17", description: "Diseños I101", categoryId: cat["Diseño y contenido"], amountCents: c(2000), currency: "HNL", fxRateToUsd: hnlToUsdRate, paymentAccountId: acc["BAC"], status: "paid", paidOn: "2026-08-17" },
      { ...base, expenseDate: "2026-08-18", description: "Dominio inversiones101.lat", categoryId: cat["Software y herramientas"], amountCents: c(1.99), paymentAccountId: acc["Visa Infinite"], status: "paid" },
      { ...base, expenseDate: "2026-08-19", description: "Skool Pro", categoryId: cat["Plataformas de venta"], frequency: "monthly", subscriptionId: skoolPro.id, vendorId: cp["Skool"], amountCents: c(99), paymentAccountId: acc["Visa Infinite"], status: "paid" },
      { ...base, expenseDate: "2026-08-28", description: "Diseños Cursos", categoryId: cat["Diseño y contenido"], amountCents: c(134.01), paymentAccountId: acc["Visa Occidente"], status: "paid" },
      { ...base, expenseDate: "2026-09-11", description: "Loom Suscripción", categoryId: cat["Software y herramientas"], frequency: "monthly", subscriptionId: loom.id, vendorId: cp["Loom"], amountCents: c(24), paymentAccountId: acc["AMEX"], status: "paid" },
      { ...base, expenseDate: "2026-09-15", description: "Cuota 2 · Consultoría Skool Scaling", categoryId: cat["Consultoría y mentoría"], contractId: scaling.id, vendorId: cp["Skool Scaling"], amountCents: c(500), paymentAccountId: acc["AMEX"], status: "paid" },
      { ...base, expenseDate: "2026-09-19", description: "Skool Pro", categoryId: cat["Plataformas de venta"], frequency: "monthly", subscriptionId: skoolPro.id, vendorId: cp["Skool"], amountCents: c(99), paymentAccountId: acc["AMEX"], status: "paid" },
    ];
    const insertedExpenses = await tx.insert(s.expenses).values(expenseRows).returning();

    await tx.insert(s.ownerLedger).values(
      insertedExpenses.map((e) => ({
        entryDate: e.expenseDate,
        type: "contribution" as const,
        currency: e.currency,
        amountCents: e.amountCents,
        fxRateToUsd: e.fxRateToUsd,
        expenseId: e.id,
        personalAccountId: e.paymentAccountId,
        description: `Aporte: ${e.description}`,
      }))
    );

    // ── Ingresos (agregado de septiembre del panel de Skool) ────────────────
    const revenues = await tx
      .insert(s.revenues)
      .values([
        {
          revenueDate: "2026-09-15", productId: annualPlan.id, categoryId: cat["Membresías"], billingInterval: "annual",
          serviceStart: "2026-09-15", grossCents: c(3516), processorFeeCents: 10982, affiliateFeeCents: 1917,
          status: "available", depositAccountId: acc["Saldo Skool"], notes: "Suscripciones anuales de septiembre (agregado del panel de Skool)",
        },
        {
          revenueDate: "2026-09-15", productId: monthlyPlan.id, categoryId: cat["Membresías"], billingInterval: "monthly",
          serviceStart: "2026-09-15", grossCents: c(518), processorFeeCents: 1618, affiliateFeeCents: 283,
          status: "available", depositAccountId: acc["Saldo Skool"], notes: "Suscripciones mensuales de septiembre (agregado del panel de Skool)",
        },
      ])
      .returning();

    // ── Caja: saldo Skool ───────────────────────────────────────────────────
    const [draw] = await tx
      .insert(s.ownerLedger)
      .values({ entryDate: "2026-09-16", type: "draw", amountCents: c(1.34), personalAccountId: acc["BAC"], description: "Payout de Skool a BAC personal" })
      .returning();

    const [statement] = await tx
      .insert(s.accountStatements)
      .values({ accountId: acc["Saldo Skool"], statementDate: "2026-09-22", closingBalanceCents: c(3885.71), reconciledAt: new Date() })
      .returning();

    await tx.insert(s.cashMovements).values([
      ...revenues.map((r) => ({
        accountId: acc["Saldo Skool"], movementDate: r.revenueDate, type: "revenue_direct" as const,
        amountCents: r.grossCents - r.processorFeeCents - r.affiliateFeeCents, revenueId: r.id,
        description: "Cobros de membresías (neto)", statementId: statement.id, reconciled: true,
      })),
      {
        accountId: acc["Saldo Skool"], movementDate: "2026-09-16", type: "owner_draw" as const, amountCents: -c(1.34),
        ownerLedgerId: draw.id, description: "Payout a BAC ••7351", statementId: statement.id, reconciled: true,
      },
      {
        accountId: acc["Saldo Skool"], movementDate: "2026-09-22", type: "adjustment" as const, amountCents: c(1.05),
        description: "Ajuste de conciliación (el panel de Skool redondea los montos)", statementId: statement.id, reconciled: true,
      },
    ]);

    // ── Impuestos (informativo: confirmar con doola / contador) ─────────────
    await tx.insert(s.taxObligations).values([
      {
        authorityId: cp["IRS"], jurisdiction: "US-FED", name: "Form 5472 + 1120 pro forma (año 2026)",
        periodStart: "2026-08-14", periodEnd: "2026-12-31", dueDate: "2027-04-15",
        notes: "LLC unipersonal de dueño extranjero. Confirmar con contador.",
      },
      {
        authorityId: cp["Wyoming Secretary of State"], jurisdiction: "US-WY", name: "Annual Report Wyoming",
        dueDate: "2027-08-01", estimatedCents: c(60), notes: "Vence el primer día del mes aniversario. Mínimo $60.",
      },
    ]);

    await tx.insert(s.reminders).values({
      dueOn: "2026-09-28", title: "EIN (fecha estimada)", detail: "Al llegar: abrir Mercury y mover los payouts de Skool a Mercury",
    });

    await tx.insert(s.exchangeRates).values({ rateDate: "2026-09-22", base: "USD", quote: "HNL", rate: String(HNL_PER_USD), source: "seed" });

    await tx.insert(s.settings).values([
      { key: "company_name", value: "Inversiones 101 LLC" },
      { key: "brand_name", value: "Inversiones 101" },
      { key: "base_currency", value: "USD" },
      { key: "timezone", value: "America/Tegucigalpa" },
      { key: "operations_start_date", value: "2026-09-20" },
    ]);
  });
}

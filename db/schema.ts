/**
 * Esquema de base de datos — Finanzas 101 (ERP financiero ligero para Inversiones 101 LLC)
 *
 * Principios contables que este esquema hace cumplir:
 *
 *  1. P&L (rentabilidad) vive en `revenues` y `expenses`. Son registros de devengo:
 *     cuándo se ganó / incurrió, sin importar cuándo se movió el dinero.
 *  2. Cash Flow vive en `cash_movements`. Solo registra dinero que realmente entra o
 *     sale de una cuenta de la LLC (Mercury, saldo Skool). Es la fuente del "cash disponible".
 *  3. Owner Financing vive en `owner_ledger`. Cuando el dueño paga algo con dinero
 *     personal, el gasto SÍ va al P&L (es un costo real del negocio), pero NO genera un
 *     `cash_movement` en cuentas de la LLC: genera una entrada de "Aporte del Propietario".
 *     Así no se distorsiona ni el P&L ni el flujo de caja corporativo.
 *
 * Dinero: siempre en centavos (bigint) + moneda. La tasa USD/HNL se actualiza a diario
 * en `exchange_rates`; al crear un registro se congela la tasa de SU fecha en
 * `fx_rate_to_usd`, para que los reportes de meses pasados no cambien con la tasa de hoy.
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  boolean,
  integer,
  bigint,
  numeric,
  date,
  timestamp,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const id = () => uuid("id").primaryKey().defaultRandom();
const cents = (name: string) => bigint(name, { mode: "number" });
const fxRate = () => numeric("fx_rate_to_usd", { precision: 14, scale: 6 }).notNull().default("1");
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};
const createdBy = () => uuid("created_by").references(() => users.id, { onDelete: "set null" });

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

export const currencyEnum = pgEnum("currency", ["USD", "HNL"]);

/** Módulos del sistema — la unidad de permisos del RBAC. */
export const moduleEnum = pgEnum("app_module", [
  "dashboard",
  "revenue",
  "expenses",
  "subscriptions",
  "debts",
  "banking",
  "owner_equity",
  "taxes",
  "reports",
  "planning", // presupuestos y metas
  "settings", // catálogos: productos, categorías, proveedores, recordatorios
  "users",
]);

/** none < read < write < admin. `admin` permite además borrar y conciliar. */
export const accessLevelEnum = pgEnum("access_level", ["none", "read", "write", "admin"]);

/** Quién es el dueño legal del instrumento financiero. Clave para separar LLC vs. personal. */
export const accountOwnerEnum = pgEnum("account_owner", ["llc", "personal"]);

export const accountTypeEnum = pgEnum("account_type", [
  "checking", // Mercury Checking
  "savings", // Mercury Savings / Treasury
  "credit_card", // Mercury IO, AMEX, Visa Infinite, Visa Occidente
  "processor", // Saldo retenido en Skool / Stripe antes del payout
  "cash",
]);

export const counterpartyTypeEnum = pgEnum("counterparty_type", [
  "customer",
  "vendor",
  "creditor",
  "tax_authority",
  "processor",
]);

/** revenue → P&L ingresos · cogs → costo directo · opex → gasto operativo. */
export const categoryKindEnum = pgEnum("category_kind", ["revenue", "cogs", "opex"]);

export const billingIntervalEnum = pgEnum("billing_interval", [
  "one_time",
  "monthly",
  "quarterly",
  "annual",
]);

export const revenueStatusEnum = pgEnum("revenue_status", ["pending", "available", "paid_out", "refunded", "disputed"]);

/**
 * Cómo se financió un gasto. Esto decide qué ledger se afecta además del P&L:
 *  - llc_cash         → cash_movement en cuenta LLC
 *  - llc_credit       → queda como cuenta por pagar en la tarjeta de la LLC
 *  - owner_personal   → owner_ledger (aporte o préstamo del propietario)
 */
export const fundingSourceEnum = pgEnum("funding_source", ["llc_cash", "llc_credit", "owner_personal"]);

export const expenseStatusEnum = pgEnum("expense_status", ["pending", "paid", "financed", "void"]);

export const subscriptionStatusEnum = pgEnum("subscription_status", ["active", "paused", "canceled"]);

export const contractStatusEnum = pgEnum("contract_status", ["active", "completed", "canceled"]);

/** pending_opening: la cuenta existe en el sistema pero aún no está abierta (ej. Mercury esperando EIN). */
export const accountStatusEnum = pgEnum("account_status", ["active", "pending_opening", "closed"]);

export const debtStatusEnum = pgEnum("debt_status", ["active", "paid_off", "defaulted", "renegotiated"]);

export const cashMovementTypeEnum = pgEnum("cash_movement_type", [
  "revenue_payout", // Skool → Mercury
  "revenue_direct", // cobro directo a cuenta LLC
  "expense_payment",
  "card_payment", // pago del estado de cuenta de tarjeta LLC
  "debt_disbursement",
  "debt_payment",
  "tax_payment",
  "owner_contribution", // dueño deposita dinero a la LLC
  "owner_reimbursement", // LLC devuelve al dueño
  "owner_draw", // retiro / distribución al dueño
  "transfer", // entre cuentas propias (Checking ↔ Savings)
  "fee",
  "interest",
  "adjustment",
]);

/**
 * Ledger del propietario. El saldo "por reembolsar" = loan - reimbursement.
 * Equity aportado = contribution - draw.
 */
export const ownerEntryTypeEnum = pgEnum("owner_entry_type", [
  "contribution", // Aporte de capital (no se devuelve)
  "loan", // Préstamo del propietario (la LLC debe devolverlo)
  "reimbursement", // La LLC devuelve un préstamo
  "draw", // Retiro / distribución de utilidades
]);

/**
 * Dónde cae cada categoría de gasto en el estado de resultados:
 * operating → antes del EBITDA · depreciation → D&A (entre EBITDA y EBIT) ·
 * interest → costos financieros (después del EBIT) · income_tax → impuestos sobre la renta.
 */
export const pnlLineEnum = pgEnum("pnl_line", ["operating", "depreciation", "interest", "income_tax"]);

export const memberStatusEnum = pgEnum("member_status", ["active", "canceled"]);

export const goalMetricEnum = pgEnum("goal_metric", [
  "gross_revenue", // facturación bruta en el periodo
  "net_revenue", // ingreso neto en el periodo
  "net_profit", // utilidad neta en el periodo
  "mrr", // MRR al cierre
  "active_members", // miembros activos al cierre
  "new_members", // altas en el periodo
  "cash", // caja en bancos al cierre
]);

export const goalStatusEnum = pgEnum("goal_status", ["active", "archived"]);

export const taxStatusEnum = pgEnum("tax_status", ["upcoming", "in_progress", "filed", "paid", "overdue", "not_required"]);

// ─────────────────────────────────────────────────────────────────────────────
// 1. Usuarios, roles y permisos (RBAC)
// ─────────────────────────────────────────────────────────────────────────────

export const roles = pgTable("roles", {
  id: id(),
  key: varchar("key", { length: 40 }).notNull().unique(), // admin | viewer | expense_manager
  name: text("name").notNull(),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(false), // no se puede borrar
  ...timestamps,
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    module: moduleEnum("module").notNull(),
    level: accessLevelEnum("level").notNull().default("none"),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.module] })]
);

export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: text("password_hash").notNull(), // argon2id
    roleId: uuid("role_id").notNull().references((): AnyPgColumn => roles.id),
    isActive: boolean("is_active").notNull().default(true),
    /** El dueño: único que ve la sección privada de aportes de capital. */
    isOwner: boolean("is_owner").notNull().default(false),
    /** Cargo que cada quien pone en su perfil (ej. "Fundador"). Se muestra en vez del rol. */
    title: text("title"),
    /** Orden y visibilidad de los widgets del dashboard de este usuario. */
    dashboardPrefs: jsonb("dashboard_prefs"),
    preferredTheme: varchar("preferred_theme", { length: 10 }).default("system"), // light | dark | system
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    /** Verificación en dos pasos (TOTP). El secreto va cifrado con APP_SECRET (AES-256-GCM). */
    totpSecretEnc: text("totp_secret_enc"),
    totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }), // null = aún no activada
    totpLastStep: integer("totp_last_step"), // evita reusar el mismo código
    /** Hashes SHA-256 de los códigos de recuperación que aún no se han usado. */
    recoveryCodes: jsonb("recovery_codes"),
    ...timestamps,
  },
  (t) => [uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`)]
);

/** Sesiones del lado del servidor. En la cookie va el token; aquí solo su hash. */
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    ip: varchar("ip", { length: 64 }),
    /** Contraseña correcta pero falta el código de dos pasos: la sesión aún no da acceso. */
    mfaPending: boolean("mfa_pending").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)]
);

/** Intentos de inicio de sesión: base del freno a la fuerza bruta (funciona entre servidores). */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: id(),
    email: text("email").notNull(),
    ip: varchar("ip", { length: 64 }),
    success: boolean("success").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempts_email_idx").on(t.email, t.createdAt)]
);

/** Bitácora: quién creó / cambió / borró qué. Imprescindible en un ERP financiero. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 40 }).notNull(), // create | update | delete | login | reconcile…
    entity: varchar("entity", { length: 60 }).notNull(),
    entityId: uuid("entity_id"),
    diff: jsonb("diff"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_entity_idx").on(t.entity, t.entityId)]
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. Catálogos compartidos
// ─────────────────────────────────────────────────────────────────────────────

/** Clientes, proveedores, acreedores, autoridades fiscales y procesadores en una sola tabla. */
export const counterparties = pgTable(
  "counterparties",
  {
    id: id(),
    type: counterpartyTypeEnum("type").notNull(),
    name: text("name").notNull(), // "Skool", "Loom", "doola", "IRS", "Diseñador X"
    email: varchar("email", { length: 255 }),
    country: varchar("country", { length: 2 }), // ISO: US, HN
    externalRef: text("external_ref"), // id en Skool / Stripe / Mercury
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("counterparties_type_idx").on(t.type)]
);

export const categories = pgTable(
  "categories",
  {
    id: id(),
    kind: categoryKindEnum("kind").notNull(),
    name: text("name").notNull(), // "Membresías Skool", "Software", "Diseño", "Legal y constitución"
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id),
    isTaxDeductible: boolean("is_tax_deductible").notNull().default(true),
    pnlLine: pnlLineEnum("pnl_line").notNull().default("operating"),
    color: varchar("color", { length: 16 }), // para chips y gráficos
    ...timestamps,
  },
  (t) => [uniqueIndex("categories_kind_name_idx").on(t.kind, t.name)]
);

export const exchangeRates = pgTable(
  "exchange_rates",
  {
    id: id(),
    rateDate: date("rate_date").notNull(),
    base: currencyEnum("base").notNull(), // USD
    quote: currencyEnum("quote").notNull(), // HNL
    rate: numeric("rate", { precision: 14, scale: 6 }).notNull(), // 1 base = rate quote (ej. 1 USD = 26.86 HNL)
    source: text("source"), // open.er-api.com (job diario), BCH o manual
  },
  (t) => [uniqueIndex("fx_unique_idx").on(t.rateDate, t.base, t.quote)]
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Cuentas financieras (Mercury, tarjetas, saldo Skool)
// ─────────────────────────────────────────────────────────────────────────────

export const financialAccounts = pgTable("financial_accounts", {
  id: id(),
  name: text("name").notNull(), // "Mercury Checking", "AMEX personal", "Saldo Skool"
  institution: text("institution"), // Mercury, BAC, Banco Occidente, Skool
  owner: accountOwnerEnum("owner").notNull(), // llc | personal
  type: accountTypeEnum("type").notNull(),
  currency: currencyEnum("currency").notNull().default("USD"),
  last4: varchar("last4", { length: 4 }),
  openingBalanceCents: cents("opening_balance_cents").notNull().default(0),
  openingDate: date("opening_date"),
  creditLimitCents: cents("credit_limit_cents"), // solo tarjetas
  statementDay: integer("statement_day"), // día de corte (tarjetas)
  paymentDueDay: integer("payment_due_day"), // día de pago (ej. 30)
  /** Mercury IO: "daily" al inicio, "monthly" (30 días) cuando el saldo llega a $15K. Se paga completa. */
  repaymentTerms: varchar("repayment_terms", { length: 20 }),
  cashbackPct: numeric("cashback_pct", { precision: 5, scale: 3 }), // IO = 1.5
  status: accountStatusEnum("status").notNull().default("active"),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Id de la cuenta en el banco (Mercury) para sincronizar movimientos. */
  externalId: text("external_id"),
  ...timestamps,
});

/** Saldo reportado por el banco en una fecha → base de la conciliación. */
export const accountStatements = pgTable(
  "account_statements",
  {
    id: id(),
    accountId: uuid("account_id").notNull().references(() => financialAccounts.id, { onDelete: "cascade" }),
    statementDate: date("statement_date").notNull(),
    closingBalanceCents: cents("closing_balance_cents").notNull(),
    computedBalanceCents: cents("computed_balance_cents"), // lo que dice nuestro ledger ese día
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    reconciledBy: uuid("reconciled_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [uniqueIndex("statements_account_date_idx").on(t.accountId, t.statementDate)]
);

/**
 * Catálogo de productos / líneas de ingreso de la marca: Comunidad Skool, cursos, consultorías…
 * Agregar un producto nuevo es una fila aquí, no código: el dashboard lo desglosa solo.
 */
export const products = pgTable("products", {
  id: id(),
  name: text("name").notNull(), // "Membresía mensual", "Membresía anual", "Curso de Bolsa"
  /** Línea de negocio que agrupa productos (ej. "Comunidad Skool"). */
  line: text("line"),
  categoryId: uuid("category_id").notNull().references(() => categories.id), // kind revenue
  defaultBillingInterval: billingIntervalEnum("default_billing_interval").notNull().default("one_time"),
  /** Precio de lista (lo que paga un miembro nuevo). Base del MRR y del formulario de miembros. */
  listPriceCents: cents("list_price_cents"),
  platform: text("platform"), // Skool, Hotmart, Stripe, directo
  isActive: boolean("is_active").notNull().default(true),
  color: varchar("color", { length: 16 }),
  ...timestamps,
});

/**
 * Historial de precios de lista. El precio cambia con cada lanzamiento: un miembro nuevo paga
 * el precio vigente el día que entra y lo conserva (Skool respeta el precio de quien ya está).
 * `products.list_price_cents` es solo el valor de respaldo para productos sin historial.
 */
export const productPrices = pgTable(
  "product_prices",
  {
    id: id(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    priceCents: cents("price_cents").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    note: text("note"), // "Lanzamiento de noviembre"
    ...timestamps,
  },
  (t) => [uniqueIndex("product_prices_product_date_idx").on(t.productId, t.effectiveFrom)]
);

/**
 * Miembros / suscriptores. Fuente del MRR, del churn y del pronóstico: el MRR es la suma
 * de los planes activos. Cancelar un miembro lo saca del MRR desde el fin de su periodo
 * pagado (`accessUntil`); reactivarlo lo vuelve a sumar.
 */
export const members = pgTable(
  "members",
  {
    id: id(),
    name: text("name").notNull(),
    /** Correo en Skool: llave para importar el CSV sin duplicar (el nombre es el respaldo). */
    email: text("email"),
    productId: uuid("product_id").notNull().references(() => products.id),
    billingInterval: billingIntervalEnum("billing_interval").notNull(),
    currency: currencyEnum("currency").notNull().default("USD"),
    priceCents: cents("price_cents").notNull(), // precio del plan (lista), no lo prorrateado
    startedOn: date("started_on").notNull(),
    currentPeriodEnd: date("current_period_end").notNull(), // próxima renovación
    status: memberStatusEnum("status").notNull().default("active"),
    canceledOn: date("canceled_on"),
    accessUntil: date("access_until"), // cancelado: sigue contando hasta esta fecha
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("members_status_idx").on(t.status), uniqueIndex("members_email_idx").on(t.email)]
);

export const memberEventTypeEnum = pgEnum("member_event_type", ["new", "change", "cancel", "reactivate"]);

/**
 * Bitácora del MRR por miembro: cada alta, cambio de plan o de precio, baja y reactivación con
 * cuánto movió el MRR (centavos al mes, con signo). Es la base del "movimiento del MRR": como
 * los precios cambian, no se puede reconstruir solo con el precio actual de cada miembro.
 * Una baja se fecha el día que deja de contar (fin de su periodo pagado).
 */
export const memberEvents = pgTable(
  "member_events",
  {
    id: id(),
    memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
    eventDate: date("event_date").notNull(),
    type: memberEventTypeEnum("type").notNull(),
    mrrDeltaCents: cents("mrr_delta_cents").notNull(),
    ...timestamps,
  },
  (t) => [index("member_events_date_idx").on(t.eventDate), index("member_events_member_idx").on(t.memberId)]
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. P&L — Ingresos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un ingreso = un cobro. `gross - processor_fee - affiliate_fee = net` (columna generada).
 * Para MRR: un cobro anual cubre `service_start..service_end` (12 meses), así que su
 * aporte mensual es gross/12. El MRR de un mes = Σ aportes de los cobros cuyo periodo
 * de servicio incluye ese mes (sin one_time).
 */
export const revenues = pgTable(
  "revenues",
  {
    id: id(),
    revenueDate: date("revenue_date").notNull(),
    customerId: uuid("customer_id").references(() => counterparties.id),
    customerName: text("customer_name"), // atajo cuando no vale la pena crear el cliente
    memberId: uuid("member_id").references((): AnyPgColumn => members.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id),
    categoryId: uuid("category_id").notNull().references(() => categories.id),
    billingInterval: billingIntervalEnum("billing_interval").notNull().default("one_time"),
    serviceStart: date("service_start"),
    serviceEnd: date("service_end"),
    currency: currencyEnum("currency").notNull().default("USD"),
    grossCents: cents("gross_cents").notNull(),
    processorFeeCents: cents("processor_fee_cents").notNull().default(0), // comisión Skool/Stripe
    affiliateFeeCents: cents("affiliate_fee_cents").notNull().default(0),
    netCents: cents("net_cents")
      .notNull()
      .generatedAlwaysAs(sql`gross_cents - processor_fee_cents - affiliate_fee_cents`),
    fxRateToUsd: fxRate(),
    status: revenueStatusEnum("status").notNull().default("pending"),
    /** Dónde está el dinero: normalmente "Saldo Skool" hasta el payout. */
    depositAccountId: uuid("deposit_account_id").references(() => financialAccounts.id),
    externalRef: text("external_ref"),
    notes: text("notes"),
    createdBy: createdBy(),
    ...timestamps,
  },
  (t) => [
    index("revenues_date_idx").on(t.revenueDate),
    check("revenues_gross_positive", sql`${t.grossCents} >= 0`),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. Suscripciones y compromisos (lo que la LLC paga de forma recurrente)
// ─────────────────────────────────────────────────────────────────────────────

export const subscriptions = pgTable("subscriptions", {
  id: id(),
  vendorId: uuid("vendor_id").notNull().references(() => counterparties.id),
  name: text("name").notNull(), // "Loom Business", "Skool Pro", "Claude Max"
  categoryId: uuid("category_id").notNull().references(() => categories.id),
  billingInterval: billingIntervalEnum("billing_interval").notNull(),
  currency: currencyEnum("currency").notNull().default("USD"),
  amountCents: cents("amount_cents").notNull(),
  startedOn: date("started_on").notNull(),
  nextRenewalOn: date("next_renewal_on").notNull(),
  canceledOn: date("canceled_on"),
  status: subscriptionStatusEnum("status").notNull().default("active"),
  defaultFundingSource: fundingSourceEnum("default_funding_source").notNull().default("llc_credit"),
  defaultPaymentAccountId: uuid("default_payment_account_id").references(() => financialAccounts.id),
  autoCreateExpense: boolean("auto_create_expense").notNull().default(true), // al renovar genera el gasto
  notes: text("notes"),
  ...timestamps,
});

/**
 * Contratos con proveedores pagados por partes (ej. Consultoría Skool Scaling: $7,730 total).
 * Criterio contable (base caja, típico de una LLC unipersonal): cada pago es un gasto en el P&L
 * cuando se hace; el saldo restante es un compromiso pendiente, no un gasto ni una deuda bancaria.
 * pagado = Σ expenses.amount con este contract_id · pendiente = total − pagado.
 */
export const vendorContracts = pgTable("vendor_contracts", {
  id: id(),
  vendorId: uuid("vendor_id").notNull().references(() => counterparties.id),
  name: text("name").notNull(), // "Consultoría Skool Scaling"
  categoryId: uuid("category_id").notNull().references(() => categories.id),
  currency: currencyEnum("currency").notNull().default("USD"),
  totalCents: cents("total_cents").notNull(),
  signedOn: date("signed_on").notNull(),
  expectedEndOn: date("expected_end_on"),
  installmentsTotal: integer("installments_total"),
  /** Cuotas: el día del mes en que se paga (ej. 15) y el monto sugerido. Se puede liquidar antes. */
  installmentDay: integer("installment_day"),
  installmentAmountCents: cents("installment_amount_cents"),
  defaultFundingSource: fundingSourceEnum("default_funding_source").notNull().default("owner_personal"),
  status: contractStatusEnum("status").notNull().default("active"),
  notes: text("notes"),
  ...timestamps,
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Deudas y financiamiento (solo deuda de la LLC con terceros)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Regla: el dinero que el dueño adelanta NO es una deuda aquí; va a `owner_ledger`.
 * Ejemplos válidos: minicuotas de tarjeta LLC, préstamo bancario, financiamiento de proveedor.
 */
export const debts = pgTable("debts", {
  id: id(),
  creditorId: uuid("creditor_id").notNull().references(() => counterparties.id),
  name: text("name").notNull(), // "SS — plan de cuotas"
  accountId: uuid("account_id").references(() => financialAccounts.id), // tarjeta a la que se trasladó
  currency: currencyEnum("currency").notNull().default("USD"),
  principalCents: cents("principal_cents").notNull(),
  upfrontFeeCents: cents("upfront_fee_cents").notNull().default(0), // ej. $180 comisión minicuotas
  annualRatePct: numeric("annual_rate_pct", { precision: 6, scale: 3 }).notNull().default("0"),
  installmentsTotal: integer("installments_total"),
  installmentAmountCents: cents("installment_amount_cents"),
  startDate: date("start_date").notNull(),
  firstDueDate: date("first_due_date"),
  maturityDate: date("maturity_date"),
  status: debtStatusEnum("status").notNull().default("active"),
  notes: text("notes"),
  ...timestamps,
});

export const debtPayments = pgTable(
  "debt_payments",
  {
    id: id(),
    debtId: uuid("debt_id").notNull().references(() => debts.id, { onDelete: "cascade" }),
    installmentNumber: integer("installment_number"),
    dueDate: date("due_date").notNull(),
    paidOn: date("paid_on"), // null = pendiente
    principalCents: cents("principal_cents").notNull().default(0), // reduce saldo, NO es gasto P&L
    interestCents: cents("interest_cents").notNull().default(0), // gasto financiero P&L
    feeCents: cents("fee_cents").notNull().default(0),
    fundingSource: fundingSourceEnum("funding_source").notNull().default("llc_cash"),
    ...timestamps,
  },
  (t) => [index("debt_payments_due_idx").on(t.dueDate)]
);

// ─────────────────────────────────────────────────────────────────────────────
// 7. P&L — Gastos (COGS + Opex)
// ─────────────────────────────────────────────────────────────────────────────

export const expenses = pgTable(
  "expenses",
  {
    id: id(),
    expenseDate: date("expense_date").notNull(), // fecha del cargo (devengo)
    vendorId: uuid("vendor_id").references(() => counterparties.id),
    description: text("description").notNull(), // "Loom Suscripción", "Diseños I101"
    categoryId: uuid("category_id").notNull().references(() => categories.id), // kind cogs|opex
    frequency: billingIntervalEnum("frequency").notNull().default("one_time"), // recurrente vs único
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
    debtId: uuid("debt_id").references(() => debts.id, { onDelete: "set null" }), // gasto financiado en cuotas
    contractId: uuid("contract_id").references(() => vendorContracts.id, { onDelete: "set null" }), // pago parcial de un contrato
    currency: currencyEnum("currency").notNull().default("USD"),
    amountCents: cents("amount_cents").notNull(),
    fxRateToUsd: fxRate(),
    fundingSource: fundingSourceEnum("funding_source").notNull(),
    paymentAccountId: uuid("payment_account_id").references(() => financialAccounts.id), // AMEX, Visa, Mercury…
    dueDate: date("due_date"), // cuándo hay que pagar la tarjeta (ej. 30 sep)
    paidOn: date("paid_on"),
    status: expenseStatusEnum("status").notNull().default("pending"),
    receiptUrl: text("receipt_url"),
    notes: text("notes"),
    createdBy: createdBy(),
    ...timestamps,
  },
  (t) => [
    index("expenses_date_idx").on(t.expenseDate),
    index("expenses_due_idx").on(t.dueDate),
    check("expenses_amount_positive", sql`${t.amountCents} >= 0`),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// 8. Owner Financing — ledger separado del propietario
// ─────────────────────────────────────────────────────────────────────────────

export const ownerLedger = pgTable(
  "owner_ledger",
  {
    id: id(),
    entryDate: date("entry_date").notNull(),
    ownerUserId: uuid("owner_user_id").references(() => users.id), // por si hay más de un socio
    type: ownerEntryTypeEnum("type").notNull(),
    currency: currencyEnum("currency").notNull().default("USD"),
    amountCents: cents("amount_cents").notNull(),
    fxRateToUsd: fxRate(),
    /** Si el dueño pagó un gasto con su tarjeta, se enlaza aquí (gasto va al P&L, dinero aquí). */
    expenseId: uuid("expense_id").references(() => expenses.id, { onDelete: "set null" }),
    /** Ingreso de la LLC que cayó en una cuenta personal ⇒ retiro del dueño. */
    revenueId: uuid("revenue_id").references(() => revenues.id, { onDelete: "set null" }),
    debtPaymentId: uuid("debt_payment_id").references(() => debtPayments.id, { onDelete: "set null" }),
    personalAccountId: uuid("personal_account_id").references(() => financialAccounts.id), // tarjeta/cuenta personal usada
    description: text("description").notNull(),
    createdBy: createdBy(),
    ...timestamps,
  },
  (t) => [
    index("owner_ledger_date_idx").on(t.entryDate),
    check("owner_amount_positive", sql`${t.amountCents} > 0`),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// 9. Impuestos y obligaciones
// ─────────────────────────────────────────────────────────────────────────────

export const taxObligations = pgTable(
  "tax_obligations",
  {
    id: id(),
    authorityId: uuid("authority_id").references(() => counterparties.id), // IRS, Estado, SAR
    jurisdiction: varchar("jurisdiction", { length: 40 }).notNull(), // US-FED, US-WY, HN
    name: text("name").notNull(), // "Form 5472 + 1120 pro forma", "Annual Report", "BOI"
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    dueDate: date("due_date").notNull(),
    currency: currencyEnum("currency").notNull().default("USD"),
    estimatedCents: cents("estimated_cents").notNull().default(0),
    paidCents: cents("paid_cents").notNull().default(0),
    status: taxStatusEnum("status").notNull().default("upcoming"),
    filedOn: date("filed_on"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("tax_due_idx").on(t.dueDate)]
);

/** Fondo de reserva: apartados (positivos) y usos (negativos). Saldo = Σ amount. */
export const taxReserveEntries = pgTable("tax_reserve_entries", {
  id: id(),
  entryDate: date("entry_date").notNull(),
  amountCents: cents("amount_cents").notNull(),
  taxObligationId: uuid("tax_obligation_id").references(() => taxObligations.id),
  note: text("note"),
  ...timestamps,
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Cash Flow — movimientos reales en cuentas de la LLC
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Única fuente del "cash disponible". Signo: + entra, − sale.
 * Saldo de cuenta = opening_balance + Σ amount_cents.
 * Cada movimiento puede apuntar al registro que lo originó (ingreso, gasto, deuda, impuesto, owner).
 * Una transferencia entre cuentas propias = 2 movimientos con el mismo `transfer_group_id`.
 */
export const cashMovements = pgTable(
  "cash_movements",
  {
    id: id(),
    accountId: uuid("account_id").notNull().references(() => financialAccounts.id),
    movementDate: date("movement_date").notNull(),
    type: cashMovementTypeEnum("type").notNull(),
    amountCents: cents("amount_cents").notNull(), // con signo
    currency: currencyEnum("currency").notNull().default("USD"),
    fxRateToUsd: fxRate(),
    description: text("description"),
    revenueId: uuid("revenue_id").references(() => revenues.id, { onDelete: "set null" }),
    expenseId: uuid("expense_id").references(() => expenses.id, { onDelete: "set null" }),
    debtPaymentId: uuid("debt_payment_id").references(() => debtPayments.id, { onDelete: "set null" }),
    taxObligationId: uuid("tax_obligation_id").references(() => taxObligations.id, { onDelete: "set null" }),
    ownerLedgerId: uuid("owner_ledger_id").references(() => ownerLedger.id, { onDelete: "set null" }),
    transferGroupId: uuid("transfer_group_id"),
    externalId: text("external_id"), // id de transacción Mercury (para importar sin duplicar)
    statementId: uuid("statement_id").references(() => accountStatements.id), // conciliado contra
    reconciled: boolean("reconciled").notNull().default(false),
    createdBy: createdBy(),
    ...timestamps,
  },
  (t) => [
    index("cash_account_date_idx").on(t.accountId, t.movementDate),
    uniqueIndex("cash_external_idx").on(t.accountId, t.externalId),
  ]
);

/** Hitos sueltos que no son un pago recurrente (ej. "EIN estimado", "Abrir Mercury"). */
export const reminders = pgTable("reminders", {
  id: id(),
  dueOn: date("due_on").notNull(),
  title: text("title").notNull(),
  detail: text("detail"),
  amountCents: cents("amount_cents"),
  doneAt: timestamp("done_at", { withTimezone: true }),
  ...timestamps,
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Planeación: presupuestos y metas
// ─────────────────────────────────────────────────────────────────────────────

/** Tope de gasto por categoría. `month` null = aplica todos los meses. */
export const budgets = pgTable(
  "budgets",
  {
    id: id(),
    categoryId: uuid("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
    month: varchar("month", { length: 7 }), // YYYY-MM
    amountCents: cents("amount_cents").notNull(),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [uniqueIndex("budgets_category_month_idx").on(t.categoryId, t.month)]
);

/** Metas del negocio (ventas, facturación, miembros…) con fecha de inicio y límite. */
export const goals = pgTable("goals", {
  id: id(),
  name: text("name").notNull(),
  metric: goalMetricEnum("metric").notNull(),
  target: numeric("target", { precision: 14, scale: 2 }).notNull(), // dólares o número de miembros
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  status: goalStatusEnum("status").notNull().default("active"),
  notes: text("notes"),
  ...timestamps,
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Configuración
// ─────────────────────────────────────────────────────────────────────────────

/** Clave-valor: `tax_reserve_pct`, `base_currency`, `runway_lookback_months`, etc. */
export const settings = pgTable("settings", {
  key: varchar("key", { length: 60 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Sincronización bancaria (Mercury)
// ─────────────────────────────────────────────────────────────────────────────

export const bankInboxStatusEnum = pgEnum("bank_inbox_status", ["pending", "classified", "ignored"]);

/**
 * Bandeja "Por clasificar": transacciones crudas del banco. No tocan los libros hasta que
 * alguien las confirma; al confirmarlas se crea el registro contable y `cashMovementId` apunta a él.
 * `suggestion` = lo que el sistema propone (regla, pareja de transferencia o movimiento ya registrado).
 */
export const bankInbox = pgTable(
  "bank_inbox",
  {
    id: id(),
    accountId: uuid("account_id").notNull().references(() => financialAccounts.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    postedOn: date("posted_on").notNull(),
    amountCents: cents("amount_cents").notNull(), // con signo: + entra, − sale
    counterparty: text("counterparty"),
    description: text("description"),
    status: bankInboxStatusEnum("status").notNull().default("pending"),
    suggestion: jsonb("suggestion"),
    cashMovementId: uuid("cash_movement_id").references(() => cashMovements.id, { onDelete: "set null" }),
    resolvedBy: createdBy(),
    ...timestamps,
  },
  (t) => [uniqueIndex("bank_inbox_external_idx").on(t.accountId, t.externalId), index("bank_inbox_status_idx").on(t.status)]
);

/** "Si la contraparte contiene X, clasifícala como Y". Se crean al marcar "recordar". */
export const classificationRules = pgTable("classification_rules", {
  id: id(),
  pattern: text("pattern").notNull().unique(), // minúsculas, sin acentos
  as: varchar("as", { length: 30 }).notNull(),
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
  productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
  description: text("description"),
  ...timestamps,
});

// ─────────────────────────────────────────────────────────────────────────────
// Adjuntos (recibos y facturas) — el archivo vive en Vercel Blob privado
// ─────────────────────────────────────────────────────────────────────────────

export const expenseAttachments = pgTable(
  "expense_attachments",
  {
    id: id(),
    expenseId: uuid("expense_id").notNull().references(() => expenses.id, { onDelete: "cascade" }),
    blobPath: text("blob_path").notNull(), // pathname en Vercel Blob (privado); se sirve por /api/adjuntos/[id]
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedBy: createdBy(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("expense_attachments_expense_idx").on(t.expenseId)]
);

// ─────────────────────────────────────────────────────────────────────────────
// Informe mensual redactado por la IA
// ─────────────────────────────────────────────────────────────────────────────

/** Un informe por mes ("carta a inversionistas"). `content` = JSON estructurado; `facts` = los números que se le dieron. */
export const monthlyReports = pgTable("monthly_reports", {
  id: id(),
  month: varchar("month", { length: 7 }).notNull().unique(), // YYYY-MM
  content: jsonb("content").notNull(),
  facts: jsonb("facts").notNull(),
  model: varchar("model", { length: 60 }).notNull(),
  createdBy: createdBy(),
  ...timestamps,
});

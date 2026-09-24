CREATE TYPE "public"."access_level" AS ENUM('none', 'read', 'write', 'admin');--> statement-breakpoint
CREATE TYPE "public"."account_owner" AS ENUM('llc', 'personal');--> statement-breakpoint
CREATE TYPE "public"."account_status" AS ENUM('active', 'pending_opening', 'closed');--> statement-breakpoint
CREATE TYPE "public"."account_type" AS ENUM('checking', 'savings', 'credit_card', 'processor', 'cash');--> statement-breakpoint
CREATE TYPE "public"."billing_interval" AS ENUM('one_time', 'monthly', 'quarterly', 'annual');--> statement-breakpoint
CREATE TYPE "public"."cash_movement_type" AS ENUM('revenue_payout', 'revenue_direct', 'expense_payment', 'card_payment', 'debt_disbursement', 'debt_payment', 'tax_payment', 'owner_contribution', 'owner_reimbursement', 'owner_draw', 'transfer', 'fee', 'interest', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('revenue', 'cogs', 'opex');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('active', 'completed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."counterparty_type" AS ENUM('customer', 'vendor', 'creditor', 'tax_authority', 'processor');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('USD', 'HNL');--> statement-breakpoint
CREATE TYPE "public"."debt_status" AS ENUM('active', 'paid_off', 'defaulted', 'renegotiated');--> statement-breakpoint
CREATE TYPE "public"."expense_status" AS ENUM('pending', 'paid', 'financed', 'void');--> statement-breakpoint
CREATE TYPE "public"."funding_source" AS ENUM('llc_cash', 'llc_credit', 'owner_personal');--> statement-breakpoint
CREATE TYPE "public"."app_module" AS ENUM('dashboard', 'revenue', 'expenses', 'subscriptions', 'debts', 'banking', 'owner_equity', 'taxes', 'reports', 'settings', 'users');--> statement-breakpoint
CREATE TYPE "public"."owner_entry_type" AS ENUM('contribution', 'loan', 'reimbursement', 'draw');--> statement-breakpoint
CREATE TYPE "public"."revenue_status" AS ENUM('pending', 'available', 'paid_out', 'refunded', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'paused', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."tax_status" AS ENUM('upcoming', 'in_progress', 'filed', 'paid', 'overdue', 'not_required');--> statement-breakpoint
CREATE TABLE "account_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"statement_date" date NOT NULL,
	"closing_balance_cents" bigint NOT NULL,
	"computed_balance_cents" bigint,
	"reconciled_at" timestamp with time zone,
	"reconciled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" varchar(20) NOT NULL,
	"entity" varchar(60) NOT NULL,
	"entity_id" uuid,
	"diff" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"movement_date" date NOT NULL,
	"type" "cash_movement_type" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"fx_rate_to_usd" numeric(14, 6) DEFAULT '1' NOT NULL,
	"description" text,
	"revenue_id" uuid,
	"expense_id" uuid,
	"debt_payment_id" uuid,
	"tax_obligation_id" uuid,
	"owner_ledger_id" uuid,
	"transfer_group_id" uuid,
	"external_id" text,
	"statement_id" uuid,
	"reconciled" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "category_kind" NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"is_tax_deductible" boolean DEFAULT true NOT NULL,
	"color" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counterparties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "counterparty_type" NOT NULL,
	"name" text NOT NULL,
	"email" varchar(255),
	"country" varchar(2),
	"external_ref" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "debt_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"debt_id" uuid NOT NULL,
	"installment_number" integer,
	"due_date" date NOT NULL,
	"paid_on" date,
	"principal_cents" bigint DEFAULT 0 NOT NULL,
	"interest_cents" bigint DEFAULT 0 NOT NULL,
	"fee_cents" bigint DEFAULT 0 NOT NULL,
	"funding_source" "funding_source" DEFAULT 'llc_cash' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "debts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creditor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"account_id" uuid,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"principal_cents" bigint NOT NULL,
	"upfront_fee_cents" bigint DEFAULT 0 NOT NULL,
	"annual_rate_pct" numeric(6, 3) DEFAULT '0' NOT NULL,
	"installments_total" integer,
	"installment_amount_cents" bigint,
	"start_date" date NOT NULL,
	"first_due_date" date,
	"maturity_date" date,
	"status" "debt_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rate_date" date NOT NULL,
	"base" "currency" NOT NULL,
	"quote" "currency" NOT NULL,
	"rate" numeric(14, 6) NOT NULL,
	"source" text
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_date" date NOT NULL,
	"vendor_id" uuid,
	"description" text NOT NULL,
	"category_id" uuid NOT NULL,
	"frequency" "billing_interval" DEFAULT 'one_time' NOT NULL,
	"subscription_id" uuid,
	"debt_id" uuid,
	"contract_id" uuid,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"fx_rate_to_usd" numeric(14, 6) DEFAULT '1' NOT NULL,
	"funding_source" "funding_source" NOT NULL,
	"payment_account_id" uuid,
	"due_date" date,
	"paid_on" date,
	"status" "expense_status" DEFAULT 'pending' NOT NULL,
	"receipt_url" text,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_amount_positive" CHECK ("expenses"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "financial_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"institution" text,
	"owner" "account_owner" NOT NULL,
	"type" "account_type" NOT NULL,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"last4" varchar(4),
	"opening_balance_cents" bigint DEFAULT 0 NOT NULL,
	"opening_date" date,
	"credit_limit_cents" bigint,
	"statement_day" integer,
	"payment_due_day" integer,
	"repayment_terms" varchar(20),
	"cashback_pct" numeric(5, 3),
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_date" date NOT NULL,
	"owner_user_id" uuid,
	"type" "owner_entry_type" NOT NULL,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"fx_rate_to_usd" numeric(14, 6) DEFAULT '1' NOT NULL,
	"expense_id" uuid,
	"revenue_id" uuid,
	"debt_payment_id" uuid,
	"personal_account_id" uuid,
	"description" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_amount_positive" CHECK ("owner_ledger"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"line" text,
	"category_id" uuid NOT NULL,
	"default_billing_interval" "billing_interval" DEFAULT 'one_time' NOT NULL,
	"platform" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"color" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"due_on" date NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"amount_cents" bigint,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revenues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revenue_date" date NOT NULL,
	"customer_id" uuid,
	"customer_name" text,
	"product_id" uuid,
	"category_id" uuid NOT NULL,
	"billing_interval" "billing_interval" DEFAULT 'one_time' NOT NULL,
	"service_start" date,
	"service_end" date,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"gross_cents" bigint NOT NULL,
	"processor_fee_cents" bigint DEFAULT 0 NOT NULL,
	"affiliate_fee_cents" bigint DEFAULT 0 NOT NULL,
	"net_cents" bigint GENERATED ALWAYS AS (gross_cents - processor_fee_cents - affiliate_fee_cents) STORED NOT NULL,
	"fx_rate_to_usd" numeric(14, 6) DEFAULT '1' NOT NULL,
	"status" "revenue_status" DEFAULT 'pending' NOT NULL,
	"deposit_account_id" uuid,
	"external_ref" text,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revenues_gross_positive" CHECK ("revenues"."gross_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"module" "app_module" NOT NULL,
	"level" "access_level" DEFAULT 'none' NOT NULL,
	CONSTRAINT "role_permissions_role_id_module_pk" PRIMARY KEY("role_id","module")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(40) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(60) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"billing_interval" "billing_interval" NOT NULL,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"started_on" date NOT NULL,
	"next_renewal_on" date NOT NULL,
	"canceled_on" date,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"default_funding_source" "funding_source" DEFAULT 'llc_credit' NOT NULL,
	"default_payment_account_id" uuid,
	"auto_create_expense" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"authority_id" uuid,
	"jurisdiction" varchar(40) NOT NULL,
	"name" text NOT NULL,
	"period_start" date,
	"period_end" date,
	"due_date" date NOT NULL,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"estimated_cents" bigint DEFAULT 0 NOT NULL,
	"paid_cents" bigint DEFAULT 0 NOT NULL,
	"status" "tax_status" DEFAULT 'upcoming' NOT NULL,
	"filed_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_reserve_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_date" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"tax_obligation_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"role_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"preferred_theme" varchar(10) DEFAULT 'system',
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"total_cents" bigint NOT NULL,
	"signed_on" date NOT NULL,
	"expected_end_on" date,
	"installments_total" integer,
	"installment_day" integer,
	"installment_amount_cents" bigint,
	"default_funding_source" "funding_source" DEFAULT 'owner_personal' NOT NULL,
	"status" "contract_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_statements" ADD CONSTRAINT "account_statements_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_statements" ADD CONSTRAINT "account_statements_reconciled_by_users_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_revenue_id_revenues_id_fk" FOREIGN KEY ("revenue_id") REFERENCES "public"."revenues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_debt_payment_id_debt_payments_id_fk" FOREIGN KEY ("debt_payment_id") REFERENCES "public"."debt_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_tax_obligation_id_tax_obligations_id_fk" FOREIGN KEY ("tax_obligation_id") REFERENCES "public"."tax_obligations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_owner_ledger_id_owner_ledger_id_fk" FOREIGN KEY ("owner_ledger_id") REFERENCES "public"."owner_ledger"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_statement_id_account_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."account_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_debt_id_debts_id_fk" FOREIGN KEY ("debt_id") REFERENCES "public"."debts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_creditor_id_counterparties_id_fk" FOREIGN KEY ("creditor_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vendor_id_counterparties_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_debt_id_debts_id_fk" FOREIGN KEY ("debt_id") REFERENCES "public"."debts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_contract_id_vendor_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."vendor_contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payment_account_id_financial_accounts_id_fk" FOREIGN KEY ("payment_account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_ledger" ADD CONSTRAINT "owner_ledger_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_ledger" ADD CONSTRAINT "owner_ledger_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_ledger" ADD CONSTRAINT "owner_ledger_revenue_id_revenues_id_fk" FOREIGN KEY ("revenue_id") REFERENCES "public"."revenues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_ledger" ADD CONSTRAINT "owner_ledger_debt_payment_id_debt_payments_id_fk" FOREIGN KEY ("debt_payment_id") REFERENCES "public"."debt_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_ledger" ADD CONSTRAINT "owner_ledger_personal_account_id_financial_accounts_id_fk" FOREIGN KEY ("personal_account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_ledger" ADD CONSTRAINT "owner_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenues" ADD CONSTRAINT "revenues_customer_id_counterparties_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenues" ADD CONSTRAINT "revenues_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenues" ADD CONSTRAINT "revenues_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenues" ADD CONSTRAINT "revenues_deposit_account_id_financial_accounts_id_fk" FOREIGN KEY ("deposit_account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenues" ADD CONSTRAINT "revenues_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_vendor_id_counterparties_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_default_payment_account_id_financial_accounts_id_fk" FOREIGN KEY ("default_payment_account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_obligations" ADD CONSTRAINT "tax_obligations_authority_id_counterparties_id_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_reserve_entries" ADD CONSTRAINT "tax_reserve_entries_tax_obligation_id_tax_obligations_id_fk" FOREIGN KEY ("tax_obligation_id") REFERENCES "public"."tax_obligations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_contracts" ADD CONSTRAINT "vendor_contracts_vendor_id_counterparties_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_contracts" ADD CONSTRAINT "vendor_contracts_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "statements_account_date_idx" ON "account_statements" USING btree ("account_id","statement_date");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "cash_account_date_idx" ON "cash_movements" USING btree ("account_id","movement_date");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_external_idx" ON "cash_movements" USING btree ("account_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_kind_name_idx" ON "categories" USING btree ("kind","name");--> statement-breakpoint
CREATE INDEX "counterparties_type_idx" ON "counterparties" USING btree ("type");--> statement-breakpoint
CREATE INDEX "debt_payments_due_idx" ON "debt_payments" USING btree ("due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "fx_unique_idx" ON "exchange_rates" USING btree ("rate_date","base","quote");--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("expense_date");--> statement-breakpoint
CREATE INDEX "expenses_due_idx" ON "expenses" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "owner_ledger_date_idx" ON "owner_ledger" USING btree ("entry_date");--> statement-breakpoint
CREATE INDEX "revenues_date_idx" ON "revenues" USING btree ("revenue_date");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tax_due_idx" ON "tax_obligations" USING btree ("due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));
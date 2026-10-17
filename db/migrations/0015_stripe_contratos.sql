CREATE TYPE "public"."access_task_kind" AS ENUM('grant_level', 'contact_client', 'restrict_access', 'restore_access', 'review_access');--> statement-breakpoint
CREATE TYPE "public"."access_task_status" AS ENUM('pendiente', 'hecha', 'descartada');--> statement-breakpoint
CREATE TYPE "public"."customer_contract_status" AS ENUM('al_dia', 'pendiente', 'fallido', 'vencido', 'completado', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."installment_status" AS ENUM('pagada', 'pendiente', 'fallida', 'reembolsada');--> statement-breakpoint
ALTER TYPE "public"."cash_movement_type" ADD VALUE 'sales_tax_collected';--> statement-breakpoint
CREATE TABLE "access_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"kind" "access_task_kind" NOT NULL,
	"level" integer,
	"title" text NOT NULL,
	"detail" text,
	"status" "access_task_status" DEFAULT 'pendiente' NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	"due_date" date,
	"status" "installment_status" DEFAULT 'pendiente' NOT NULL,
	"stripe_invoice_id" text,
	"revenue_id" uuid,
	"paid_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_installments_stripe_invoice_id_unique" UNIQUE("stripe_invoice_id")
);
--> statement-breakpoint
CREATE TABLE "customer_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_schedule_id" text,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"total_cents" bigint NOT NULL,
	"installments" integer NOT NULL,
	"status" "customer_contract_status" DEFAULT 'al_dia' NOT NULL,
	"access_start" date NOT NULL,
	"access_end" date NOT NULL,
	"access_level_confirmed" integer DEFAULT 0 NOT NULL,
	"next_due_date" date,
	"failed_since" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_contracts_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"livemode" boolean NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "stripe_product_id" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "installments" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "access_levels" jsonb;--> statement-breakpoint
ALTER TABLE "revenues" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "revenues" ADD COLUMN "stripe_charge_id" text;--> statement-breakpoint
ALTER TABLE "revenues" ADD COLUMN "tax_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "revenues" ADD COLUMN "tax_country" varchar(2);--> statement-breakpoint
ALTER TABLE "revenues" ADD COLUMN "tax_region" text;--> statement-breakpoint
ALTER TABLE "revenues" ADD COLUMN "merchant_of_record" varchar(10) DEFAULT 'skool' NOT NULL;--> statement-breakpoint
ALTER TABLE "access_tasks" ADD CONSTRAINT "access_tasks_contract_id_customer_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."customer_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_tasks" ADD CONSTRAINT "access_tasks_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_installments" ADD CONSTRAINT "contract_installments_contract_id_customer_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."customer_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_installments" ADD CONSTRAINT "contract_installments_revenue_id_revenues_id_fk" FOREIGN KEY ("revenue_id") REFERENCES "public"."revenues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contracts" ADD CONSTRAINT "customer_contracts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contracts" ADD CONSTRAINT "customer_contracts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_tasks_status_idx" ON "access_tasks" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_installment_number_idx" ON "contract_installments" USING btree ("contract_id","number");--> statement-breakpoint
CREATE INDEX "customer_contracts_status_idx" ON "customer_contracts" USING btree ("status");--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_stripe_customer_id_unique" UNIQUE("stripe_customer_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_stripe_product_id_unique" UNIQUE("stripe_product_id");--> statement-breakpoint
ALTER TABLE "revenues" ADD CONSTRAINT "revenues_external_id_unique" UNIQUE("external_id");--> statement-breakpoint
-- Stripe como plataforma de cobro de la LLC (como el saldo de Skool): su saldo solo sale por payout.
INSERT INTO "financial_accounts" ("name", "institution", "owner", "type", "currency", "status", "sort_order")
SELECT 'Saldo Stripe', 'Stripe', 'llc', 'processor', 'USD', 'active', 2
WHERE NOT EXISTS (SELECT 1 FROM "financial_accounts" WHERE lower("institution") = 'stripe' AND "type" = 'processor');

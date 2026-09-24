CREATE TYPE "public"."goal_metric" AS ENUM('gross_revenue', 'net_revenue', 'net_profit', 'mrr', 'active_members', 'new_members', 'cash');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('active', 'archived');--> statement-breakpoint
ALTER TYPE "public"."app_module" ADD VALUE 'planning' BEFORE 'settings';--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"month" varchar(7),
	"amount_cents" bigint NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"metric" "goal_metric" NOT NULL,
	"target" numeric(14, 2) NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "goal_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "dashboard_prefs" jsonb;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_category_month_idx" ON "budgets" USING btree ("category_id","month");
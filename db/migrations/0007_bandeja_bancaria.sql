CREATE TYPE "public"."bank_inbox_status" AS ENUM('pending', 'classified', 'ignored');--> statement-breakpoint
CREATE TABLE "bank_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"posted_on" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"counterparty" text,
	"description" text,
	"status" "bank_inbox_status" DEFAULT 'pending' NOT NULL,
	"suggestion" jsonb,
	"cash_movement_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classification_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pattern" text NOT NULL,
	"as" varchar(30) NOT NULL,
	"category_id" uuid,
	"product_id" uuid,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classification_rules_pattern_unique" UNIQUE("pattern")
);
--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "bank_inbox" ADD CONSTRAINT "bank_inbox_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_inbox" ADD CONSTRAINT "bank_inbox_cash_movement_id_cash_movements_id_fk" FOREIGN KEY ("cash_movement_id") REFERENCES "public"."cash_movements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_inbox" ADD CONSTRAINT "bank_inbox_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_rules" ADD CONSTRAINT "classification_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_rules" ADD CONSTRAINT "classification_rules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_inbox_external_idx" ON "bank_inbox" USING btree ("account_id","external_id");--> statement-breakpoint
CREATE INDEX "bank_inbox_status_idx" ON "bank_inbox" USING btree ("status");
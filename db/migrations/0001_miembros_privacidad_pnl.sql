CREATE TYPE "public"."member_status" AS ENUM('active', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."pnl_line" AS ENUM('operating', 'depreciation', 'interest', 'income_tax');--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"product_id" uuid NOT NULL,
	"billing_interval" "billing_interval" NOT NULL,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"price_cents" bigint NOT NULL,
	"started_on" date NOT NULL,
	"current_period_end" date NOT NULL,
	"status" "member_status" DEFAULT 'active' NOT NULL,
	"canceled_on" date,
	"access_until" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "pnl_line" "pnl_line" DEFAULT 'operating' NOT NULL;--> statement-breakpoint
ALTER TABLE "revenues" ADD COLUMN "member_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_owner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "members_status_idx" ON "members" USING btree ("status");--> statement-breakpoint
ALTER TABLE "revenues" ADD CONSTRAINT "revenues_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
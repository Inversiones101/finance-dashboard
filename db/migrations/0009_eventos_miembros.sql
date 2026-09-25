CREATE TYPE "public"."member_event_type" AS ENUM('new', 'change', 'cancel', 'reactivate');--> statement-breakpoint
CREATE TABLE "member_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"event_date" date NOT NULL,
	"type" "member_event_type" NOT NULL,
	"mrr_delta_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_events" ADD CONSTRAINT "member_events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_events_date_idx" ON "member_events" USING btree ("event_date");--> statement-breakpoint
CREATE INDEX "member_events_member_idx" ON "member_events" USING btree ("member_id");--> statement-breakpoint
-- Historia inicial: el alta de cada miembro y, si ya se fue, su baja (el día que dejó de contar).
INSERT INTO "member_events" ("member_id", "event_date", "type", "mrr_delta_cents")
SELECT "id", "started_on", 'new',
       ROUND("price_cents"::numeric / CASE "billing_interval" WHEN 'annual' THEN 12 WHEN 'quarterly' THEN 3 ELSE 1 END)
FROM "members";--> statement-breakpoint
INSERT INTO "member_events" ("member_id", "event_date", "type", "mrr_delta_cents")
SELECT "id", COALESCE("access_until", "canceled_on", "current_period_end"), 'cancel',
       -ROUND("price_cents"::numeric / CASE "billing_interval" WHEN 'annual' THEN 12 WHEN 'quarterly' THEN 3 ELSE 1 END)
FROM "members" WHERE "status" = 'canceled';

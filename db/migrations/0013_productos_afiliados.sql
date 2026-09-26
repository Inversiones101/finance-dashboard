ALTER TABLE "expenses" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "invited_by" text;--> statement-breakpoint
ALTER TABLE "revenues" ADD COLUMN "affiliate_name" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
CREATE TABLE "product_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"price_cents" bigint NOT NULL,
	"effective_from" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_prices_product_date_idx" ON "product_prices" USING btree ("product_id","effective_from");--> statement-breakpoint
-- El precio de lista actual pasa a ser el primer precio del historial (vigente desde siempre).
INSERT INTO "product_prices" ("product_id", "price_cents", "effective_from", "note")
SELECT "id", "list_price_cents", '2000-01-01', 'Precio inicial'
FROM "products" WHERE "list_price_cents" IS NOT NULL;

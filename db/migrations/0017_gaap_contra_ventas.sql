ALTER TABLE "categories" ADD COLUMN "is_contra_revenue" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Reembolsos y descuentos a clientes son devoluciones sobre ventas (restan ventas, no son gasto).
UPDATE "categories" SET "is_contra_revenue" = true WHERE "kind" = 'opex' AND "name" = 'Descuentos y reembolsos a clientes';

-- Migración de datos (idempotente). En una base nueva no encuentra filas y no hace nada;
-- en producción prepara lo existente para miembros, privacidad del dueño y el nuevo P&L.

-- 1. El primer usuario creado es el dueño (ve la sección privada de aportes).
UPDATE "users" SET "is_owner" = true
WHERE "id" = (SELECT "id" FROM "users" ORDER BY "created_at" LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM "users" WHERE "is_owner");
--> statement-breakpoint

-- 2. Categorías: las comisiones de financiamiento van debajo del EBIT; nuevas categorías base.
UPDATE "categories" SET "pnl_line" = 'interest' WHERE "name" = 'Comisiones financieras' AND "kind" = 'opex';
--> statement-breakpoint
INSERT INTO "categories" ("kind", "name", "pnl_line")
SELECT v.kind::category_kind, v.name, v.line::pnl_line
FROM (VALUES ('opex', 'Impuestos y licencias', 'operating'), ('opex', 'Comisiones bancarias', 'operating')) AS v(kind, name, line)
WHERE EXISTS (SELECT 1 FROM "categories")
ON CONFLICT ("kind", "name") DO NOTHING;
--> statement-breakpoint

-- 3. Precios de lista de las membresías de Skool.
UPDATE "products" SET "list_price_cents" = 3700 WHERE "name" = 'Membresía mensual' AND "list_price_cents" IS NULL;
--> statement-breakpoint
UPDATE "products" SET "list_price_cents" = 19700 WHERE "name" = 'Membresía anual' AND "list_price_cents" IS NULL;
--> statement-breakpoint

-- 4. Miembros a partir de los cobros recurrentes con nombre de cliente.
--    El plan vigente es el del cobro más reciente (empate ⇒ el de periodo más largo).
INSERT INTO "members" ("name", "product_id", "billing_interval", "currency", "price_cents", "started_on", "current_period_end", "notes")
SELECT
  latest.customer_name,
  latest.product_id,
  latest.billing_interval,
  latest.currency,
  COALESCE(p.list_price_cents, latest.gross_cents),
  first_charge.started_on,
  (COALESCE(latest.service_start, latest.revenue_date) + CASE latest.billing_interval
      WHEN 'monthly' THEN INTERVAL '1 month'
      WHEN 'quarterly' THEN INTERVAL '3 months'
      ELSE INTERVAL '12 months' END)::date,
  'Creado desde sus cobros registrados'
FROM (
  SELECT DISTINCT ON (lower(trim(r.customer_name))) r.*
  FROM "revenues" r
  WHERE r.customer_name IS NOT NULL AND r.product_id IS NOT NULL
    AND r.billing_interval <> 'one_time' AND r.status NOT IN ('refunded', 'disputed')
  ORDER BY lower(trim(r.customer_name)), COALESCE(r.service_start, r.revenue_date) DESC,
           CASE r.billing_interval WHEN 'annual' THEN 3 WHEN 'quarterly' THEN 2 ELSE 1 END DESC
) latest
JOIN "products" p ON p.id = latest.product_id
JOIN (
  SELECT lower(trim(customer_name)) AS k, min(revenue_date) AS started_on
  FROM "revenues" WHERE customer_name IS NOT NULL GROUP BY 1
) first_charge ON first_charge.k = lower(trim(latest.customer_name))
WHERE NOT EXISTS (SELECT 1 FROM "members" m WHERE lower(trim(m.name)) = lower(trim(latest.customer_name)));
--> statement-breakpoint

UPDATE "revenues" r SET "member_id" = m.id
FROM "members" m
WHERE r.member_id IS NULL AND r.customer_name IS NOT NULL AND lower(trim(r.customer_name)) = lower(trim(m.name));
--> statement-breakpoint

-- 5. Lo pagado con dinero del dueño es un aporte ya hecho: no hay "tarjetas personales por pagar".
UPDATE "expenses" SET "status" = 'paid', "due_date" = NULL, "paid_on" = COALESCE("paid_on", "expense_date")
WHERE "funding_source" = 'owner_personal' AND "status" = 'pending';
--> statement-breakpoint
UPDATE "subscriptions" SET "default_payment_account_id" = NULL, "default_funding_source" = 'owner_personal'
WHERE "default_payment_account_id" IN (SELECT "id" FROM "financial_accounts" WHERE "owner" = 'personal');

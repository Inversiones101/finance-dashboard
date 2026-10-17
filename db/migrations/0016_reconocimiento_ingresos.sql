-- Reconocimiento de ingresos: cada cobro recurrente guarda hasta cuándo cubre (fin exclusivo).
-- Anual = 12 meses, trimestral = 3, mensual = 1, contados desde el inicio del servicio.
UPDATE "revenues"
SET "service_end" = (COALESCE("service_start", "revenue_date") + (CASE "billing_interval" WHEN 'annual' THEN 12 WHEN 'quarterly' THEN 3 ELSE 1 END) * interval '1 month')::date
WHERE "billing_interval" <> 'one_time' AND "service_end" IS NULL;

-- Descuentos y reembolsos a clientes (ej. el descuento prometido al pasar de mensual a anual).
INSERT INTO "categories" ("kind", "name", "is_tax_deductible")
SELECT 'opex', 'Descuentos y reembolsos a clientes', true
WHERE NOT EXISTS (SELECT 1 FROM "categories" WHERE "kind" = 'opex' AND "name" = 'Descuentos y reembolsos a clientes');

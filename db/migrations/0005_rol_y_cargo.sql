-- "Admin total" → "Administrador"; el dueño aparece con su cargo.
UPDATE "roles" SET "name" = 'Administrador' WHERE "key" = 'admin' AND "name" = 'Admin total';
--> statement-breakpoint
UPDATE "users" SET "title" = 'Fundador' WHERE "is_owner" AND "title" IS NULL;

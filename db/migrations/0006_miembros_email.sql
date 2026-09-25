ALTER TABLE "members" ADD COLUMN "email" text;--> statement-breakpoint
CREATE UNIQUE INDEX "members_email_idx" ON "members" USING btree ("email");
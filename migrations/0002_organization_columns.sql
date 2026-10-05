ALTER TABLE `session` ADD COLUMN `active_organization_id` text;
--> statement-breakpoint
ALTER TABLE `invitation` ADD COLUMN `created_at` integer NOT NULL DEFAULT 0;

CREATE TABLE `metered_usage_event` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`job_id` text NOT NULL REFERENCES `job`(`id`) ON DELETE CASCADE,
	`package_id` text NOT NULL REFERENCES `package`(`id`) ON DELETE CASCADE,
	`size_bytes` integer NOT NULL,
	`mb_billed` integer NOT NULL,
	`stripe_event_id` text,
	`created_at` integer NOT NULL
);

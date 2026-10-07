CREATE TABLE `processing_stat` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);

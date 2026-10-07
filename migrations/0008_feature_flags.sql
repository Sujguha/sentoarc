CREATE TABLE `feature_flag` (
	`key` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`description` text,
	`updated_at` integer NOT NULL
);

-- Pricing pivot: subscription tiers free/pro/metered/enterprise, billed
-- per month or per MB, become free/project_pack/enterprise, billed as
-- one-time packs of "objects" (converted files). See CHANGELOG.

ALTER TABLE `subscription` ADD COLUMN `objects_remaining` integer NOT NULL DEFAULT 3;

CREATE TABLE `pack_purchase` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`pack_tier` text NOT NULL,
	`objects_granted` integer,
	`amount_cents` integer NOT NULL,
	`stripe_checkout_session_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pack_purchase_stripe_checkout_session_id_unique` ON `pack_purchase` (`stripe_checkout_session_id`);

-- Carry existing paying customers forward onto the nearest new tier
-- rather than silently downgrading them to free on this pivot. There is
-- no exact translation from "unlimited monthly" (old pro) or a prepaid
-- cents balance (old metered) into an object count, so this is a
-- one-time, generous conversion to a fresh Project Pack grant, not a
-- precise migration of what they had before.
UPDATE `subscription` SET `tier` = 'project_pack', `objects_remaining` = 100 WHERE `tier` IN ('pro', 'metered');

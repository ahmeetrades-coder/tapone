ALTER TABLE `postbacks` ADD COLUMN `offer_title` text;
--> statement-breakpoint
ALTER TABLE `postbacks` ADD COLUMN `offer_image_url` text;
--> statement-breakpoint
ALTER TABLE `postbacks` ADD COLUMN `kind` text;
--> statement-breakpoint
CREATE INDEX `postbacks_live_idx` ON `postbacks` (`status`, `credited_cents`, `created_at`);

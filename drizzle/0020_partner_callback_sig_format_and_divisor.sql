ALTER TABLE `partner_callbacks` ADD COLUMN `sig_format` text DEFAULT 'params' NOT NULL;
--> statement-breakpoint
ALTER TABLE `partner_callbacks` ADD COLUMN `payout_divisor` real DEFAULT 1 NOT NULL;

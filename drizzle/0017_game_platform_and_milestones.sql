ALTER TABLE `content_items` ADD COLUMN `platform` text DEFAULT 'android' NOT NULL;
--> statement-breakpoint
ALTER TABLE `content_items` ADD COLUMN `milestones_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `content_items` ADD COLUMN `badge` text;

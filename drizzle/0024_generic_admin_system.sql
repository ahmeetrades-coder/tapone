ALTER TABLE `partner_callbacks` ADD COLUMN `sig_template` text;
--> statement-breakpoint
ALTER TABLE `partner_callbacks` ADD COLUMN `status_param` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `partner_callbacks` ADD COLUMN `status_credit_value` text DEFAULT '1' NOT NULL;
--> statement-breakpoint
ALTER TABLE `partner_callbacks` ADD COLUMN `link_hash_salt` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `partner_callbacks` ADD COLUMN `link_hash_param` text DEFAULT 'hash' NOT NULL;
--> statement-breakpoint
ALTER TABLE `content_items` ADD COLUMN `feed_auth_kind` text DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE `content_items` ADD COLUMN `feed_secret` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `content_items` ADD COLUMN `feed_category` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `content_items` ADD COLUMN `feed_category_mode` text DEFAULT 'include' NOT NULL;

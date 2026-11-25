ALTER TABLE `announcements` ADD COLUMN `user_id` integer;
--> statement-breakpoint
CREATE INDEX `announcements_user_idx` ON `announcements` (`user_id`);

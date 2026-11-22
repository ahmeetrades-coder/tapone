ALTER TABLE `messages` ADD COLUMN `image_url` text;
--> statement-breakpoint
ALTER TABLE `messages` ADD COLUMN `status` text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
CREATE TABLE `announcements` (
  `id` integer PRIMARY KEY AUTOINCREMENT,
  `kind` text DEFAULT 'announcement' NOT NULL,
  `title` text NOT NULL,
  `body` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `announcement_reads` (
  `id` integer PRIMARY KEY AUTOINCREMENT,
  `user_id` integer NOT NULL,
  `announcement_id` integer NOT NULL,
  `read_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `announcement_reads_user_announcement_idx` ON `announcement_reads` (`user_id`, `announcement_id`);

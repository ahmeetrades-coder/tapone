CREATE TABLE `contest_awards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contest` text DEFAULT 'daily' NOT NULL,
	`period_key` text NOT NULL,
	`user_id` integer NOT NULL,
	`rank` integer NOT NULL,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'paid' NOT NULL,
	`release_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contest_awards_period_user_unique` ON `contest_awards` (`period_key`,`user_id`);
--> statement-breakpoint
ALTER TABLE `users` ADD `title_bonus_paid_level` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `twofa_enabled` integer DEFAULT 0 NOT NULL;

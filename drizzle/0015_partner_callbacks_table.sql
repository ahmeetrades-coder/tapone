CREATE TABLE `partner_callbacks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`user_param` text DEFAULT 'user_id' NOT NULL,
	`txn_param` text DEFAULT 'txn_id' NOT NULL,
	`payout_param` text DEFAULT 'payout' NOT NULL,
	`payout_in_cents` integer DEFAULT 0 NOT NULL,
	`auth_method` text DEFAULT 'none' NOT NULL,
	`secret_param` text DEFAULT '' NOT NULL,
	`secret` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `partner_callbacks_key_unique` ON `partner_callbacks` (`key`);

CREATE TABLE `withdraw_methods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`country_code` text NOT NULL,
	`country_name` text DEFAULT '' NOT NULL,
	`label` text NOT NULL,
	`fields_json` text DEFAULT '[]' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL
);

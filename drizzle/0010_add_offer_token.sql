ALTER TABLE `users` ADD COLUMN `offer_token` text;
--> statement-breakpoint
UPDATE `users` SET `offer_token` = 'OT-' || substr(`user_code`, 4) WHERE `user_code` LIKE 'TO-%' AND `offer_token` IS NULL;
--> statement-breakpoint
UPDATE `users` SET `offer_token` = 'OT-' || `user_code` WHERE `offer_token` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_offer_token_unique` ON `users` (`offer_token`);

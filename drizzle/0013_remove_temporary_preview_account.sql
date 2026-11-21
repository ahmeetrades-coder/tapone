DELETE FROM `sessions` WHERE `user_id` IN (SELECT `id` FROM `users` WHERE `email` = 'preview@tapone.internal');
--> statement-breakpoint
DELETE FROM `users` WHERE `email` = 'preview@tapone.internal';
--> statement-breakpoint
DELETE FROM `settings` WHERE `key` = 'preview_login_enabled';

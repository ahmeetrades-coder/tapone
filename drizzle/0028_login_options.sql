ALTER TABLE `users` ADD COLUMN `password_hash` TEXT;
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `email_verified` INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE TABLE email_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'signup',
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX email_verifications_email_idx ON email_verifications (email);

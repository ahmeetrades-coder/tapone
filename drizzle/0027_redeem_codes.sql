CREATE TABLE redeem_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL,
  max_uses INTEGER NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE redeem_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX redeem_redemptions_code_user_idx ON redeem_redemptions (code_id, user_id);
--> statement-breakpoint
CREATE INDEX redeem_redemptions_created_idx ON redeem_redemptions (created_at);

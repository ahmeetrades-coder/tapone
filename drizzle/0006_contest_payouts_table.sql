CREATE TABLE contest_payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contest TEXT NOT NULL DEFAULT 'daily',
  period_key TEXT NOT NULL,
  winner_user_id INTEGER,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX contest_payouts_unique ON contest_payouts (contest, period_key);

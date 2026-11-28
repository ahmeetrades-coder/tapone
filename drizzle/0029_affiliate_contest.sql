CREATE TABLE affiliate_contest_settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_key TEXT NOT NULL,
  total_cents INTEGER NOT NULL DEFAULT 0,
  winners_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX affiliate_contest_settlements_week_unique ON affiliate_contest_settlements (week_key);
--> statement-breakpoint
CREATE TABLE affiliate_withdrawal_commissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  withdrawal_id INTEGER NOT NULL,
  referrer_id INTEGER NOT NULL,
  invitee_id INTEGER NOT NULL,
  pct INTEGER NOT NULL,
  commission_cents INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX affiliate_withdrawal_commissions_withdrawal_unique ON affiliate_withdrawal_commissions (withdrawal_id);

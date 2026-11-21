CREATE TABLE contest_joins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  contest TEXT NOT NULL,
  period_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX contest_joins_unique ON contest_joins (user_id, contest, period_key);

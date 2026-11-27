CREATE TABLE daily_contest_settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_key TEXT NOT NULL,
  total_cents INTEGER NOT NULL DEFAULT 0,
  winners_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX daily_contest_settlements_day_unique ON daily_contest_settlements (day_key);

CREATE TABLE banned_countries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country_code TEXT NOT NULL UNIQUE,
  country_name TEXT NOT NULL DEFAULT '',
  flag_emoji TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE admin_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'registration',
  user_id INTEGER,
  user_name TEXT NOT NULL DEFAULT '',
  user_email TEXT NOT NULL DEFAULT '',
  user_code TEXT NOT NULL DEFAULT '',
  country_code TEXT,
  country_name TEXT,
  flag_emoji TEXT,
  ip TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

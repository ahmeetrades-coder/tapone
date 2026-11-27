CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX chat_messages_created_idx ON chat_messages (created_at);
--> statement-breakpoint
CREATE TABLE chat_blocks (
  user_id INTEGER PRIMARY KEY,
  blocked_by INTEGER NOT NULL,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
ALTER TABLE users ADD COLUMN is_chat_manager INTEGER NOT NULL DEFAULT 0;

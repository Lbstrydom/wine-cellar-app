-- Migration 019: Chat sessions persistence for AI conversations
-- Allows conversations to survive server restarts and enables conversation history

-- Chat sessions table stores metadata about each conversation
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  session_type TEXT NOT NULL,  -- 'sommelier', 'zone_chat', 'cellar_analysis'
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity TEXT NOT NULL DEFAULT (datetime('now')),
  context_json TEXT,           -- Initial context (wine list summary, zone info, etc.)
  status TEXT DEFAULT 'active' -- 'active', 'completed', 'expired'
);

-- Chat messages table stores individual messages in conversations
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,          -- 'user', 'assistant', 'system'
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  tokens_used INTEGER,         -- Track token usage per message
  model_used TEXT,             -- Which model was used
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_chat_sessions_type ON chat_sessions(session_type);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_status ON chat_sessions(status);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_last_activity ON chat_sessions(last_activity);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);

-- Cleanup old/expired sessions (can be called periodically)
-- Sessions older than 24 hours without activity should be marked expired
-- This is a placeholder trigger concept - actual cleanup via scheduled job

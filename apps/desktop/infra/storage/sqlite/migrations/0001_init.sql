CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  item_ids_json TEXT NOT NULL,
  executions_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_items (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  item_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  classification_json TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  needs_followup INTEGER NOT NULL DEFAULT 0,
  followup_question TEXT,
  decision_source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS logs_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  code TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  session_id TEXT,
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_created_status ON sessions(created_at, status);
CREATE INDEX IF NOT EXISTS idx_session_items_session_followup ON session_items(session_id, needs_followup);
CREATE INDEX IF NOT EXISTS idx_logs_index_session_timestamp ON logs_index(session_id, timestamp);

CREATE TABLE IF NOT EXISTS legacy_imports (
  source_file TEXT PRIMARY KEY,
  imported_at TEXT NOT NULL,
  records INTEGER NOT NULL DEFAULT 0
);


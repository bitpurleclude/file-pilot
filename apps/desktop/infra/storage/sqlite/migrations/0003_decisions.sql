CREATE TABLE IF NOT EXISTS classification_decisions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence REAL NOT NULL,
  purpose TEXT NOT NULL,
  project TEXT NOT NULL,
  prompt_version TEXT,
  model TEXT,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rule_feedback_events (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(rule_id) REFERENCES classification_rules(id) ON DELETE CASCADE,
  FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decisions_session_created ON classification_decisions(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rule_feedback_rule_created ON rule_feedback_events(rule_id, created_at);


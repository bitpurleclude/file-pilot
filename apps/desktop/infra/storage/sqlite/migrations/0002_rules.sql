CREATE TABLE IF NOT EXISTS classification_rules (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  project TEXT NOT NULL,
  ext TEXT,
  path_prefix TEXT,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  negative_keywords_json TEXT NOT NULL DEFAULT '[]',
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_matched_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_rules_enabled_priority ON classification_rules(enabled, priority DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rules_ext ON classification_rules(ext);


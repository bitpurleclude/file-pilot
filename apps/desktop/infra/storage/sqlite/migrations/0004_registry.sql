CREATE TABLE IF NOT EXISTS registry_areas (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  retired_at TEXT
);

CREATE TABLE IF NOT EXISTS registry_projects (
  id TEXT PRIMARY KEY,
  area_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  name TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  retired_at TEXT,
  sample_paths_json TEXT,
  UNIQUE(area_id, number),
  FOREIGN KEY(area_id) REFERENCES registry_areas(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_registry_projects_active_area_name
  ON registry_projects(area_id, name)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_registry_areas_status_number ON registry_areas(status, number);
CREATE INDEX IF NOT EXISTS idx_registry_projects_area_status ON registry_projects(area_id, status);

ALTER TABLE classification_rules ADD COLUMN project_id TEXT REFERENCES registry_projects(id);

CREATE INDEX IF NOT EXISTS idx_rules_project_id ON classification_rules(project_id);

-- Case-insensitive active-name uniqueness (belt-and-braces behind the handler
-- preflight): SQLite LIKE is CI for ASCII, so case variants must not coexist.
CREATE UNIQUE INDEX IF NOT EXISTS uq_registry_areas_active_name_ci
  ON registry_areas(lower(name))
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS uq_registry_projects_active_area_name_ci
  ON registry_projects(area_id, lower(name))
  WHERE status = 'active';


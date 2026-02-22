import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

import type Database from "better-sqlite3";

interface MigrationRow {
  migration_name: string;
}

const ensureMigrationTable = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
};

const listMigrationFiles = async (migrationsDir: string): Promise<string[]> => {
  const entries = await readdir(migrationsDir);
  return entries
    .filter((entry) => entry.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
};

const getAppliedMigrationNames = (db: Database.Database): Set<string> => {
  const rows = db.prepare("SELECT migration_name FROM schema_migrations").all() as MigrationRow[];
  return new Set(rows.map((row) => row.migration_name));
};

const runMigrationFile = (db: Database.Database, migrationName: string, sql: string): void => {
  const transaction = db.transaction(() => {
    db.exec(sql);
    db
      .prepare("INSERT INTO schema_migrations (migration_name, applied_at) VALUES (?, ?)")
      .run(migrationName, new Date().toISOString());
  });

  transaction();
};

export const runMigrations = async (params: {
  db: Database.Database;
  migrationsDir: string;
}): Promise<string[]> => {
  ensureMigrationTable(params.db);
  const applied = getAppliedMigrationNames(params.db);
  const files = await listMigrationFiles(params.migrationsDir);
  const executed: string[] = [];

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = await readFile(join(params.migrationsDir, file), "utf-8");
    runMigrationFile(params.db, file, sql);
    executed.push(file);
  }

  return executed;
};

const readLegacySessions = async (sessionsPath: string): Promise<string | null> => {
  try {
    await access(sessionsPath, constants.R_OK);
    return await readFile(sessionsPath, "utf-8");
  } catch {
    return null;
  }
};

export const importLegacySessionsJson = async (params: {
  db: Database.Database;
  dataRoot: string;
}): Promise<number> => {
  const alreadyImported = params.db
    .prepare("SELECT source_file FROM legacy_imports WHERE source_file = ?")
    .get("sessions.json");

  if (alreadyImported !== undefined) {
    return 0;
  }

  const existingRows = params.db.prepare("SELECT COUNT(*) AS total FROM sessions").get() as { total: number };
  if (existingRows.total > 0) {
    return 0;
  }

  const sessionsPath = join(params.dataRoot, "sessions.json");
  const legacyContent = await readLegacySessions(sessionsPath);
  if (legacyContent === null) {
    return 0;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(legacyContent);
  } catch {
    return 0;
  }

  if (!Array.isArray(parsed)) {
    return 0;
  }

  type LegacySession = {
    id?: string;
    status?: string;
    createdAt?: string;
    updatedAt?: string;
    itemIds?: string[];
    executions?: unknown[];
  };

  const sessions = parsed as LegacySession[];
  const insertSession = params.db.prepare(`
    INSERT OR REPLACE INTO sessions (
      id,
      status,
      created_at,
      updated_at,
      item_ids_json,
      executions_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const importTx = params.db.transaction(() => {
    for (const session of sessions) {
      if (typeof session.id !== "string" || session.id.length === 0) {
        continue;
      }

      const createdAt = typeof session.createdAt === "string" ? session.createdAt : new Date().toISOString();
      const updatedAt = typeof session.updatedAt === "string" ? session.updatedAt : createdAt;
      const itemIds = Array.isArray(session.itemIds) ? session.itemIds : [];
      const executions = Array.isArray(session.executions) ? session.executions : [];

      insertSession.run(
        session.id,
        typeof session.status === "string" ? session.status : "pending",
        createdAt,
        updatedAt,
        JSON.stringify(itemIds),
        JSON.stringify(executions)
      );
    }

    params.db
      .prepare("INSERT INTO legacy_imports (source_file, imported_at, records) VALUES (?, ?, ?)")
      .run("sessions.json", new Date().toISOString(), sessions.length);
  });

  importTx();
  return sessions.length;
};


import { join } from "node:path";

import { openSqliteDatabase } from "./db.js";
import { importLegacySessionsJson, runMigrations } from "./migration-runner.js";

export interface SqliteBootstrapResult {
  dbPath: string;
  appliedMigrations: string[];
  importedLegacyRecords: number;
}

const sqliteMigrationsPath = (): string => {
  return join(process.cwd(), "apps", "desktop", "infra", "storage", "sqlite", "migrations");
};

export const bootstrapSqliteStorage = async (appDataRoot: string): Promise<SqliteBootstrapResult> => {
  const dataRoot = join(appDataRoot, "data");
  const dbPath = join(dataRoot, "data.db");
  const db = openSqliteDatabase(dbPath);

  const appliedMigrations = await runMigrations({
    db,
    migrationsDir: sqliteMigrationsPath()
  });

  const importedLegacyRecords = await importLegacySessionsJson({
    db,
    dataRoot
  });

  return {
    dbPath,
    appliedMigrations,
    importedLegacyRecords
  };
};


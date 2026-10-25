import { join } from "node:path";

import type Database from "better-sqlite3";

import { openSqliteDatabase } from "./db.js";
import { importLegacySessionsJson, runMigrations } from "./migration-runner.js";

export interface SqliteBootstrapResult {
  dbPath: string;
  appliedMigrations: string[];
  importedLegacyRecords: number;
}

const sqliteMigrationsPath = (): string => {
  return join(__dirname, "migrations");
};

const requiredRegistryTables = ["registry_areas", "registry_projects"];

const verifyRegistryTables = (db: Database.Database): void => {
  for (const table of requiredRegistryTables) {
    const row = db
      .prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as { total: number };
    if (row.total === 0) {
      throw new Error(`registry table missing after migrations: ${table}`);
    }
  }
};

export const bootstrapSqliteStorage = async (appDataRoot: string): Promise<SqliteBootstrapResult> => {
  const dataRoot = join(appDataRoot, "data");
  const dbPath = join(dataRoot, "data.db");
  const db = openSqliteDatabase(dbPath);

  const appliedMigrations = await runMigrations({
    db,
    migrationsDir: sqliteMigrationsPath()
  });

  verifyRegistryTables(db);

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

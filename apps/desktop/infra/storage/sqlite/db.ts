import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

const databaseCache = new Map<string, Database.Database>();

const applyPragmas = (db: Database.Database): void => {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
};

export const openSqliteDatabase = (dbPath: string): Database.Database => {
  const cached = databaseCache.get(dbPath);
  if (cached !== undefined) {
    return cached;
  }

  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  applyPragmas(db);
  databaseCache.set(dbPath, db);
  return db;
};

/** Close one cached connection (mainly so tests can release temp-dir files). */
export const closeSqliteDatabase = (dbPath: string): void => {
  const db = databaseCache.get(dbPath);
  if (db === undefined) {
    return;
  }

  db.close();
  databaseCache.delete(dbPath);
};

export const closeAllSqliteDatabases = (): void => {
  for (const db of databaseCache.values()) {
    db.close();
  }

  databaseCache.clear();
};

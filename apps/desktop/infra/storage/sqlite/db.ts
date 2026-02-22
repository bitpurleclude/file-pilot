import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

const databaseCache = new Map<string, Database.Database>();

const applyPragmas = (db: Database.Database): void => {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
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

export const closeAllSqliteDatabases = (): void => {
  for (const db of databaseCache.values()) {
    db.close();
  }

  databaseCache.clear();
};


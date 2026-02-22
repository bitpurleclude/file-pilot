import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { closeAllSqliteDatabases, openSqliteDatabase } from "../../infra/storage/sqlite/db.js";
import { runMigrations } from "../../infra/storage/sqlite/migration-runner.js";

const tempDirs: string[] = [];

afterEach(async () => {
  closeAllSqliteDatabases();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("sql-migration-runner", () => {
  it("runs migrations in order and is idempotent", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-migrations-"));
    tempDirs.push(root);
    const dbPath = join(root, "data.db");
    const migrationsDir = join(root, "migrations");
    await mkdir(migrationsDir, { recursive: true });

    await writeFile(join(migrationsDir, "0001_init.sql"), "CREATE TABLE IF NOT EXISTS t1 (id TEXT PRIMARY KEY);", "utf-8");
    await writeFile(join(migrationsDir, "0002_more.sql"), "CREATE TABLE IF NOT EXISTS t2 (id TEXT PRIMARY KEY);", "utf-8");

    const db = openSqliteDatabase(dbPath);
    const firstRun = await runMigrations({ db, migrationsDir });
    const secondRun = await runMigrations({ db, migrationsDir });

    const appliedCount = db
      .prepare("SELECT COUNT(*) AS total FROM schema_migrations")
      .get() as { total: number };

    expect(firstRun).toEqual(["0001_init.sql", "0002_more.sql"]);
    expect(secondRun).toEqual([]);
    expect(appliedCount.total).toBe(2);
  });
});


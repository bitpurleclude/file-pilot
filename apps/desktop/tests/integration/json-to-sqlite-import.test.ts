import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { closeAllSqliteDatabases, openSqliteDatabase } from "../../infra/storage/sqlite/db.js";
import { importLegacySessionsJson, runMigrations } from "../../infra/storage/sqlite/migration-runner.js";

const tempDirs: string[] = [];

afterEach(async () => {
  closeAllSqliteDatabases();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("json-to-sqlite-import", () => {
  it("imports legacy sessions.json only once", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-import-"));
    tempDirs.push(root);
    const dataRoot = join(root, "data");
    await mkdir(dataRoot, { recursive: true });
    const db = openSqliteDatabase(join(dataRoot, "data.db"));
    await runMigrations({
      db,
      migrationsDir: join(process.cwd(), "apps/desktop/infra/storage/sqlite/migrations")
    });

    await writeFile(join(dataRoot, "sessions.json"), JSON.stringify([
      {
        id: "legacy-session-1",
        status: "planned",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        itemIds: ["f-1"],
        executions: []
      }
    ]), "utf-8");

    const first = await importLegacySessionsJson({ db, dataRoot });
    const second = await importLegacySessionsJson({ db, dataRoot });
    const total = db.prepare("SELECT COUNT(*) AS total FROM sessions").get() as { total: number };

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(total.total).toBe(1);
  });
});


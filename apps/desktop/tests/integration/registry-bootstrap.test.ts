import { copyFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { bootstrapSqliteStorage } from "../../infra/storage/sqlite/bootstrap.js";
import { closeAllSqliteDatabases, openSqliteDatabase } from "../../infra/storage/sqlite/db.js";
import { runMigrations } from "../../infra/storage/sqlite/migration-runner.js";
import {
  createArea,
  createProject
} from "../../infra/storage/sqlite/repositories/registry-repository.js";
import {
  createRuleSqlite,
  getRuleByIdSqlite
} from "../../infra/storage/sqlite/repositories/rules-repository.js";
import type { ClassificationRule } from "../../shared/types/rules.js";

const tempDirs: string[] = [];

afterEach(async () => {
  closeAllSqliteDatabases();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const realMigrationsDir = join(process.cwd(), "apps/desktop/infra/storage/sqlite/migrations");

const legacyRule: ClassificationRule = {
  id: "rule-legacy",
  purpose: "Documents",
  project: "P1",
  matcher: {
    ext: "md",
    keywords: ["alpha"],
    negativeKeywords: []
  },
  priority: 100,
  enabled: true,
  source: "learned",
  hits: 3,
  createdAt: "2025-12-01T00:00:00.000Z",
  updatedAt: "2025-12-01T00:00:00.000Z"
};

describe("registry-bootstrap", () => {
  it("applies the registry migration and verifies registry tables on bootstrap", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-bootstrap-"));
    tempDirs.push(root);

    const result = await bootstrapSqliteStorage(root);

    expect(result.appliedMigrations).toContain("0004_registry.sql");

    const db = openSqliteDatabase(result.dbPath);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((row) => row.name);
    expect(tableNames).toContain("registry_areas");
    expect(tableNames).toContain("registry_projects");

    const area = createArea(db, { name: "开发" });
    const project = createProject(db, { areaId: area.id, name: "登记册" });
    expect(project.number).toBe(1);
  });

  it("migration 0004 preserves legacy classification_rules rows", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-registry-mig-"));
    tempDirs.push(root);

    const stagedMigrationsDir = join(root, "migrations");
    await mkdir(stagedMigrationsDir, { recursive: true });
    for (const file of ["0001_init.sql", "0002_rules.sql", "0003_decisions.sql"]) {
      await copyFile(join(realMigrationsDir, file), join(stagedMigrationsDir, file));
    }

    const dbPath = join(root, "data.db");
    const db = openSqliteDatabase(dbPath);
    await runMigrations({ db, migrationsDir: stagedMigrationsDir });

    createRuleSqlite(db, legacyRule);
    const before = getRuleByIdSqlite(db, legacyRule.id);
    expect(before?.project).toBe("P1");

    const executed = await runMigrations({ db, migrationsDir: realMigrationsDir });
    // Later migrations (e.g. 0005_shadow.sql) may join; what this test pins is
    // that 0004 runs and leaves legacy rule rows untouched.
    expect(executed).toContain("0004_registry.sql");

    const after = getRuleByIdSqlite(db, legacyRule.id);
    expect(after).toEqual(legacyRule);

    const legacyRow = db
      .prepare("SELECT project_id FROM classification_rules WHERE id = ?")
      .get(legacyRule.id) as { project_id: string | null };
    expect(legacyRow.project_id).toBeNull();

    const registryTables = db
      .prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name IN ('registry_areas', 'registry_projects')")
      .get() as { total: number };
    expect(registryTables.total).toBe(2);
  });
});

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  registryCreateAreaRequestSchema,
  registryCreateProjectRequestSchema
} from "../../shared/ipc/contracts.js";
import { closeAllSqliteDatabases, openSqliteDatabase } from "../../infra/storage/sqlite/db.js";
import { runMigrations } from "../../infra/storage/sqlite/migration-runner.js";
import { createArea, createProject } from "../../infra/storage/sqlite/repositories/registry-repository.js";
import { AppError } from "../../shared/errors/app-error.js";

const tempDirs: string[] = [];

afterEach(async () => {
  closeAllSqliteDatabases();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const setupDb = async () => {
  const root = await mkdtemp(join(tmpdir(), "file-pilot-registry-name-"));
  tempDirs.push(root);
  const db = openSqliteDatabase(join(root, "data.db"));
  await runMigrations({
    db,
    migrationsDir: join(process.cwd(), "apps/desktop/infra/storage/sqlite/migrations")
  });
  return db;
};

const expectInvalidName = (action: () => unknown): void => {
  try {
    action();
    expect.unreachable("unsafe registry name should be rejected");
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("REGISTRY_NAME_INVALID");
  }
};

describe("registry name validation", () => {
  it("rejects path separators and Windows-illegal characters at the IPC boundary", () => {
    for (const name of ["A/B", "A\\B", "A:B", "A*B", "A?B", "CON", "..", "   "]) {
      expect(registryCreateAreaRequestSchema.safeParse({ name }).success, `area name ${name}`).toBe(false);
    }

    expect(registryCreateAreaRequestSchema.safeParse({ name: "考公" }).success).toBe(true);

    const areaId = randomUUID();
    expect(
      registryCreateProjectRequestSchema.safeParse({ areaId, name: "A/B" }).success,
      "project name with slash"
    ).toBe(false);
    expect(
      registryCreateProjectRequestSchema.safeParse({ areaId, name: "行测", aliases: ["ok", "a/b"] }).success,
      "project alias with slash"
    ).toBe(false);
    expect(
      registryCreateProjectRequestSchema.safeParse({ areaId, name: "行测", aliases: ["xingce"] }).success
    ).toBe(true);
  });

  it("rejects unsafe names inside the repository as a second line of defense", async () => {
    const db = await setupDb();

    expectInvalidName(() => createArea(db, { name: "A/B" }));
    expectInvalidName(() => createArea(db, { name: "CON" }));

    const area = createArea(db, { name: "开发" });
    expectInvalidName(() => createProject(db, { areaId: area.id, name: "A\\B" }));
    expectInvalidName(() => createProject(db, { areaId: area.id, name: "登记册", aliases: ["a/b"] }));
  });

  it("accepts normal names and trims surrounding whitespace", async () => {
    const db = await setupDb();

    const area = createArea(db, { name: " 考公 " });
    const project = createProject(db, { areaId: area.id, name: " 行测 " });

    expect(area.name).toBe("考公");
    expect(project.name).toBe("行测");
  });
});

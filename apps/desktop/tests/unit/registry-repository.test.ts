import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { appendDecisionRecordsSqlite } from "../../infra/storage/sqlite/repositories/decisions-repository.js";
import { closeAllSqliteDatabases, openSqliteDatabase } from "../../infra/storage/sqlite/db.js";
import { runMigrations } from "../../infra/storage/sqlite/migration-runner.js";
import {
  addSamplePath,
  archiveArea,
  archiveProject,
  createArea,
  createProject,
  findAreaByNumber,
  findProjectById,
  listActiveCoordinates,
  listAreas,
  listProjects,
  listProposals,
  resolveCoordinate
} from "../../infra/storage/sqlite/repositories/registry-repository.js";
import { upsertSessionSqlite } from "../../infra/storage/sqlite/repositories/sessions-repository.js";
import { REGISTRY_CONFIG } from "../../shared/config/registry.config.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { RegistryProject } from "../../shared/types/registry.js";

const tempDirs: string[] = [];

afterEach(async () => {
  closeAllSqliteDatabases();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const setupDb = async () => {
  const root = await mkdtemp(join(tmpdir(), "file-pilot-registry-"));
  tempDirs.push(root);
  const db = openSqliteDatabase(join(root, "data.db"));
  await runMigrations({
    db,
    migrationsDir: join(process.cwd(), "apps/desktop/infra/storage/sqlite/migrations")
  });
  return db;
};

describe("registry-repository", () => {
  it("claims area slots in order 10,20,30... and errors when 80 is taken", async () => {
    const db = await setupDb();

    const numbers: number[] = [];
    for (let index = 0; index < REGISTRY_CONFIG.maxAreas; index += 1) {
      numbers.push(createArea(db, { name: `领域${index}` }).number);
    }

    expect(numbers).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
    expect(listAreas(db).length).toBe(REGISTRY_CONFIG.maxAreas);

    try {
      createArea(db, { name: "超额领域" });
      expect.unreachable("area slot exhaustion should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("REGISTRY_AREA_SLOTS_EXHAUSTED");
    }
  });

  it("archives an area and never reuses its number", async () => {
    const db = await setupDb();

    const first = createArea(db, { name: "早期领域" });
    createArea(db, { name: "现役领域" });
    archiveArea(db, first.id);

    const archived = findAreaByNumber(db, first.number);
    expect(archived?.status).toBe("archived");
    expect(archived?.retiredAt).toBeDefined();

    const next = createArea(db, { name: "新领域" });
    expect(next.number).toBe(30);

    expect(listAreas(db).map((area) => area.number)).toEqual([20, 30]);
    expect(listAreas(db, { includeArchived: true }).map((area) => area.status)).toEqual([
      "archived",
      "active",
      "active"
    ]);
  });

  it("cascades archival from area to its projects", async () => {
    const db = await setupDb();

    const area = createArea(db, { name: "开发" });
    const project = createProject(db, { areaId: area.id, name: "登记册" });

    archiveArea(db, area.id);

    const stored = findProjectById(db, project.id);
    expect(stored?.status).toBe("archived");
    expect(stored?.retiredAt).toBeDefined();
  });

  it("claims project slots 1..9 per area and errors with a distinct code when full", async () => {
    const db = await setupDb();

    const area = createArea(db, { name: "考公" });
    const numbers: number[] = [];
    for (let index = 1; index <= REGISTRY_CONFIG.maxProjectsPerArea; index += 1) {
      numbers.push(createProject(db, { areaId: area.id, name: `项目${index}` }).number);
    }

    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(listProjects(db, area.id).length).toBe(REGISTRY_CONFIG.maxProjectsPerArea);

    try {
      createProject(db, { areaId: area.id, name: "第十个" });
      expect.unreachable("project slot exhaustion should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("REGISTRY_PROJECT_SLOTS_EXHAUSTED");
    }

    const otherArea = createArea(db, { name: "写作" });
    expect(createProject(db, { areaId: otherArea.id, name: "独立领域项目" }).number).toBe(1);
  });

  it("never reuses archived project numbers inside an area", async () => {
    const db = await setupDb();

    const area = createArea(db, { name: "开发" });
    const first = createProject(db, { areaId: area.id, name: "旧项目" });
    const second = createProject(db, { areaId: area.id, name: "现役项目" });

    archiveProject(db, first.id);

    const archived = findProjectById(db, first.id);
    expect(archived?.status).toBe("archived");

    const next = createProject(db, { areaId: area.id, name: "新项目" });
    expect(next.number).toBe(3);
    expect(first.number).toBe(1);
    expect(second.number).toBe(2);
    expect(listProjects(db, area.id).map((project) => project.number)).toEqual([1, 2, 3]);
  });

  it("rejects duplicate active project names within the same area", async () => {
    const db = await setupDb();

    const area = createArea(db, { name: "开发" });
    createProject(db, { areaId: area.id, name: "登记册" });

    try {
      createProject(db, { areaId: area.id, name: " 登记册 " });
      expect.unreachable("duplicate active name should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("REGISTRY_PROJECT_NAME_TAKEN");
    }
  });

  it("lists active coordinates joined and sorted by area then project number", async () => {
    const db = await setupDb();

    const devArea = createArea(db, { name: "开发" });
    const examArea = createArea(db, { name: "考公" });
    createProject(db, { areaId: devArea.id, name: "file-pilot" });
    const retired = createProject(db, { areaId: devArea.id, name: "退役项目" });
    const lawProject = createProject(db, { areaId: examArea.id, name: "行测" });
    createProject(db, { areaId: examArea.id, name: "申论" });
    archiveProject(db, retired.id);

    const coordinates = listActiveCoordinates(db);

    expect(coordinates).toEqual([
      {
        areaId: devArea.id,
        areaNumber: 10,
        areaName: "开发",
        projectId: expect.any(String),
        projectNumber: 1,
        projectName: "file-pilot"
      },
      {
        areaId: examArea.id,
        areaNumber: 20,
        areaName: "考公",
        projectId: lawProject.id,
        projectNumber: 1,
        projectName: "行测"
      },
      {
        areaId: examArea.id,
        areaNumber: 20,
        areaName: "考公",
        projectId: expect.any(String),
        projectNumber: 2,
        projectName: "申论"
      }
    ]);

    expect(resolveCoordinate(db, 20, 1)).toMatchObject({
      areaNumber: 20,
      areaName: "考公",
      projectNumber: 1,
      projectName: "行测"
    });
    expect(resolveCoordinate(db, 10, 2)).toBeUndefined();
  });

  it("round-trips aliases and capped sample paths", async () => {
    const db = await setupDb();

    const area = createArea(db, { name: "开发" });
    const project = createProject(db, {
      areaId: area.id,
      name: "登记册",
      aliases: ["registry", "治理层"]
    });

    expect(findProjectById(db, project.id)?.aliases).toEqual(["registry", "治理层"]);
    expect(findProjectById(db, project.id)?.samplePaths).toBeUndefined();

    addSamplePath(db, project.id, "D:/data/00-Inbox/a.md");
    addSamplePath(db, project.id, "D:/data/00-Inbox/b.md");
    addSamplePath(db, project.id, "D:/data/00-Inbox/a.md");

    let stored: RegistryProject | undefined = findProjectById(db, project.id);
    expect(stored?.samplePaths).toEqual(["D:/data/00-Inbox/a.md", "D:/data/00-Inbox/b.md"]);

    for (let index = 0; index < REGISTRY_CONFIG.maxSamplePaths; index += 1) {
      addSamplePath(db, project.id, `D:/data/00-Inbox/batch-${index}.md`);
    }

    stored = findProjectById(db, project.id);
    expect(stored?.samplePaths?.length).toBe(REGISTRY_CONFIG.maxSamplePaths);
    // Cap keeps the most recent 50: the two earliest paths are evicted first.
    expect(stored?.samplePaths?.[0]).toBe("D:/data/00-Inbox/batch-0.md");
    expect(stored?.samplePaths?.[REGISTRY_CONFIG.maxSamplePaths - 1]).toBe(
      `D:/data/00-Inbox/batch-${REGISTRY_CONFIG.maxSamplePaths - 1}.md`
    );

    try {
      addSamplePath(db, "missing-project", "D:/nowhere.txt");
      expect.unreachable("missing project should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("REGISTRY_PROJECT_NOT_FOUND");
    }
  });

  it("writes and enforces rule project_id association", async () => {
    const db = await setupDb();

    const area = createArea(db, { name: "开发" });
    const project = createProject(db, { areaId: area.id, name: "登记册" });

    db.prepare(`
      INSERT INTO classification_rules (
        id, purpose, project, ext, path_prefix, keywords_json, negative_keywords_json,
        priority, enabled, source, hits, created_at, updated_at, last_matched_at, project_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "rule-linked",
      "Documents",
      "登记册",
      "md",
      null,
      "[]",
      "[]",
      100,
      1,
      "manual",
      0,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      null,
      project.id
    );

    const linked = db
      .prepare("SELECT project_id FROM classification_rules WHERE id = ?")
      .get("rule-linked") as { project_id: string | null };
    expect(linked.project_id).toBe(project.id);

    const legacy = db.prepare(`
      INSERT INTO classification_rules (
        id, purpose, project, ext, path_prefix, keywords_json, negative_keywords_json,
        priority, enabled, source, hits, created_at, updated_at, last_matched_at, project_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "rule-legacy",
      "Documents",
      "P1",
      null,
      null,
      "[]",
      "[]",
      10,
      1,
      "learned",
      0,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      null,
      null
    );
    expect(legacy.changes).toBe(1);

    expect(() =>
      db
        .prepare("INSERT INTO classification_rules (id, purpose, project, keywords_json, negative_keywords_json, priority, enabled, source, hits, created_at, updated_at, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run("rule-broken-fk", "Documents", "X", "[]", "[]", 0, 1, "manual", 0, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "missing-project")
    ).toThrow();
  });

  it("lists recent NEW: proposals from decisions", async () => {
    const db = await setupDb();

    const session = (sessionId: string) => ({
      id: sessionId,
      status: "done" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      itemIds: [],
      executions: []
    });
    upsertSessionSqlite(db, session("s-1"));
    upsertSessionSqlite(db, session("s-2"));

    appendDecisionRecordsSqlite(db, [
      {
        id: "d-normal",
        sessionId: "s-1",
        fileId: "f-1",
        source: "rule",
        confidence: 0.9,
        purpose: "Documents",
        project: "P1",
        reasons: ["matched-rule:r1"],
        createdAt: "2026-01-01T00:00:00.000Z"
      },
      {
        id: "d-proposal-old",
        sessionId: "s-1",
        fileId: "f-2",
        source: "llm-primary",
        confidence: 0.4,
        purpose: "Media",
        project: "NEW:旅行日志",
        reasons: [],
        createdAt: "2026-01-02T00:00:00.000Z"
      },
      {
        id: "d-proposal-new",
        sessionId: "s-2",
        fileId: "f-3",
        source: "llm-primary",
        confidence: 0.5,
        purpose: "Work",
        project: "NEW:周报整理",
        reasons: [],
        createdAt: "2026-01-03T00:00:00.000Z"
      }
    ]);

    const proposals = listProposals(db, 10);
    expect(proposals.map((proposal) => proposal.proposedName)).toEqual(["周报整理", "旅行日志"]);
    expect(proposals[0]).toMatchObject({
      id: "d-proposal-new",
      sessionId: "s-2",
      fileId: "f-3",
      purpose: "Work",
      confidence: 0.5,
      source: "llm-primary"
    });

    expect(listProposals(db, 1).length).toBe(1);
    expect(listProposals(db, 0)).toEqual([]);
  });
});

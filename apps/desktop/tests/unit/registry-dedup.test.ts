import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { checkDuplicate, withTimeout } from "../../core/usecases/registry-dedup.js";
import type { DedupJudge, DedupJudgeEntry, DedupJudgeInput } from "../../shared/ipc/contracts.js";
import { closeAllSqliteDatabases, openSqliteDatabase } from "../../infra/storage/sqlite/db.js";
import { runMigrations } from "../../infra/storage/sqlite/migration-runner.js";
import {
  addSamplePath,
  archiveProject,
  createArea,
  createProject
} from "../../infra/storage/sqlite/repositories/registry-repository.js";
import { REGISTRY_CONFIG } from "../../shared/config/registry.config.js";

const tempDirs: string[] = [];

afterEach(async () => {
  closeAllSqliteDatabases();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const setupDb = async (): Promise<Database.Database> => {
  const root = await mkdtemp(join(tmpdir(), "file-pilot-registry-dedup-"));
  tempDirs.push(root);
  const db = openSqliteDatabase(join(root, "data.db"));
  await runMigrations({
    db,
    migrationsDir: join(process.cwd(), "apps/desktop/infra/storage/sqlite/migrations")
  });
  return db;
};

const seedRegistry = async (db: Database.Database): Promise<void> => {
  const examArea = createArea(db, { name: "考公" });
  createProject(db, { areaId: examArea.id, name: "行测题库" });
  const notesArea = createArea(db, { name: "Notes" });
  const registryProject = createProject(db, {
    areaId: notesArea.id,
    name: "登记册",
    aliases: ["registry", "治理层"]
  });
  addSamplePath(db, registryProject.id, "D:/data/00-Inbox/registry-spec.md");
};

describe("checkDuplicate — level a: exact", () => {
  it("matches an area name after trim and case folding", async () => {
    const db = await setupDb();
    await seedRegistry(db);

    const evidence = await checkDuplicate(db, "  考公  ");
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      level: "exact",
      matchedName: "考公",
      matchedKind: "area"
    });
  });

  it("matches project names case-insensitively across areas", async () => {
    const db = await setupDb();
    await seedRegistry(db);

    const evidence = await checkDuplicate(db, "行测题库");
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      level: "exact",
      matchedName: "行测题库",
      matchedKind: "project"
    });
  });

  it("matches a project alias as exact evidence", async () => {
    const db = await setupDb();
    await seedRegistry(db);

    const evidence = await checkDuplicate(db, "Registry");
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      level: "exact",
      matchedName: "登记册",
      matchedKind: "project"
    });
    expect(evidence[0]?.detail).toContain("registry");
  });
});

describe("checkDuplicate — level b: similar", () => {
  it("flags tail-only digit differences without LLM", async () => {
    const db = await setupDb();
    await seedRegistry(db);

    const evidence = await checkDuplicate(db, "行测题库2");
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ level: "similar", matchedName: "行测题库" });
    expect(evidence[0]?.detail).toContain("尾部");
    expect(evidence[0]?.score).toBeGreaterThanOrEqual(REGISTRY_CONFIG.similarNameThreshold);
  });

  it("flags containment for short CJK names (考公 vs 考公资料)", async () => {
    const db = await setupDb();
    await seedRegistry(db);

    const evidence = await checkDuplicate(db, "考公资料");
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ level: "similar", matchedName: "考公", matchedKind: "area" });
    expect(evidence[0]?.score).toBeGreaterThanOrEqual(REGISTRY_CONFIG.similarNameThreshold);
  });

  it("returns nothing for a clearly unrelated name", async () => {
    const db = await setupDb();
    await seedRegistry(db);

    const evidence = await checkDuplicate(db, "完全无关的领域名称");
    expect(evidence).toEqual([]);
  });
});

describe("checkDuplicate — level c: semantic judge", () => {
  it("calls the judge only when exact and similar produced nothing", async () => {
    const db = await setupDb();
    await seedRegistry(db);

    const judgeImpl: DedupJudge = async () => [
      { name: "登记册", verdict: "same", reason: "同名含义" },
      { name: "考公", verdict: "different", reason: "不同域" },
      { name: "Notes", verdict: "unsure", reason: "不确定" },
      { name: "行测题库", verdict: "different", reason: "不同域" }
    ];
    const judge = vi.fn(judgeImpl);

    // "考公资料" hits level b (containment) — judge must not be called.
    const similarEvidence = await checkDuplicate(db, "考公资料", judge);
    expect(similarEvidence.map((item) => item.level)).toEqual(["similar"]);
    expect(judge).not.toHaveBeenCalled();

    // Unique name falls through to the judge; "same"/"unsure" become evidence.
    const semanticEvidence = await checkDuplicate(db, "题册新域", judge);
    expect(judge).toHaveBeenCalledTimes(1);
    expect(semanticEvidence.map((item) => item.level)).toEqual(["semantic", "semantic"]);
    expect(semanticEvidence[0]).toMatchObject({ matchedName: "登记册" });
    expect(semanticEvidence[0]?.detail).toContain("same");
    expect(semanticEvidence[1]).toMatchObject({ matchedName: "Notes" });
    expect(semanticEvidence[1]?.detail).toContain("unsure");
  });

  it("degrades every existing name to unsure when the judge rejects", async () => {
    const db = await setupDb();
    await seedRegistry(db);

    const judgeImpl: DedupJudge = async () => {
      throw new Error("judge offline");
    };
    const judge = vi.fn(judgeImpl);

    const evidence = await checkDuplicate(db, "全新名称", judge);
    expect(evidence).toHaveLength(4); // 2 areas + 2 active projects
    for (const item of evidence) {
      expect(item.level).toBe("semantic");
      expect(item.detail).toContain("unsure");
      expect(item.detail).toContain("judge offline");
    }
  });

  it("marks judge-uncovered names as unsure", async () => {
    const db = await setupDb();
    await seedRegistry(db);

    // Judge omits one existing name entirely.
    const judge: DedupJudge = async () => [
      { name: "考公", verdict: "different", reason: "不同域" }
    ];

    const evidence = await checkDuplicate(db, "全新名称", judge);
    const uncovered = evidence.find((item) => item.matchedName === "Notes");
    expect(uncovered).toBeDefined();
    expect(uncovered?.detail).toContain("未覆盖");
  });

  it("forwards judge inputs with sample-path basenames", async () => {
    const db = await setupDb();
    await seedRegistry(db);

    let seen: DedupJudgeInput[] = [];
    const judge: DedupJudge = async (_candidate, existing) => {
      seen = existing;
      return existing.map((entry) => ({ name: entry.name, verdict: "different" as const, reason: "no" }));
    };

    await checkDuplicate(db, "全新名称", judge);
    const registryEntry = seen.find((entry) => entry.name === "登记册");
    expect(registryEntry?.sampleText).toContain("registry-spec.md");
  });
});

describe("checkDuplicate — ordering and guards", () => {
  it("emits every exact hit before similar hits", async () => {
    const db = await setupDb();
    const area = createArea(db, { name: "学习" });
    createProject(db, { areaId: area.id, name: "学习资料" });

    const evidence = await checkDuplicate(db, "学习");
    expect(evidence.map((item) => [item.level, item.matchedName])).toEqual([
      ["exact", "学习"],
      ["similar", "学习资料"]
    ]);
  });

  it("sorts similar hits by descending score", async () => {
    const db = await setupDb();
    const area = createArea(db, { name: "考公" });
    createProject(db, { areaId: area.id, name: "考公资料2" });

    const evidence = await checkDuplicate(db, "考公资料");
    expect(evidence.map((item) => item.matchedName)).toEqual(["考公资料2", "考公"]);
    expect(evidence.map((item) => item.level)).toEqual(["similar", "similar"]);
    expect(evidence[0]?.score).toBeGreaterThanOrEqual(evidence[1]?.score ?? 0);
  });

  it("returns empty evidence for blank input", async () => {
    const db = await setupDb();
    await seedRegistry(db);

    expect(await checkDuplicate(db, "   ")).toEqual([]);
  });

  it("ignores archived projects for dedup purposes", async () => {
    const db = await setupDb();
    const area = createArea(db, { name: "开发" });
    const retired = createProject(db, { areaId: area.id, name: "旧项目" });
    archiveProject(db, retired.id);

    const evidence = await checkDuplicate(db, "旧项目");
    expect(evidence).toEqual([]);
  });
});

describe("withTimeout", () => {
  it("rejects when the judge exceeds the budget", async () => {
    const slowJudge: DedupJudge = async () => new Promise<DedupJudgeEntry[]>(() => undefined);
    const guarded = withTimeout(slowJudge, 30);

    await expect(guarded("x", [])).rejects.toThrow(/timed out/);
  });

  it("resolves and clears the timer when the judge finishes in time", async () => {
    const fastJudge: DedupJudge = async () => [
      { name: "a", verdict: "same", reason: "ok" }
    ];
    const guarded = withTimeout(fastJudge, 500);

    await expect(guarded("x", [{ name: "a" }])).resolves.toEqual([
      { name: "a", verdict: "same", reason: "ok" }
    ]);
  });
});

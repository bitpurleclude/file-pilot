import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handlers, type HandlerContext } from "../../electron/main/handler-registry.js";
import { appendDecisionRecordsSqlite } from "../../infra/storage/sqlite/repositories/decisions-repository.js";
import { closeAllSqliteDatabases, openSqliteDatabase } from "../../infra/storage/sqlite/db.js";
import { runMigrations } from "../../infra/storage/sqlite/migration-runner.js";
import { upsertSessionSqlite } from "../../infra/storage/sqlite/repositories/sessions-repository.js";

const tempDirs: string[] = [];

afterEach(async () => {
  closeAllSqliteDatabases();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const createContext = async (): Promise<{ context: HandlerContext; dbPath: string }> => {
  const root = await mkdtemp(join(tmpdir(), "file-pilot-registry-handlers-"));
  tempDirs.push(root);
  const dbPath = join(root, "data", "data.db");
  const db = openSqliteDatabase(dbPath);
  await runMigrations({
    db,
    migrationsDir: join(process.cwd(), "apps/desktop/infra/storage/sqlite/migrations")
  });

  return {
    context: {
      appDataRoot: root,
      workspaceRoot: join(root, "workspace"),
      appVersion: "0.1.0",
      quitApp: () => undefined
    },
    dbPath
  };
};

// Fresh settings carry a key-less provider, so dedup stays at levels a+b (no LLM calls).

describe("registryHandlers", () => {
  it("createArea claims slots and rejects exact duplicates with evidence", async () => {
    const { context } = await createContext();

    const first = await handlers.registryCreateArea(context, { name: "考公" });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.data.area.number).toBe(10);
    expect(first.data.warnings).toEqual([]);

    const duplicate = await handlers.registryCreateArea(context, { name: " 考公 " });
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) {
      return;
    }
    expect(duplicate.error.code).toBe("REGISTRY_DUPLICATE_NAME");
    const details = duplicate.error.details as { evidence?: unknown } | undefined;
    expect(Array.isArray(details?.evidence)).toBe(true);
    const evidence = (details?.evidence as Array<{ level?: string; matchedName?: string }> | undefined) ?? [];
    expect(evidence[0]).toMatchObject({ level: "exact", matchedName: "考公", matchedKind: "area" });
  });

  it("allows recreating an archived name and claims the next free slot", async () => {
    const { context } = await createContext();

    const first = await handlers.registryCreateArea(context, { name: "旧领域" });
    if (!first.ok) {
      throw new Error("seed create failed");
    }
    const archived = await handlers.registryArchive(context, { kind: "area", id: first.data.area.id });
    expect(archived).toEqual({ ok: true, data: { archived: true } });

    const recreated = await handlers.registryCreateArea(context, { name: "旧领域" });
    expect(recreated.ok).toBe(true);
    if (!recreated.ok) {
      return;
    }
    // Archived slots keep their numbers; the new area claims 20.
    expect(recreated.data.area.number).toBe(20);
    expect(recreated.data.warnings).toEqual([]);
  });

  it("createProject nests under an area and rejects duplicate names", async () => {
    const { context } = await createContext();

    const area = await handlers.registryCreateArea(context, { name: "开发" });
    if (!area.ok) {
      throw new Error("area create failed");
    }

    const project = await handlers.registryCreateProject(context, {
      areaId: area.data.area.id,
      name: "登记册"
    });
    expect(project.ok).toBe(true);
    if (!project.ok) {
      return;
    }
    expect(project.data.project.number).toBe(1);
    expect(project.data.warnings).toEqual([]);

    const duplicate = await handlers.registryCreateProject(context, {
      areaId: area.data.area.id,
      name: "登记册"
    });
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) {
      return;
    }
    expect(duplicate.error.code).toBe("REGISTRY_DUPLICATE_NAME");
  });

  it("createArea returns similar warnings but still creates", async () => {
    const { context } = await createContext();

    await handlers.registryCreateArea(context, { name: "考公" });
    const similar = await handlers.registryCreateArea(context, { name: "考公资料" });

    expect(similar.ok).toBe(true);
    if (!similar.ok) {
      return;
    }
    expect(similar.data.area.name).toBe("考公资料");
    expect(similar.data.warnings.length).toBeGreaterThan(0);
    expect(similar.data.warnings[0]).toMatchObject({ level: "similar", matchedName: "考公" });
  });

  it("checkDuplicate returns empty evidence for unique names", async () => {
    const { context } = await createContext();

    const result = await handlers.registryCheckDuplicate(context, { name: "独一无二的领域" });
    expect(result).toEqual({ ok: true, data: { evidence: [] } });
  });

  it("registryList includes archived areas and projects", async () => {
    const { context } = await createContext();

    const area = await handlers.registryCreateArea(context, { name: "开发" });
    if (!area.ok) {
      throw new Error("area create failed");
    }
    const keep = await handlers.registryCreateProject(context, { areaId: area.data.area.id, name: "保留" });
    const drop = await handlers.registryCreateProject(context, { areaId: area.data.area.id, name: "退役" });
    if (!keep.ok || !drop.ok) {
      throw new Error("project creates failed");
    }
    await handlers.registryArchive(context, { kind: "project", id: drop.data.project.id });

    const list = await handlers.registryList(context, {});
    expect(list.ok).toBe(true);
    if (!list.ok) {
      return;
    }
    expect(list.data.areas.map((item) => item.name)).toEqual(["开发"]);
    const statuses = list.data.projects.map((item) => ({ name: item.name, status: item.status }));
    expect(statuses).toContainEqual({ name: "退役", status: "archived" });
    expect(statuses).toContainEqual({ name: "保留", status: "active" });
  });

  it("registryProposals reads NEW: decisions inserted into classification_decisions", async () => {
    const { context, dbPath } = await createContext();

    const db = openSqliteDatabase(dbPath);
    upsertSessionSqlite(db, {
      id: "session-proposal",
      status: "done",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      itemIds: [],
      executions: []
    });
    appendDecisionRecordsSqlite(db, [
      {
        id: "decision-proposal",
        sessionId: "session-proposal",
        fileId: "file-1",
        source: "llm-primary",
        confidence: 0.55,
        purpose: "Work",
        project: "NEW:测试提案",
        reasons: [],
        createdAt: "2026-01-02T00:00:00.000Z"
      },
      {
        id: "decision-normal",
        sessionId: "session-proposal",
        fileId: "file-2",
        source: "rule",
        confidence: 0.9,
        purpose: "Documents",
        project: "登记册",
        reasons: [],
        createdAt: "2026-01-03T00:00:00.000Z"
      }
    ]);

    const result = await handlers.registryProposals(context, {});
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.proposals).toHaveLength(1);
    const proposal = result.data.proposals[0];
    expect(proposal).toMatchObject({
      id: "decision-proposal",
      sessionId: "session-proposal",
      fileId: "file-1",
      proposedName: "测试提案",
      purpose: "Work",
      confidence: 0.55,
      source: "llm-primary"
    });
  });

  it("rejects malformed payloads with the uniform error shape", async () => {
    const { context } = await createContext();

    const badName = await handlers.registryCreateArea(context, { name: "" });
    expect(badName.ok).toBe(false);
    if (!badName.ok) {
      expect(typeof badName.error.code).toBe("string");
      expect(typeof badName.error.message).toBe("string");
    }

    const badArchive = await handlers.registryArchive(context, { kind: "area", id: "not-a-uuid" });
    expect(badArchive.ok).toBe(false);
    if (!badArchive.ok) {
      expect(typeof badArchive.error.code).toBe("string");
    }
  });
});

import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildPlacementPlan } from "../../core/usecases/plan-placement.js";
import { handlers, type HandlerContext } from "../../electron/main/handler-registry.js";
import { closeAllSqliteDatabases, openSqliteDatabase } from "../../infra/storage/sqlite/db.js";
import { runMigrations } from "../../infra/storage/sqlite/migration-runner.js";
import {
  createArea,
  createProject,
  findProjectById
} from "../../infra/storage/sqlite/repositories/registry-repository.js";
import {
  replaceSessionItemsSqlite,
  upsertSessionSqlite
} from "../../infra/storage/sqlite/repositories/sessions-repository.js";
import type { ClassificationRule } from "../../shared/types/rules.js";
import type { ProcessedSessionItem } from "../../shared/types/workflow.js";

const tempDirs: string[] = [];

afterEach(async () => {
  closeAllSqliteDatabases();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Fixture {
  db: ReturnType<typeof openSqliteDatabase>;
  context: HandlerContext;
  projectId: string;
  sourcePath: string;
  sessionId: string;
}

const setupFixture = async (): Promise<Fixture> => {
  const root = await mkdtemp(join(tmpdir(), "file-pilot-session-coord-"));
  tempDirs.push(root);
  const db = openSqliteDatabase(join(root, "data", "data.db"));
  await runMigrations({
    db,
    migrationsDir: join(process.cwd(), "apps/desktop/infra/storage/sqlite/migrations")
  });

  const workspaceRoot = join(root, "workspace");
  const inbox = join(workspaceRoot, "00-Inbox");
  await mkdir(inbox, { recursive: true });
  const sourcePath = join(inbox, "笔记.pdf");
  await writeFile(sourcePath, "fixture", "utf-8");

  const area = createArea(db, { name: "考公" });
  const project = createProject(db, { areaId: area.id, name: "行测" });

  const context: HandlerContext = {
    appDataRoot: root,
    workspaceRoot,
    appVersion: "0.1.0",
    quitApp: () => undefined
  };

  const now = new Date().toISOString();
  const plan = buildPlacementPlan({
    fileId: "file-1",
    sourcePath,
    classification: {
      purpose: "Study",
      project: "默认项目",
      confidence: 0.4,
      reasons: ["seed"]
    },
    workspaceRoot,
    now: new Date(now)
  });
  const item: ProcessedSessionItem = {
    item: {
      id: "file-1",
      path: sourcePath,
      name: "笔记.pdf",
      ext: "pdf",
      size: 7,
      createdAt: now,
      modifiedAt: now,
      mime: "application/pdf"
    },
    summary: { textSnippet: "", keywords: [], language: "zh-CN" },
    classification: {
      purpose: "Study",
      project: "默认项目",
      confidence: 0.4,
      confidenceBand: "low",
      reasons: ["seed"],
      decisionSource: "local-fallback"
    },
    plan,
    needsFollowUp: true,
    followUpQuestion: "请补充所属项目",
    decisionSource: "local-fallback"
  };

  const sessionId = randomUUID();
  upsertSessionSqlite(db, {
    id: sessionId,
    status: "planned",
    createdAt: now,
    updatedAt: now,
    itemIds: [item.item.id],
    executions: [{ plan, executed: false, rollbackable: false, reason: "planned" }]
  });
  replaceSessionItemsSqlite(db, [{ sessionId, data: item }]);

  return { db, context, projectId: project.id, sourcePath, sessionId };
};

const updatedItem = (data: unknown): ProcessedSessionItem | undefined => {
  const items = (data as { items?: ProcessedSessionItem[] }).items ?? [];
  return items.find((item) => item.item.id === "file-1");
};

describe("coordinate-aware follow-up and correction handlers", () => {
  it("strips the NEW: sentinel from the follow-up placement path", async () => {
    const fixture = await setupFixture();

    const result = await handlers.submitFollowup(fixture.context, {
      sessionId: fixture.sessionId,
      answer: "NEW:行测冲刺",
      applyToAll: true
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const item = updatedItem(result.data);
    expect(item?.classification.project).toBe("NEW:行测冲刺");
    expect(item?.classification.proposedProject).toBe("行测冲刺");

    const normalized = (item?.plan.targetPath ?? "").replaceAll("\\", "/");
    expect(normalized).toContain("/Study/行测冲刺/");
    expect(normalized).not.toContain("NEW");
  });

  it("keeps coordinated placement, records the sample path, and links the learned rule", async () => {
    const fixture = await setupFixture();

    const result = await handlers.saveCorrections(fixture.context, {
      sessionId: fixture.sessionId,
      fileId: "file-1",
      purpose: "Study",
      project: "10-考公/1-行测",
      saveAsRule: true,
      applyToAll: false
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const item = updatedItem(result.data);
    const normalized = (item?.plan.targetPath ?? "").replaceAll("\\", "/");
    expect(normalized).toContain("/10-考公/1-行测/");
    expect(item?.plan.coordinate?.projectId).toBe(fixture.projectId);

    const rule = (result.data as { rule?: ClassificationRule }).rule;
    expect(rule?.projectId).toBe(fixture.projectId);

    expect(findProjectById(fixture.db, fixture.projectId)?.samplePaths).toContain(fixture.sourcePath);
  });
});

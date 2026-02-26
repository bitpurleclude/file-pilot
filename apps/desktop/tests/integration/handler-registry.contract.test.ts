import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handlers, type HandlerContext } from "../../electron/main/handler-registry.js";
import { closeAllSqliteDatabases, openSqliteDatabase } from "../../infra/storage/sqlite/db.js";
import { runMigrations } from "../../infra/storage/sqlite/migration-runner.js";
import {
  replaceSessionItemsSqlite,
  upsertSessionSqlite
} from "../../infra/storage/sqlite/repositories/sessions-repository.js";

const tempDirs: string[] = [];

afterEach(async () => {
  closeAllSqliteDatabases();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const createContext = (root: string): HandlerContext => ({
  appDataRoot: root,
  workspaceRoot: join(root, "workspace"),
  appVersion: "0.1.0",
  quitApp: () => undefined
});

describe("handler-registry contracts", () => {
  it("validates new IPC channels and keeps uniform error/result shape", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-handler-contract-"));
    tempDirs.push(root);

    const db = openSqliteDatabase(join(root, "data", "data.db"));
    await runMigrations({
      db,
      migrationsDir: join(process.cwd(), "apps/desktop/infra/storage/sqlite/migrations")
    });

    const context = createContext(root);

    const listRulesResult = await handlers.listRules(context, {});
    expect(listRulesResult.ok).toBe(true);

    const updateRuleError = await handlers.updateRule(context, {
      ruleId: "missing-field-only"
    });
    expect(updateRuleError.ok).toBe(false);
    if (!updateRuleError.ok) {
      expect(typeof updateRuleError.error.code).toBe("string");
      expect(typeof updateRuleError.error.message).toBe("string");
    }

    const followupError = await handlers.submitFollowup(context, {
      sessionId: "bad-uuid",
      answer: "x"
    });
    expect(followupError.ok).toBe(false);
    if (!followupError.ok) {
      expect(typeof followupError.error.code).toBe("string");
      expect(typeof followupError.error.message).toBe("string");
    }
  });

  it("returns updated items for save-corrections success path", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-handler-correction-"));
    tempDirs.push(root);

    const db = openSqliteDatabase(join(root, "data", "data.db"));
    await runMigrations({
      db,
      migrationsDir: join(process.cwd(), "apps/desktop/infra/storage/sqlite/migrations")
    });

    const context = createContext(root);
    const sessionId = crypto.randomUUID();
    const fileId = crypto.randomUUID();

    upsertSessionSqlite(db, {
      id: sessionId,
      status: "planned",
      createdAt: "2026-02-20T00:00:00.000Z",
      updatedAt: "2026-02-20T00:00:00.000Z",
      itemIds: [fileId],
      executions: []
    });

    replaceSessionItemsSqlite(db, [
      {
        sessionId,
        data: {
          item: {
            id: fileId,
            path: "C:/data/sample.md",
            name: "sample.md",
            ext: "md",
            size: 10,
            createdAt: "2026-02-20T00:00:00.000Z",
            modifiedAt: "2026-02-20T00:00:00.000Z",
            mime: "text/markdown"
          },
          summary: {
            textSnippet: "hello",
            keywords: ["hello"],
            language: "en"
          },
          classification: {
            purpose: "Documents",
            project: "old",
            confidence: 0.5,
            reasons: ["seed"],
            confidenceBand: "low",
            decisionSource: "llm-primary"
          },
          plan: {
            fileId,
            sourcePath: "C:/data/sample.md",
            targetPath: "C:/workspace/Documents/old/sample.md",
            action: "move",
            conflictPolicy: "rename"
          },
          needsFollowUp: true,
          followUpQuestion: "question",
          decisionSource: "llm-primary"
        }
      }
    ]);

    const saveResult = await handlers.saveCorrections(context, {
      sessionId,
      fileId,
      purpose: "Study",
      project: "new",
      saveAsRule: false,
      applyToAll: false
    });

    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const data = saveResult.data as {
      sessionId: string;
      updatedCount: number;
      items: Array<{ classification: { purpose: string; project: string } }>;
      needsFollowUp: boolean;
      followUpQuestions: Array<{ fileId: string; question: string }>;
    };

    expect(data.sessionId).toBe(sessionId);
    expect(data.updatedCount).toBe(1);
    expect(data.items[0]?.classification.purpose).toBe("Study");
    expect(data.items[0]?.classification.project).toBe("new");
    expect(data.needsFollowUp).toBe(false);
    expect(data.followUpQuestions).toEqual([]);
  });
});

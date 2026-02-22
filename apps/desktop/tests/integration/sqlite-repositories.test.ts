import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openSqliteDatabase, closeAllSqliteDatabases } from "../../infra/storage/sqlite/db.js";
import { runMigrations } from "../../infra/storage/sqlite/migration-runner.js";
import {
  appendDecisionRecordsSqlite,
  listDecisionsBySessionSqlite
} from "../../infra/storage/sqlite/repositories/decisions-repository.js";
import { createRuleSqlite, listRulesSqlite, updateRuleSqlite } from "../../infra/storage/sqlite/repositories/rules-repository.js";
import {
  getSessionByIdSqlite,
  listSessionItemsSqlite,
  replaceSessionItemsSqlite,
  upsertSessionSqlite
} from "../../infra/storage/sqlite/repositories/sessions-repository.js";
import type { Session } from "../../shared/types/workflow.js";

const tempDirs: string[] = [];

afterEach(async () => {
  closeAllSqliteDatabases();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("sqlite-repositories", () => {
  it("supports CRUD for sessions/items/rules/decisions with consistency", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-sqlite-"));
    tempDirs.push(root);
    const db = openSqliteDatabase(join(root, "data.db"));
    await runMigrations({
      db,
      migrationsDir: join(process.cwd(), "apps/desktop/infra/storage/sqlite/migrations")
    });

    const session: Session = {
      id: crypto.randomUUID(),
      status: "planned",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      itemIds: ["f-1"],
      executions: [{
        plan: {
          fileId: "f-1",
          sourcePath: "D:/src/a.md",
          targetPath: "D:/dst/a.md",
          action: "move",
          conflictPolicy: "rename"
        },
        executed: false,
        rollbackable: false
      }]
    };

    upsertSessionSqlite(db, session);
    replaceSessionItemsSqlite(db, [{
      sessionId: session.id,
      data: {
        item: {
          id: "f-1",
          path: "D:/src/a.md",
          name: "a.md",
          ext: "md",
          size: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          modifiedAt: "2026-01-01T00:00:00.000Z",
          mime: "text/markdown"
        },
        summary: {
          textSnippet: "alpha",
          keywords: ["alpha"],
          language: "zh-CN"
        },
        classification: {
          purpose: "Documents",
          project: "P1",
          confidence: 0.9,
          reasons: []
        },
        plan: {
          fileId: "f-1",
          sourcePath: "D:/src/a.md",
          targetPath: "D:/dst/a.md",
          action: "move",
          conflictPolicy: "rename"
        },
        needsFollowUp: false,
        decisionSource: "rule"
      }
    }]);

    const savedSession = getSessionByIdSqlite(db, session.id);
    const savedItems = listSessionItemsSqlite(db, session.id);
    expect(savedSession?.id).toBe(session.id);
    expect(savedItems.length).toBe(1);

    createRuleSqlite(db, {
      id: "rule-1",
      purpose: "Documents",
      project: "P1",
      matcher: {
        ext: "md",
        pathPrefix: "D:/src",
        keywords: ["alpha"],
        negativeKeywords: []
      },
      priority: 100,
      enabled: true,
      source: "learned",
      hits: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    const updatedRule = updateRuleSqlite(db, {
      ruleId: "rule-1",
      enabled: false,
      priority: 10
    });
    expect(updatedRule.enabled).toBe(false);
    expect(listRulesSqlite(db, { includeDisabled: true }).length).toBe(1);

    appendDecisionRecordsSqlite(db, [{
      id: "d1",
      sessionId: session.id,
      fileId: "f-1",
      source: "rule",
      confidence: 0.9,
      purpose: "Documents",
      project: "P1",
      reasons: ["matched-rule:rule-1"],
      createdAt: "2026-01-01T00:00:00.000Z"
    }]);

    const decisions = listDecisionsBySessionSqlite(db, session.id);
    expect(decisions.length).toBe(1);
    expect(decisions[0]?.source).toBe("rule");
  });
});


import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runMigrations } from "../../infra/storage/sqlite/migration-runner.js";
import { closeAllSqliteDatabases, openSqliteDatabase } from "../../infra/storage/sqlite/db.js";
import {
  createRuleSqlite,
  getRuleByIdSqlite
} from "../../infra/storage/sqlite/repositories/rules-repository.js";
import { markRuleHits } from "../../electron/main/handlers/shared.js";
import type { ProcessedSessionItem } from "../../shared/types/workflow.js";

const tempDirs: string[] = [];

afterEach(async () => {
  closeAllSqliteDatabases();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const createProcessedItem = (params: {
  decisionSource: ProcessedSessionItem["decisionSource"];
  reasons: string[];
}): ProcessedSessionItem => {
  return {
    item: {
      id: crypto.randomUUID(),
      path: "C:/data/sample.txt",
      name: "sample.txt",
      ext: "txt",
      size: 3,
      createdAt: "2026-02-20T00:00:00.000Z",
      modifiedAt: "2026-02-20T00:00:00.000Z",
      mime: "text/plain"
    },
    summary: {
      textSnippet: "abc",
      keywords: ["abc"],
      language: "en"
    },
    classification: {
      purpose: "Documents",
      project: "demo",
      confidence: 0.9,
      reasons: params.reasons,
      decisionSource: params.decisionSource
    },
    plan: {
      fileId: crypto.randomUUID(),
      sourcePath: "C:/data/sample.txt",
      targetPath: "C:/workspace/Documents/demo/sample.txt",
      action: "move",
      conflictPolicy: "rename"
    },
    needsFollowUp: false,
    decisionSource: params.decisionSource
  };
};

describe("markRuleHits", () => {
  it("increments rule hit only when decision source is rule", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-rule-hits-"));
    tempDirs.push(root);

    const dbPath = join(root, "data", "data.db");
    const db = openSqliteDatabase(dbPath);
    await runMigrations({
      db,
      migrationsDir: join(process.cwd(), "apps/desktop/infra/storage/sqlite/migrations")
    });

    const ruleId = crypto.randomUUID();
    createRuleSqlite(db, {
      id: ruleId,
      purpose: "Documents",
      project: "demo",
      matcher: {
        ext: "txt",
        keywords: ["abc"],
        negativeKeywords: []
      },
      priority: 100,
      enabled: true,
      source: "learned",
      hits: 0,
      createdAt: "2026-02-20T00:00:00.000Z",
      updatedAt: "2026-02-20T00:00:00.000Z"
    });

    markRuleHits(dbPath, [
      createProcessedItem({
        decisionSource: "rule",
        reasons: [`matched-rule:${ruleId}`]
      }),
      createProcessedItem({
        decisionSource: "llm-primary",
        reasons: [`matched-rule:${ruleId}`]
      })
    ]);

    const updatedRule = getRuleByIdSqlite(db, ruleId);
    expect(updatedRule?.hits).toBe(1);
  });
});

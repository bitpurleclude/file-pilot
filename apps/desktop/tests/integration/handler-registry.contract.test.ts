import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handlers, type HandlerContext } from "../../electron/main/handler-registry.js";
import { closeAllSqliteDatabases, openSqliteDatabase } from "../../infra/storage/sqlite/db.js";
import { runMigrations } from "../../infra/storage/sqlite/migration-runner.js";

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
});


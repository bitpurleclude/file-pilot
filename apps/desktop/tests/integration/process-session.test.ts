import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { processSession } from "../../core/usecases/process-session.js";
import { RuleFirstLlmClassifier } from "../../infra/llm/rule-first-llm.js";
import type { AppSettings } from "../../infra/storage/settings-repository.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("process-session", () => {
  it("processes whitelisted files and returns dry-run plans", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-m1-"));
    tempDirs.push(root);
    const input = join(root, "note.md");
    await writeFile(input, "hello M1", "utf-8");

    const settings: AppSettings = {
      whitelistDirectories: [root],
      llm: {
        baseUrl: "https://api.openai.com/v1",
        primaryModel: "gpt-4.1",
        secondaryModel: "gpt-4.1-mini"
      }
    };

    const result = await processSession({
      filePaths: [input],
      settings,
      workspaceRoot: join(root, "workspace"),
      classifier: new RuleFirstLlmClassifier(),
      now: new Date(2026, 1, 12, 10, 11, 12)
    });

    expect(result.plans.length).toBe(1);
    expect(result.classifications.length).toBe(1);
    expect(result.plans[0]?.targetPath).toContain("workspace");
  });
});

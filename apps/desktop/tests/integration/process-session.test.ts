import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { processSession } from "../../core/usecases/process-session.js";
import { RuleFirstLlmClassifier } from "../../infra/llm/rule-first-llm.js";
import type { AppSettings } from "../../shared/types/settings.js";

const tempDirs: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(async () => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("process-session", () => {
  it("processes whitelisted files and returns dry-run plans", async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  purpose: "Documents",
                  project: "默认项目",
                  confidence: 0.8,
                  reasons: ["mock-llm"]
                })
              }
            }
          ]
        })
      } as Response;
    }) as typeof fetch;

    const root = await mkdtemp(join(tmpdir(), "file-pilot-m1-"));
    tempDirs.push(root);
    const input = join(root, "note.md");
    await writeFile(input, "hello M1", "utf-8");

    const settings: AppSettings = {
      language: "en",
      whitelistDirectories: [root],
      readOnlyMode: false,
      classification: {
        highConfidenceMin: 0.85,
        mediumConfidenceMin: 0.6,
        askThreshold: 0.6
      },
      ruleLearning: {
        enabled: true,
        autoApplyThreshold: 0.9
      },
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
      classifier: new RuleFirstLlmClassifier(settings),
      rules: [],
      now: new Date(2026, 1, 12, 10, 11, 12)
    });

    expect(result.plans.length).toBe(1);
    expect(result.classifications.length).toBe(1);
    expect(result.items.length).toBe(1);
    expect(result.needsFollowUp).toBe(false);
    expect(result.plans[0]?.targetPath).toContain("workspace");
  });

  it("returns follow-up questions for low confidence items and uses learned rule on next run", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-m1-low-confidence-"));
    tempDirs.push(root);
    const input = join(root, "note.txt");
    await writeFile(input, "low confidence content", "utf-8");

    const settings: AppSettings = {
      language: "en",
      whitelistDirectories: [root],
      readOnlyMode: false,
      classification: {
        highConfidenceMin: 0.85,
        mediumConfidenceMin: 0.6,
        askThreshold: 0.6
      },
      ruleLearning: {
        enabled: true,
        autoApplyThreshold: 0.9
      },
      llm: {
        baseUrl: "https://api.openai.com/v1",
        primaryModel: "gpt-4.1",
        secondaryModel: "gpt-4.1-mini"
      }
    };

    const lowConfidenceClassifier = {
      classify: async () => ({
        purpose: "Others" as const,
        project: "unknown",
        confidence: 0.3,
        reasons: ["mock-low"],
        decisionSource: "llm-primary" as const
      })
    };

    const first = await processSession({
      filePaths: [input],
      settings,
      workspaceRoot: join(root, "workspace"),
      classifier: lowConfidenceClassifier,
      rules: [],
      now: new Date(2026, 1, 12, 10, 11, 12)
    });

    expect(first.needsFollowUp).toBe(true);
    expect(first.followUpQuestions.length).toBe(1);

    const second = await processSession({
      filePaths: [input],
      settings,
      workspaceRoot: join(root, "workspace"),
      classifier: lowConfidenceClassifier,
      rules: [{
        id: "rule-1",
        purpose: "Study",
        project: "Chem",
        matcher: {
          ext: "txt",
          pathPrefix: root,
          keywords: [],
          negativeKeywords: []
        },
        priority: 100,
        enabled: true,
        source: "learned",
        hits: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      now: new Date(2026, 1, 12, 10, 11, 12)
    });

    expect(second.items[0]?.classification.project).toBe("Chem");
    expect(second.items[0]?.classification.decisionSource).toBe("rule");
  });
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { processSession, type BatchLlmClassifier } from "../../core/usecases/process-session.js";
import { RuleFirstLlmClassifier } from "../../infra/llm/rule-first-llm.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { AppSettings } from "../../shared/types/settings.js";
import type { Classification, ContentSummary, FileItem } from "../../shared/types/workflow.js";

const mockState = vi.hoisted(() => ({ escapeTarget: false }));

// Passthrough by default; flip escapeTarget to make buildPlacementPlan emit a
// target path outside the workspace root so the processSession guard is tested.
vi.mock("../../core/usecases/plan-placement.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../core/usecases/plan-placement.js")>();
  return {
    ...actual,
    buildPlacementPlan: (params: Parameters<typeof actual.buildPlacementPlan>[0]) => {
      const plan = actual.buildPlacementPlan(params);
      if (!mockState.escapeTarget) {
        return plan;
      }
      return {
        ...plan,
        targetPath: resolve(params.workspaceRoot, "..", "escaped-outside-root")
      };
    }
  };
});

const tempDirs: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(async () => {
  mockState.escapeTarget = false;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const createSettings = (root: string): AppSettings => ({
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
  llmProviders: {
    activeProviderId: "provider-1",
    providers: [
      {
        id: "provider-1",
        presetId: "openai",
        name: "OpenAI",
        isPreset: true,
        baseUrl: "https://api.openai.com/v1",
        authType: "bearer",
        protocol: "openai",
        apiKey: "test-key",
        primaryModel: "gpt-4.1",
        secondaryModel: "gpt-4.1-mini",
        modelControlMode: "manual",
        intensity: "balanced",
        intensityProfiles: {
          speed: { primaryModel: "gpt-4.1-mini", secondaryModel: "gpt-4.1-mini" },
          balanced: { primaryModel: "gpt-4.1", secondaryModel: "gpt-4.1-mini" },
          quality: { primaryModel: "gpt-4.1", secondaryModel: "gpt-4.1" }
        },
        enabled: true
      }
    ]
  }
});

describe("process-session", () => {
  it("processes whitelisted files and returns dry-run plans", async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        text: async () => JSON.stringify({
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

    const settings = createSettings(root);

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

    const settings = createSettings(root);

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

  it("uses classifyMany for rule-unmatched items and falls back per item on null entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-batch-"));
    tempDirs.push(root);
    const first = join(root, "a.md");
    const second = join(root, "b.md");
    await writeFile(first, "batch one", "utf-8");
    await writeFile(second, "batch two", "utf-8");

    const batchInputs: Array<Array<{ item: FileItem; summary: ContentSummary }>> = [];
    const singleInputs: Array<{ item: FileItem; summary: ContentSummary }> = [];

    const batchClassifier: BatchLlmClassifier = {
      classify: async (input) => {
        singleInputs.push(input);
        return {
          purpose: "Documents",
          project: "solo-fallback",
          confidence: 0.9,
          reasons: ["single"],
          decisionSource: "llm-primary"
        };
      },
      classifyMany: async (inputs) => {
        batchInputs.push(inputs);
        return inputs.map((_, index): Classification | null =>
          index === 0
            ? {
                purpose: "Work",
                project: "batch-project",
                confidence: 0.95,
                reasons: ["batch"],
                decisionSource: "llm-primary"
              }
            : null
        );
      }
    };

    const result = await processSession({
      filePaths: [first, second],
      settings: createSettings(root),
      workspaceRoot: join(root, "workspace"),
      classifier: batchClassifier,
      rules: [],
      now: new Date(2026, 1, 12, 10, 11, 12)
    });

    expect(batchInputs.length).toBe(1);
    expect(batchInputs[0]?.length).toBe(2);
    expect(singleInputs.length).toBe(1);
    expect(singleInputs[0]?.item.path).toBe(second);

    expect(result.items.length).toBe(2);
    expect(result.items[0]?.classification.project).toBe("batch-project");
    expect(result.items[1]?.classification.project).toBe("solo-fallback");
    expect(result.plans.length).toBe(2);
  });

  it("keeps per-item classification when the classifier does not implement classifyMany", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-per-item-"));
    tempDirs.push(root);
    const first = join(root, "a.txt");
    const second = join(root, "b.txt");
    await writeFile(first, "one", "utf-8");
    await writeFile(second, "two", "utf-8");

    const singleInputs: Array<{ item: FileItem; summary: ContentSummary }> = [];
    const perItemClassifier: BatchLlmClassifier = {
      classify: async (input) => {
        singleInputs.push(input);
        return {
          purpose: "Documents",
          project: "per-item",
          confidence: 0.9,
          reasons: ["single"],
          decisionSource: "llm-primary"
        };
      }
    };

    const result = await processSession({
      filePaths: [first, second],
      settings: createSettings(root),
      workspaceRoot: join(root, "workspace"),
      classifier: perItemClassifier,
      rules: [],
      now: new Date(2026, 1, 12, 10, 11, 12)
    });

    expect(singleInputs.length).toBe(2);
    expect(result.items.length).toBe(2);
    expect(result.items.every((item) => item.classification.project === "per-item")).toBe(true);
  });

  it("throws AppError when a generated plan target escapes the workspace root", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-escape-"));
    tempDirs.push(root);
    const input = join(root, "note.md");
    await writeFile(input, "escape", "utf-8");

    mockState.escapeTarget = true;
    const outcome = await processSession({
      filePaths: [input],
      settings: createSettings(root),
      workspaceRoot: join(root, "workspace"),
      classifier: {
        classify: async () => ({
          purpose: "Documents",
          project: "demo",
          confidence: 0.9,
          reasons: ["mock"],
          decisionSource: "llm-primary"
        })
      },
      rules: [],
      now: new Date(2026, 1, 12, 10, 11, 12)
    }).then(
      () => null,
      (error: unknown) => error
    );

    expect(outcome).toBeInstanceOf(AppError);
    expect((outcome as AppError).code).toBe("USER_PATH_NOT_ALLOWED");
  });

  describe("dual-track placement (governance stage 1)", () => {
    const coordinates = [
      { areaNumber: 30, areaName: "考公", projectNumber: 1, projectName: "行测" },
      { areaNumber: 30, areaName: "考公", projectNumber: 2, projectName: "申论" }
    ];

    const runWithProject = async (
      root: string,
      fileName: string,
      project: string,
      purpose: Classification["purpose"] = "Study"
    ) => {
      const input = join(root, fileName);
      await writeFile(input, "dual-track", "utf-8");

      const classifier: BatchLlmClassifier = {
        classify: async () => ({
          purpose,
          project,
          confidence: 0.9,
          reasons: ["dual-track-mock"],
          decisionSource: "llm-primary"
        })
      };

      return processSession({
        filePaths: [input],
        settings: createSettings(root),
        workspaceRoot: join(root, "workspace"),
        classifier,
        rules: [],
        coordinates,
        now: new Date(2026, 1, 12, 10, 11, 12)
      });
    };

    it("routes a registry-hit coordinate claim to the coordinated path without a time bucket", async () => {
      const root = await mkdtemp(join(tmpdir(), "file-pilot-coordinated-"));
      tempDirs.push(root);

      const result = await runWithProject(root, "笔记.pdf", "30-考公/1-行测");

      const item = result.items[0];
      expect(item).toBeDefined();
      const normalizedPath = (item?.plan.targetPath ?? "").replaceAll("\\", "/");
      expect(normalizedPath.endsWith("workspace/30-考公/1-行测/笔记.pdf")).toBe(true);
      expect(normalizedPath).not.toContain("2026/");
      expect(item?.plan.coordinate).toEqual({
        areaNumber: 30,
        areaName: "考公",
        projectNumber: 1,
        projectName: "行测"
      });
      expect(item?.plan.uncoordinated).toBe(false);
      expect(item?.classification.proposedProject).toBeUndefined();
    });

    it("keeps NEW: claims on the legacy track and records proposedProject", async () => {
      const root = await mkdtemp(join(tmpdir(), "file-pilot-new-claim-"));
      tempDirs.push(root);

      const result = await runWithProject(root, "冲刺.pdf", "NEW:行测冲刺");

      const item = result.items[0];
      expect(item).toBeDefined();
      expect(item?.classification.proposedProject).toBe("行测冲刺");
      expect(item?.classification.project).toBe("NEW:行测冲刺");
      const normalizedPath = (item?.plan.targetPath ?? "").replaceAll("\\", "/");
      expect(normalizedPath.endsWith("workspace/Study/行测冲刺/2026/02/冲刺.pdf")).toBe(true);
      expect(item?.plan.coordinate).toBeUndefined();
      expect(item?.plan.uncoordinated).toBe(true);
    });

    it("falls back to the legacy track for a project name missing from the coordinate list", async () => {
      const root = await mkdtemp(join(tmpdir(), "file-pilot-off-list-"));
      tempDirs.push(root);

      const result = await runWithProject(root, "随手记.pdf", "名单外的项目");

      const item = result.items[0];
      expect(item).toBeDefined();
      const normalizedPath = (item?.plan.targetPath ?? "").replaceAll("\\", "/");
      expect(normalizedPath.endsWith("workspace/Study/名单外的项目/2026/02/随手记.pdf")).toBe(true);
      expect(item?.plan.coordinate).toBeUndefined();
      expect(item?.plan.uncoordinated).toBe(true);
      expect(item?.classification.proposedProject).toBeUndefined();
    });

    it("treats a coordinate-form claim as legacy when no coordinates are provided", async () => {
      const root = await mkdtemp(join(tmpdir(), "file-pilot-no-coords-"));
      tempDirs.push(root);
      const input = join(root, "遗留.pdf");
      await writeFile(input, "legacy", "utf-8");

      const classifier: BatchLlmClassifier = {
        classify: async () => ({
          purpose: "Documents",
          project: "30-考公/1-行测",
          confidence: 0.9,
          reasons: ["legacy-mock"],
          decisionSource: "llm-primary"
        })
      };

      const result = await processSession({
        filePaths: [input],
        settings: createSettings(root),
        workspaceRoot: join(root, "workspace"),
        classifier,
        rules: [],
        now: new Date(2026, 1, 12, 10, 11, 12)
      });

      const item = result.items[0];
      expect(item).toBeDefined();
      expect(item?.plan.uncoordinated).toBe(true);
      expect(item?.plan.coordinate).toBeUndefined();
      expect((item?.plan.targetPath ?? "").replaceAll("\\", "/")).toContain("workspace/Documents/");
    });
  });
});

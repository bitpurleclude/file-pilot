import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { afterEach, describe, expect, it } from "vitest";

import { applySession, processSession } from "../../core/usecases/process-session.js";
import type { LlmClassifier } from "../../core/usecases/classify-files.js";
import type { AppSettings } from "../../shared/types/settings.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const settings: AppSettings = {
  language: "en",
  whitelistDirectories: [],
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
        baseUrl: "https://example.com/v1",
        authType: "bearer",
        protocol: "openai",
        apiKey: "qa-key",
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
};

const classifier: LlmClassifier = {
  classify: async () => ({
    purpose: "Documents",
    project: "Perf",
    confidence: 0.92,
    reasons: ["qa-mock"],
    decisionSource: "local-fallback"
  })
};

describe("qa-performance-100-files", () => {
  it("keeps dry-run under 8s and execution under 20s", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-qa-perf-"));
    tempDirs.push(root);
    const sourceRoot = join(root, "source");
    const workspaceRoot = join(root, "workspace");
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(workspaceRoot, { recursive: true });

    const filePaths: string[] = [];
    for (let i = 0; i < 100; i += 1) {
      const file = join(sourceRoot, `f-${i}.txt`);
      await writeFile(file, `performance-${i}`, "utf-8");
      filePaths.push(file);
    }

    const analyzeStart = performance.now();
    const analyzed = await processSession({
      filePaths,
      settings: {
        ...settings,
        whitelistDirectories: [sourceRoot]
      },
      workspaceRoot,
      classifier,
      rules: [],
      now: new Date(2026, 1, 12, 10, 11, 12)
    });
    const dryRunEnd = performance.now();

    const executeStart = performance.now();
    const executeResult = await applySession(analyzed.plans, false, "move");
    const executeEnd = performance.now();

    const dryRunSeconds = (dryRunEnd - analyzeStart) / 1000;
    const executeSeconds = (executeEnd - executeStart) / 1000;

    await mkdir(join(process.cwd(), "test-results", "qa"), { recursive: true });
    await writeFile(
      join(process.cwd(), "test-results", "qa", `perf-${Date.now()}.json`),
      JSON.stringify({
        scenario: "100-files",
        dryRunSeconds,
        executeSeconds,
        executedCount: executeResult.filter((result) => result.executed).length
      }, null, 2),
      "utf-8"
    );

    expect(dryRunSeconds).toBeLessThan(8);
    expect(executeSeconds).toBeLessThan(20);
  });
});

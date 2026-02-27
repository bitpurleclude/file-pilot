import { afterEach, describe, expect, it, vi } from "vitest";

import { RuleFirstLlmClassifier } from "../../infra/llm/rule-first-llm.js";
import type { AppSettings } from "../../shared/types/settings.js";

const originalFetch = globalThis.fetch;

const createSettings = (): AppSettings => ({
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

const defaultInput = {
  item: {
    id: "1",
    path: "C:/a/note.md",
    name: "note.md",
    ext: "md",
    size: 10,
    createdAt: "2026-02-12T00:00:00.000Z",
    modifiedAt: "2026-02-12T00:00:00.000Z",
    mime: "text/markdown"
  },
  summary: {
    textSnippet: "测试",
    keywords: ["测试"],
    language: "zh-CN"
  }
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("rule-first-llm classifier", () => {
  it("uses secondary model when primary model fails", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      if (payload.model === "gpt-4.1") {
        return {
          ok: false,
          text: async () => ""
        } as Response;
      }

      return {
        ok: true,
        text: async () => JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  purpose: "Documents",
                  project: "次模型项目",
                  confidence: 0.9,
                  reasons: ["secondary"]
                })
              }
            }
          ]
        })
      } as Response;
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const classifier = new RuleFirstLlmClassifier(createSettings());
    const result = await classifier.classify(defaultInput);

    expect(result).not.toBeNull();
    expect(result?.decisionSource).toBe("llm-secondary");
    expect(result?.model).toBe("gpt-4.1-mini");
    expect(result?.promptVersion).toBe("classify.v1");
  });

  it("falls back to local rule when no provider is enabled", async () => {
    const settings = createSettings();
    settings.llmProviders.providers[0].enabled = false;

    const classifier = new RuleFirstLlmClassifier(settings);
    const result = await classifier.classify({
      ...defaultInput,
      item: {
        ...defaultInput.item,
        ext: "jpg"
      }
    });

    expect(result?.purpose).toBe("Media");
    expect(result?.decisionSource).toBe("local-fallback");
    expect(result?.reasons).toContain("llm-fallback-rule:media");
  });
});

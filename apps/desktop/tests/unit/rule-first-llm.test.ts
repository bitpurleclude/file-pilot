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
  llm: {
    baseUrl: "https://example.com/v1",
    apiKey: "test-key",
    primaryModel: "gpt-4.1",
    secondaryModel: "gpt-4.1-mini"
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      if (payload.model === "gpt-4.1") {
        return {
          ok: false,
          json: async () => ({})
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
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

  it("falls back to local rule when both llm models fail", async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        json: async () => ({})
      } as Response;
    }) as typeof fetch;

    const classifier = new RuleFirstLlmClassifier(createSettings());
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

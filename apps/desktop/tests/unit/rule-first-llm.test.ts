import { afterEach, describe, expect, it, vi } from "vitest";

import { RuleFirstLlmClassifier } from "../../infra/llm/rule-first-llm.js";
import type { CoordinateOption } from "../../shared/types/registry.js";
import type { AppSettings } from "../../shared/types/settings.js";
import type { ContentSummary, FileItem } from "../../shared/types/workflow.js";

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

const makeInput = (id: string, ext = "md"): { item: FileItem; summary: ContentSummary } => ({
  item: {
    id,
    path: `C:/a/${id}.${ext}`,
    name: `${id}.${ext}`,
    ext,
    size: 10,
    createdAt: "2026-02-12T00:00:00.000Z",
    modifiedAt: "2026-02-12T00:00:00.000Z",
    mime: "text/plain"
  },
  summary: {
    textSnippet: "测试",
    keywords: ["测试"],
    language: "zh-CN"
  }
});

type FetchBody = { model?: string; messages?: Array<{ role: string; content?: string }> };

const readBody = (init?: RequestInit): FetchBody => {
  return JSON.parse(String(init?.body ?? "{}")) as FetchBody;
};

const readUserContent = (init?: RequestInit): string => {
  const body = readBody(init);
  return body.messages?.find((message) => message.role === "user")?.content ?? "";
};

const isBatchRequest = (init?: RequestInit): boolean => {
  return readUserContent(init).includes("JSON 数组");
};

const extractBatchIds = (init?: RequestInit): string[] => {
  const content = readUserContent(init);
  return [...content.matchAll(/- id: (\S+)/g)].map((match) => match[1] ?? "");
};

const singleResponseBody = (classification: Record<string, unknown>): string => {
  return JSON.stringify({
    choices: [
      {
        message: {
          content: JSON.stringify(classification)
        }
      }
    ]
  });
};

const batchResponseBody = (entries: Array<Record<string, unknown>>, usage?: {
  prompt_tokens: number;
  completion_tokens: number;
}): string => {
  return JSON.stringify({
    choices: [
      {
        message: {
          content: JSON.stringify(entries)
        }
      }
    ],
    ...(usage === undefined ? {} : { usage })
  });
};

const singleResponse = (classification: Record<string, unknown>): Response => {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => singleResponseBody(classification)
  } as Response;
};

const batchResponse = (entries: Array<Record<string, unknown>>, usage?: {
  prompt_tokens: number;
  completion_tokens: number;
}): Response => {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => batchResponseBody(entries, usage)
  } as Response;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("rule-first-llm classifier", () => {
  it("uses secondary model when primary model fails", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = readBody(init);
      if (payload.model === "gpt-4.1") {
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          text: async () => ""
        } as Response;
      }

      return singleResponse({
        purpose: "Documents",
        project: "次模型项目",
        confidence: 0.9,
        reasons: ["secondary"]
      });
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

  it("falls back to document rule for unknown extensions", async () => {
    const settings = createSettings();
    settings.llmProviders.providers[0].enabled = false;

    const classifier = new RuleFirstLlmClassifier(settings);
    const result = await classifier.classify({
      ...defaultInput,
      item: {
        ...defaultInput.item,
        ext: "xyz"
      }
    });

    expect(result?.purpose).toBe("Documents");
    expect(result?.reasons).toContain("llm-fallback-rule:doc");
  });

  it("appends usage reason on successful single classify", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  purpose: "Work",
                  project: "usage-project",
                  confidence: 0.9,
                  reasons: ["single"]
                })
              }
            }
          ],
          usage: { prompt_tokens: 12, completion_tokens: 3 }
        })
      } as Response;
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const classifier = new RuleFirstLlmClassifier(createSettings());
    const result = await classifier.classify(defaultInput);

    expect(result?.project).toBe("usage-project");
    expect(result?.reasons).toContain("usage:pt:12:ct:3");
    expect(result?.usage).toEqual({ promptTokens: 12, completionTokens: 3 });
  });
});

describe("rule-first-llm classifyMany", () => {
  it("classifies a batch in one call and aligns results by id with usage reasons", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (isBatchRequest(init)) {
        return batchResponse([
          { id: "a", purpose: "Work", project: "batch-a", confidence: 0.9, reasons: ["batch-a"] },
          { id: "b", purpose: "Media", project: "batch-b", confidence: 0.8, reasons: [] }
        ], { prompt_tokens: 120, completion_tokens: 40 });
      }
      return singleResponse({
        purpose: "Documents",
        project: "solo",
        confidence: 0.9,
        reasons: ["single"]
      });
    });

    globalThis.fetch = fetchMock as typeof fetch;

    const classifier = new RuleFirstLlmClassifier(createSettings());
    const results = await classifier.classifyMany([makeInput("a"), makeInput("b")]);

    expect(results.length).toBe(2);
    expect(results[0]?.project).toBe("batch-a");
    expect(results[0]?.purpose).toBe("Work");
    expect(results[0]?.decisionSource).toBe("llm-primary");
    expect(results[0]?.promptVersion).toBe("classify-batch.v1");
    expect(results[0]?.model).toBe("gpt-4.1");
    expect(results[0]?.reasons).toContain("usage:pt:120:ct:40");
    expect(results[0]?.usage).toEqual({ promptTokens: 120, completionTokens: 40 });
    expect(results[1]?.purpose).toBe("Media");
    expect(results[1]?.project).toBe("batch-b");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("degrades invalid or unknown-id batch entries to per-item classify", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (isBatchRequest(init)) {
        return batchResponse([
          { id: "a", purpose: "Work", project: "batch-a", confidence: 0.9, reasons: ["batch-a"] },
          { id: "b", purpose: "NotAPurpose", project: "bad", confidence: 0.9, reasons: [] },
          { id: "zzz", purpose: "Code", project: "unknown-entry", confidence: 0.9, reasons: [] }
        ]);
      }
      return singleResponse({
        purpose: "Documents",
        project: "solo",
        confidence: 0.9,
        reasons: ["single"]
      });
    });

    globalThis.fetch = fetchMock as typeof fetch;

    const classifier = new RuleFirstLlmClassifier(createSettings());
    const results = await classifier.classifyMany([makeInput("a"), makeInput("b")]);

    expect(results.length).toBe(2);
    expect(results[0]?.project).toBe("batch-a");
    expect(results[0]?.promptVersion).toBe("classify-batch.v1");
    expect(results[1]?.project).toBe("solo");
    expect(results[1]?.promptVersion).toBe("classify.v1");
    expect(results[1]?.decisionSource).toBe("llm-primary");
  });

  it("degrades the whole chunk to per-item classify when the batch output is unparseable", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (isBatchRequest(init)) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => JSON.stringify({
            choices: [
              {
                message: {
                  content: "抱歉，我无法输出 JSON。"
                }
              }
            ]
          })
        } as Response;
      }
      return singleResponse({
        purpose: "Documents",
        project: "solo",
        confidence: 0.9,
        reasons: ["single"]
      });
    });

    globalThis.fetch = fetchMock as typeof fetch;

    const classifier = new RuleFirstLlmClassifier(createSettings());
    const results = await classifier.classifyMany([makeInput("a"), makeInput("b")]);

    expect(results.length).toBe(2);
    expect(results.every((entry) => entry?.project === "solo")).toBe(true);
    expect(results.every((entry) => entry?.promptVersion === "classify.v1")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("splits inputs into batchSize chunks and maps results back in order", async () => {
    const inputs = Array.from({ length: 12 }, (_, index) => makeInput(`f${index}`));
    let batchCalls = 0;
    let singleCalls = 0;

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (isBatchRequest(init)) {
        batchCalls += 1;
        const ids = extractBatchIds(init);
        return batchResponse(ids.map((id) => ({
          id,
          purpose: "Work",
          project: `p-${id}`,
          confidence: 0.9,
          reasons: ["batch"]
        })));
      }
      singleCalls += 1;
      return singleResponse({
        purpose: "Documents",
        project: "solo",
        confidence: 0.9,
        reasons: ["single"]
      });
    });

    globalThis.fetch = fetchMock as typeof fetch;

    const classifier = new RuleFirstLlmClassifier(createSettings());
    const results = await classifier.classifyMany(inputs);

    expect(batchCalls).toBe(2);
    expect(singleCalls).toBe(0);
    expect(results.length).toBe(12);
    expect(results[0]?.project).toBe("p-f0");
    expect(results[9]?.project).toBe("p-f9");
    expect(results[10]?.project).toBe("p-f10");
    expect(results[11]?.project).toBe("p-f11");
    expect(results.every((entry) => entry?.decisionSource === "llm-primary")).toBe(true);
  });

  it("degrades to per-item classify when the whole LLM call fails for the chunk", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (isBatchRequest(init)) {
        return {
          ok: false,
          status: 400,
          headers: new Headers(),
          text: async () => ""
        } as Response;
      }
      return singleResponse({
        purpose: "Documents",
        project: "solo",
        confidence: 0.9,
        reasons: ["single"]
      });
    });

    globalThis.fetch = fetchMock as typeof fetch;

    const classifier = new RuleFirstLlmClassifier(createSettings());
    const results = await classifier.classifyMany([makeInput("a")]);

    expect(results.length).toBe(1);
    expect(results[0]?.project).toBe("solo");
    expect(results[0]?.promptVersion).toBe("classify.v1");
  });

  it("returns an empty array for empty input", async () => {
    const classifier = new RuleFirstLlmClassifier(createSettings());
    const results = await classifier.classifyMany([]);

    expect(results).toEqual([]);
  });
});

describe("rule-first-llm coordinate claim validation", () => {
  const coordinates: CoordinateOption[] = [
    { areaNumber: 30, areaName: "考公", projectNumber: 1, projectName: "行测" },
    { areaNumber: 40, areaName: "开发", projectNumber: 2, projectName: "工具" }
  ];
  const CLAIMED = "30-考公/1-行测";

  it("renders the coordinate list into the prompt and keeps a claimed coordinate", async () => {
    let userPrompt = "";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      userPrompt = readUserContent(init);
      return singleResponse({
        purpose: "Documents",
        project: CLAIMED,
        confidence: 0.9,
        reasons: ["claim"]
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const classifier = new RuleFirstLlmClassifier(createSettings());
    const result = await classifier.classify({ ...defaultInput, coordinates });

    expect(userPrompt).toContain("可用项目坐标清单");
    expect(userPrompt).toContain(`- ${CLAIMED}`);
    expect(userPrompt).toContain("- 40-开发/2-工具");
    expect(userPrompt).toContain("NEW:<简短中文名>");
    expect(result?.project).toBe(CLAIMED);
    expect(result?.reasons).toContain("coord:claimed");
  });

  it("keeps a NEW: proposal as-is and appends coord:new-proposal", async () => {
    const fetchMock = vi.fn(async () => singleResponse({
      purpose: "Study",
      project: "NEW:考试资料",
      confidence: 0.9,
      reasons: ["proposal"]
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    const classifier = new RuleFirstLlmClassifier(createSettings());
    const result = await classifier.classify({ ...defaultInput, coordinates });

    expect(result?.project).toBe("NEW:考试资料");
    expect(result?.decisionSource).toBe("llm-primary");
    expect(result?.reasons).toContain("coord:new-proposal");
    expect(result?.reasons).not.toContain("coord:claimed");
  });

  it("degrades to local fallback with coord:invalid-degraded when the project misses the list", async () => {
    const fetchMock = vi.fn(async () => singleResponse({
      purpose: "Documents",
      project: "自由发挥的项目",
      confidence: 0.9,
      reasons: ["off-list"]
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    const classifier = new RuleFirstLlmClassifier(createSettings());
    const result = await classifier.classify({ ...defaultInput, coordinates });

    expect(result?.decisionSource).toBe("local-fallback");
    expect(result?.project).toBe("默认项目");
    expect(result?.reasons).toContain("coord:invalid-degraded");
  });

  it("keeps claimed/NEW batch entries and degrades an off-list entry to per-item classify", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (isBatchRequest(init)) {
        return batchResponse([
          { id: "a", purpose: "Work", project: CLAIMED, confidence: 0.9, reasons: ["claim"] },
          { id: "b", purpose: "Study", project: "NEW:考试资料", confidence: 0.9, reasons: ["proposal"] },
          { id: "c", purpose: "Code", project: "清单外项目", confidence: 0.9, reasons: ["off-list"] }
        ]);
      }
      // c 逐条降级后的单文件调用：返回清单内坐标。
      return singleResponse({
        purpose: "Code",
        project: "40-开发/2-工具",
        confidence: 0.9,
        reasons: ["solo-claim"]
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const classifier = new RuleFirstLlmClassifier(createSettings());
    const results = await classifier.classifyMany([
      { ...makeInput("a"), coordinates },
      { ...makeInput("b"), coordinates },
      { ...makeInput("c"), coordinates }
    ]);

    expect(results.length).toBe(3);
    expect(results[0]?.project).toBe(CLAIMED);
    expect(results[0]?.reasons).toContain("coord:claimed");
    expect(results[0]?.promptVersion).toBe("classify-batch.v1");
    expect(results[1]?.project).toBe("NEW:考试资料");
    expect(results[1]?.reasons).toContain("coord:new-proposal");
    // 清单外条目 → 该条无效 → 逐条 classify 降级（单文件模板 + 重新校验）。
    expect(results[2]?.project).toBe("40-开发/2-工具");
    expect(results[2]?.reasons).toContain("coord:claimed");
    expect(results[2]?.promptVersion).toBe("classify.v1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("behaves identically to the legacy path when coordinates are not provided", async () => {
    const fetchMock = vi.fn(async () => singleResponse({
      purpose: "Documents",
      project: "自由发挥的项目",
      confidence: 0.9,
      reasons: ["legacy"]
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    const classifier = new RuleFirstLlmClassifier(createSettings());
    const result = await classifier.classify(defaultInput);

    expect(result?.project).toBe("自由发挥的项目");
    expect(result?.decisionSource).toBe("llm-primary");
    expect(result?.reasons.every((reason) => !reason.startsWith("coord:"))).toBe(true);
  });

  it("treats an empty coordinate list the same as no coordinates (registry exists but is empty)", async () => {
    const fetchMock = vi.fn(async () => singleResponse({
      purpose: "Documents",
      project: "StubProject",
      confidence: 0.9,
      reasons: ["legacy"]
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    const classifier = new RuleFirstLlmClassifier(createSettings());
    const result = await classifier.classify({ ...defaultInput, coordinates: [] });

    expect(result?.project).toBe("StubProject");
    expect(result?.decisionSource).toBe("llm-primary");
    expect(result?.reasons.every((reason) => !reason.startsWith("coord:"))).toBe(true);
  });
});

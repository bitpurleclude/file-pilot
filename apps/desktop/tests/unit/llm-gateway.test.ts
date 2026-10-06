import { describe, expect, it, vi } from "vitest";

import { callLlmWithFallback, __test__ } from "../../infra/llm/llm-gateway.js";
import { extractJsonPayload, parseUsage } from "../../infra/llm/provider-adapter.js";
import type { AppSettings } from "../../shared/types/settings.js";

const { parseRetryAfterMs, classifyHttpFailure } = __test__;

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

const messages = [{ role: "user" as const, content: "classify this" }];

const statusResponse = (status: number, headers?: Record<string, string>): Response => {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => ""
  } as Response;
};

const chatContent = JSON.stringify({
  purpose: "Documents",
  project: "demo",
  confidence: 0.9,
  reasons: ["ok"]
});

const chatResponseBody = (content: string, usage?: { prompt_tokens: number; completion_tokens: number }): string => {
  return JSON.stringify({
    choices: [
      {
        message: {
          content
        }
      }
    ],
    ...(usage === undefined ? {} : { usage })
  });
};

const jsonResponse = (content: string, usage?: { prompt_tokens: number; completion_tokens: number }): Response => {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => chatResponseBody(content, usage)
  } as Response;
};

type FetchBody = { model?: string; messages?: Array<{ content?: string }>; max_tokens?: number; temperature?: number };

const readBody = (init?: RequestInit): FetchBody => {
  return JSON.parse(String(init?.body ?? "{}")) as FetchBody;
};

describe("llm-gateway error classification", () => {
  it("does not retry and does not switch to the secondary model on HTTP 401", async () => {
    const fetchMock = vi.fn(async () => statusResponse(401));

    const result = await callLlmWithFallback({
      settings: createSettings(),
      messages,
      fetchImpl: fetchMock
    });

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry and does not switch to the secondary model on HTTP 403", async () => {
    const fetchMock = vi.fn(async () => statusResponse(403));

    const result = await callLlmWithFallback({
      settings: createSettings(),
      messages,
      fetchImpl: fetchMock
    });

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up on a 400 model immediately but still tries the secondary model", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = readBody(init);
      if (body.model === "gpt-4.1") {
        return statusResponse(400);
      }
      return jsonResponse(chatContent);
    });

    const result = await callLlmWithFallback({
      settings: createSettings(),
      messages,
      fetchImpl: fetchMock
    });

    expect(result?.source).toBe("llm-secondary");
    expect(result?.model).toBe("gpt-4.1-mini");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries HTTP 500 and succeeds on the primary model", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return statusResponse(500);
      }
      return jsonResponse(chatContent);
    });

    const result = await callLlmWithFallback({
      settings: createSettings(),
      messages,
      fetchImpl: fetchMock
    });

    expect(result?.source).toBe("llm-primary");
    expect(JSON.parse(result?.content ?? "{}")).toMatchObject({ purpose: "Documents" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries network errors and succeeds on a later attempt", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("network down");
      }
      return jsonResponse(chatContent);
    });

    const result = await callLlmWithFallback({
      settings: createSettings(),
      messages,
      fetchImpl: fetchMock
    });

    expect(result?.source).toBe("llm-primary");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honors the Retry-After header on HTTP 429 before retrying", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return statusResponse(429, { "Retry-After": "0" });
      }
      return jsonResponse(chatContent);
    });

    const result = await callLlmWithFallback({
      settings: createSettings(),
      messages,
      fetchImpl: fetchMock
    });

    expect(result?.source).toBe("llm-primary");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends temperature 0 and max_tokens from config in the request body", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = readBody(init);
      expect(body.temperature).toBe(0);
      expect(body.max_tokens).toBe(800);
      return jsonResponse(chatContent);
    });

    const result = await callLlmWithFallback({
      settings: createSettings(),
      messages,
      fetchImpl: fetchMock
    });

    expect(result).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("llm-gateway response parsing", () => {
  it("extracts JSON content wrapped in markdown code fences", async () => {
    const fencedContent = "```json\n" + chatContent + "\n```";
    const fetchMock = vi.fn(async () => jsonResponse(fencedContent));

    const result = await callLlmWithFallback({
      settings: createSettings(),
      messages,
      fetchImpl: fetchMock
    });

    expect(result?.content).toBe(chatContent);
    expect(() => JSON.parse(result?.content ?? "")).not.toThrow();
  });

  it("extracts usage tokens from the response body", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(chatContent, { prompt_tokens: 120, completion_tokens: 45 }));

    const result = await callLlmWithFallback({
      settings: createSettings(),
      messages,
      fetchImpl: fetchMock
    });

    expect(result?.usage).toEqual({ promptTokens: 120, completionTokens: 45 });
  });

  it("returns no usage when the response body omits it", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(chatContent));

    const result = await callLlmWithFallback({
      settings: createSettings(),
      messages,
      fetchImpl: fetchMock
    });

    expect(result?.usage).toBeUndefined();
  });
});

describe("provider-adapter json extraction", () => {
  it("strips ```json fences", () => {
    expect(extractJsonPayload("```json\n{\"a\":1}\n```")).toBe("{\"a\":1}");
  });

  it("strips plain ``` fences", () => {
    expect(extractJsonPayload("```\n[{\"a\":1}]\n```")).toBe("[{\"a\":1}]");
  });

  it("extracts the first balanced object embedded in surrounding text", () => {
    expect(extractJsonPayload("结果如下：{\"a\":{\"b\":\"x\"}} 请查收")).toBe("{\"a\":{\"b\":\"x\"}}");
  });

  it("extracts the first balanced array", () => {
    expect(extractJsonPayload("prefix [{\"a\":1},{\"b\":2}] suffix")).toBe("[{\"a\":1},{\"b\":2}]");
  });

  it("ignores braces inside string literals", () => {
    expect(extractJsonPayload("{\"code\":\"}\"}")).toBe("{\"code\":\"}\"}");
  });

  it("returns null when no JSON structure exists", () => {
    expect(extractJsonPayload("抱歉，我无法输出 JSON")).toBeNull();
    expect(extractJsonPayload("")).toBeNull();
  });

  it("parses usage tokens from an OpenAI-compatible body", () => {
    expect(parseUsage(chatResponseBody(chatContent, { prompt_tokens: 10, completion_tokens: 3 })))
      .toEqual({ promptTokens: 10, completionTokens: 3 });
    expect(parseUsage(chatResponseBody(chatContent))).toBeNull();
    expect(parseUsage("not json")).toBeNull();
  });
});

describe("retry-after parsing", () => {
  it("parses delta-seconds and caps at 5 seconds", () => {
    expect(parseRetryAfterMs("1")).toBe(1000);
    expect(parseRetryAfterMs("0")).toBe(0);
    expect(parseRetryAfterMs("30")).toBe(5000);
  });

  it("returns null for missing or malformed headers", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs(undefined)).toBeNull();
    expect(parseRetryAfterMs("")).toBeNull();
    expect(parseRetryAfterMs("soon")).toBeNull();
  });

  it("classifies 429 as retryable with retryAfterMs attached", () => {
    const failure = classifyHttpFailure(429, "2");
    expect(failure.kind).toBe("retryable-http");
    expect(failure.retryAfterMs).toBe(2000);
  });
});

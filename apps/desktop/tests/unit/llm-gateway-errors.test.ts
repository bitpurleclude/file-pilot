import { afterEach, describe, expect, it, vi } from "vitest";

import { callLlmWithFallback } from "../../infra/llm/llm-gateway.js";
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
        name: "Test",
        isPreset: false,
        baseUrl: "https://example.com/v1",
        authType: "bearer",
        protocol: "openai",
        apiKey: "test-key",
        primaryModel: "primary-model",
        secondaryModel: "secondary-model",
        modelControlMode: "manual",
        intensity: "balanced",
        intensityProfiles: {
          speed: { primaryModel: "secondary-model", secondaryModel: "secondary-model" },
          balanced: { primaryModel: "primary-model", secondaryModel: "secondary-model" },
          quality: { primaryModel: "primary-model", secondaryModel: "primary-model" }
        },
        enabled: true
      }
    ]
  }
});

const jsonResponse = (content: string): Response => {
  return {
    ok: true,
    text: async () => JSON.stringify({ choices: [{ message: { content } }] })
  } as Response;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("llm-gateway error classification", () => {
  it("does not retry or fall back to the secondary model on 401", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 401 } as Response));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await callLlmWithFallback({ settings: createSettings(), messages: [{ role: "user", content: "hi" }] });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.failure.errorCode).toBe("LLM_HTTP_401");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the secondary model after primary network failures", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      if (payload.model === "primary-model") {
        throw new Error("connection reset");
      }
      return jsonResponse("secondary-content");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await callLlmWithFallback({ settings: createSettings(), messages: [{ role: "user", content: "hi" }] });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.source).toBe("llm-secondary");
    expect(result.content).toBe("secondary-content");
  });

  it("reports a typed failure when every attempt fails", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await callLlmWithFallback({ settings: createSettings(), messages: [{ role: "user", content: "hi" }] });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.failure.errorCode).toBe("LLM_RETRIES_EXHAUSTED");
  });
});

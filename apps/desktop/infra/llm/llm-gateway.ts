import { LLM_CONFIG } from "../../shared/config/llm.config.js";
import { resolveProviderModels } from "../../shared/config/llm-providers.js";
import type { LlmProviderConfig } from "../../shared/types/llm-provider.js";
import type { AppSettings } from "../../shared/types/settings.js";
import { buildHttpRequest, parseResponse } from "./provider-adapter.js";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface LlmCallFailure {
  errorCode: string;
  message: string;
  /** HTTP status when the provider answered with a non-2xx response. */
  httpStatus?: number;
}

export type LlmCallResult =
  | { ok: true; content: string; model: string; source: "llm-primary" | "llm-secondary" }
  | { ok: false; failure: LlmCallFailure };

const NON_RETRYABLE_HTTP_STATUSES = new Set([400, 401, 403, 404, 405, 413, 422]);

const delay = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const pickActiveProvider = (settings: AppSettings): LlmProviderConfig | null => {
  const active = settings.llmProviders.providers.find((provider) => (
    provider.id === settings.llmProviders.activeProviderId
    && provider.enabled
  ));
  if (active !== undefined) {
    return active;
  }

  const fallback = settings.llmProviders.providers.find((provider) => provider.enabled);
  return fallback ?? null;
};

type AttemptResult = { content: string } | { failure: LlmCallFailure; retryable: boolean };

const callChatApi = async (params: {
  provider: LlmProviderConfig;
  messages: ChatMessage[];
  model: string;
}): Promise<AttemptResult> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_CONFIG.timeoutMs);

  try {
    const request = buildHttpRequest({
      provider: params.provider,
      messages: params.messages,
      model: params.model
    });
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        failure: {
          errorCode: `LLM_HTTP_${response.status}`,
          message: `LLM provider returned HTTP ${response.status}`,
          ...(Number.isFinite(response.status) ? { httpStatus: response.status } : {})
        },
        retryable: !NON_RETRYABLE_HTTP_STATUSES.has(response.status)
      };
    }

    const responseBody = await response.text();
    const content = parseResponse({
      provider: params.provider,
      responseBody
    });
    if (content === null) {
      return {
        failure: {
          errorCode: "LLM_UNPARSEABLE_RESPONSE",
          message: "LLM response body did not contain chat content"
        },
        retryable: true
      };
    }

    return { content };
  } catch (error) {
    return {
      failure: {
        errorCode: "LLM_NETWORK_ERROR",
        message: error instanceof Error ? error.message : "network error"
      },
      retryable: true
    };
  } finally {
    clearTimeout(timer);
  }
};

const callWithRetry = async (params: {
  provider: LlmProviderConfig;
  messages: ChatMessage[];
  model: string;
}): Promise<{ content: string } | { failure: LlmCallFailure; stopModelFallback: boolean }> => {
  for (let attempt = 0; attempt <= LLM_CONFIG.retryCount; attempt += 1) {
    const outcome = await callChatApi(params);
    if ("content" in outcome) {
      return { content: outcome.content };
    }

    if (!outcome.retryable) {
      // 401/403/404 and friends will fail on the secondary model too —
      // stop early instead of burning the remaining attempts.
      return { failure: outcome.failure, stopModelFallback: true };
    }

    if (attempt < LLM_CONFIG.retryCount) {
      await delay(300 * (attempt + 1));
    }
  }

  return {
    failure: {
      errorCode: "LLM_RETRIES_EXHAUSTED",
      message: `LLM call failed after ${LLM_CONFIG.retryCount + 1} attempts`
    },
    stopModelFallback: false
  };
};

export const callLlmWithFallback = async (params: {
  settings: AppSettings;
  messages: ChatMessage[];
}): Promise<LlmCallResult> => {
  const provider = pickActiveProvider(params.settings);
  if (provider === null) {
    return {
      ok: false,
      failure: {
        errorCode: "LLM_NO_ENABLED_PROVIDER",
        message: "no enabled LLM provider is configured"
      }
    };
  }

  const resolvedModels = resolveProviderModels(provider);
  const primary = await callWithRetry({
    provider,
    model: resolvedModels.primaryModel,
    messages: params.messages
  });

  if ("content" in primary) {
    return { ok: true, content: primary.content, model: resolvedModels.primaryModel, source: "llm-primary" };
  }

  if (primary.stopModelFallback) {
    return { ok: false, failure: primary.failure };
  }

  const secondary = await callWithRetry({
    provider,
    model: resolvedModels.secondaryModel,
    messages: params.messages
  });

  if ("content" in secondary) {
    return { ok: true, content: secondary.content, model: resolvedModels.secondaryModel, source: "llm-secondary" };
  }

  return { ok: false, failure: secondary.failure };
};

import { LLM_CONFIG } from "../../shared/config/llm.config.js";
import { resolveProviderModels } from "../../shared/config/llm-providers.js";
import type { LlmProviderConfig } from "../../shared/types/llm-provider.js";
import type { AppSettings } from "../../shared/types/settings.js";
import { buildHttpRequest, parseResponse } from "./provider-adapter.js";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

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

const callChatApi = async (params: {
  provider: LlmProviderConfig;
  messages: ChatMessage[];
  model: string;
}): Promise<string | null> => {
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
      return null;
    }

    const responseBody = await response.text();
    return parseResponse({
      provider: params.provider,
      responseBody
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const callWithRetry = async (params: {
  provider: LlmProviderConfig;
  messages: ChatMessage[];
  model: string;
}): Promise<string | null> => {
  for (let attempt = 0; attempt <= LLM_CONFIG.retryCount; attempt += 1) {
    const content = await callChatApi(params);
    if (content !== null) {
      return content;
    }

    if (attempt < LLM_CONFIG.retryCount) {
      await delay(300 * (attempt + 1));
    }
  }

  return null;
};

export const callLlmWithFallback = async (params: {
  settings: AppSettings;
  messages: ChatMessage[];
}): Promise<{ content: string; model: string; source: "llm-primary" | "llm-secondary" } | null> => {
  const provider = pickActiveProvider(params.settings);
  if (provider === null) {
    return null;
  }

  const resolvedModels = resolveProviderModels(provider);
  const primary = await callWithRetry({
    provider,
    model: resolvedModels.primaryModel,
    messages: params.messages
  });

  if (primary !== null) {
    return { content: primary, model: resolvedModels.primaryModel, source: "llm-primary" };
  }

  const secondary = await callWithRetry({
    provider,
    model: resolvedModels.secondaryModel,
    messages: params.messages
  });

  if (secondary !== null) {
    return { content: secondary, model: resolvedModels.secondaryModel, source: "llm-secondary" };
  }

  return null;
};

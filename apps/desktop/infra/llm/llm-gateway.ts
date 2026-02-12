import { LLM_CONFIG } from "../../shared/config/llm.config.js";
import type { AppSettings } from "../../shared/types/settings.js";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface ChatCompletionRequest {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  messages: ChatMessage[];
}

interface ChatCompletionChoice {
  message?: {
    content?: string;
  };
}

interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
}

const delay = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const callChatApi = async (request: ChatCompletionRequest): Promise<string | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_CONFIG.timeoutMs);

  try {
    const response = await fetch(`${request.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(request.apiKey === undefined || request.apiKey.length === 0
          ? {}
          : { Authorization: `Bearer ${request.apiKey}` })
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: 0.2
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const json = (await response.json()) as ChatCompletionResponse;
    return json.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const callWithRetry = async (request: ChatCompletionRequest): Promise<string | null> => {
  for (let attempt = 0; attempt <= LLM_CONFIG.retryCount; attempt += 1) {
    const content = await callChatApi(request);
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
}): Promise<{ content: string; model: string } | null> => {
  const primary = await callWithRetry({
    baseUrl: params.settings.llm.baseUrl,
    apiKey: params.settings.llm.apiKey,
    model: params.settings.llm.primaryModel,
    messages: params.messages
  });

  if (primary !== null) {
    return { content: primary, model: params.settings.llm.primaryModel };
  }

  const secondary = await callWithRetry({
    baseUrl: params.settings.llm.baseUrl,
    apiKey: params.settings.llm.apiKey,
    model: params.settings.llm.secondaryModel,
    messages: params.messages
  });

  if (secondary !== null) {
    return { content: secondary, model: params.settings.llm.secondaryModel };
  }

  return null;
};

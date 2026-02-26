import { LLM_CONFIG } from "../../shared/config/llm.config.js";
import type { AppSettings } from "../../shared/types/settings.js";
import type { LlmProviderConfig } from "../../shared/types/llm-provider.js";
import { buildHttpRequest, parseResponse } from "./provider-adapter.js";

/**
 * LLM Gateway V2 - 支持多供应商
 * 
 * 向后兼容策略：
 * 1. 保留原有 callLlmWithFallback 接口
 * 2. 检测 settings.llmProviders 是否存在
 * 3. 存在则使用新的 Provider 架构，否则使用旧逻辑
 */

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

/**
 * 调用 LLM API（使用 Provider 配置）
 */
const callChatApiWithProvider = async (params: {
  provider: LlmProviderConfig;
  messages: ChatMessage[];
  model: string;
}): Promise<string | null> => {
  const { provider, messages, model } = params;
  
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_CONFIG.timeoutMs);
  
  try {
    const httpRequest = buildHttpRequest({ provider, messages, model });
    
    const response = await fetch(httpRequest.url, {
      method: httpRequest.method,
      headers: httpRequest.headers,
      body: httpRequest.body,
      signal: controller.signal
    });
    
    if (!response.ok) {
      return null;
    }
    
    const responseBody = await response.text();
    return parseResponse({ provider, responseBody });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * 调用 LLM API（旧版，向后兼容）
 */
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

/**
 * 带重试的调用（使用 Provider）
 */
const callWithRetryProvider = async (params: {
  provider: LlmProviderConfig;
  messages: ChatMessage[];
  model: string;
}): Promise<string | null> => {
  for (let attempt = 0; attempt <= LLM_CONFIG.retryCount; attempt += 1) {
    const content = await callChatApiWithProvider(params);
    if (content !== null) {
      return content;
    }
    
    if (attempt < LLM_CONFIG.retryCount) {
      await delay(300 * (attempt + 1));
    }
  }
  
  return null;
};

/**
 * 带重试的调用（旧版）
 */
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

/**
 * 使用 Provider 配置调用 LLM（带主备模型回退）
 */
export const callLlmWithProvider = async (params: {
  provider: LlmProviderConfig;
  messages: ChatMessage[];
}): Promise<{ content: string; model: string; source: "llm-primary" | "llm-secondary" } | null> => {
  const { provider, messages } = params;
  
  // 尝试主模型
  const primary = await callWithRetryProvider({
    provider,
    messages,
    model: provider.primaryModel
  });
  
  if (primary !== null) {
    return { content: primary, model: provider.primaryModel, source: "llm-primary" };
  }
  
  // 尝试备用模型
  const secondary = await callWithRetryProvider({
    provider,
    messages,
    model: provider.secondaryModel
  });
  
  if (secondary !== null) {
    return { content: secondary, model: provider.secondaryModel, source: "llm-secondary" };
  }
  
  return null;
};

/**
 * 调用 LLM（带主备模型回退）- 向后兼容接口
 * 
 * 自动检测是否使用新的 Provider 架构
 */
export const callLlmWithFallback = async (params: {
  settings: AppSettings;
  messages: ChatMessage[];
}): Promise<{ content: string; model: string; source: "llm-primary" | "llm-secondary" } | null> => {
  const { settings, messages } = params;
  
  // 检测是否有新的 Provider 配置
  if (settings.llmProviders !== undefined && settings.llmProviders.providers.length > 0) {
    // 使用新架构
    const activeProvider = settings.llmProviders.providers.find(
      (p) => p.id === settings.llmProviders?.activeProviderId
    );
    
    if (activeProvider !== undefined && activeProvider.enabled) {
      return callLlmWithProvider({ provider: activeProvider, messages });
    }
    
    // 如果没有找到激活的 Provider，回退到第一个启用的
    const firstEnabled = settings.llmProviders.providers.find((p) => p.enabled);
    if (firstEnabled !== undefined) {
      return callLlmWithProvider({ provider: firstEnabled, messages });
    }
  }
  
  // 使用旧架构（向后兼容）
  const primary = await callWithRetry({
    baseUrl: settings.llm.baseUrl,
    apiKey: settings.llm.apiKey,
    model: settings.llm.primaryModel,
    messages
  });
  
  if (primary !== null) {
    return { content: primary, model: settings.llm.primaryModel, source: "llm-primary" };
  }
  
  const secondary = await callWithRetry({
    baseUrl: settings.llm.baseUrl,
    apiKey: settings.llm.apiKey,
    model: settings.llm.secondaryModel,
    messages
  });
  
  if (secondary !== null) {
    return { content: secondary, model: settings.llm.secondaryModel, source: "llm-secondary" };
  }
  
  return null;
};

import type { LlmProviderConfig } from "../../shared/types/llm-provider.js";
import type { ChatMessage } from "./llm-gateway.js";

/**
 * Provider 适配器
 *
 * 职责：
 * 1. 将统一的 ChatMessage[] 转换为供应商请求格式（当前全部为 OpenAI 兼容）
 * 2. 将供应商响应转换为统一的 string
 * 3. 处理认证头和自定义请求头
 */

export interface HttpRequestConfig {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

/** Join baseUrl + endpoint tolerating trailing/leading slash variants. */
export const buildEndpointUrl = (baseUrl: string, endpoint: string): string => {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${trimmedBase}${normalizedEndpoint}`;
};

export const buildHttpRequest = (params: {
  provider: LlmProviderConfig;
  messages: ChatMessage[];
  model: string;
}): HttpRequestConfig => {
  const { provider, messages, model } = params;

  const endpoint = provider.endpoint ?? "/chat/completions";
  const url = buildEndpointUrl(provider.baseUrl, endpoint);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...provider.customHeaders
  };

  // Auth headers are assigned after customHeaders so a stray header entry
  // cannot silently override Authorization.
  if (provider.authType === "bearer" && provider.apiKey !== undefined && provider.apiKey.length > 0) {
    headers["Authorization"] = `Bearer ${provider.apiKey}`;
  } else if (provider.authType === "api-key" && provider.apiKey !== undefined && provider.apiKey.length > 0) {
    headers["X-API-Key"] = provider.apiKey;
  }

  const body = JSON.stringify({
    model,
    messages,
    temperature: 0.2
  });

  return {
    url,
    method: "POST",
    headers,
    body
  };
};

interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export const parseResponse = (params: {
  provider: LlmProviderConfig;
  responseBody: string;
}): string | null => {
  try {
    // 所有支持的供应商端点均使用 OpenAI 兼容格式。
    const json = JSON.parse(params.responseBody) as OpenAIResponse;
    return json.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
};

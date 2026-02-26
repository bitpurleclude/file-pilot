import type { LlmProviderConfig } from "../../shared/types/llm-provider.js";
import type { ChatMessage } from "./llm-gateway.js";

/**
 * Provider 适配器
 * 
 * 职责：
 * 1. 将统一的 ChatMessage[] 转换为各供应商的请求格式
 * 2. 将各供应商的响应格式转换为统一的 string
 * 3. 处理认证头和自定义请求头
 */

/**
 * HTTP 请求配置
 */
export interface HttpRequestConfig {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

/**
 * 构建 HTTP 请求配置
 */
export const buildHttpRequest = (params: {
  provider: LlmProviderConfig;
  messages: ChatMessage[];
  model: string;
}): HttpRequestConfig => {
  const { provider, messages, model } = params;
  
  // 构建 URL
  const endpoint = provider.endpoint ?? "/chat/completions";
  const url = `${provider.baseUrl}${endpoint}`;
  
  // 构建请求头
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...provider.customHeaders
  };
  
  // 添加认证头
  if (provider.authType === "bearer" && provider.apiKey !== undefined && provider.apiKey.length > 0) {
    headers["Authorization"] = `Bearer ${provider.apiKey}`;
  } else if (provider.authType === "api-key" && provider.apiKey !== undefined && provider.apiKey.length > 0) {
    headers["X-API-Key"] = provider.apiKey;
  }
  
  // 构建请求体（OpenAI 格式）
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

/**
 * OpenAI 响应格式
 */
interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

/**
 * 解析响应内容
 */
export const parseResponse = (params: {
  provider: LlmProviderConfig;
  responseBody: string;
}): string | null => {
  const { provider, responseBody } = params;
  
  try {
    // 当前所有供应商都使用 OpenAI 兼容格式
    if (provider.protocol === "openai") {
      const json = JSON.parse(responseBody) as OpenAIResponse;
      return json.choices?.[0]?.message?.content ?? null;
    }
    
    // 未来可扩展其他协议
    return null;
  } catch {
    return null;
  }
};

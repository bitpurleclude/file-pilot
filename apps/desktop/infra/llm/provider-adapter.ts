import type { LlmProviderConfig } from "../../shared/types/llm-provider.js";
import type { ChatMessage } from "./llm-gateway.js";

/**
 * Provider 适配器
 *
 * 职责：
 * 1. 将统一的 ChatMessage[] 转换为各供应商的请求格式
 * 2. 将各供应商的响应格式转换为统一的 string
 * 3. 处理认证头和自定义请求头
 * 4. 从模型输出中稳健提取 JSON 负载、从响应体提取 token usage
 */

/**
 * LLM 响应中的 token 用量（OpenAI 兼容格式的统一表示）
 */
export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

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
 *
 * temperature 与 maxTokens 从 shared/config/llm.config.ts 传入，
 * 分类任务使用 temperature 0，max_tokens 控制输出上限以约束成本。
 */
export const buildHttpRequest = (params: {
  provider: LlmProviderConfig;
  messages: ChatMessage[];
  model: string;
  temperature: number;
  maxTokens: number;
}): HttpRequestConfig => {
  const { provider, messages, model, temperature, maxTokens } = params;

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
    temperature,
    max_tokens: maxTokens
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

interface OpenAIUsageShape {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
}

/**
 * 从文本中提取第一个平衡的 {...} 或 [...] 子串。
 * 扫描时正确跳过字符串字面量与转义字符。
 */
const scanBalancedJson = (text: string, start: number): string | null => {
  const openChar = text[start];
  if (openChar !== "{" && openChar !== "[") {
    return null;
  }
  const closeChar = openChar === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === undefined) {
      break;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
};

const findEarliestIndex = (text: string, chars: readonly string[]): number => {
  let earliest = -1;
  for (const char of chars) {
    const at = text.indexOf(char);
    if (at !== -1 && (earliest === -1 || at < earliest)) {
      earliest = at;
    }
  }
  return earliest;
};

const CODE_FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

/**
 * 从模型输出中提取 JSON 负载：
 * 1. 剥离 ```json / ``` Markdown 代码围栏
 * 2. 若仍有前后缀文本，提取第一个平衡的 {...} 或 [...] 子串
 * 找不到任何 JSON 结构时返回 null。
 */
export const extractJsonPayload = (text: string): string | null => {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const fenced = CODE_FENCE_PATTERN.exec(trimmed);
  const candidate = (fenced !== null ? fenced[1] : trimmed)?.trim() ?? "";
  if (candidate.length === 0) {
    return null;
  }

  const start = findEarliestIndex(candidate, ["{", "["]);
  if (start === -1) {
    return null;
  }

  return scanBalancedJson(candidate, start);
};

/**
 * 从 OpenAI 兼容响应体中提取 token 用量。
 * 缺失或格式非法时返回 null（不参与重试判定）。
 */
export const parseUsage = (responseBody: string): LlmUsage | null => {
  try {
    const json = JSON.parse(responseBody) as { usage?: OpenAIUsageShape };
    const usage = json.usage;
    if (typeof usage !== "object" || usage === null) {
      return null;
    }

    const promptTokens = usage.prompt_tokens;
    const completionTokens = usage.completion_tokens;
    if (typeof promptTokens !== "number" || !Number.isFinite(promptTokens)) {
      return null;
    }
    if (typeof completionTokens !== "number" || !Number.isFinite(completionTokens)) {
      return null;
    }

    return { promptTokens, completionTokens };
  } catch {
    return null;
  }
};

/**
 * 解析响应内容
 *
 * 增强：content 若被 Markdown 代码围栏包裹或夹杂说明文本，
 * 会先经过 extractJsonPayload 提取；签名与返回值向后兼容。
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
      const content = json.choices?.[0]?.message?.content ?? null;
      if (content === null) {
        return null;
      }
      return extractJsonPayload(content) ?? content;
    }

    // 未来可扩展其他协议
    return null;
  } catch {
    return null;
  }
};

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

// ==== 本地决策协议（protocol="local-decision"）====

/**
 * 本地决策请求形态（decision-models.md §2/§6：Laya/System One 的
 * 结构化状态 + 类型化问题，决策原语 choice + 校准置信）。
 */
export type LocalDecisionMode = "systemone" | "openai-chat";

/** 单个决策问题：id 供应答回填，prompt 为自然语言题面，options 为候选集。 */
export interface LocalDecisionQuestion {
  id: string;
  prompt: string;
  options: Array<{ id: string; text: string }>;
}

/** 单题应答：choiceId 为 null 表示模型弃权（Null 原语），confidence 为校准置信。 */
export interface LocalDecisionAnswer {
  questionId: string;
  choiceId: string | null;
  confidence: number;
}

/**
 * 本地决策端点的默认路径：
 * - systemone → /v1/systemone（Laya 的 System One API 形态）
 * - openai-chat → /chat/completions（借 OpenAI 兼容对话端点承载决策负载）
 * 两者均可被调用方显式覆盖（LlmProviderConfig.decisionEndpointPath）。
 */
export const defaultLocalDecisionEndpointPath = (mode: LocalDecisionMode): string => {
  return mode === "systemone" ? "/v1/systemone" : "/chat/completions";
};

interface LocalDecisionHttpConfig {
  baseUrl: string;
  mode: LocalDecisionMode;
  endpointPath?: string;
  apiKey?: string;
  model?: string;
}

/**
 * 构建本地决策批量请求。
 *
 * ⚠️ 保守假设：本地决策端点（Laya/System One 形态）的公开规范尚不稳定，本结构
 * 是影子模式阶段①的基线协议——systemone 走结构化 questions 端点；openai-chat
 * 借 OpenAI 兼容对话端点、以单条 user 消息承载 JSON 化 questions。正式接入实现
 * 时必须以端点文档为准调整（decision-models.md §2 口径注记）。
 */
export const buildLocalDecisionRequest = (params: {
  questions: LocalDecisionQuestion[];
} & LocalDecisionHttpConfig): HttpRequestConfig => {
  const { questions, baseUrl, mode, endpointPath, apiKey, model } = params;

  const endpoint = endpointPath ?? defaultLocalDecisionEndpointPath(mode);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(apiKey !== undefined && apiKey.length > 0 ? { Authorization: `Bearer ${apiKey}` } : {})
  };

  const body =
    mode === "systemone"
      ? JSON.stringify({
          questions: questions.map((question) => ({
            id: question.id,
            prompt: question.prompt,
            options: question.options.map((option) => ({ id: option.id, text: option.text }))
          }))
        })
      : JSON.stringify({
          ...(model === undefined ? {} : { model }),
          messages: [
            {
              role: "user",
              content: JSON.stringify({
                task: "choose-one",
                questions: questions.map((question) => ({
                  id: question.id,
                  prompt: question.prompt,
                  options: question.options.map((option) => ({ id: option.id, text: option.text }))
                }))
              })
            }
          ]
        });

  return { url: `${baseUrl}${endpoint}`, method: "POST", headers, body };
};

interface SystemOneResponseShape {
  answers?: unknown;
}

/**
 * 容错解析本地决策响应，按 questionId 索引应答。
 *
 * 两种形态都兼容：systemone 直接返回 {answers:[...]}；openai-chat 从
 * choices[0].message.content 中提取 JSON。任何字段缺失/类型不符/JSON 损坏
 * 都只影响对应题目（该题不入索引），绝不 throw——影子模式宁缺毋断。
 * 返回 map 中不存在的 questionId 由调用方按弃权处理。
 */
export const parseLocalDecisionResponse = (params: {
  mode: LocalDecisionMode;
  responseBody: string;
}): Map<string, LocalDecisionAnswer> => {
  const { mode, responseBody } = params;
  const answers = new Map<string, LocalDecisionAnswer>();

  try {
    const json = JSON.parse(responseBody) as SystemOneResponseShape;
    let rawAnswers: unknown = json.answers;

    if (mode === "openai-chat") {
      const chatJson = json as unknown as OpenAIResponse;
      const content = chatJson.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        return answers;
      }
      const payload = extractJsonPayload(content) ?? content;
      const inner = JSON.parse(payload) as SystemOneResponseShape;
      rawAnswers = inner.answers;
    }

    if (!Array.isArray(rawAnswers)) {
      return answers;
    }

    for (const raw of rawAnswers) {
      if (typeof raw !== "object" || raw === null) {
        continue;
      }
      const candidate = raw as { questionId?: unknown; choiceId?: unknown; confidence?: unknown };
      if (typeof candidate.questionId !== "string") {
        continue;
      }
      const confidence = typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence)
        ? candidate.confidence
        : 0;
      if (candidate.choiceId === null || candidate.choiceId === undefined) {
        answers.set(candidate.questionId, { questionId: candidate.questionId, choiceId: null, confidence });
        continue;
      }
      if (typeof candidate.choiceId === "string") {
        answers.set(candidate.questionId, {
          questionId: candidate.questionId,
          choiceId: candidate.choiceId,
          confidence
        });
      }
    }

    return answers;
  } catch {
    return answers;
  }
};

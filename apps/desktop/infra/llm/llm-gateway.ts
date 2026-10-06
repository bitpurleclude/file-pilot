import { LLM_CONFIG } from "../../shared/config/llm.config.js";
import { resolveProviderModels } from "../../shared/config/llm-providers.js";
import type { LlmProviderConfig } from "../../shared/types/llm-provider.js";
import type { AppSettings } from "../../shared/types/settings.js";
import { buildHttpRequest, parseResponse, parseUsage } from "./provider-adapter.js";
import type { LlmUsage } from "./provider-adapter.js";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface LlmCallResult {
  content: string;
  model: string;
  source: "llm-primary" | "llm-secondary";
  usage?: LlmUsage;
}

/**
 * LLM 调用失败分类：
 * - auth: HTTP 401/403，API key 无效 — 不重试，且同一把 key 下的备模型直接跳过
 * - client: HTTP 400/404 等不可重试的客户端错误 — 该模型立即放弃（备模型仍可尝试）
 * - retryable-http: HTTP 408/429/5xx — 指数退避重试（429 优先遵循 Retry-After）
 * - network: 网络错误/超时 — 指数退避重试
 * - invalid-response: 2xx 但响应体不可解析 — 按可重试处理
 */
export type LlmFailureKind = "auth" | "client" | "retryable-http" | "network" | "invalid-response";

export interface LlmFailure {
  kind: LlmFailureKind;
  status?: number;
  retryAfterMs?: number;
  detail?: string;
}

type ChatApiOutcome =
  | { ok: true; content: string; usage: LlmUsage | null }
  | { ok: false; failure: LlmFailure };

type ModelAttemptOutcome =
  | { ok: true; content: string; usage: LlmUsage | null }
  | { ok: false; skipRemainingModels: boolean };

const AUTH_FAILURE_STATUSES: ReadonlySet<number> = new Set([401, 403]);
const NON_RETRYABLE_STATUSES: ReadonlySet<number> = new Set([400, 401, 403, 404]);

/**
 * Retry-After 头解析上限（毫秒），防止恶意/异常响应导致超长等待。
 */
export const RETRY_AFTER_CAP_MS = 5_000;

/**
 * 解析 Retry-After 头（支持 delta-seconds 与 HTTP-date 两种形式），返回等待毫秒数。
 */
export const parseRetryAfterMs = (headerValue: string | null | undefined): number | null => {
  if (headerValue === undefined || headerValue === null) {
    return null;
  }

  const trimmed = headerValue.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
  }

  const httpDateMs = Date.parse(trimmed);
  if (Number.isNaN(httpDateMs)) {
    return null;
  }

  const deltaMs = httpDateMs - Date.now();
  if (deltaMs <= 0) {
    return 0;
  }
  return Math.min(deltaMs, RETRY_AFTER_CAP_MS);
};

export const classifyHttpFailure = (status: number, retryAfterHeader: string | null): LlmFailure => {
  if (AUTH_FAILURE_STATUSES.has(status)) {
    return { kind: "auth", status };
  }

  if (NON_RETRYABLE_STATUSES.has(status)) {
    return { kind: "client", status };
  }

  if (status === 429) {
    const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
    return { kind: "retryable-http", status, ...(retryAfterMs === null ? {} : { retryAfterMs }) };
  }

  return { kind: "retryable-http", status };
};

const isRetryableFailure = (failure: LlmFailure): boolean => {
  return failure.kind === "retryable-http"
    || failure.kind === "network"
    || failure.kind === "invalid-response";
};

const computeBackoffDelayMs = (failure: LlmFailure, attempt: number): number => {
  // 429 且服务端给出 Retry-After 时直接遵循服务端指示（已做 5s 上限截断）
  if (failure.kind === "retryable-http" && failure.retryAfterMs !== undefined) {
    return failure.retryAfterMs;
  }

  const exponential = LLM_CONFIG.retryBaseDelayMs * 2 ** attempt;
  return exponential + Math.random() * LLM_CONFIG.retryJitterMs;
};

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

const readRetryAfterHeader = (response: Response): string | null => {
  try {
    const value = response.headers.get("retry-after");
    return value !== null && value.length > 0 ? value : null;
  } catch {
    // 部分 Response 桩（测试 mock）没有 headers — 按无 Retry-After 处理（有意的最小化吞错）。
    return null;
  }
};

const callChatApi = async (params: {
  provider: LlmProviderConfig;
  messages: ChatMessage[];
  model: string;
  maxTokens: number;
  fetchImpl: typeof fetch;
}): Promise<ChatApiOutcome> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_CONFIG.timeoutMs);

  try {
    const request = buildHttpRequest({
      provider: params.provider,
      messages: params.messages,
      model: params.model,
      temperature: LLM_CONFIG.temperature,
      maxTokens: params.maxTokens
    });
    const response = await params.fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        ok: false,
        failure: classifyHttpFailure(response.status, readRetryAfterHeader(response))
      };
    }

    const responseBody = await response.text();
    const content = parseResponse({
      provider: params.provider,
      responseBody
    });

    if (content === null) {
      return { ok: false, failure: { kind: "invalid-response" } };
    }

    return { ok: true, content, usage: parseUsage(responseBody) };
  } catch (error) {
    // 网络错误/超时（含 AbortError）：记录最小 detail 用于诊断，重试由上层判定。
    return {
      ok: false,
      failure: {
        kind: "network",
        detail: error instanceof Error ? error.message : String(error)
      }
    };
  } finally {
    clearTimeout(timer);
  }
};

const callModelWithRetry = async (params: {
  provider: LlmProviderConfig;
  messages: ChatMessage[];
  model: string;
  maxTokens: number;
  fetchImpl: typeof fetch;
}): Promise<ModelAttemptOutcome> => {
  let skipRemainingModels = false;

  for (let attempt = 0; attempt <= LLM_CONFIG.retryCount; attempt += 1) {
    const outcome = await callChatApi({
      provider: params.provider,
      messages: params.messages,
      model: params.model,
      maxTokens: params.maxTokens,
      fetchImpl: params.fetchImpl
    });

    if (outcome.ok) {
      return outcome;
    }

    if (outcome.failure.kind === "auth") {
      skipRemainingModels = true;
    }

    if (!isRetryableFailure(outcome.failure)) {
      break;
    }

    if (attempt < LLM_CONFIG.retryCount) {
      await delay(computeBackoffDelayMs(outcome.failure, attempt));
    }
  }

  return { ok: false, skipRemainingModels };
};

const toCallResult = (
  base: { content: string; model: string; source: "llm-primary" | "llm-secondary" },
  usage: LlmUsage | null
): LlmCallResult => {
  if (usage === null) {
    return base;
  }
  return { ...base, usage };
};

export const callLlmWithFallback = async (params: {
  settings: AppSettings;
  messages: ChatMessage[];
  fetchImpl?: typeof fetch;
  maxTokens?: number;
}): Promise<LlmCallResult | null> => {
  const fetchImpl = params.fetchImpl ?? fetch;
  const provider = pickActiveProvider(params.settings);
  if (provider === null) {
    return null;
  }

  const maxTokens = params.maxTokens ?? LLM_CONFIG.maxTokensSingle;
  const resolvedModels = resolveProviderModels(provider);

  const primary = await callModelWithRetry({
    provider,
    model: resolvedModels.primaryModel,
    messages: params.messages,
    maxTokens,
    fetchImpl
  });

  if (primary.ok) {
    return toCallResult(
      { content: primary.content, model: resolvedModels.primaryModel, source: "llm-primary" },
      primary.usage
    );
  }

  // 401/403 意味着同一把 API key 不可用，备模型共用同一把 key，直接放弃。
  if (primary.skipRemainingModels) {
    return null;
  }

  const secondary = await callModelWithRetry({
    provider,
    model: resolvedModels.secondaryModel,
    messages: params.messages,
    maxTokens,
    fetchImpl
  });

  if (secondary.ok) {
    return toCallResult(
      { content: secondary.content, model: resolvedModels.secondaryModel, source: "llm-secondary" },
      secondary.usage
    );
  }

  return null;
};

export const __test__ = {
  parseRetryAfterMs,
  classifyHttpFailure
};

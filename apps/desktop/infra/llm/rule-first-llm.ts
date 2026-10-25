import { z } from "zod";

import {
  buildLocalFallback,
  type ClassifyInput,
  type LlmClassifier
} from "../../core/usecases/classify-files.js";
import { LLM_CONFIG } from "../../shared/config/llm.config.js";
import type { CoordinateOption } from "../../shared/types/registry.js";
import type { AppSettings } from "../../shared/types/settings.js";
import type { Classification } from "../../shared/types/workflow.js";
import { validateProjectOutput } from "./coordinate-output.js";
import { callLlmWithFallback } from "./llm-gateway.js";
import { extractJsonPayload } from "./provider-adapter.js";
import type { LlmUsage } from "./provider-adapter.js";
import {
  CLASSIFY_BATCH_PROMPT_VERSION,
  CLASSIFY_PROMPT_VERSION,
  renderClassifyBatchPrompt,
  renderClassifyPrompt
} from "./prompt-renderer.js";

const purposeSchema = z.enum([
  "Documents",
  "Media",
  "Code",
  "Archives",
  "Installers",
  "Others",
  "Study",
  "Work",
  "Design",
  "Finance",
  "Research"
]);

const classifyResponseSchema = z.object({
  purpose: purposeSchema,
  project: z.string().min(1).default("默认项目"),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()).default([])
});

const classifyBatchEntrySchema = classifyResponseSchema.extend({
  id: z.string().min(1)
});

type ParsedClassification = z.infer<typeof classifyResponseSchema>;
type ParsedBatchEntry = z.infer<typeof classifyBatchEntrySchema>;

// classify/classifyMany 的输入契约复用 classify-files 的 ClassifyInput（含可选 coordinates，
// 与 LlmClassifier 接口同步扩展）。

/** 坐标审计 reason（governance-design.md §4.3，便于按 reason 过滤审计日志）。 */
const COORD_CLAIMED_REASON = "coord:claimed";
const COORD_NEW_PROPOSAL_REASON = "coord:new-proposal";
const COORD_INVALID_DEGRADED_REASON = "coord:invalid-degraded";

/**
 * project 输出判定：
 * - passthrough：未提供坐标清单（老调用方），不做校验；
 * - claimed / new：坐标命中清单 / NEW: 提案，project 原样保留并携带审计 reason；
 * - invalid：清单外自由命名等，调用方视为无效输出走既有降级链路。
 */
type ProjectJudge =
  | { verdict: "passthrough"; reason: null }
  | { verdict: "claimed"; reason: typeof COORD_CLAIMED_REASON }
  | { verdict: "new"; reason: typeof COORD_NEW_PROPOSAL_REASON }
  | { verdict: "invalid" };

const judgeProject = (
  project: string,
  coordinates: readonly CoordinateOption[] | undefined
): ProjectJudge => {
  // An empty list means "registry exists but nothing registered yet" — the
  // prompt rendered no coordinate section, so the model was never asked to
  // claim one. Treat it the same as no coordinates (passthrough).
  if (coordinates === undefined || coordinates.length === 0) {
    return { verdict: "passthrough", reason: null };
  }

  const validated = validateProjectOutput(project, coordinates);
  if (validated.kind === "coordinate") {
    return { verdict: "claimed", reason: COORD_CLAIMED_REASON };
  }
  if (validated.kind === "new") {
    return { verdict: "new", reason: COORD_NEW_PROPOSAL_REASON };
  }
  return { verdict: "invalid" };
};

type LlmCallOutcome = {
  model: string;
  source: "llm-primary" | "llm-secondary";
  usage?: LlmUsage;
};

const buildUsageReason = (usage: LlmUsage | undefined): string | null => {
  if (usage === undefined) {
    return null;
  }
  return `usage:pt:${usage.promptTokens}:ct:${usage.completionTokens}`;
};

const toClassification = (
  parsed: ParsedClassification,
  callResult: LlmCallOutcome,
  promptVersion: string,
  coordReason: string | null
): Classification => {
  const usageReason = buildUsageReason(callResult.usage);

  return {
    purpose: parsed.purpose,
    project: parsed.project,
    confidence: parsed.confidence,
    reasons: [
      ...parsed.reasons,
      ...(coordReason === null ? [] : [coordReason]),
      `prompt_version:${promptVersion}`,
      `model:${callResult.model}`,
      ...(usageReason === null ? [] : [usageReason])
    ],
    decisionSource: callResult.source,
    promptVersion,
    model: callResult.model,
    ...(callResult.usage === undefined ? {} : { usage: callResult.usage })
  };
};

/**
 * 逐条校验批量响应条目：非法条目直接丢弃（由调用方逐条降级），id 由调用方对齐。
 * 响应不是 JSON 数组时返回 null（整块失败）。
 */
const parseBatchEntries = (content: string): ParsedBatchEntry[] | null => {
  const payload = extractJsonPayload(content);
  if (payload === null) {
    return null;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return null;
  }

  if (!Array.isArray(raw)) {
    return null;
  }

  const entries: ParsedBatchEntry[] = [];
  for (const item of raw) {
    const parsed = classifyBatchEntrySchema.safeParse(item);
    if (parsed.success) {
      entries.push(parsed.data);
    }
  }
  return entries;
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunkSize = Math.max(1, size);
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

/**
 * 简单分块池：最多 limit 个 worker 并发消费队列，结果按下标对齐。
 */
const runWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const laneCount = Math.max(1, Math.min(limit, items.length));
  const lanes = Array.from({ length: laneCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) {
        continue;
      }
      results[index] = await worker(item);
    }
  });

  await Promise.all(lanes);
  return results;
};

export class RuleFirstLlmClassifier implements LlmClassifier {
  public constructor(private readonly settings: AppSettings) {}

  public async classify(input: ClassifyInput): Promise<Classification> {
    const prompt = renderClassifyPrompt(input);
    const result = await callLlmWithFallback({
      settings: this.settings,
      messages: [
        {
          role: "system",
          content: "你是文件分类助手，只输出 JSON。"
        },
        {
          role: "user",
          content: prompt
        }
      ]
    });

    if (result !== null) {
      const payload = extractJsonPayload(result.content);
      if (payload !== null) {
        try {
          const parsed = classifyResponseSchema.parse(JSON.parse(payload));
          const judge = judgeProject(parsed.project, input.coordinates);
          if (judge.verdict === "invalid") {
            // 坐标模式下输出了清单外 project 且无 NEW: 前缀 → 该条输出无效，本地兜底并留审计 reason。
            const fallback = buildLocalFallback(input.item, "llm-fallback");
            return { ...fallback, reasons: [...fallback.reasons, COORD_INVALID_DEGRADED_REASON] };
          }
          return toClassification(parsed, result, CLASSIFY_PROMPT_VERSION, judge.reason);
        } catch {
          // LLM 输出不符合 schema — 静默降级到本地规则兜底（有意的最小化吞错）。
        }
      }
    }

    return buildLocalFallback(input.item, "llm-fallback");
  }

  /**
   * 以实例属性（箭头函数）绑定 this：
   * process-session 会把 classifyMany 从实例上解引用后调用（BatchLlmClassifier.classifyMany），
   * 普通方法会丢失 this，这里必须保持绑定。
   */
  public classifyMany = async (inputs: ClassifyInput[]): Promise<Array<Classification | null>> => {
    if (inputs.length === 0) {
      return [];
    }

    const chunks = chunkArray(inputs, LLM_CONFIG.batchSize);
    const chunkResults = await runWithConcurrency(
      chunks,
      LLM_CONFIG.llmConcurrency,
      (chunk) => this.classifyChunk(chunk)
    );

    return chunkResults.flat();
  };

  /**
   * 批量分类一个分块：
   * 1. 渲染批量模板并调用 LLM（主→备模型）；提供坐标清单时模板注入坐标段；
   * 2. 从响应中稳健提取 JSON 数组并逐条校验（schema + 坐标认领校验），按 id 与输入对齐；
   * 3. 有效条目携带 usage reason（usage:pt:<p>:ct:<c>）与坐标审计 reason 用于观测；
   * 4. 缺失/无效条目（含 project 不在清单且无 NEW: 前缀）与整块失败均逐条降级到单文件 classify。
   */
  private async classifyChunk(chunk: ClassifyInput[]): Promise<Array<Classification | null>> {
    // 坐标清单在一次 analyze 调用内同质（上游契约）：批式模板与批式校验统一采用首条输入的
    // 清单；逐条降级路径（this.classify）仍使用各条自己的清单。
    const chunkCoordinates = chunk[0]?.coordinates;
    const prompt = renderClassifyBatchPrompt(chunk, chunkCoordinates);
    const result = await callLlmWithFallback({
      settings: this.settings,
      maxTokens: LLM_CONFIG.maxTokensBatch,
      messages: [
        {
          role: "system",
          content: "你是文件分类助手，只输出 JSON 数组。"
        },
        {
          role: "user",
          content: prompt
        }
      ]
    });

    if (result !== null) {
      const entries = parseBatchEntries(result.content);
      if (entries !== null) {
        const entriesById = new Map<string, Classification>();
        for (const entry of entries) {
          if (entriesById.has(entry.id)) {
            continue;
          }
          const judge = judgeProject(entry.project, chunkCoordinates);
          if (judge.verdict === "invalid") {
            // project 不在清单内且无 NEW: 前缀 → 该条输出无效，跳过以走逐条 classify 降级。
            continue;
          }
          entriesById.set(entry.id, toClassification(entry, result, CLASSIFY_BATCH_PROMPT_VERSION, judge.reason));
        }

        const results: Array<Classification | null> = [];
        for (const input of chunk) {
          const matched = entriesById.get(input.item.id);
          if (matched !== undefined) {
            results.push(matched);
          } else {
            results.push(await this.classify(input));
          }
        }
        return results;
      }
    }

    // 整块失败（LLM 不可用或响应不可解析）→ 整块逐条 classify 降级。
    const degraded: Array<Classification | null> = [];
    for (const input of chunk) {
      degraded.push(await this.classify(input));
    }
    return degraded;
  }
}

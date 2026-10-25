import { z } from "zod";

import { buildLocalFallback, type LlmClassifier } from "../../core/usecases/classify-files.js";
import { LLM_CONFIG } from "../../shared/config/llm.config.js";
import type { AppSettings } from "../../shared/types/settings.js";
import type { Classification, ContentSummary, FileItem } from "../../shared/types/workflow.js";
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

type ClassifyInput = { item: FileItem; summary: ContentSummary };

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
  promptVersion: string
): Classification => {
  const usageReason = buildUsageReason(callResult.usage);

  return {
    purpose: parsed.purpose,
    project: parsed.project,
    confidence: parsed.confidence,
    reasons: [
      ...parsed.reasons,
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
          return toClassification(parsed, result, CLASSIFY_PROMPT_VERSION);
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
   * 1. 渲染批量模板并调用 LLM（主→备模型）；
   * 2. 从响应中稳健提取 JSON 数组并逐条校验，按 id 与输入对齐；
   * 3. 有效条目携带 usage reason（usage:pt:<p>:ct:<c>）用于成本观测；
   * 4. 缺失/无效条目与整块失败均逐条降级到单文件 classify。
   */
  private async classifyChunk(chunk: ClassifyInput[]): Promise<Array<Classification | null>> {
    const prompt = renderClassifyBatchPrompt(chunk);
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
          if (!entriesById.has(entry.id)) {
            entriesById.set(entry.id, toClassification(entry, result, CLASSIFY_BATCH_PROMPT_VERSION));
          }
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

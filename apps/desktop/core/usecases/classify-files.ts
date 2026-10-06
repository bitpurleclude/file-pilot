import { CLASSIFICATION_CONFIG } from "../../shared/config/classification.config.js";
import type { Classification, ConfidenceBand, ContentSummary, FileItem, Purpose } from "../../shared/types/workflow.js";

export interface LlmClassifier {
  classify(input: { item: FileItem; summary: ContentSummary }): Promise<Classification | null>;
  /**
   * 批量分类可选实现：返回数组与输入按序对齐，
   * null 条目由调用方（如 process-session）逐条走 classifyWithFallback 兜底。
   */
  classifyMany?(inputs: Array<{ item: FileItem; summary: ContentSummary }>): Promise<Array<Classification | null>>;
}

/**
 * 本地兜底来源：
 * - "llm-fallback": rule-first 链路中 LLM 不可用/输出无效时的兜底（历史 reason 前缀 llm-fallback-rule:*）
 * - "classify-fallback": classifyWithFallback 中分类器返回 null 时的兜底（历史 reason local-rule:fallback）
 */
export type LocalFallbackSource = "llm-fallback" | "classify-fallback";

/**
 * 统一的本地规则兜底实现。
 * 扩展名表与默认值来自 shared/config/classification.config.ts。
 */
export const buildLocalFallback = (item: FileItem, source: LocalFallbackSource): Classification => {
  const tablePurpose = CLASSIFICATION_CONFIG.extensionPurposes[item.ext];

  if (source === "llm-fallback") {
    // 兼容历史 rule-first 兜底：Media 扩展名记 media，其余按 doc 记因（reason 字符串保持原值）。
    const purpose: Purpose = tablePurpose ?? "Documents";
    const isMedia = purpose === "Media";
    return {
      purpose,
      project: CLASSIFICATION_CONFIG.fallbackProject,
      confidence: isMedia
        ? CLASSIFICATION_CONFIG.llmFallbackMediaConfidence
        : CLASSIFICATION_CONFIG.llmFallbackDocumentsConfidence,
      reasons: [isMedia ? "llm-fallback-rule:media" : "llm-fallback-rule:doc"],
      decisionSource: "local-fallback"
    };
  }

  return {
    purpose: tablePurpose ?? CLASSIFICATION_CONFIG.fallbackPurpose,
    project: CLASSIFICATION_CONFIG.fallbackProject,
    confidence: CLASSIFICATION_CONFIG.fallbackConfidence,
    reasons: ["local-rule:fallback"],
    decisionSource: "local-fallback"
  };
};

export const classifyWithFallback = async (
  classifier: LlmClassifier,
  item: FileItem,
  summary: ContentSummary
): Promise<Classification> => {
  const llmResult = await classifier.classify({ item, summary });
  if (llmResult === null) {
    return buildLocalFallback(item, "classify-fallback");
  }

  return {
    ...llmResult,
    confidenceBand: confidenceBandOf(llmResult.confidence)
  };
};

export const shouldAskFollowUp = (classification: Classification): boolean => {
  return classification.confidence < CLASSIFICATION_CONFIG.askThreshold;
};

export const confidenceBandOf = (confidence: number): ConfidenceBand => {
  if (confidence >= CLASSIFICATION_CONFIG.highConfidenceMin) {
    return "high";
  }

  if (confidence >= CLASSIFICATION_CONFIG.mediumConfidenceMin) {
    return "medium";
  }

  return "low";
};

import { CLASSIFICATION_CONFIG } from "../../shared/config/classification.config.js";
import type { Classification, ConfidenceBand, ContentSummary, FileItem, Purpose } from "../../shared/types/workflow.js";

export interface LlmClassifier {
  classify(input: { item: FileItem; summary: ContentSummary }): Promise<Classification | null>;
}

const purposeByExtension: Record<string, Purpose> = {
  md: "Documents",
  txt: "Documents",
  pdf: "Documents",
  xlsx: "Work",
  docx: "Work",
  jpg: "Media",
  jpeg: "Media",
  png: "Media",
  zip: "Archives",
  rar: "Archives",
  exe: "Installers",
  msi: "Installers",
  ts: "Code",
  tsx: "Code",
  js: "Code"
};

const fallbackClassify = (item: FileItem): Classification => {
  const purpose = purposeByExtension[item.ext] ?? "Others";

  return {
    purpose,
    project: "default",
    confidence: 0.72,
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
    return fallbackClassify(item);
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

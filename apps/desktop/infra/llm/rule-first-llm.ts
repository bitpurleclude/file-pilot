import { z } from "zod";

import type { LlmClassifier } from "../../core/usecases/classify-files.js";
import type { AppSettings } from "../../shared/types/settings.js";
import type { Classification } from "../../shared/types/workflow.js";
import { callLlmWithFallback } from "./llm-gateway.js";
import { CLASSIFY_PROMPT_VERSION, renderClassifyPrompt } from "./prompt-renderer.js";

const classifyResponseSchema = z.object({
  purpose: z.enum([
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
  ]),
  // project is joined into placement target paths, so path-like values are
  // rejected at the schema level — prompt wording alone is not a boundary.
  project: z.string().min(1).max(64)
    .regex(/^[^\\/:*?"<>|]+$/, "project must not contain path separators")
    .refine((value) => value !== "." && value !== "..")
    .default("默认项目"),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()).default([])
});

/** Models frequently wrap JSON in markdown fences; strip them before parsing. */
const stripMarkdownFences = (content: string): string => {
  return content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
};

const buildRuleResult = (ext: string, extraReasons: string[] = []): Classification => {
  if (["png", "jpg", "jpeg"].includes(ext)) {
    return {
      purpose: "Media",
      project: "默认项目",
      confidence: 0.88,
      reasons: ["llm-fallback-rule:media", ...extraReasons],
      decisionSource: "local-fallback"
    };
  }

  return {
    purpose: "Documents",
    project: "默认项目",
    confidence: 0.7,
    reasons: ["llm-fallback-rule:doc", ...extraReasons],
    decisionSource: "local-fallback"
  };
};

export class RuleFirstLlmClassifier implements LlmClassifier {
  public constructor(private readonly settings: AppSettings) {}

  public async classify(input: Parameters<LlmClassifier["classify"]>[0]): ReturnType<LlmClassifier["classify"]> {
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

    if (result.ok) {
      try {
        const parsed = classifyResponseSchema.parse(JSON.parse(stripMarkdownFences(result.content)));
        return {
          ...parsed,
          decisionSource: result.source,
          promptVersion: CLASSIFY_PROMPT_VERSION,
          model: result.model,
          reasons: [...parsed.reasons, `prompt_version:${CLASSIFY_PROMPT_VERSION}`, `model:${result.model}`]
        };
      } catch {
        return buildRuleResult(input.item.ext, ["llm-response-unparseable"]);
      }
    }

    return buildRuleResult(input.item.ext, [`llm-failed:${result.failure.errorCode}`]);
  }
}

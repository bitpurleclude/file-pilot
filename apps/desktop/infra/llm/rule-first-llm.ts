import { z } from "zod";

import type { Classification } from "../../shared/types/workflow.js";
import type { AppSettings } from "../../shared/types/settings.js";
import type { LlmClassifier } from "../../core/usecases/classify-files.js";
import { CLASSIFY_PROMPT_VERSION, renderClassifyPrompt } from "./prompt-renderer.js";
import { callLlmWithFallback } from "./llm-gateway.js";

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
  project: z.string().min(1).default("默认项目"),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()).default([])
});

const buildRuleResult = (ext: string): Classification => {
  if (["png", "jpg", "jpeg"].includes(ext)) {
    return { purpose: "Media", project: "默认项目", confidence: 0.88, reasons: ["llm-fallback-rule:media"] };
  }

  return { purpose: "Documents", project: "默认项目", confidence: 0.7, reasons: ["llm-fallback-rule:doc"] };
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

    if (result !== null) {
      try {
        const parsed = classifyResponseSchema.parse(JSON.parse(result.content));
        return {
          ...parsed,
          reasons: [...parsed.reasons, `prompt_version:${CLASSIFY_PROMPT_VERSION}`, `model:${result.model}`]
        };
      } catch {
        return buildRuleResult(input.item.ext);
      }
    }

    return buildRuleResult(input.item.ext);
  }
}

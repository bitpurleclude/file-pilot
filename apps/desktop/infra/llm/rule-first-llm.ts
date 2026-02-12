import { LLM_CONFIG } from "../../shared/config/llm.config.js";
import type { Classification } from "../../shared/types/workflow.js";
import type { LlmClassifier } from "../../core/usecases/classify-files.js";

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("llm-timeout"));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
};

const buildRuleResult = (ext: string): Classification => {
  if (["png", "jpg", "jpeg"].includes(ext)) {
    return { purpose: "Media", project: "默认项目", confidence: 0.88, reasons: ["llm-fallback-rule:media"] };
  }

  return { purpose: "Documents", project: "默认项目", confidence: 0.7, reasons: ["llm-fallback-rule:doc"] };
};

export class RuleFirstLlmClassifier implements LlmClassifier {
  public async classify(input: Parameters<LlmClassifier["classify"]>[0]): ReturnType<LlmClassifier["classify"]> {
    let attempt = 0;
    while (attempt <= LLM_CONFIG.retryCount) {
      try {
        const result = await withTimeout(Promise.resolve(buildRuleResult(input.item.ext)), LLM_CONFIG.timeoutMs);
        return result;
      } catch {
        attempt += 1;
      }
    }

    return null;
  }
}

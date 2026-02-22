import { readFileSync } from "node:fs";
import { join } from "node:path";

import nunjucks from "nunjucks";
import { z } from "zod";

import { AppError } from "../../shared/errors/app-error.js";
import type { ContentSummary, FileItem } from "../../shared/types/workflow.js";

const classifyInputSchema = z.object({
  item: z.object({
    name: z.string().min(1),
    ext: z.string(),
    size: z.number().nonnegative()
  }),
  summary: z.object({
    textSnippet: z.string(),
    keywords: z.array(z.string())
  })
});

const env = nunjucks.configure({
  autoescape: false,
  throwOnUndefined: true
});

const templatePath = (): string => {
  return join(process.cwd(), "apps", "desktop", "infra", "llm", "templates", "classify.v1.njk");
};

const loadClassifyTemplate = (): string => {
  try {
    return readFileSync(templatePath(), "utf-8");
  } catch (error) {
    throw new AppError("SYSTEM_PROMPT_TEMPLATE_MISSING", "classify template file not found", "SYSTEM", {
      cause: error instanceof Error ? error.message : String(error),
      path: templatePath()
    });
  }
};

export const CLASSIFY_PROMPT_VERSION = "classify.v1";

export const renderClassifyPrompt = (input: { item: FileItem; summary: ContentSummary }): string => {
  try {
    const validated = classifyInputSchema.parse({
      item: {
        name: input.item.name,
        ext: input.item.ext,
        size: input.item.size
      },
      summary: {
        textSnippet: input.summary.textSnippet,
        keywords: input.summary.keywords
      }
    });

    return env.renderString(loadClassifyTemplate(), validated);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError("SYSTEM_PROMPT_RENDER_FAILED", "failed to render classify prompt", "SYSTEM", {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
};


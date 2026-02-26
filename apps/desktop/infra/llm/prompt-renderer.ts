import { existsSync, readFileSync } from "node:fs";
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

const classifyTemplateName = "classify.v1.njk";

const templatePaths = (): string[] => {
  return [
    join(__dirname, "templates", classifyTemplateName),
    join(process.cwd(), "dist", "electron", "templates", classifyTemplateName),
    join(process.cwd(), "apps", "desktop", "infra", "llm", "templates", classifyTemplateName)
  ];
};

let cachedClassifyTemplate: string | null = null;

const loadClassifyTemplate = (): string => {
  if (cachedClassifyTemplate !== null) {
    return cachedClassifyTemplate;
  }

  const checkedPaths: string[] = [];

  for (const path of templatePaths()) {
    checkedPaths.push(path);
    if (!existsSync(path)) {
      continue;
    }

    try {
      cachedClassifyTemplate = readFileSync(path, "utf-8");
      return cachedClassifyTemplate;
    } catch (error) {
      throw new AppError("SYSTEM_PROMPT_TEMPLATE_MISSING", "classify template file not found", "SYSTEM", {
        cause: error instanceof Error ? error.message : String(error),
        checkedPaths
      });
    }
  }

  try {
    throw new Error("no template file found");
  } catch (error) {
    throw new AppError("SYSTEM_PROMPT_TEMPLATE_MISSING", "classify template file not found", "SYSTEM", {
      cause: error instanceof Error ? error.message : String(error),
      checkedPaths
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

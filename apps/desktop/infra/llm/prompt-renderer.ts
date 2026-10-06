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

const classifyBatchInputSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    ext: z.string(),
    size: z.number().nonnegative(),
    keywords: z.array(z.string())
  })).min(1)
});

const env = nunjucks.configure({
  autoescape: false,
  throwOnUndefined: true
});

const templatePaths = (templateName: string): string[] => {
  return [
    join(__dirname, "templates", templateName),
    join(process.cwd(), "dist", "electron", "templates", templateName),
    join(process.cwd(), "apps", "desktop", "infra", "llm", "templates", templateName)
  ];
};

const templateCache = new Map<string, string>();

const loadTemplate = (templateName: string): string => {
  const cached = templateCache.get(templateName);
  if (cached !== undefined) {
    return cached;
  }

  const checkedPaths: string[] = [];

  for (const path of templatePaths(templateName)) {
    checkedPaths.push(path);
    if (!existsSync(path)) {
      continue;
    }

    try {
      const content = readFileSync(path, "utf-8");
      templateCache.set(templateName, content);
      return content;
    } catch (error) {
      throw new AppError("SYSTEM_PROMPT_TEMPLATE_MISSING", `${templateName} template file not found`, "SYSTEM", {
        cause: error instanceof Error ? error.message : String(error),
        checkedPaths
      });
    }
  }

  throw new AppError("SYSTEM_PROMPT_TEMPLATE_MISSING", `${templateName} template file not found`, "SYSTEM", {
    cause: "no template file found",
    checkedPaths
  });
};

const renderError = (error: unknown, message: string): AppError => {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError("SYSTEM_PROMPT_RENDER_FAILED", message, "SYSTEM", {
    cause: error instanceof Error ? error.message : String(error)
  });
};

const renderValidatedTemplate = (
  templateName: string,
  variables: object,
  failureMessage: string
): string => {
  try {
    return env.renderString(loadTemplate(templateName), variables);
  } catch (error) {
    throw renderError(error, failureMessage);
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

    return renderValidatedTemplate("classify.v1.njk", validated, "failed to render classify prompt");
  } catch (error) {
    throw renderError(error, "failed to render classify prompt");
  }
};

export const CLASSIFY_BATCH_PROMPT_VERSION = "classify-batch.v1";

export type ClassifyBatchInput = Array<{ item: FileItem; summary: ContentSummary }>;

export const renderClassifyBatchPrompt = (items: ClassifyBatchInput): string => {
  try {
    const validated = classifyBatchInputSchema.parse({
      items: items.map((entry) => ({
        id: entry.item.id,
        name: entry.item.name,
        ext: entry.item.ext,
        size: entry.item.size,
        keywords: entry.summary.keywords
      }))
    });

    return renderValidatedTemplate("classify-batch.v1.njk", validated, "failed to render classify batch prompt");
  } catch (error) {
    throw renderError(error, "failed to render classify batch prompt");
  }
};

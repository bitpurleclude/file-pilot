import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import nunjucks from "nunjucks";
import { z } from "zod";

import { AppError } from "../../shared/errors/app-error.js";
import { LLM_CONFIG } from "../../shared/config/llm.config.js";
import type { CoordinateOption } from "../../shared/types/registry.js";
import type { ContentSummary, FileItem } from "../../shared/types/workflow.js";

const coordinateOptionSchema = z.object({
  areaNumber: z.number(),
  areaName: z.string().min(1),
  projectNumber: z.number(),
  projectName: z.string().min(1)
});

const classifyInputSchema = z.object({
  item: z.object({
    name: z.string().min(1),
    ext: z.string(),
    size: z.number().nonnegative()
  }),
  summary: z.object({
    textSnippet: z.string(),
    keywords: z.array(z.string())
  }),
  /**
   * 坐标认领清单（governance-design.md §4.3）：提供时模板渲染「可用项目坐标清单」段，
   * 并把 project 约束改写为"从清单认领或 NEW: 提案"；缺省时保持既有模板输出逐字节不变。
   * 空数组表示登记册存在但无坐标（模型应对一切输出 NEW: 提案）。
   */
  coordinates: z.array(coordinateOptionSchema).optional()
});

const classifyBatchInputSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    ext: z.string(),
    size: z.number().nonnegative(),
    keywords: z.array(z.string())
  })).min(1),
  // 与 classifyInputSchema.coordinates 语义一致：批式模板的坐标认领清单。
  coordinates: z.array(coordinateOptionSchema).optional()
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

/** 模板公共变量：坐标段指令中的 NEW 前缀取自 LLM_CONFIG（与输出校验共用单一来源）。 */
const withPromptConstants = (variables: object): object => {
  return { ...variables, newProjectPrefix: LLM_CONFIG.newProjectPrefix };
};

export const CLASSIFY_PROMPT_VERSION = "classify.v1";

// An empty list means "registry exists but nothing registered yet" — there is
// nothing to claim, so the prompt must render exactly like no coordinates at
// all (nunjucks treats [] as truthy, which would emit an empty list section).
const normalizeCoordinates = (
  coordinates: CoordinateOption[] | undefined
): CoordinateOption[] | undefined =>
  coordinates !== undefined && coordinates.length === 0 ? undefined : coordinates;

export type ClassifyPromptInput = {
  item: FileItem;
  summary: ContentSummary;
  coordinates?: CoordinateOption[] | undefined;
};

export const renderClassifyPrompt = (input: ClassifyPromptInput): string => {
  try {
    const coordinates = normalizeCoordinates(input.coordinates);
    const validated = classifyInputSchema.parse({
      item: {
        name: input.item.name,
        ext: input.item.ext,
        size: input.item.size
      },
      summary: {
        textSnippet: input.summary.textSnippet,
        keywords: input.summary.keywords
      },
      ...(coordinates === undefined ? {} : { coordinates })
    });

    return renderValidatedTemplate("classify.v1.njk", withPromptConstants(validated), "failed to render classify prompt");
  } catch (error) {
    throw renderError(error, "failed to render classify prompt");
  }
};

export const CLASSIFY_BATCH_PROMPT_VERSION = "classify-batch.v1";

export type ClassifyBatchInput = Array<{ item: FileItem; summary: ContentSummary }>;

export const renderClassifyBatchPrompt = (
  items: ClassifyBatchInput,
  coordinates?: CoordinateOption[] | undefined
): string => {
  try {
    const effectiveCoordinates = normalizeCoordinates(coordinates);
    const validated = classifyBatchInputSchema.parse({
      items: items.map((entry) => ({
        id: entry.item.id,
        name: entry.item.name,
        ext: entry.item.ext,
        size: entry.item.size,
        keywords: entry.summary.keywords
      })),
      ...(effectiveCoordinates === undefined ? {} : { coordinates: effectiveCoordinates })
    });

    return renderValidatedTemplate("classify-batch.v1.njk", withPromptConstants(validated), "failed to render classify batch prompt");
  } catch (error) {
    throw renderError(error, "failed to render classify batch prompt");
  }
};

import nunjucks from "nunjucks";
import { z } from "zod";

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

const classifyTemplate = `你是一个文件分类助手。\n请根据文件元数据和摘要，返回 JSON：\n{\n  "purpose": "Documents|Media|Code|Archives|Installers|Others|Study|Work|Design|Finance|Research",\n  "project": "项目名",\n  "confidence": 0.0,\n  "reasons": ["简短原因"]\n}\n\n约束：\n1. 仅返回 JSON，不要解释。\n2. confidence 取值范围 0 到 1。\n3. project 为空时填 "默认项目"。\n\n输入：\n- 文件名：{{ item.name }}\n- 扩展名：{{ item.ext }}\n- 大小：{{ item.size }}\n- 摘要：{{ summary.textSnippet }}\n- 关键词：{{ summary.keywords | join(', ') }}\n`;

export const CLASSIFY_PROMPT_VERSION = "classify.v1";

export const renderClassifyPrompt = (input: { item: FileItem; summary: ContentSummary }): string => {
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

  return env.renderString(classifyTemplate, validated);
};

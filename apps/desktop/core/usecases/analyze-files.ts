import { basename, extname } from "node:path";
import { stat, readFile } from "node:fs/promises";

import { ANALYZER_CONFIG } from "../../shared/config/analyzer.config.js";
import type { ContentSummary, FileItem } from "../../shared/types/workflow.js";

const textLikeExtensions = new Set(["txt", "md"]);

const safeReadSnippet = async (path: string): Promise<string> => {
  const ext = extname(path).slice(1).toLowerCase();
  if (!textLikeExtensions.has(ext)) {
    return "";
  }

  const raw = await readFile(path, "utf-8");
  return raw.slice(0, ANALYZER_CONFIG.maxSnippetLength);
};

const extractKeywords = (snippet: string): string[] => {
  if (snippet.length === 0) {
    return [];
  }

  const words = snippet
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3);

  return [...new Set(words)].slice(0, ANALYZER_CONFIG.maxKeywordCount);
};

export const analyzeFile = async (path: string): Promise<{ item: FileItem; summary: ContentSummary }> => {
  const meta = await stat(path);
  const name = basename(path);
  const ext = extname(path).slice(1).toLowerCase();
  const snippet = await safeReadSnippet(path);

  return {
    item: {
      id: crypto.randomUUID(),
      path,
      name,
      ext,
      size: meta.size,
      createdAt: meta.birthtime.toISOString(),
      modifiedAt: meta.mtime.toISOString(),
      mime: ext.length > 0 ? `application/${ext}` : "application/octet-stream"
    },
    summary: {
      textSnippet: snippet,
      keywords: extractKeywords(snippet),
      language: "zh-CN"
    }
  };
};

export const analyzeFiles = async (paths: string[]): Promise<Array<{ item: FileItem; summary: ContentSummary }>> => {
  return Promise.all(paths.map((path) => analyzeFile(path)));
};

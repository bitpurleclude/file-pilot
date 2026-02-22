import { dirname, sep } from "node:path";

import type { ClassificationRule, RuleMatchResult } from "../../shared/types/rules.js";
import type { ContentSummary, FileItem } from "../../shared/types/workflow.js";

const SCORE_THRESHOLD = 0.6;

const normalizeKeywordSet = (summary: ContentSummary): Set<string> => {
  const fromSnippet = summary.textSnippet
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 2);

  const fromKeywords = summary.keywords.map((keyword) => keyword.toLowerCase());
  return new Set([...fromSnippet, ...fromKeywords]);
};

const normalizePath = (value: string): string => {
  return value.replaceAll("\\", "/");
};

const pathStartsWith = (path: string, prefix: string): boolean => {
  const normalizedPath = normalizePath(path);
  const normalizedPrefix = normalizePath(prefix).replace(/\/+$/, "");
  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
};

export const scoreRule = (rule: ClassificationRule, input: { item: FileItem; summary: ContentSummary }): number => {
  let score = 0;

  const ext = input.item.ext.toLowerCase();
  if (rule.matcher.ext !== undefined && rule.matcher.ext.toLowerCase() === ext) {
    score += 0.45;
  }

  if (rule.matcher.pathPrefix !== undefined) {
    const sourceDir = dirname(input.item.path).split(sep).join("/");
    if (pathStartsWith(sourceDir, rule.matcher.pathPrefix)) {
      score += 0.25;
    }
  }

  const keywords = normalizeKeywordSet(input.summary);
  const positiveHits = rule.matcher.keywords.reduce((acc, keyword) => {
    return keywords.has(keyword.toLowerCase()) ? acc + 1 : acc;
  }, 0);
  score += Math.min(positiveHits * 0.1, 0.3);

  const negativeHits = rule.matcher.negativeKeywords.reduce((acc, keyword) => {
    return keywords.has(keyword.toLowerCase()) ? acc + 1 : acc;
  }, 0);
  score -= Math.min(negativeHits * 0.2, 0.4);

  if (score < 0) {
    return 0;
  }

  if (score > 1) {
    return 1;
  }

  return score;
};

export const selectBestMatchingRule = (
  rules: ClassificationRule[],
  input: { item: FileItem; summary: ContentSummary }
): RuleMatchResult | null => {
  const candidates = rules
    .filter((rule) => rule.enabled)
    .map((rule) => ({
      rule,
      score: scoreRule(rule, input)
    }))
    .filter((candidate) => candidate.score >= SCORE_THRESHOLD);

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => {
    if (b.rule.priority !== a.rule.priority) {
      return b.rule.priority - a.rule.priority;
    }

    return b.rule.updatedAt.localeCompare(a.rule.updatedAt);
  });

  return candidates[0] ?? null;
};

export const ruleThreshold = SCORE_THRESHOLD;


import type { Purpose } from "./workflow.js";

export type RuleSource = "manual" | "learned";

export interface RuleMatcher {
  ext?: string;
  pathPrefix?: string;
  keywords: string[];
  negativeKeywords: string[];
}

export interface ClassificationRule {
  id: string;
  purpose: Purpose;
  project: string;
  matcher: RuleMatcher;
  priority: number;
  enabled: boolean;
  source: RuleSource;
  hits: number;
  createdAt: string;
  updatedAt: string;
  lastMatchedAt?: string;
}

export interface RuleMatchResult {
  rule: ClassificationRule;
  score: number;
}

export interface RuleUpdatePayload {
  ruleId: string;
  enabled?: boolean;
  priority?: number;
  project?: string;
  purpose?: Purpose;
}

export interface RuleMetrics {
  ruleId: string;
  hits: number;
  lastMatchedAt?: string;
}


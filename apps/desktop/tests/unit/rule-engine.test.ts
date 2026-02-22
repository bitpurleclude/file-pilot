import { describe, expect, it } from "vitest";

import { ruleThreshold, scoreRule, selectBestMatchingRule } from "../../core/usecases/rule-engine.js";
import type { ClassificationRule } from "../../shared/types/rules.js";

const input = {
  item: {
    id: "f1",
    path: "D:/Study/Chemistry/chapter1.md",
    name: "chapter1.md",
    ext: "md",
    size: 100,
    createdAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    mime: "text/markdown"
  },
  summary: {
    textSnippet: "chemistry chapter notes",
    keywords: ["chemistry", "chapter"],
    language: "zh-CN"
  }
};

const makeRule = (partial: Partial<ClassificationRule>): ClassificationRule => ({
  id: "r1",
  purpose: "Study",
  project: "Chem",
  matcher: {
    ext: "md",
    pathPrefix: "D:/Study/Chemistry",
    keywords: ["chemistry"],
    negativeKeywords: []
  },
  priority: 10,
  enabled: true,
  source: "learned",
  hits: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...partial
});

describe("rule-engine", () => {
  it("scores rule with fixed weights and keyword caps", () => {
    const rule = makeRule({
      matcher: {
        ext: "md",
        pathPrefix: "D:/Study/Chemistry",
        keywords: ["chemistry", "chapter", "notes", "extra"],
        negativeKeywords: []
      }
    });

    const score = scoreRule(rule, input);
    expect(score).toBeGreaterThanOrEqual(ruleThreshold);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("selects rule by priority then updatedAt", () => {
    const winner = makeRule({ id: "winner", priority: 100, updatedAt: "2026-02-02T00:00:00.000Z" });
    const loser = makeRule({ id: "loser", priority: 50, updatedAt: "2026-03-02T00:00:00.000Z" });

    const selected = selectBestMatchingRule([loser, winner], input);
    expect(selected?.rule.id).toBe("winner");
  });

  it("ignores disabled rules and below-threshold matches", () => {
    const disabled = makeRule({ id: "disabled", enabled: false });
    const weak = makeRule({
      id: "weak",
      matcher: {
        keywords: [],
        negativeKeywords: [],
        ext: "png"
      }
    });

    expect(selectBestMatchingRule([disabled, weak], input)).toBeNull();
  });
});

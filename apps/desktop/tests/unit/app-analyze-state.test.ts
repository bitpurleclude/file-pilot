import { describe, expect, it } from "vitest";

import { mergeAnalyzeData } from "../../src/pages/analyze-state.js";
import type { AnalyzeData, SubmitFollowupData } from "../../src/pages/types.js";

describe("mergeAnalyzeData", () => {
  it("replaces stale analyze state with follow-up/correction response data", () => {
    const current: AnalyzeData = {
      sessionId: "session-1",
      needsFollowUp: true,
      followUpQuestions: [{ fileId: "file-1", question: "question-1" }],
      items: [
        {
          item: {
            id: "file-1",
            path: "C:/data/note.md",
            name: "note.md",
            ext: "md",
            size: 10,
            createdAt: "2026-02-20T00:00:00.000Z",
            modifiedAt: "2026-02-20T00:00:00.000Z",
            mime: "text/markdown"
          },
          summary: {
            textSnippet: "old",
            keywords: ["old"],
            language: "en"
          },
          classification: {
            purpose: "Documents",
            project: "old-project",
            confidence: 0.58,
            decisionSource: "llm-primary",
            reasons: ["seed"]
          },
          plan: {
            fileId: "file-1",
            sourcePath: "C:/data/note.md",
            targetPath: "C:/workspace/Documents/old-project/note.md",
            action: "move",
            conflictPolicy: "rename"
          },
          needsFollowUp: true,
          followUpQuestion: "question-1",
          decisionSource: "llm-primary"
        }
      ]
    };

    const update: SubmitFollowupData = {
      sessionId: "session-1",
      updatedCount: 1,
      needsFollowUp: false,
      followUpQuestions: [],
      items: [
        {
          item: {
            id: "file-1",
            path: "C:/data/note.md",
            name: "note.md",
            ext: "md",
            size: 10,
            createdAt: "2026-02-20T00:00:00.000Z",
            modifiedAt: "2026-02-20T00:00:00.000Z",
            mime: "text/markdown"
          },
          summary: {
            textSnippet: "new",
            keywords: ["new"],
            language: "en"
          },
          classification: {
            purpose: "Study",
            project: "new-project",
            confidence: 0.95,
            decisionSource: "manual-correction",
            reasons: ["manual-correction"]
          },
          plan: {
            fileId: "file-1",
            sourcePath: "C:/data/note.md",
            targetPath: "C:/workspace/Study/new-project/note.md",
            action: "move",
            conflictPolicy: "rename"
          },
          needsFollowUp: false,
          decisionSource: "manual-correction"
        }
      ]
    };

    const merged = mergeAnalyzeData(current, update);

    expect(merged.sessionId).toBe("session-1");
    expect(merged.needsFollowUp).toBe(false);
    expect(merged.followUpQuestions).toEqual([]);
    expect(merged.items[0]?.classification.project).toBe("new-project");
    expect(merged.items[0]?.classification.decisionSource).toBe("manual-correction");
  });
});

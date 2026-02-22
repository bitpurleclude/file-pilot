import { describe, expect, it } from "vitest";

import { AppError } from "../../shared/errors/app-error.js";
import { CLASSIFY_PROMPT_VERSION, renderClassifyPrompt } from "../../infra/llm/prompt-renderer.js";

describe("prompt-renderer", () => {
  it("renders classify template from file with validated variables", () => {
    const prompt = renderClassifyPrompt({
      item: {
        id: "f-1",
        path: "C:/demo/note.md",
        name: "note.md",
        ext: "md",
        size: 42,
        createdAt: "2026-02-12T00:00:00.000Z",
        modifiedAt: "2026-02-12T00:00:00.000Z",
        mime: "text/markdown"
      },
      summary: {
        textSnippet: "这是一个学习记录",
        keywords: ["学习", "记录"],
        language: "zh-CN"
      }
    });

    expect(CLASSIFY_PROMPT_VERSION).toBe("classify.v1");
    expect(prompt).toContain("note.md");
    expect(prompt).toContain("学习");
    expect(prompt).toContain("记录");
  });

  it("throws identifiable error when required variable is missing", () => {
    expect(() => renderClassifyPrompt({
      item: {
        id: "f-1",
        path: "C:/demo/note.md",
        name: "",
        ext: "md",
        size: 42,
        createdAt: "2026-02-12T00:00:00.000Z",
        modifiedAt: "2026-02-12T00:00:00.000Z",
        mime: "text/markdown"
      },
      summary: {
        textSnippet: "text",
        keywords: ["k1"],
        language: "zh-CN"
      }
    })).toThrowError(AppError);

    try {
      renderClassifyPrompt({
        item: {
          id: "f-1",
          path: "C:/demo/note.md",
          name: "",
          ext: "md",
          size: 42,
          createdAt: "2026-02-12T00:00:00.000Z",
          modifiedAt: "2026-02-12T00:00:00.000Z",
          mime: "text/markdown"
        },
        summary: {
          textSnippet: "text",
          keywords: ["k1"],
          language: "zh-CN"
        }
      });
    } catch (error) {
      expect((error as AppError).code).toBe("SYSTEM_PROMPT_RENDER_FAILED");
    }
  });
});


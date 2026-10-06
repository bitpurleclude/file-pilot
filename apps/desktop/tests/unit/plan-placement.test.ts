import { describe, expect, it } from "vitest";

import {
  buildPlacementPlan,
  sanitizePathSegment,
  timestampSuffix
} from "../../core/usecases/plan-placement.js";
import type { Classification } from "../../shared/types/workflow.js";

const buildClassification = (overrides: Partial<Classification>): Classification => ({
  purpose: "Documents",
  project: "demo",
  confidence: 0.9,
  reasons: ["test"],
  ...overrides
});

describe("plan-placement", () => {
  it("keeps the original file name and adds time bucket for Media", () => {
    const plan = buildPlacementPlan({
      fileId: "file-1",
      sourcePath: "C:/in/pic.jpg",
      classification: buildClassification({
        purpose: "Media",
        project: "旅行"
      }),
      workspaceRoot: "D:/target",
      now: new Date(2026, 1, 12, 10, 11, 12)
    });

    const normalizedPath = plan.targetPath.replaceAll("\\", "/");

    expect(normalizedPath).toContain("D:/target");
    expect(normalizedPath).toContain("Media");
    expect(normalizedPath).toContain("2026");
    expect(normalizedPath).toContain("02");
    expect(normalizedPath.endsWith("pic.jpg")).toBe(true);
    expect(plan.conflictPolicy).toBe("rename");
    expect(plan.action).toBe("move");
  });

  it("does not append a timestamp to the target name", () => {
    const plan = buildPlacementPlan({
      fileId: "file-1",
      sourcePath: "C:/in/report final.pdf",
      classification: buildClassification({ project: "demo" }),
      workspaceRoot: "D:/target",
      now: new Date(2026, 1, 12, 10, 11, 12)
    });

    const normalizedPath = plan.targetPath.replaceAll("\\", "/");
    expect(normalizedPath.endsWith("Documents/demo/report final.pdf")).toBe(true);
  });

  it("formats timestamp suffix as YYYYMMDDhhmmss", () => {
    expect(timestampSuffix(new Date(2026, 1, 12, 10, 11, 12))).toBe("20260212101112");
    expect(timestampSuffix(new Date(2026, 10, 3, 5, 6, 7))).toBe("20261103050607");
  });

  describe("sanitizePathSegment", () => {
    it("removes Windows-forbidden and control characters", () => {
      expect(sanitizePathSegment('a/b\\c:d*e?f"g<h>i|j', "fallback")).toBe("abcdefghij");
      expect(sanitizePathSegment("a\u0000b\u0007c\u007fd", "fallback")).toBe("abcd");
    });

    it("collapses whitespace", () => {
      expect(sanitizePathSegment("  多  个   空格 \t 名 ", "fallback")).toBe("多 个 空格 名");
    });

    it("strips leading and trailing dots and spaces", () => {
      expect(sanitizePathSegment(".hidden.", "fallback")).toBe("hidden");
      expect(sanitizePathSegment(" . name . ", "fallback")).toBe("name");
    });

    it("rejects reserved device names including extension forms", () => {
      expect(sanitizePathSegment("CON", "fallback")).toBe("fallback");
      expect(sanitizePathSegment("con.txt", "fallback")).toBe("fallback");
      expect(sanitizePathSegment("LPT9", "fallback")).toBe("fallback");
      expect(sanitizePathSegment("COM4.md", "fallback")).toBe("fallback");
      expect(sanitizePathSegment("NUL", "fallback")).toBe("fallback");
    });

    it("allows names that merely contain reserved words", () => {
      expect(sanitizePathSegment("my.CON.notes", "fallback")).toBe("my.CON.notes");
    });

    it("falls back for empty, dot-only and traversal segments", () => {
      expect(sanitizePathSegment("", "fallback")).toBe("fallback");
      expect(sanitizePathSegment("   ", "fallback")).toBe("fallback");
      expect(sanitizePathSegment(".", "fallback")).toBe("fallback");
      expect(sanitizePathSegment("..", "fallback")).toBe("fallback");
    });

    it("truncates to the configured maximum length", () => {
      expect(sanitizePathSegment("a".repeat(70), "fallback")).toBe("a".repeat(64));
    });
  });

  describe("buildPlacementPlan sanitization", () => {
    it("cleans illegal characters in project segments", () => {
      const plan = buildPlacementPlan({
        fileId: "file-1",
        sourcePath: "C:/in/doc.txt",
        classification: buildClassification({ project: "my/project" }),
        workspaceRoot: "D:/target",
        now: new Date(2026, 1, 12)
      });

      const normalizedPath = plan.targetPath.replaceAll("\\", "/");
      expect(normalizedPath).toContain("Documents/myproject/doc.txt");
    });

    it("falls back to the default project for unusable project values", () => {
      const plan = buildPlacementPlan({
        fileId: "file-1",
        sourcePath: "C:/in/doc.txt",
        classification: buildClassification({ project: "CON" }),
        workspaceRoot: "D:/target",
        now: new Date(2026, 1, 12)
      });

      const normalizedPath = plan.targetPath.replaceAll("\\", "/");
      expect(normalizedPath).toContain("Documents/默认项目/doc.txt");
    });

    it("sanitizes the purpose segment as well", () => {
      const plan = buildPlacementPlan({
        fileId: "file-1",
        sourcePath: "C:/in/doc.txt",
        classification: buildClassification({
          purpose: "Media?" as unknown as Classification["purpose"],
          project: "demo"
        }),
        workspaceRoot: "D:/target",
        now: new Date(2026, 1, 12, 10, 11, 12)
      });

      const normalizedPath = plan.targetPath.replaceAll("\\", "/");
      expect(normalizedPath).toContain("Media/demo/");
      expect(normalizedPath).toContain("2026/02");
      expect(normalizedPath.endsWith("doc.txt")).toBe(true);
    });
  });
});

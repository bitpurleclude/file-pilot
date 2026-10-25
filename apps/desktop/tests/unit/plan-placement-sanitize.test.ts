import { isAbsolute, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { buildPlacementPlan, sanitizeProjectSegment } from "../../core/usecases/plan-placement.js";
import type { Classification } from "../../shared/types/workflow.js";

const classification = (project: string): Classification => ({
  purpose: "Documents",
  project,
  confidence: 0.9,
  reasons: []
});

describe("sanitizeProjectSegment", () => {
  it("strips path separators and Windows-illegal characters", () => {
    expect(sanitizeProjectSegment("..\\..\\Startup")).not.toMatch(/[\\/:*?"<>|]/);
    expect(sanitizeProjectSegment("a/b/c")).not.toContain("/");
  });

  it("neutralizes dot-dot sequences", () => {
    expect(sanitizeProjectSegment("..")).not.toBe("..");
    expect(sanitizeProjectSegment("a..b")).not.toContain("..");
  });

  it("falls back to a safe default for empty results", () => {
    expect(sanitizeProjectSegment("///")).toBe("默认项目");
    expect(sanitizeProjectSegment(" . ")).toBe("默认项目");
  });
});

describe("buildPlacementPlan hostile project values", () => {
  const workspaceRoot = join("D:", "workspace");

  const assertInsideWorkspace = (targetPath: string): void => {
    const rel = relative(workspaceRoot, targetPath);
    expect(rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel)).toBe(true);
  };

  it("keeps traversal payloads inside the workspace", () => {
    const plan = buildPlacementPlan({
      fileId: "1",
      sourcePath: join("D:", "src", "a.txt"),
      classification: classification("..\\..\\..\\Windows\\System32"),
      workspaceRoot,
    now: new Date("2026-01-01T00:00:00Z")
    });

    assertInsideWorkspace(plan.targetPath);
  });

  it("keeps absolute-path payloads inside the workspace", () => {
    const plan = buildPlacementPlan({
      fileId: "1",
      sourcePath: join("D:", "src", "a.txt"),
      classification: classification("C:\\Users\\evil"),
      workspaceRoot,
      now: new Date("2026-01-01T00:00:00Z")
    });

    assertInsideWorkspace(plan.targetPath);
  });
});

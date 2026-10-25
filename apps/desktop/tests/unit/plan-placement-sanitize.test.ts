import { isAbsolute, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { buildPlacementPlan, sanitizePathSegment } from "../../core/usecases/plan-placement.js";

const sanitizePathSegmentWithDefault = (value: string): string => sanitizePathSegment(value, "默认项目");
import type { Classification } from "../../shared/types/workflow.js";

const classification = (project: string): Classification => ({
  purpose: "Documents",
  project,
  confidence: 0.9,
  reasons: []
});

describe("sanitizePathSegment", () => {
  it("strips path separators and Windows-illegal characters", () => {
    expect(sanitizePathSegmentWithDefault("..\\..\\Startup")).not.toMatch(/[\\/:*?"<>|]/);
    expect(sanitizePathSegmentWithDefault("a/b/c")).not.toContain("/");
  });

  it("neutralizes traversal-only segments and Windows reserved names", () => {
    expect(sanitizePathSegmentWithDefault("..")).toBe("默认项目");
    expect(sanitizePathSegmentWithDefault("CON")).toBe("默认项目");
  });

  it("falls back to a safe default for empty results", () => {
    expect(sanitizePathSegmentWithDefault("///")).toBe("默认项目");
    expect(sanitizePathSegmentWithDefault(" . ")).toBe("默认项目");
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

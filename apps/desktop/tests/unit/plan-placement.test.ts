import { describe, expect, it } from "vitest";

import { buildPlacementPlan } from "../../core/usecases/plan-placement.js";

describe("plan-placement", () => {
  it("adds time bucket for Media and appends timestamp", () => {
    const plan = buildPlacementPlan({
      fileId: "file-1",
      sourcePath: "C:/in/pic.jpg",
      classification: {
        purpose: "Media",
        project: "旅行",
        confidence: 0.9,
        reasons: ["test"]
      },
      workspaceRoot: "D:/target",
      now: new Date(2026, 1, 12, 10, 11, 12)
    });

    const normalizedPath = plan.targetPath.replaceAll("\\", "/");

    expect(normalizedPath).toContain("D:/target");
    expect(normalizedPath).toContain("Media");
    expect(normalizedPath).toContain("2026");
    expect(normalizedPath).toContain("02");
    expect(normalizedPath.endsWith("pic-20260212101112.jpg")).toBe(true);
  });
});

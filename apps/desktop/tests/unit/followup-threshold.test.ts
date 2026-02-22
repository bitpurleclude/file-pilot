import { describe, expect, it } from "vitest";

import { confidenceBandOf, shouldAskFollowUp } from "../../core/usecases/classify-files.js";

describe("followup-threshold", () => {
  it("treats 0.60 and 0.85 boundaries correctly", () => {
    expect(confidenceBandOf(0.59)).toBe("low");
    expect(confidenceBandOf(0.6)).toBe("medium");
    expect(confidenceBandOf(0.84)).toBe("medium");
    expect(confidenceBandOf(0.85)).toBe("high");
  });

  it("asks followup only under 0.60", () => {
    expect(shouldAskFollowUp({
      purpose: "Documents",
      project: "p",
      confidence: 0.59,
      reasons: []
    })).toBe(true);

    expect(shouldAskFollowUp({
      purpose: "Documents",
      project: "p",
      confidence: 0.6,
      reasons: []
    })).toBe(false);
  });
});


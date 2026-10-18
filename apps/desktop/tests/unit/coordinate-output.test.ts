import { describe, expect, it } from "vitest";

import {
  isCoordinateInList,
  parseCoordinateClaim,
  parseNewProposal,
  validateProjectOutput
} from "../../infra/llm/coordinate-output.js";
import { parseCoordinateClaim as resolveParseCoordinateClaim } from "../../core/usecases/coordinate-resolution.js";
import { LLM_CONFIG } from "../../shared/config/llm.config.js";
import type { CoordinateOption } from "../../shared/types/registry.js";

const coordinates: CoordinateOption[] = [
  { areaNumber: 30, areaName: "考公", projectNumber: 1, projectName: "行测" },
  { areaNumber: 30, areaName: "考公", projectNumber: 2, projectName: "申论" },
  { areaNumber: 40, areaName: "Dev", projectNumber: 3, projectName: "Tools" }
];

describe("parseCoordinateClaim", () => {
  it("parses a canonical coordinate claim", () => {
    expect(parseCoordinateClaim("30-考公/1-行测")).toEqual({
      areaNumber: 30,
      areaName: "考公",
      projectNumber: 1,
      projectName: "行测"
    });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseCoordinateClaim("  30-考公/1-行测 \n")).toEqual({
      areaNumber: 30,
      areaName: "考公",
      projectNumber: 1,
      projectName: "行测"
    });
  });

  it("parses latin names without case folding", () => {
    expect(parseCoordinateClaim("40-Dev/3-Tools")).toEqual({
      areaNumber: 40,
      areaName: "Dev",
      projectNumber: 3,
      projectName: "Tools"
    });
    expect(parseCoordinateClaim("40-dev/3-tools")).toEqual({
      areaNumber: 40,
      areaName: "dev",
      projectNumber: 3,
      projectName: "tools"
    });
  });

  it("returns null for non-coordinate strings", () => {
    expect(parseCoordinateClaim("")).toBeNull();
    expect(parseCoordinateClaim("30-考公")).toBeNull();
    expect(parseCoordinateClaim("考公-30/1-行测")).toBeNull();
    expect(parseCoordinateClaim("30-考公/行测")).toBeNull();
    expect(parseCoordinateClaim("30-考公/1-行测/extra")).toBeNull();
    expect(parseCoordinateClaim("NEW:30-考公/1-行测")).toBeNull();
    expect(parseCoordinateClaim("默认项目")).toBeNull();
  });

  it("agrees with the placement resolver on every accepted or rejected shape", () => {
    const samples = [
      "30-考公/1-行测",
      " 10-开发 / 2-前端-基础 ",
      "30-考公/1-行测/extra",
      "30-考公",
      "考公-30/1-行测",
      "30-考公/行测",
      "NEW:30-考公/1-行测",
      ""
    ];

    for (const sample of samples) {
      expect(parseCoordinateClaim(sample)).toEqual(resolveParseCoordinateClaim(sample));
    }
  });
});

describe("parseNewProposal", () => {
  it("parses a canonical NEW proposal", () => {
    expect(parseNewProposal("NEW:考试资料")).toBe("考试资料");
  });

  it("cleans surrounding and internal whitespace", () => {
    expect(parseNewProposal(" NEW: 考试 资料 ")).toBe("考试 资料");
    expect(parseNewProposal("NEW:\t多  空格\n名称")).toBe("多 空格 名称");
  });

  it("tolerates lowercase prefix variants", () => {
    expect(parseNewProposal("new:调试工具")).toBe("调试工具");
    expect(parseNewProposal("New:Docs")).toBe("Docs");
  });

  it("returns null for non-NEW strings and empty names", () => {
    expect(parseNewProposal("NEW:")).toBeNull();
    expect(parseNewProposal("NEW:   ")).toBeNull();
    expect(parseNewProposal("NEW")).toBeNull();
    expect(parseNewProposal("NEWX:名称")).toBeNull();
    expect(parseNewProposal("30-考公/1-行测")).toBeNull();
    expect(parseNewProposal("")).toBeNull();
  });

  it("uses the shared NEW prefix constant", () => {
    expect(parseNewProposal(`${LLM_CONFIG.newProjectPrefix}约定前缀`)).toBe("约定前缀");
  });
});

describe("isCoordinateInList", () => {
  it("matches only when numbers and names all match exactly", () => {
    expect(isCoordinateInList(
      { areaNumber: 30, areaName: "考公", projectNumber: 1, projectName: "行测" },
      coordinates
    )).toBe(true);
  });

  it("rejects wrong name with right numbers", () => {
    expect(isCoordinateInList(
      { areaNumber: 30, areaName: "考公", projectNumber: 1, projectName: "行测 " },
      coordinates
    )).toBe(false);
    expect(isCoordinateInList(
      { areaNumber: 40, areaName: "dev", projectNumber: 3, projectName: "Tools" },
      coordinates
    )).toBe(false);
  });

  it("rejects wrong numbers with right names", () => {
    expect(isCoordinateInList(
      { areaNumber: 30, areaName: "考公", projectNumber: 9, projectName: "行测" },
      coordinates
    )).toBe(false);
  });

  it("rejects when the list is empty", () => {
    expect(isCoordinateInList(
      { areaNumber: 30, areaName: "考公", projectNumber: 1, projectName: "行测" },
      []
    )).toBe(false);
  });
});

describe("validateProjectOutput", () => {
  it("accepts a coordinate claim that hits the list", () => {
    expect(validateProjectOutput("30-考公/2-申论", coordinates)).toEqual({
      kind: "coordinate",
      areaNumber: 30,
      areaName: "考公",
      projectNumber: 2,
      projectName: "申论"
    });
  });

  it("accepts whitespace-wrapped coordinate claims", () => {
    expect(validateProjectOutput(" 30-考公/1-行测 ", coordinates)).toEqual({
      kind: "coordinate",
      areaNumber: 30,
      areaName: "考公",
      projectNumber: 1,
      projectName: "行测"
    });
  });

  it("rejects a coordinate-shaped string missing from the list", () => {
    expect(validateProjectOutput("50-新域/1-未登记", coordinates)).toEqual({ kind: "invalid" });
    expect(validateProjectOutput("30-考公/1-申论", coordinates)).toEqual({ kind: "invalid" });
  });

  it("accepts NEW proposals with cleaned names", () => {
    expect(validateProjectOutput("NEW:考试资料", coordinates)).toEqual({ kind: "new", name: "考试资料" });
    expect(validateProjectOutput("new: 调试 工具 ", coordinates)).toEqual({ kind: "new", name: "调试 工具" });
  });

  it("treats free-form project names as invalid", () => {
    expect(validateProjectOutput("默认项目", coordinates)).toEqual({ kind: "invalid" });
    expect(validateProjectOutput("StubProject", coordinates)).toEqual({ kind: "invalid" });
    expect(validateProjectOutput("", coordinates)).toEqual({ kind: "invalid" });
  });

  it("keeps NEW detection ahead of coordinate parsing", () => {
    expect(validateProjectOutput("NEW:30-考公/1-行测", coordinates)).toEqual({
      kind: "new",
      name: "30-考公/1-行测"
    });
  });

  it("accepts only NEW proposals against an empty list", () => {
    expect(validateProjectOutput("NEW:全新项目", [])).toEqual({ kind: "new", name: "全新项目" });
    expect(validateProjectOutput("30-考公/1-行测", [])).toEqual({ kind: "invalid" });
  });
});

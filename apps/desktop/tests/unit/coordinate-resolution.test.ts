import { describe, expect, it } from "vitest";

import {
  buildCoordinatedTarget,
  parseCoordinateClaim,
  resolveClaim,
  resolveProjectClaim,
  stripNewProjectPrefix
} from "../../core/usecases/coordinate-resolution.js";
import type { CoordinateClaim } from "../../core/usecases/coordinate-resolution.js";
import type { RegistryCoordinate } from "../../shared/types/registry.js";

const buildCoordinate = (overrides: Partial<RegistryCoordinate>): RegistryCoordinate => ({
  areaNumber: 30,
  areaName: "考公",
  projectNumber: 1,
  projectName: "行测",
  areaId: "area-30",
  projectId: "project-30-1",
  ...overrides
});

const registry: RegistryCoordinate[] = [
  buildCoordinate({}),
  buildCoordinate({
    areaNumber: 10,
    areaName: "开发",
    projectNumber: 2,
    projectName: "前端",
    areaId: "area-10",
    projectId: "project-10-2"
  })
];

const claimOf = (value: string): CoordinateClaim => {
  const claim = parseCoordinateClaim(value);
  if (claim === null) {
    throw new Error(`unexpected unparsable claim: ${value}`);
  }

  return claim;
};

describe("parseCoordinateClaim", () => {
  it("parses the canonical area/project coordinate string", () => {
    expect(parseCoordinateClaim("30-考公/1-行测")).toEqual({
      areaNumber: 30,
      areaName: "考公",
      projectNumber: 1,
      projectName: "行测"
    });
  });

  it("tolerates surrounding whitespace and names containing dashes", () => {
    expect(parseCoordinateClaim(" 10-开发 / 2-前端-基础 ")).toEqual({
      areaNumber: 10,
      areaName: "开发",
      projectNumber: 2,
      projectName: "前端-基础"
    });
  });

  it("rejects values without exactly two segments", () => {
    expect(parseCoordinateClaim("30-考公")).toBeNull();
    expect(parseCoordinateClaim("30-考公/1-行测/extra")).toBeNull();
    expect(parseCoordinateClaim("")).toBeNull();
    expect(parseCoordinateClaim("自由项目")).toBeNull();
  });

  it("rejects segments missing the number-name separator or numeric part", () => {
    expect(parseCoordinateClaim("考公/1-行测")).toBeNull();
    expect(parseCoordinateClaim("30-考公/行测")).toBeNull();
    expect(parseCoordinateClaim("-考公/1-行测")).toBeNull();
    expect(parseCoordinateClaim("30-考公/1-")).toBeNull();
    expect(parseCoordinateClaim("3o-考公/1-行测")).toBeNull();
    expect(parseCoordinateClaim("30-考公/1.5-行测")).toBeNull();
  });
});

describe("resolveClaim", () => {
  it("matches only when numbers and names all hit", () => {
    expect(resolveClaim(claimOf("30-考公/1-行测"), registry)).toEqual(registry[0]);
    expect(resolveClaim(claimOf("10-开发/2-前端"), registry)).toEqual(registry[1]);
  });

  it("misses when the number is right but the name is wrong", () => {
    expect(resolveClaim(claimOf("30-公考/1-行测"), registry)).toBeNull();
    expect(resolveClaim(claimOf("30-考公/1-申论"), registry)).toBeNull();
  });

  it("misses when the name is right but the number is wrong", () => {
    expect(resolveClaim(claimOf("31-考公/1-行测"), registry)).toBeNull();
    expect(resolveClaim(claimOf("30-考公/2-行测"), registry)).toBeNull();
  });

  it("misses when both sides are wrong", () => {
    expect(resolveClaim(claimOf("20-读书/5-英语"), registry)).toBeNull();
  });

  it("misses against an empty registry", () => {
    expect(resolveClaim(claimOf("30-考公/1-行测"), [])).toBeNull();
  });
});

describe("stripNewProjectPrefix", () => {
  it("extracts the proposed name and trims whitespace", () => {
    expect(stripNewProjectPrefix("NEW:行测冲刺")).toBe("行测冲刺");
    expect(stripNewProjectPrefix("NEW: 冲刺计划 ")).toBe("冲刺计划");
  });

  it("returns null for non-prefixed or empty proposals", () => {
    expect(stripNewProjectPrefix("30-考公/1-行测")).toBeNull();
    expect(stripNewProjectPrefix("NEW:")).toBeNull();
    expect(stripNewProjectPrefix("NEW:   ")).toBeNull();
  });
});

describe("buildCoordinatedTarget", () => {
  it("builds <NN>-<area>/<x>-<project>/<filename>", () => {
    const target = buildCoordinatedTarget(registry[0] ?? buildCoordinate({}), "笔记.pdf");
    expect(target.replaceAll("\\", "/")).toBe("30-考公/1-行测/笔记.pdf");
  });
});

describe("resolveProjectClaim", () => {
  it("resolves a registry-hit coordinate claim to the coordinated track", () => {
    const resolution = resolveProjectClaim("30-考公/1-行测", registry);
    expect(resolution).toEqual({ kind: "coordinated", coordinate: registry[0] });
  });

  it("resolves a NEW: claim to the new-project track", () => {
    expect(resolveProjectClaim("NEW:行测冲刺", registry)).toEqual({
      kind: "new-project",
      proposedProject: "行测冲刺"
    });
  });

  it("keeps NEW: priority even when the payload looks like a coordinate", () => {
    expect(resolveProjectClaim("NEW:30-考公/1-行测", registry)).toEqual({
      kind: "new-project",
      proposedProject: "30-考公/1-行测"
    });
  });

  it("falls back to legacy for free strings", () => {
    expect(resolveProjectClaim("默认项目", registry)).toEqual({ kind: "legacy" });
  });

  it("falls back to legacy for coordinate-shaped strings missing from the registry", () => {
    expect(resolveProjectClaim("30-考公/2-申论", registry)).toEqual({ kind: "legacy" });
    expect(resolveProjectClaim("40-读书/1-英语", registry)).toEqual({ kind: "legacy" });
  });

  it("falls back to legacy when no coordinates are provided", () => {
    expect(resolveProjectClaim("30-考公/1-行测", [])).toEqual({ kind: "legacy" });
  });
});

// Coordinate resolution pure logic (governance stage 1, docs/product/governance-design.md §1/§4).
// Turns a classification "project" claim string into either a registry coordinate hit,
// a NEW: proposal, or a legacy disposition. Pure functions only — no IO.

import { join } from "node:path";

import { sanitizePathSegment } from "./path-safety.js";
import type { CoordinateOption } from "../../shared/types/registry.js";

export const NEW_PROJECT_PREFIX = "NEW:";

const AREA_PROJECT_SEPARATOR = "/";
const NUMBER_NAME_SEPARATOR = "-";
const NEW_PROJECT_PREFIX_UPPER = NEW_PROJECT_PREFIX.toUpperCase();

/** A claimed coordinate `"30-考公/1-行测"` without registry identity. */
export interface CoordinateClaim {
  areaNumber: number;
  areaName: string;
  projectNumber: number;
  projectName: string;
}

export type CoordinateClaimResolution =
  | { kind: "coordinated"; coordinate: CoordinateOption }
  | { kind: "new-project"; proposedProject: string }
  | { kind: "legacy" };

/** Extracts `<name>` from a `NEW:<name>` claim; null when the value is not a NEW: claim. */
export const stripNewProjectPrefix = (value: string): string | null => {
  // Case-insensitive on purpose: the LLM output validator (coordinate-output)
  // accepts `new:`/`New:` variants, so both layers must agree.
  if (!value.toUpperCase().startsWith(NEW_PROJECT_PREFIX_UPPER)) {
    return null;
  }

  const proposed = value.slice(NEW_PROJECT_PREFIX.length).trim();
  return proposed.length === 0 ? null : proposed;
};

const parseNumberNameSegment = (segment: string): { number: number; name: string } | null => {
  const separatorIndex = segment.indexOf(NUMBER_NAME_SEPARATOR);
  if (separatorIndex <= 0) {
    return null;
  }

  const numberText = segment.slice(0, separatorIndex).trim();
  const name = segment.slice(separatorIndex + NUMBER_NAME_SEPARATOR.length).trim();
  if (!/^\d+$/.test(numberText) || name.length === 0) {
    return null;
  }

  return { number: Number.parseInt(numberText, 10), name };
};

/** Parses `"30-考公/1-行测"`; returns null for any other shape. */
export const parseCoordinateClaim = (value: string): CoordinateClaim | null => {
  const segments = value.split(AREA_PROJECT_SEPARATOR);
  if (segments.length !== 2) {
    return null;
  }

  const areaSegment = parseNumberNameSegment((segments[0] ?? "").trim());
  const projectSegment = parseNumberNameSegment((segments[1] ?? "").trim());
  if (areaSegment === null || projectSegment === null) {
    return null;
  }

  return {
    areaNumber: areaSegment.number,
    areaName: areaSegment.name,
    projectNumber: projectSegment.number,
    projectName: projectSegment.name
  };
};

/**
 * Exact registry match: area/project numbers AND names must all hit.
 * Generic so callers may pass either CoordinateOption[] or the richer RegistryCoordinate[].
 */
export const resolveClaim = <T extends CoordinateOption>(
  claim: CoordinateClaim,
  coordinates: ReadonlyArray<T>
): T | null => {
  return (
    coordinates.find(
      (coordinate) =>
        coordinate.areaNumber === claim.areaNumber &&
        coordinate.areaName === claim.areaName &&
        coordinate.projectNumber === claim.projectNumber &&
        coordinate.projectName === claim.projectName
    ) ?? null
  );
};

/** Relative coordinated target `<NN>-<area>/<x>-<project>/<filename>` under the workspace root. */
export const buildCoordinatedTarget = (
  coordinate: CoordinateOption,
  originalFilename: string
): string => {
  // Registry names arrive through free user input; apply the same segment
  // sanitizer as the legacy track so a hostile or pasted name can never put
  // illegal characters or extra directory levels into the target path.
  return join(
    `${coordinate.areaNumber}-${sanitizePathSegment(coordinate.areaName, "area")}`,
    `${coordinate.projectNumber}-${sanitizePathSegment(coordinate.projectName, "project")}`,
    originalFilename
  );
};

/**
 * Dual-track disposition for a classification project string:
 * - coordinate string hitting the active registry -> "coordinated";
 * - `NEW:<name>` -> "new-project" (proposal for the domain-creation wizard, legacy placement);
 * - anything else (free string, off-list coordinate, legacy data) -> "legacy" placement.
 */
export const resolveProjectClaim = (
  project: string,
  coordinates: ReadonlyArray<CoordinateOption>
): CoordinateClaimResolution => {
  const proposedProject = stripNewProjectPrefix(project);
  if (proposedProject !== null) {
    return { kind: "new-project", proposedProject };
  }

  const claim = parseCoordinateClaim(project);
  if (claim !== null) {
    const coordinate = resolveClaim(claim, coordinates);
    if (coordinate !== null) {
      return { kind: "coordinated", coordinate };
    }
  }

  return { kind: "legacy" };
};

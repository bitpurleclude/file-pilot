// Coordinate resolution pure logic (governance stage 1, docs/product/governance-design.md §1/§4).
// Turns a classification "project" claim string into either a registry coordinate hit,
// a NEW: proposal, or a legacy disposition. Pure functions only — no IO.

import { join } from "node:path";

import { sanitizePathSegment } from "./path-safety.js";
import type { CoordinateOption } from "../../shared/types/registry.js";
import {
  parseCoordinateClaim,
  type CoordinateClaim
} from "../../shared/validation/registry.js";

export const NEW_PROJECT_PREFIX = "NEW:";

const NEW_PROJECT_PREFIX_UPPER = NEW_PROJECT_PREFIX.toUpperCase();

export { parseCoordinateClaim };
export type { CoordinateClaim };

export type CoordinateClaimResolution<T extends CoordinateOption = CoordinateOption> =
  | { kind: "coordinated"; coordinate: T }
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
export const resolveProjectClaim = <T extends CoordinateOption>(
  project: string,
  coordinates: ReadonlyArray<T>
): CoordinateClaimResolution<T> => {
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

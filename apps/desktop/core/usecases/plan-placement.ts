import { basename, dirname, join } from "node:path";

import { sanitizePathSegment } from "./path-safety.js";
import { buildCoordinatedTarget } from "./coordinate-resolution.js";
import { EXECUTOR_CONFIG } from "../../shared/config/executor.config.js";
import type { CoordinateOption, RegistryCoordinate } from "../../shared/types/registry.js";
import type { Classification, PlacementPlan } from "../../shared/types/workflow.js";

export { sanitizePathSegment };

const useTimeBucketPurposes = new Set(["Media", "Archives", "Study"]);

const toTimeBucket = (date: Date): string => {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  return `${year}/${month}`;
};

export const timestampSuffix = (date: Date): string => {
  return [
    date.getFullYear().toString().padStart(4, "0"),
    (date.getMonth() + 1).toString().padStart(2, "0"),
    date.getDate().toString().padStart(2, "0"),
    date.getHours().toString().padStart(2, "0"),
    date.getMinutes().toString().padStart(2, "0"),
    date.getSeconds().toString().padStart(2, "0")
  ].join("");
};

const buildTargetDirectory = (purpose: string, project: string, now: Date): string => {
  const base = join(purpose, project);
  if (!useTimeBucketPurposes.has(purpose)) {
    return base;
  }

  return join(base, toTimeBucket(now));
};

export const buildPlacementPlan = (params: {
  fileId: string;
  sourcePath: string;
  classification: Classification;
  workspaceRoot: string;
  now: Date;
  /**
   * When a registry coordinate is provided, the target becomes
   * `<workspaceRoot>/<NN>-<area>/<x>-<project>/<filename>` (no time bucket —
   * the coordinate itself is the grouping, governance §4). Without it the
   * legacy purpose/project[/time-bucket] layout is kept and the plan is
   * marked `uncoordinated: true`. Omitted/legacy callers behave as before.
   */
  coordinate?: RegistryCoordinate | CoordinateOption | null;
}): PlacementPlan => {
  const coordinate = params.coordinate ?? null;
  const originalFilename = basename(params.sourcePath);
  const targetPath =
    coordinate === null
      ? join(
          params.workspaceRoot,
          buildTargetDirectory(
            sanitizePathSegment(params.classification.purpose, EXECUTOR_CONFIG.fallbackPurposeName),
            sanitizePathSegment(params.classification.project, EXECUTOR_CONFIG.fallbackProjectName),
            params.now
          ),
          originalFilename
        )
      : join(params.workspaceRoot, buildCoordinatedTarget(coordinate, originalFilename));

  const registryIds = coordinate as { areaId?: string; projectId?: string } | null;
  return {
    fileId: params.fileId,
    sourcePath: params.sourcePath,
    targetPath,
    action: "move",
    conflictPolicy: EXECUTOR_CONFIG.defaultConflictPolicy,
    ...(coordinate === null || registryIds === null
      ? { uncoordinated: true }
      : {
          coordinate: {
            areaNumber: coordinate.areaNumber,
            areaName: coordinate.areaName,
            projectNumber: coordinate.projectNumber,
            projectName: coordinate.projectName,
            ...(registryIds.areaId === undefined ? {} : { areaId: registryIds.areaId }),
            ...(registryIds.projectId === undefined ? {} : { projectId: registryIds.projectId })
          },
          uncoordinated: false
        })
  };
};

export const getOriginalDirectory = (sourcePath: string): string => dirname(sourcePath);

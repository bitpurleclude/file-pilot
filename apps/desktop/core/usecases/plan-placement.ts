import { basename, dirname, join } from "node:path";

import { sanitizePathSegment } from "./path-safety.js";
import { EXECUTOR_CONFIG } from "../../shared/config/executor.config.js";
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
}): PlacementPlan => {
  const project = sanitizePathSegment(params.classification.project, EXECUTOR_CONFIG.fallbackProjectName);
  const purpose = sanitizePathSegment(params.classification.purpose, EXECUTOR_CONFIG.fallbackPurposeName);
  const targetDirectory = join(
    params.workspaceRoot,
    buildTargetDirectory(purpose, project, params.now)
  );
  const targetPath = join(targetDirectory, basename(params.sourcePath));

  return {
    fileId: params.fileId,
    sourcePath: params.sourcePath,
    targetPath,
    action: "move",
    conflictPolicy: EXECUTOR_CONFIG.defaultConflictPolicy
  };
};

export const getOriginalDirectory = (sourcePath: string): string => dirname(sourcePath);

import { basename, dirname, extname, join } from "node:path";

import { EXECUTOR_CONFIG } from "../../shared/config/executor.config.js";
import type { Classification, PlacementPlan } from "../../shared/types/workflow.js";

const useTimeBucketPurposes = new Set(["Media", "Archives", "Study"]);

const toTimeBucket = (date: Date): string => {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  return `${year}/${month}`;
};

const buildTargetDirectory = (classification: Classification, now: Date): string => {
  const base = join(classification.purpose, classification.project);
  if (!useTimeBucketPurposes.has(classification.purpose)) {
    return base;
  }

  return join(base, toTimeBucket(now));
};

const withTimestampOnName = (sourcePath: string, now: Date): string => {
  const name = basename(sourcePath, extname(sourcePath));
  const ext = extname(sourcePath);
  const stamp = [
    now.getFullYear().toString().padStart(4, "0"),
    (now.getMonth() + 1).toString().padStart(2, "0"),
    now.getDate().toString().padStart(2, "0"),
    now.getHours().toString().padStart(2, "0"),
    now.getMinutes().toString().padStart(2, "0"),
    now.getSeconds().toString().padStart(2, "0")
  ].join("");

  return `${name}-${stamp}${ext}`;
};

export const buildPlacementPlan = (params: {
  fileId: string;
  sourcePath: string;
  classification: Classification;
  workspaceRoot: string;
  now: Date;
}): PlacementPlan => {
  const targetDirectory = join(params.workspaceRoot, buildTargetDirectory(params.classification, params.now));
  const finalName = withTimestampOnName(params.sourcePath, params.now);
  const targetPath = join(targetDirectory, finalName);

  return {
    fileId: params.fileId,
    sourcePath: params.sourcePath,
    targetPath,
    action: "move",
    conflictPolicy: EXECUTOR_CONFIG.defaultConflictPolicy
  };
};

export const getOriginalDirectory = (sourcePath: string): string => dirname(sourcePath);

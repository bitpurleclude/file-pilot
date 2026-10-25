import { access, copyFile, mkdir, rename, rm, unlink } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import type { ExecutionResult, PlacementPlan } from "../../shared/types/workflow.js";

export interface ExecutorOptions {
  dryRun: boolean;
}

const MAX_CONFLICT_ATTEMPTS = 99;

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const isCrossDeviceError = (error: unknown): boolean => {
  return typeof error === "object"
    && error !== null
    && (error as NodeJS.ErrnoException).code === "EXDEV";
};

const toErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const withSuffix = (path: string, attempt: number): string => {
  const ext = extname(path);
  const base = basename(path, ext);
  return join(dirname(path), `${base}-${attempt}${ext}`);
};

/**
 * Resolve the final target for a plan under its conflict policy.
 * Returns null when the policy says "skip" and the target is taken,
 * or when no free rename slot could be found.
 */
const resolveConflictTarget = async (plan: PlacementPlan): Promise<string | null> => {
  if (!(await fileExists(plan.targetPath))) {
    return plan.targetPath;
  }

  if (plan.conflictPolicy === "overwrite") {
    return plan.targetPath;
  }

  if (plan.conflictPolicy === "skip") {
    return null;
  }

  for (let attempt = 1; attempt <= MAX_CONFLICT_ATTEMPTS; attempt += 1) {
    const candidate = withSuffix(plan.targetPath, attempt);
    if (!(await fileExists(candidate))) {
      return candidate;
    }
  }

  return null;
};

/** Move with cross-device fallback (rename fails with EXDEV across volumes). */
const moveFile = async (sourcePath: string, targetPath: string): Promise<void> => {
  try {
    await rename(sourcePath, targetPath);
  } catch (error) {
    if (!isCrossDeviceError(error)) {
      throw error;
    }

    await copyFile(sourcePath, targetPath);
    await unlink(sourcePath);
  }
};

const executeOne = async (plan: PlacementPlan): Promise<ExecutionResult> => {
  try {
    await mkdir(dirname(plan.targetPath), { recursive: true });
    const target = await resolveConflictTarget(plan);
    if (target === null) {
      return {
        plan,
        executed: false,
        rollbackable: false,
        reason: plan.conflictPolicy === "skip" ? "conflict-skip" : "conflict-no-slot"
      };
    }

    if (plan.conflictPolicy === "overwrite" && target === plan.targetPath) {
      // Windows rename refuses to replace an existing file even with the same
      // policy; clearing first keeps "overwrite" meaningful on both platforms.
      await rm(plan.targetPath, { force: true });
    }

    if (plan.action === "copy") {
      await copyFile(plan.sourcePath, target);
      // Copies keep rollbackable=true so rollback can record the explicit
      // "copy-action rollback skipped" reason (original data shape).
      return {
        plan,
        executed: true,
        rollbackable: true,
        ...(target === plan.targetPath ? {} : { resolvedTargetPath: target })
      };
    }

    await moveFile(plan.sourcePath, target);
    return {
      plan,
      executed: true,
      rollbackable: true,
      ...(target === plan.targetPath ? {} : { resolvedTargetPath: target })
    };
  } catch (error) {
    // Per-item failure never aborts the batch: already-moved files must stay
    // recorded as executed so the session stays rollbackable.
    return {
      plan,
      executed: false,
      rollbackable: false,
      reason: `execute-failed:${toErrorMessage(error)}`
    };
  }
};

export const executePlans = async (
  plans: PlacementPlan[],
  options: ExecutorOptions
): Promise<ExecutionResult[]> => {
  if (options.dryRun) {
    return plans.map((plan) => ({
      plan,
      executed: false,
      rollbackable: false,
      reason: "dry-run"
    }));
  }

  const results: ExecutionResult[] = [];
  for (const plan of plans) {
    results.push(await executeOne(plan));
  }

  return results;
};

export const rollbackExecutions = async (results: ExecutionResult[]): Promise<ExecutionResult[]> => {
  const rollbackResults: ExecutionResult[] = [];
  for (const result of results) {
    if (!result.executed || !result.rollbackable) {
      rollbackResults.push(result);
      continue;
    }

    if (result.plan.action === "copy") {
      rollbackResults.push({
        ...result,
        reason: "copy-action rollback skipped"
      });
      continue;
    }

    const actualTarget = result.resolvedTargetPath ?? result.plan.targetPath;
    try {
      await mkdir(dirname(result.plan.sourcePath), { recursive: true });

      let restorePath = result.plan.sourcePath;
      let conflictRestored = false;
      if (await fileExists(restorePath)) {
        conflictRestored = true;
        for (let attempt = 1; attempt <= MAX_CONFLICT_ATTEMPTS; attempt += 1) {
          const candidate = withSuffix(restorePath, attempt);
          if (!(await fileExists(candidate))) {
            restorePath = candidate;
            break;
          }
        }
      }

      await moveFile(actualTarget, restorePath);
      rollbackResults.push({
        ...result,
        executed: false,
        rollbackable: false,
        reason: conflictRestored ? "rolled-back-conflict" : "rolled-back"
      });
    } catch (error) {
      // Stays executed/rollbackable so the user can retry the rollback.
      rollbackResults.push({
        ...result,
        reason: `rollback-failed:${toErrorMessage(error)}`
      });
    }
  }

  return rollbackResults;
};

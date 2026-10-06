import { constants } from "node:fs";
import { access, copyFile, mkdir, rename, unlink } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import { timestampSuffix } from "./plan-placement.js";
import { EXECUTOR_CONFIG } from "../../shared/config/executor.config.js";
import type { ExecutionResult, PlacementPlan } from "../../shared/types/workflow.js";

export interface ExecutorOptions {
  dryRun: boolean;
}

// Encoded in ExecutionResult.reason so rollback can pick the matching strategy
// without changing the shared ExecutionResult type.
const MOVE_VIA_COPY_REASON = "moved-via-copy";

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const toMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : "unknown error";
};

const isExdevError = (error: unknown): boolean => {
  if (error instanceof Error) {
    return (error as NodeJS.ErrnoException).code === "EXDEV";
  }
  return false;
};

const withRenamedTarget = async (plan: PlacementPlan): Promise<PlacementPlan | null> => {
  const targetName = basename(plan.targetPath);
  const extension = extname(targetName);
  const stem = basename(plan.targetPath, extension);
  const directory = dirname(plan.targetPath);

  for (let attempt = 0; attempt < EXECUTOR_CONFIG.conflictRenameMaxAttempts; attempt += 1) {
    // The timestamp has second precision, so later attempts add an index to
    // stay unique when two same-named files land in the same second.
    const attemptSuffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const candidate = join(directory, `${stem}-${timestampSuffix(new Date())}${attemptSuffix}${extension}`);
    if (!(await pathExists(candidate))) {
      return { ...plan, targetPath: candidate };
    }
  }

  return null;
};

const moveByCopyAndDelete = async (plan: PlacementPlan): Promise<void> => {
  await copyFile(plan.sourcePath, plan.targetPath);
  try {
    await unlink(plan.sourcePath);
  } catch {
    // Source removal failed after a successful copy: the data is safe at the
    // target and the session stays rollbackable (rollback copies back and
    // unlinks the target, which also cleans up the leftover source copy).
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
    try {
      let targetPath = plan.targetPath;

      if (await pathExists(plan.targetPath)) {
        if (plan.conflictPolicy === "rename") {
          const renamed = await withRenamedTarget(plan);
          if (renamed === null) {
            results.push({
              plan,
              executed: false,
              rollbackable: false,
              reason: "error:target-name-conflict"
            });
            continue;
          }
          targetPath = renamed.targetPath;
        } else if (plan.conflictPolicy === "overwrite") {
          await unlink(plan.targetPath);
        } else if (plan.conflictPolicy === "skip") {
          results.push({
            plan,
            executed: false,
            rollbackable: false,
            reason: "skipped:target-exists"
          });
          continue;
        } else {
          results.push({
            plan,
            executed: false,
            rollbackable: false,
            reason: `error:unsupported-conflict-policy:${plan.conflictPolicy}`
          });
          continue;
        }
      }

      await mkdir(dirname(targetPath), { recursive: true });
      const effectivePlan: PlacementPlan = { ...plan, targetPath };

      if (effectivePlan.action === "copy") {
        await copyFile(effectivePlan.sourcePath, effectivePlan.targetPath);
        results.push({
          plan: effectivePlan,
          executed: true,
          rollbackable: true,
          reason: "copied"
        });
        continue;
      }

      try {
        await rename(effectivePlan.sourcePath, effectivePlan.targetPath);
      } catch (error) {
        if (!isExdevError(error)) {
          throw error;
        }
        // Cross-device move: degrade to copy + delete so the plan still completes.
        await moveByCopyAndDelete(effectivePlan);
        results.push({
          plan: effectivePlan,
          executed: true,
          rollbackable: true,
          reason: MOVE_VIA_COPY_REASON
        });
        continue;
      }

      results.push({
        plan: effectivePlan,
        executed: true,
        rollbackable: true
      });
    } catch (error) {
      results.push({
        plan,
        executed: false,
        rollbackable: false,
        reason: `error:${toMessage(error)}`
      });
    }
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

    try {
      await mkdir(dirname(result.plan.sourcePath), { recursive: true });
      if (result.reason === MOVE_VIA_COPY_REASON) {
        // The move degraded to copy + delete: restore by copying back and
        // removing the target copy.
        await copyFile(result.plan.targetPath, result.plan.sourcePath);
        await unlink(result.plan.targetPath);
      } else {
        await rename(result.plan.targetPath, result.plan.sourcePath);
      }
      rollbackResults.push({
        ...result,
        executed: false,
        reason: "rolled-back"
      });
    } catch (error) {
      rollbackResults.push({
        ...result,
        executed: true,
        reason: `rollback-failed:${toMessage(error)}`
      });
    }
  }

  return rollbackResults;
};

import { copyFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";

import type { ExecutionResult, PlacementPlan } from "../../shared/types/workflow.js";

export interface ExecutorOptions {
  dryRun: boolean;
}

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
    await mkdir(dirname(plan.targetPath), { recursive: true });

    if (plan.action === "copy") {
      await copyFile(plan.sourcePath, plan.targetPath);
    } else {
      await rename(plan.sourcePath, plan.targetPath);
    }

    results.push({
      plan,
      executed: true,
      rollbackable: true
    });
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

    await mkdir(dirname(result.plan.sourcePath), { recursive: true });
    await rename(result.plan.targetPath, result.plan.sourcePath);
    rollbackResults.push({
      ...result,
      executed: false,
      reason: "rolled-back"
    });
  }

  return rollbackResults;
};

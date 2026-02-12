import type { AppSettings } from "../../shared/types/settings.js";
import type { Classification, PlacementPlan } from "../../shared/types/workflow.js";
import { analyzeFiles } from "./analyze-files.js";
import { classifyWithFallback, shouldAskFollowUp, type LlmClassifier } from "./classify-files.js";
import { executePlans, rollbackExecutions } from "./execute-and-rollback.js";
import { buildPlacementPlan } from "./plan-placement.js";
import { assertPathInWhitelist } from "./whitelist.js";

export interface ProcessSessionResult {
  classifications: Classification[];
  plans: PlacementPlan[];
  needFollowUp: boolean;
}

export const processSession = async (params: {
  filePaths: string[];
  settings: AppSettings;
  workspaceRoot: string;
  classifier: LlmClassifier;
  now: Date;
}): Promise<ProcessSessionResult> => {
  for (const path of params.filePaths) {
    assertPathInWhitelist(path, params.settings.whitelistDirectories);
  }

  const analyzed = await analyzeFiles(params.filePaths);
  const classifications: Classification[] = [];
  const plans: PlacementPlan[] = [];

  for (const result of analyzed) {
    const classification = await classifyWithFallback(params.classifier, result.item, result.summary);
    classifications.push(classification);
    plans.push(
      buildPlacementPlan({
        fileId: result.item.id,
        sourcePath: result.item.path,
        classification,
        workspaceRoot: params.workspaceRoot,
        now: params.now
      })
    );
  }

  return {
    classifications,
    plans,
    needFollowUp: classifications.some((item) => shouldAskFollowUp(item))
  };
};

export const applySession = async (plans: PlacementPlan[], dryRun: boolean) => {
  return executePlans(plans, { dryRun });
};

export const rollbackSession = async (executions: Awaited<ReturnType<typeof applySession>>) => {
  return rollbackExecutions(executions);
};

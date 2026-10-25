import type { ClassificationRule } from "../../shared/types/rules.js";
import type { AppSettings } from "../../shared/types/settings.js";
import type {
  Classification,
  ExecuteAction,
  FollowUpQuestion,
  PlacementPlan,
  ProcessedSessionItem
} from "../../shared/types/workflow.js";
import { analyzeFiles } from "./analyze-files.js";
import { classifyWithFallback, confidenceBandOf, shouldAskFollowUp, type LlmClassifier } from "./classify-files.js";
import { executePlans, rollbackExecutions } from "./execute-and-rollback.js";
import { buildPlacementPlan } from "./plan-placement.js";
import { selectBestMatchingRule } from "./rule-engine.js";
import { assertPathInWhitelist } from "./whitelist.js";

export interface ProcessSessionResult {
  items: ProcessedSessionItem[];
  classifications: Classification[];
  plans: PlacementPlan[];
  needsFollowUp: boolean;
  followUpQuestions: FollowUpQuestion[];
}

const toFollowUpQuestion = (item: ProcessedSessionItem): FollowUpQuestion => {
  return {
    fileId: item.item.id,
    question: item.followUpQuestion ?? `请补充“${item.item.name}”所属项目`
  };
};

export const processSession = async (params: {
  filePaths: string[];
  settings: AppSettings;
  workspaceRoot: string;
  classifier: LlmClassifier;
  rules: ClassificationRule[];
  now: Date;
}): Promise<ProcessSessionResult> => {
  for (const path of params.filePaths) {
    assertPathInWhitelist(path, params.settings.whitelistDirectories);
  }

  const analyzed = await analyzeFiles(params.filePaths);
  const items: ProcessedSessionItem[] = [];

  for (const result of analyzed) {
    const matched = selectBestMatchingRule(params.rules, {
      item: result.item,
      summary: result.summary
    });

    const classification = matched === null
      ? await classifyWithFallback(params.classifier, result.item, result.summary)
      : {
          purpose: matched.rule.purpose,
          project: matched.rule.project,
          confidence: matched.score,
          confidenceBand: confidenceBandOf(matched.score),
          reasons: [`matched-rule:${matched.rule.id}`],
          decisionSource: "rule" as const
        };

    const plan = buildPlacementPlan({
      fileId: result.item.id,
      sourcePath: result.item.path,
      classification,
      workspaceRoot: params.workspaceRoot,
      now: params.now
    });

    const needsFollowUp = shouldAskFollowUp(classification);
    items.push({
      item: result.item,
      summary: result.summary,
      classification: {
        ...classification,
        confidenceBand: confidenceBandOf(classification.confidence)
      },
      plan,
      needsFollowUp,
      ...(needsFollowUp ? { followUpQuestion: `请补充“${result.item.name}”所属项目` } : {}),
      decisionSource: classification.decisionSource ?? "local-fallback"
    });
  }

  const followUpQuestions = items.filter((item) => item.needsFollowUp).map((item) => toFollowUpQuestion(item));
  return {
    items,
    classifications: items.map((item) => item.classification),
    plans: items.map((item) => item.plan),
    needsFollowUp: followUpQuestions.length > 0,
    followUpQuestions
  };
};

export const applySession = async (
  plans: PlacementPlan[],
  dryRun: boolean,
  action?: ExecuteAction
) => {
  const actionAppliedPlans = action === undefined ? plans : plans.map((plan) => ({ ...plan, action }));
  return executePlans(actionAppliedPlans, { dryRun });
};

export const hasExecutionFailures = (results: Awaited<ReturnType<typeof applySession>>): boolean => {
  return results.some((result) => !result.executed && (result.reason?.startsWith("execute-failed") ?? false));
};

export const rollbackSession = async (executions: Awaited<ReturnType<typeof applySession>>) => {
  return rollbackExecutions(executions);
};


import type { CoordinateOption } from "../../shared/types/registry.js";
import type { ClassificationRule } from "../../shared/types/rules.js";
import type { AppSettings } from "../../shared/types/settings.js";
import type {
  Classification,
  ContentSummary,
  ExecuteAction,
  FileItem,
  FollowUpQuestion,
  PlacementPlan,
  ProcessedSessionItem
} from "../../shared/types/workflow.js";
import { AppError } from "../../shared/errors/app-error.js";
import { analyzeFiles } from "./analyze-files.js";
import { classifyWithFallback, confidenceBandOf, shouldAskFollowUp, type LlmClassifier } from "./classify-files.js";
import { resolveProjectClaim } from "./coordinate-resolution.js";
import { executePlans, rollbackExecutions } from "./execute-and-rollback.js";
import { assertPathInsideRoot } from "./path-safety.js";
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

export interface BatchLlmClassifier extends LlmClassifier {
  classifyMany?(
    inputs: Array<{ item: FileItem; summary: ContentSummary; coordinates?: CoordinateOption[] }>
  ): Promise<Array<Classification | null>>;
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
  /** Active registry coordinates (governance §4). Empty/omitted keeps legacy behavior. */
  coordinates?: CoordinateOption[];
  now: Date;
}): Promise<ProcessSessionResult> => {
  const registryCoordinates = params.coordinates ?? [];
  for (const path of params.filePaths) {
    assertPathInWhitelist(path, params.settings.whitelistDirectories);
  }

  const analyzed = await analyzeFiles(params.filePaths);

  const classifications: Array<Classification | null> = analyzed.map((result) => {
    const matched = selectBestMatchingRule(params.rules, {
      item: result.item,
      summary: result.summary
    });

    if (matched === null) {
      return null;
    }

    return {
      purpose: matched.rule.purpose,
      project: matched.rule.project,
      confidence: matched.score,
      confidenceBand: confidenceBandOf(matched.score),
      reasons: [`matched-rule:${matched.rule.id}`],
      decisionSource: "rule" as const
    };
  });

  const pending = analyzed
    .map((result, index) => ({ result, index }))
    .filter((entry) => classifications[entry.index] === null);

  const batchClassifier: BatchLlmClassifier = params.classifier;
  const classifyMany = typeof batchClassifier.classifyMany === "function"
    ? batchClassifier.classifyMany
    : undefined;

  if (classifyMany === undefined) {
    for (const entry of pending) {
      classifications[entry.index] = await classifyWithFallback(
        params.classifier,
        entry.result.item,
        entry.result.summary,
        registryCoordinates
      );
    }
  } else if (pending.length > 0) {
    const batchResults = await classifyMany(
      pending.map((entry) => ({
        item: entry.result.item,
        summary: entry.result.summary,
        coordinates: registryCoordinates
      }))
    );

    for (const [offset, entry] of pending.entries()) {
      const batchResult = batchResults[offset];
      classifications[entry.index] = batchResult ?? (
        await classifyWithFallback(params.classifier, entry.result.item, entry.result.summary, registryCoordinates)
      );
    }
  }

  const items: ProcessedSessionItem[] = [];

  for (const [index, result] of analyzed.entries()) {
    const classification = classifications[index];
    if (classification === null || classification === undefined) {
      throw new AppError("SYSTEM_UNKNOWN", `分类结果缺失: ${result.item.name}`, "SYSTEM");
    }

    // Dual-track placement (governance §4): a coordinate claim hitting the active
    // registry goes straight to its coordinate slot; a NEW: claim keeps the legacy
    // path (under the proposed name) and records proposedProject for the wizard;
    // everything else falls back to the legacy purpose/project[/time-bucket] layout.
    const resolution = resolveProjectClaim(classification.project, registryCoordinates);
    const planClassification: Classification =
      resolution.kind === "new-project"
        ? { ...classification, project: resolution.proposedProject }
        : classification;
    const effectiveClassification: Classification =
      resolution.kind === "new-project"
        ? { ...classification, proposedProject: resolution.proposedProject }
        : classification;

    const plan = buildPlacementPlan({
      fileId: result.item.id,
      sourcePath: result.item.path,
      classification: planClassification,
      workspaceRoot: params.workspaceRoot,
      now: params.now,
      ...(resolution.kind === "coordinated" ? { coordinate: resolution.coordinate } : { coordinate: null })
    });
    assertPathInsideRoot(plan.targetPath, params.workspaceRoot);

    const needsFollowUp = shouldAskFollowUp(effectiveClassification);
    items.push({
      item: result.item,
      summary: result.summary,
      classification: {
        ...effectiveClassification,
        confidenceBand: confidenceBandOf(effectiveClassification.confidence)
      },
      plan,
      needsFollowUp,
      ...(needsFollowUp ? { followUpQuestion: `请补充“${result.item.name}”所属项目` } : {}),
      decisionSource: effectiveClassification.decisionSource ?? "local-fallback"
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

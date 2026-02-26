import {
  applyRequestSchema,
  analyzeRequestSchema,
  rollbackRequestSchema,
  saveCorrectionsRequestSchema,
  submitFollowupRequestSchema
} from "../../../shared/ipc/contracts.js";
import { RuleFirstLlmClassifier } from "../../../infra/llm/rule-first-llm.js";
import { loadSettings } from "../../../infra/storage/settings-repository.js";
import { applySession, processSession, rollbackSession } from "../../../core/usecases/process-session.js";
import { buildPlacementPlan } from "../../../core/usecases/plan-placement.js";
import { createSession, updateSessionStatus, withExecutions } from "../../../core/usecases/session-manager.js";
import { openSqliteDatabase } from "../../../infra/storage/sqlite/db.js";
import {
  appendDecisionRecordsSqlite
} from "../../../infra/storage/sqlite/repositories/decisions-repository.js";
import {
  createRuleSqlite,
  listRulesSqlite
} from "../../../infra/storage/sqlite/repositories/rules-repository.js";
import {
  getSessionByIdSqlite,
  listSessionItemsSqlite,
  replaceSessionItemsSqlite,
  upsertSessionSqlite
} from "../../../infra/storage/sqlite/repositories/sessions-repository.js";
import { toIpcError, type IpcResult } from "../../../shared/errors/app-error.js";
import type { ClassificationRule } from "../../../shared/types/rules.js";
import type { ExecutionResult, ProcessedSessionItem } from "../../../shared/types/workflow.js";
import { confidenceBandOf } from "../../../core/usecases/classify-files.js";
import {
  type HandlerContext,
  type UnknownPayload,
  buildRuleFromItem,
  markRuleHits,
  safeWriteLog,
  settingsRootPath,
  sqlitePath,
  toDecisionRecords,
  traceId
} from "./shared.js";

const toFollowUpQuestions = (
  items: ProcessedSessionItem[]
): Array<{ fileId: string; question: string }> => {
  return items
    .filter((item) => item.needsFollowUp)
    .map((item) => ({
      fileId: item.item.id,
      question: item.followUpQuestion ?? `请补充“${item.item.name}”所属项目`
    }));
};

export const sessionHandlers = {
  analyze: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    const t = traceId();
    try {
      await safeWriteLog(context, {
        level: "info",
        category: "session",
        code: "SESSION_ANALYZE_START",
        message: "session analyze started",
        traceId: t
      });

      const req = analyzeRequestSchema.parse(payload);
      const db = openSqliteDatabase(sqlitePath(context));
      const settings = await loadSettings(settingsRootPath(context));
      const rules = listRulesSqlite(db, { includeDisabled: false });

      const session = updateSessionStatus(createSession({ itemIds: [], sessionId: req.sessionId }), "analyzing");
      const processed = await processSession({
        filePaths: req.filePaths,
        settings,
        workspaceRoot: context.workspaceRoot,
        classifier: new RuleFirstLlmClassifier(settings),
        rules,
        now: new Date()
      });

      const plannedExecutions: ExecutionResult[] = processed.plans.map((plan) => ({
        plan,
        executed: false,
        rollbackable: false,
        reason: "planned"
      }));

      const planned = withExecutions(
        updateSessionStatus(
          {
            ...session,
            itemIds: processed.items.map((item) => item.item.id)
          },
          "planned"
        ),
        plannedExecutions
      );

      upsertSessionSqlite(db, planned);
      replaceSessionItemsSqlite(
        db,
        processed.items.map((item) => ({
          sessionId: req.sessionId,
          data: item
        }))
      );
      appendDecisionRecordsSqlite(db, toDecisionRecords(req.sessionId, processed.items));
      markRuleHits(sqlitePath(context), processed.items);

      await safeWriteLog(context, {
        level: "info",
        category: "session",
        code: "SESSION_ANALYZE_DONE",
        message: "session analyze completed",
        traceId: t,
        sessionId: session.id,
        details: { plannedCount: plannedExecutions.length, needsFollowUp: processed.needsFollowUp }
      });

      return {
        ok: true,
        data: {
          sessionId: req.sessionId,
          ...processed
        }
      };
    } catch (error) {
      await safeWriteLog(context, {
        level: "error",
        category: "error",
        code: "SESSION_ANALYZE_FAILED",
        message: error instanceof Error ? error.message : "unknown error",
        traceId: t
      });
      return { ok: false, error: toIpcError(error) };
    }
  },

  apply: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    const t = traceId();
    try {
      const req = applyRequestSchema.parse(payload);
      await safeWriteLog(context, {
        level: "info",
        category: "execution",
        code: "SESSION_APPLY_START",
        message: req.dryRun ? "dry-run apply started" : "apply started",
        traceId: t,
        sessionId: req.sessionId,
        details: { dryRun: req.dryRun, action: req.action }
      });

      const db = openSqliteDatabase(sqlitePath(context));
      const session = getSessionByIdSqlite(db, req.sessionId);
      if (session === undefined) {
        throw new Error("session not found");
      }

      const results = await applySession(session.executions.map((item) => item.plan), req.dryRun, req.action);
      const updated = withExecutions(updateSessionStatus(session, req.dryRun ? "planned" : "done"), results);
      upsertSessionSqlite(db, updated);

      await safeWriteLog(context, {
        level: "info",
        category: "execution",
        code: "SESSION_APPLY_DONE",
        message: "apply completed",
        traceId: t,
        sessionId: req.sessionId,
        details: { executedCount: results.filter((r) => r.executed).length }
      });

      return { ok: true, data: updated };
    } catch (error) {
      await safeWriteLog(context, {
        level: "error",
        category: "error",
        code: "SESSION_APPLY_FAILED",
        message: error instanceof Error ? error.message : "unknown error",
        traceId: t
      });
      return { ok: false, error: toIpcError(error) };
    }
  },

  rollback: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    const t = traceId();
    try {
      const req = rollbackRequestSchema.parse(payload);
      await safeWriteLog(context, {
        level: "warn",
        category: "execution",
        code: "SESSION_ROLLBACK_START",
        message: "rollback started",
        traceId: t,
        sessionId: req.sessionId
      });

      const db = openSqliteDatabase(sqlitePath(context));
      const session = getSessionByIdSqlite(db, req.sessionId);
      if (session === undefined) {
        throw new Error("session not found");
      }

      const rolledBack = await rollbackSession(session.executions);
      const updated = withExecutions(updateSessionStatus(session, "rolled_back"), rolledBack);
      upsertSessionSqlite(db, updated);

      await safeWriteLog(context, {
        level: "info",
        category: "execution",
        code: "SESSION_ROLLBACK_DONE",
        message: "rollback completed",
        traceId: t,
        sessionId: req.sessionId
      });

      return { ok: true, data: updated };
    } catch (error) {
      await safeWriteLog(context, {
        level: "error",
        category: "error",
        code: "SESSION_ROLLBACK_FAILED",
        message: error instanceof Error ? error.message : "unknown error",
        traceId: t
      });
      return { ok: false, error: toIpcError(error) };
    }
  },

  submitFollowup: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    const t = traceId();
    try {
      const req = submitFollowupRequestSchema.parse(payload);
      await safeWriteLog(context, {
        level: "info",
        category: "session",
        code: "SESSION_FOLLOWUP_START",
        message: "follow-up submit started",
        traceId: t,
        sessionId: req.sessionId,
        details: { applyToAll: req.applyToAll }
      });

      const db = openSqliteDatabase(sqlitePath(context));
      const settings = await loadSettings(settingsRootPath(context));
      const session = getSessionByIdSqlite(db, req.sessionId);
      if (session === undefined) {
        throw new Error("session not found");
      }

      const items = listSessionItemsSqlite(db, req.sessionId);
      const now = new Date();
      let updatedCount = 0;
      const nextItems: ProcessedSessionItem[] = items.map((item): ProcessedSessionItem => {
        if (!item.needsFollowUp && !req.applyToAll) {
          return item;
        }

        updatedCount += 1;
        const confidence = Math.max(item.classification.confidence, settings.classification.askThreshold);
        const classification = {
          ...item.classification,
          project: req.answer,
          confidence,
          confidenceBand: confidenceBandOf(confidence),
          decisionSource: "followup" as const,
          reasons: [...item.classification.reasons, `followup:${req.answer}`]
        };

        const { followUpQuestion: _followUpQuestion, ...restItem } = item;
        return {
          ...restItem,
          classification,
          plan: buildPlacementPlan({
            fileId: item.item.id,
            sourcePath: item.item.path,
            classification,
            workspaceRoot: context.workspaceRoot,
            now
          }),
          needsFollowUp: false,
          decisionSource: "followup" as const
        };
      });

      replaceSessionItemsSqlite(
        db,
        nextItems.map((item) => ({
          sessionId: req.sessionId,
          data: item
        }))
      );

      const updatedExecutions = nextItems.map((item) => ({
        plan: item.plan,
        executed: false,
        rollbackable: false,
        reason: "planned"
      }));

      upsertSessionSqlite(
        db,
        withExecutions(updateSessionStatus(session, "planned"), updatedExecutions)
      );

      appendDecisionRecordsSqlite(
        db,
        toDecisionRecords(
          req.sessionId,
          nextItems.filter((item) => item.decisionSource === "followup")
        )
      );

      await safeWriteLog(context, {
        level: "info",
        category: "session",
        code: "SESSION_FOLLOWUP_APPLIED",
        message: "follow-up submit completed",
        traceId: t,
        sessionId: req.sessionId,
        details: { updatedCount, applyToAll: req.applyToAll }
      });

      return {
        ok: true,
        data: {
          sessionId: req.sessionId,
          updatedCount,
          items: nextItems,
          needsFollowUp: nextItems.some((item) => item.needsFollowUp),
          followUpQuestions: toFollowUpQuestions(nextItems)
        }
      };
    } catch (error) {
      await safeWriteLog(context, {
        level: "error",
        category: "error",
        code: "SESSION_FOLLOWUP_FAILED",
        message: error instanceof Error ? error.message : "unknown error",
        traceId: t
      });
      return { ok: false, error: toIpcError(error) };
    }
  },

  saveCorrections: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    const t = traceId();
    try {
      const req = saveCorrectionsRequestSchema.parse(payload);
      await safeWriteLog(context, {
        level: "info",
        category: "session",
        code: "SESSION_CORRECTION_START",
        message: "manual correction started",
        traceId: t,
        sessionId: req.sessionId,
        details: { saveAsRule: req.saveAsRule, applyToAll: req.applyToAll }
      });

      const db = openSqliteDatabase(sqlitePath(context));
      const settings = await loadSettings(settingsRootPath(context));
      const session = getSessionByIdSqlite(db, req.sessionId);
      if (session === undefined) {
        throw new Error("session not found");
      }

      const items = listSessionItemsSqlite(db, req.sessionId);
      const now = new Date();
      let updatedCount = 0;
      let savedRule: ClassificationRule | null = null;

      const nextItems: ProcessedSessionItem[] = items.map((item): ProcessedSessionItem => {
        const shouldUpdate = req.applyToAll || item.item.id === req.fileId;
        if (!shouldUpdate) {
          return item;
        }

        updatedCount += 1;
        const confidence = Math.max(item.classification.confidence, 0.95);
        const classification = {
          ...item.classification,
          purpose: req.purpose,
          project: req.project,
          confidence,
          confidenceBand: confidenceBandOf(confidence),
          decisionSource: "manual-correction" as const,
          reasons: [...item.classification.reasons, "manual-correction"]
        };

        const { followUpQuestion: _followUpQuestion, ...restItem } = item;
        return {
          ...restItem,
          classification,
          plan: buildPlacementPlan({
            fileId: item.item.id,
            sourcePath: item.item.path,
            classification,
            workspaceRoot: context.workspaceRoot,
            now
          }),
          needsFollowUp: false,
          decisionSource: "manual-correction" as const
        };
      });

      replaceSessionItemsSqlite(
        db,
        nextItems.map((item) => ({
          sessionId: req.sessionId,
          data: item
        }))
      );

      upsertSessionSqlite(
        db,
        withExecutions(
          updateSessionStatus(session, "planned"),
          nextItems.map((item) => ({
            plan: item.plan,
            executed: false,
            rollbackable: false,
            reason: "planned"
          }))
        )
      );

      if (req.saveAsRule && settings.ruleLearning.enabled) {
        const seed = nextItems.find((item) => req.applyToAll || item.item.id === req.fileId);
        if (seed !== undefined) {
          savedRule = createRuleSqlite(db, buildRuleFromItem(seed, req.purpose, req.project));
        }
      }

      appendDecisionRecordsSqlite(
        db,
        toDecisionRecords(
          req.sessionId,
          nextItems.filter((item) => item.decisionSource === "manual-correction")
        )
      );

      await safeWriteLog(context, {
        level: "info",
        category: "session",
        code: "SESSION_CORRECTION_SAVED",
        message: "manual correction completed",
        traceId: t,
        sessionId: req.sessionId,
        details: {
          updatedCount,
          saveAsRule: req.saveAsRule,
          createdRuleId: savedRule?.id
        }
      });

      return {
        ok: true,
        data: {
          sessionId: req.sessionId,
          updatedCount,
          items: nextItems,
          needsFollowUp: nextItems.some((item) => item.needsFollowUp),
          followUpQuestions: toFollowUpQuestions(nextItems),
          ...(savedRule === null ? {} : { rule: savedRule })
        }
      };
    } catch (error) {
      await safeWriteLog(context, {
        level: "error",
        category: "error",
        code: "SESSION_CORRECTION_FAILED",
        message: error instanceof Error ? error.message : "unknown error",
        traceId: t
      });
      return { ok: false, error: toIpcError(error) };
    }
  }
} as const;

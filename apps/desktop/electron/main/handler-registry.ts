import { dirname, join } from "node:path";

import {
  applyRequestSchema,
  analyzeRequestSchema,
  clearLogsRequestSchema,
  checkUpdatesRequestSchema,
  downloadUpdateRequestSchema,
  exportLogsRequestSchema,
  getLogStatusRequestSchema,
  getSettingsRequestSchema,
  installUpdateRequestSchema,
  listRulesRequestSchema,
  reportClientErrorRequestSchema,
  rollbackRequestSchema,
  saveCorrectionsRequestSchema,
  saveWhitelistRequestSchema,
  setReadOnlyModeRequestSchema,
  submitFollowupRequestSchema,
  updateRuleRequestSchema
} from "../../shared/ipc/contracts.js";
import { checkForUpdates, downloadLatestInstaller } from "../../infra/updater/check-updates.js";
import { launchInstaller } from "../../infra/updater/install-update.js";
import { RuleFirstLlmClassifier } from "../../infra/llm/rule-first-llm.js";
import { loadSettings, saveSettings } from "../../infra/storage/settings-repository.js";
import { buildLogExportPayload, createDefaultLogExportOptions } from "../../core/usecases/export-logs.js";
import { applySession, processSession, rollbackSession } from "../../core/usecases/process-session.js";
import { buildPlacementPlan } from "../../core/usecases/plan-placement.js";
import { createSession, updateSessionStatus, withExecutions } from "../../core/usecases/session-manager.js";
import { normalizeWhitelist } from "../../core/usecases/whitelist.js";
import { persistLogExportJson } from "../../infra/fs/log-export-file-repository.js";
import {
  clearAllLogs,
  getLogStatus,
  listLogRecords,
  writeLogRecord
} from "../../infra/logging/file-logger.js";
import { openSqliteDatabase } from "../../infra/storage/sqlite/db.js";
import {
  appendDecisionRecordsSqlite
} from "../../infra/storage/sqlite/repositories/decisions-repository.js";
import { appendLogIndexRecordSqlite } from "../../infra/storage/sqlite/repositories/log-index-repository.js";
import {
  createRuleSqlite,
  incrementRuleHitSqlite,
  listRulesSqlite,
  updateRuleSqlite
} from "../../infra/storage/sqlite/repositories/rules-repository.js";
import {
  getSessionByIdSqlite,
  listSessionItemsSqlite,
  replaceSessionItemsSqlite,
  upsertSessionSqlite
} from "../../infra/storage/sqlite/repositories/sessions-repository.js";
import { toIpcError, type IpcResult } from "../../shared/errors/app-error.js";
import type { JsonArray, JsonObject } from "../../shared/types/log-export.js";
import type { ClassificationRule } from "../../shared/types/rules.js";
import type { ExecutionResult, ProcessedSessionItem } from "../../shared/types/workflow.js";
import { confidenceBandOf } from "../../core/usecases/classify-files.js";

type UnknownPayload = Record<string, unknown>;

export interface HandlerContext {
  appDataRoot: string;
  workspaceRoot: string;
  appVersion: string;
  quitApp: () => void;
}

const settingsRootPath = (context: HandlerContext): string => join(context.appDataRoot, "settings");
const logRootPath = (context: HandlerContext): string => join(context.appDataRoot, "logs");
const updaterRootPath = (context: HandlerContext): string => join(context.appDataRoot, "updates");
const sqlitePath = (context: HandlerContext): string => join(context.appDataRoot, "data", "data.db");

const traceId = (): string => crypto.randomUUID();

const toJsonArray = (records: Awaited<ReturnType<typeof listLogRecords>>): JsonArray => {
  return records.map((record) => {
    const out: JsonObject = {
      id: record.id,
      timestamp: record.timestamp,
      level: record.level,
      category: record.category,
      code: record.code,
      message: record.message,
      traceId: record.traceId
    };

    if (record.sessionId !== undefined) {
      out.sessionId = record.sessionId;
    }

    if (record.details !== undefined) {
      out.details = JSON.parse(JSON.stringify(record.details)) as JsonObject;
    }

    return out;
  });
};

const safeWriteLog = async (
  context: HandlerContext,
  input: Parameters<typeof writeLogRecord>[1]
): Promise<void> => {
  try {
    const record = await writeLogRecord(logRootPath(context), input);
    try {
      const db = openSqliteDatabase(sqlitePath(context));
      appendLogIndexRecordSqlite(db, {
        category: record.category,
        code: record.code,
        traceId: record.traceId,
        timestamp: record.timestamp,
        ...(record.sessionId === undefined ? {} : { sessionId: record.sessionId })
      });
    } catch {
      // ignore sqlite indexing errors
    }
  } catch {
    // ignore logging side-effect failures
  }
};

const toDecisionRecords = (sessionId: string, items: ProcessedSessionItem[]) => {
  const now = new Date().toISOString();
  return items.map((item) => ({
    id: crypto.randomUUID(),
    sessionId,
    fileId: item.item.id,
    source: item.decisionSource,
    confidence: item.classification.confidence,
    purpose: item.classification.purpose,
    project: item.classification.project,
    ...(item.classification.promptVersion === undefined ? {} : { promptVersion: item.classification.promptVersion }),
    ...(item.classification.model === undefined ? {} : { model: item.classification.model }),
    reasons: item.classification.reasons,
    createdAt: now
  }));
};

const markRuleHits = (dbPath: string, items: ProcessedSessionItem[]): void => {
  const db = openSqliteDatabase(dbPath);
  for (const item of items) {
    const matchedRule = item.classification.reasons.find((reason) => reason.startsWith("matched-rule:"));
    if (matchedRule === undefined) {
      continue;
    }

    const ruleId = matchedRule.slice("matched-rule:".length);
    if (ruleId.length === 0) {
      continue;
    }

    incrementRuleHitSqlite(db, ruleId);
  }
};

const buildRuleFromItem = (item: ProcessedSessionItem, purpose: ClassificationRule["purpose"], project: string): ClassificationRule => {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    purpose,
    project,
    matcher: {
      ext: item.item.ext,
      pathPrefix: dirname(item.item.path),
      keywords: item.summary.keywords.slice(0, 3),
      negativeKeywords: []
    },
    priority: 100,
    enabled: true,
    source: "learned",
    hits: 0,
    createdAt: now,
    updatedAt: now
  };
};

export const handlers = {
  analyze: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    const t = traceId();
    try {
      await safeWriteLog(context, {
        level: "info",
        category: "session",
        code: "SESSION_ANALYZE_START",
        message: "开始分析会话",
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
        message: "会话分析完成",
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
        message: req.dryRun ? "开始执行 Dry-run" : "开始执行应用",
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
        message: "执行完成",
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
        message: "开始回滚",
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
        message: "回滚完成",
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
        message: "追问答案已应用",
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
          needsFollowUp: nextItems.some((item) => item.needsFollowUp)
        }
      };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  saveCorrections: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    const t = traceId();
    try {
      const req = saveCorrectionsRequestSchema.parse(payload);
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
        message: "分类修正已保存",
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
          ...(savedRule === null ? {} : { rule: savedRule })
        }
      };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  listRules: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    try {
      const req = listRulesRequestSchema.parse(payload);
      const db = openSqliteDatabase(sqlitePath(context));
      const rules = listRulesSqlite(db, { includeDisabled: req.includeDisabled });
      return { ok: true, data: rules };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  updateRule: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    try {
      const req = updateRuleRequestSchema.parse(payload);
      const db = openSqliteDatabase(sqlitePath(context));
      const updated = updateRuleSqlite(db, {
        ruleId: req.ruleId,
        ...(req.enabled === undefined ? {} : { enabled: req.enabled }),
        ...(req.priority === undefined ? {} : { priority: req.priority }),
        ...(req.project === undefined ? {} : { project: req.project }),
        ...(req.purpose === undefined ? {} : { purpose: req.purpose })
      });
      return { ok: true, data: updated };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  exportLogs: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    const t = traceId();
    try {
      const req = exportLogsRequestSchema.parse(payload);

      const sessionLogs = await listLogRecords(logRootPath(context), { category: "session" });
      const errorLogs = await listLogRecords(logRootPath(context), { category: "error" });
      const executionLogs = await listLogRecords(logRootPath(context), { category: "execution" });

      const options = createDefaultLogExportOptions(new Date());
      const data = buildLogExportPayload(
        {
          sessionLogs: toJsonArray(sessionLogs),
          errorLogs: toJsonArray(errorLogs),
          executionLogs: toJsonArray(executionLogs)
        },
        { ...options, anonymize: req.anonymize }
      );

      const path = await persistLogExportJson({
        baseDirectory: logRootPath(context),
        now: new Date(),
        payload: data
      });

      return { ok: true, data: { path } };
    } catch (error) {
      await writeLogRecord(logRootPath(context), {
        level: "error",
        category: "error",
        code: "LOG_EXPORT_FAILED",
        message: error instanceof Error ? error.message : "unknown error",
        traceId: t
      });
      return { ok: false, error: toIpcError(error) };
    }
  },

  saveWhitelist: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    try {
      const req = saveWhitelistRequestSchema.parse(payload);
      const settings = await loadSettings(settingsRootPath(context));
      const next = { ...settings, whitelistDirectories: normalizeWhitelist(req.directories), readOnlyMode: false };
      await saveSettings(settingsRootPath(context), next);
      return { ok: true, data: next };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  setReadOnlyMode: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    try {
      const req = setReadOnlyModeRequestSchema.parse(payload);
      const settings = await loadSettings(settingsRootPath(context));
      const next = { ...settings, readOnlyMode: req.enabled };
      await saveSettings(settingsRootPath(context), next);
      return { ok: true, data: next };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  getSettings: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    try {
      getSettingsRequestSchema.parse(payload);
      const settings = await loadSettings(settingsRootPath(context));
      return { ok: true, data: settings };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  getLogStatus: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    try {
      getLogStatusRequestSchema.parse(payload);
      const status = await getLogStatus(logRootPath(context));
      return { ok: true, data: status };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  clearLogs: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    const t = traceId();
    try {
      clearLogsRequestSchema.parse(payload);
      await clearAllLogs(logRootPath(context));
      await safeWriteLog(context, {
        level: "warn",
        category: "audit",
        code: "LOG_CLEARED",
        message: "日志已清理",
        traceId: t
      });
      return { ok: true, data: { cleared: true } };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  reportClientError: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    const t = traceId();
    try {
      const req = reportClientErrorRequestSchema.parse(payload);
      await safeWriteLog(context, {
        level: "error",
        category: "error",
        code: req.code,
        message: req.message,
        traceId: t,
        ...(req.details === undefined ? {} : { details: req.details })
      });

      return { ok: true, data: { recorded: true } };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  checkUpdates: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    const t = traceId();
    try {
      const req = checkUpdatesRequestSchema.parse(payload);
      const update = await checkForUpdates({
        currentVersion: context.appVersion,
        ...(req.channel === undefined ? {} : { channel: req.channel })
      });

      await safeWriteLog(context, {
        level: "info",
        category: "audit",
        code: update.available ? "MANUAL_UPDATE_AVAILABLE" : "MANUAL_UPDATE_NOT_AVAILABLE",
        message: update.available ? "手动检查发现新版本" : "手动检查未发现新版本",
        traceId: t,
        details: {
          available: update.available,
          currentVersion: update.currentVersion,
          latestVersion: update.latestVersion,
          releaseUrl: update.releaseUrl,
          notes: update.notes
        }
      });

      return { ok: true, data: update };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  downloadUpdate: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    const t = traceId();
    try {
      const req = downloadUpdateRequestSchema.parse(payload);
      const downloaded = await downloadLatestInstaller({
        downloadRoot: updaterRootPath(context),
        ...(req.channel === undefined ? {} : { channel: req.channel })
      });

      await safeWriteLog(context, {
        level: "info",
        category: "audit",
        code: "UPDATE_DOWNLOADED",
        message: "更新安装包已下载",
        traceId: t,
        details: {
          version: downloaded.version,
          installerPath: downloaded.installerPath
        }
      });

      return { ok: true, data: downloaded };
    } catch (error) {
      await safeWriteLog(context, {
        level: "error",
        category: "error",
        code: "UPDATE_DOWNLOAD_FAILED",
        message: error instanceof Error ? error.message : "unknown error",
        traceId: t
      });
      return { ok: false, error: toIpcError(error) };
    }
  },

  installUpdate: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    const t = traceId();
    try {
      const req = installUpdateRequestSchema.parse(payload);
      await launchInstaller(req.installerPath);

      await safeWriteLog(context, {
        level: "warn",
        category: "audit",
        code: "UPDATE_INSTALL_TRIGGERED",
        message: "已触发安装器，应用即将退出",
        traceId: t,
        details: {
          installerPath: req.installerPath
        }
      });

      context.quitApp();
      return { ok: true, data: { started: true } };
    } catch (error) {
      await safeWriteLog(context, {
        level: "error",
        category: "error",
        code: "UPDATE_INSTALL_FAILED",
        message: error instanceof Error ? error.message : "unknown error",
        traceId: t
      });
      return { ok: false, error: toIpcError(error) };
    }
  }
} as const;

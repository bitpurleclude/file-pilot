import { join } from "node:path";

import {
  applyRequestSchema,
  analyzeRequestSchema,
  exportLogsRequestSchema,
  rollbackRequestSchema,
  saveWhitelistRequestSchema
} from "../../shared/ipc/contracts.js";
import { RuleFirstLlmClassifier } from "../../infra/llm/rule-first-llm.js";
import { loadSettings, saveSettings } from "../../infra/storage/settings-repository.js";
import { getSessionById, upsertSession } from "../../infra/storage/session-repository.js";
import { buildLogExportPayload, createDefaultLogExportOptions } from "../../core/usecases/export-logs.js";
import { processSession, applySession, rollbackSession } from "../../core/usecases/process-session.js";
import { createSession, updateSessionStatus, withExecutions } from "../../core/usecases/session-manager.js";
import { normalizeWhitelist } from "../../core/usecases/whitelist.js";
import { persistLogExportJson } from "../../infra/fs/log-export-file-repository.js";
import { listLogRecords, writeLogRecord } from "../../infra/logging/file-logger.js";
import { toIpcError, type IpcResult } from "../../shared/errors/app-error.js";
import type { JsonArray, JsonObject } from "../../shared/types/log-export.js";
import type { ExecutionResult } from "../../shared/types/workflow.js";

type UnknownPayload = Record<string, unknown>;

export interface HandlerContext {
  appDataRoot: string;
  workspaceRoot: string;
}

const settingsRootPath = (context: HandlerContext): string => join(context.appDataRoot, "settings");
const dataRootPath = (context: HandlerContext): string => join(context.appDataRoot, "data");
const logRootPath = (context: HandlerContext): string => join(context.appDataRoot, "logs");

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
    await writeLogRecord(logRootPath(context), input);
  } catch {
    // ignore logging side-effect failures
  }
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
      const settings = await loadSettings(settingsRootPath(context));

      const session = updateSessionStatus(createSession([]), "analyzing");
      const processed = await processSession({
        filePaths: req.filePaths,
        settings,
        workspaceRoot: context.workspaceRoot,
        classifier: new RuleFirstLlmClassifier(settings),
        now: new Date()
      });
      const plannedExecutions: ExecutionResult[] = processed.plans.map((plan) => ({
        plan,
        executed: false,
        rollbackable: false,
        reason: "planned"
      }));

      const planned = withExecutions(updateSessionStatus(session, "planned"), plannedExecutions);
      await upsertSession(dataRootPath(context), planned);

      await safeWriteLog(context, {
        level: "info",
        category: "session",
        code: "SESSION_ANALYZE_DONE",
        message: "会话分析完成",
        traceId: t,
        sessionId: session.id,
        details: { plannedCount: plannedExecutions.length }
      });

      return { ok: true, data: { sessionId: session.id, ...processed } };
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

      const session = await getSessionById(dataRootPath(context), req.sessionId);
      if (session === undefined) {
        throw new Error("session not found");
      }

      const results = await applySession(session.executions.map((item) => item.plan), req.dryRun);
      const updated = withExecutions(updateSessionStatus(session, req.dryRun ? "planned" : "done"), results);
      await upsertSession(dataRootPath(context), updated);

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

      const session = await getSessionById(dataRootPath(context), req.sessionId);
      if (session === undefined) {
        throw new Error("session not found");
      }

      const rolledBack = await rollbackSession(session.executions);
      const updated = withExecutions(updateSessionStatus(session, "rolled_back"), rolledBack);
      await upsertSession(dataRootPath(context), updated);

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
      const next = { ...settings, whitelistDirectories: normalizeWhitelist(req.directories) };
      await saveSettings(settingsRootPath(context), next);
      return { ok: true, data: next };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  }
} as const;

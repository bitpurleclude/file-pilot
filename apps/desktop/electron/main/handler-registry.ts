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
import { toIpcError, type IpcResult } from "../../shared/errors/app-error.js";
import type { ExecutionResult } from "../../shared/types/workflow.js";

type UnknownPayload = Record<string, unknown>;

export interface HandlerContext {
  appDataRoot: string;
  workspaceRoot: string;
}

const settingsRootPath = (context: HandlerContext): string => join(context.appDataRoot, "settings");
const dataRootPath = (context: HandlerContext): string => join(context.appDataRoot, "data");
const logRootPath = (context: HandlerContext): string => join(context.appDataRoot, "logs");

export const handlers = {
  analyze: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    try {
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
      return { ok: true, data: { sessionId: session.id, ...processed } };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  apply: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    try {
      const req = applyRequestSchema.parse(payload);
      const session = await getSessionById(dataRootPath(context), req.sessionId);
      if (session === undefined) {
        throw new Error("session not found");
      }

      const results = await applySession(session.executions.map((item) => item.plan), req.dryRun);
      const updated = withExecutions(updateSessionStatus(session, req.dryRun ? "planned" : "done"), results);
      await upsertSession(dataRootPath(context), updated);
      return { ok: true, data: updated };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  rollback: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    try {
      const req = rollbackRequestSchema.parse(payload);
      const session = await getSessionById(dataRootPath(context), req.sessionId);
      if (session === undefined) {
        throw new Error("session not found");
      }

      const rolledBack = await rollbackSession(session.executions);
      const updated = withExecutions(updateSessionStatus(session, "rolled_back"), rolledBack);
      await upsertSession(dataRootPath(context), updated);
      return { ok: true, data: updated };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  exportLogs: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    try {
      const req = exportLogsRequestSchema.parse(payload);
      const options = createDefaultLogExportOptions(new Date());
      const data = buildLogExportPayload(
        { sessionLogs: [], errorLogs: [], executionLogs: [] },
        { ...options, anonymize: req.anonymize }
      );

      const path = await persistLogExportJson({
        baseDirectory: logRootPath(context),
        now: new Date(),
        payload: data
      });

      return { ok: true, data: { path } };
    } catch (error) {
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

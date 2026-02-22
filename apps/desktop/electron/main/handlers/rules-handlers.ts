import {
  listRulesRequestSchema,
  updateRuleRequestSchema
} from "../../../shared/ipc/contracts.js";
import { openSqliteDatabase } from "../../../infra/storage/sqlite/db.js";
import {
  listRulesSqlite,
  updateRuleSqlite
} from "../../../infra/storage/sqlite/repositories/rules-repository.js";
import { toIpcError, type IpcResult } from "../../../shared/errors/app-error.js";
import {
  type HandlerContext,
  type UnknownPayload,
  safeWriteLog,
  sqlitePath,
  traceId
} from "./shared.js";

export const ruleHandlers = {
  listRules: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    const t = traceId();
    try {
      const req = listRulesRequestSchema.parse(payload);
      await safeWriteLog(context, {
        level: "info",
        category: "session",
        code: "RULES_LIST_START",
        message: "list rules started",
        traceId: t,
        details: { includeDisabled: req.includeDisabled }
      });

      const db = openSqliteDatabase(sqlitePath(context));
      const rules = listRulesSqlite(db, { includeDisabled: req.includeDisabled });

      await safeWriteLog(context, {
        level: "info",
        category: "session",
        code: "RULES_LIST_DONE",
        message: "list rules completed",
        traceId: t,
        details: { count: rules.length, includeDisabled: req.includeDisabled }
      });

      return { ok: true, data: rules };
    } catch (error) {
      await safeWriteLog(context, {
        level: "error",
        category: "error",
        code: "RULES_LIST_FAILED",
        message: error instanceof Error ? error.message : "unknown error",
        traceId: t
      });
      return { ok: false, error: toIpcError(error) };
    }
  },

  updateRule: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    const t = traceId();
    try {
      const req = updateRuleRequestSchema.parse(payload);
      await safeWriteLog(context, {
        level: "info",
        category: "session",
        code: "RULE_UPDATE_START",
        message: "update rule started",
        traceId: t,
        details: { ruleId: req.ruleId }
      });

      const db = openSqliteDatabase(sqlitePath(context));
      const updated = updateRuleSqlite(db, {
        ruleId: req.ruleId,
        ...(req.enabled === undefined ? {} : { enabled: req.enabled }),
        ...(req.priority === undefined ? {} : { priority: req.priority }),
        ...(req.project === undefined ? {} : { project: req.project }),
        ...(req.purpose === undefined ? {} : { purpose: req.purpose })
      });

      await safeWriteLog(context, {
        level: "info",
        category: "session",
        code: "RULE_UPDATE_DONE",
        message: "update rule completed",
        traceId: t,
        details: { ruleId: req.ruleId }
      });

      return { ok: true, data: updated };
    } catch (error) {
      await safeWriteLog(context, {
        level: "error",
        category: "error",
        code: "RULE_UPDATE_FAILED",
        message: error instanceof Error ? error.message : "unknown error",
        traceId: t
      });
      return { ok: false, error: toIpcError(error) };
    }
  }
} as const;


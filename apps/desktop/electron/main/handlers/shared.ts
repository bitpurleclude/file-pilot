import { dirname, join } from "node:path";

import {
  listLogRecords,
  writeLogRecord
} from "../../../infra/logging/file-logger.js";
import { openSqliteDatabase } from "../../../infra/storage/sqlite/db.js";
import { appendLogIndexRecordSqlite } from "../../../infra/storage/sqlite/repositories/log-index-repository.js";
import { incrementRuleHitSqlite } from "../../../infra/storage/sqlite/repositories/rules-repository.js";
import type { JsonArray, JsonObject } from "../../../shared/types/log-export.js";
import type { ClassificationRule } from "../../../shared/types/rules.js";
import type { ProcessedSessionItem } from "../../../shared/types/workflow.js";

export type UnknownPayload = Record<string, unknown>;

export interface HandlerContext {
  appDataRoot: string;
  workspaceRoot: string;
  appVersion: string;
  quitApp: () => void;
}

export const settingsRootPath = (context: HandlerContext): string => join(context.appDataRoot, "settings");
export const logRootPath = (context: HandlerContext): string => join(context.appDataRoot, "logs");
export const updaterRootPath = (context: HandlerContext): string => join(context.appDataRoot, "updates");
export const sqlitePath = (context: HandlerContext): string => join(context.appDataRoot, "data", "data.db");

export const traceId = (): string => crypto.randomUUID();

export const toJsonArray = (records: Awaited<ReturnType<typeof listLogRecords>>): JsonArray => {
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

export const safeWriteLog = async (
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

export const toDecisionRecords = (sessionId: string, items: ProcessedSessionItem[]) => {
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

export const markRuleHits = (dbPath: string, items: ProcessedSessionItem[]): void => {
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

export const buildRuleFromItem = (
  item: ProcessedSessionItem,
  purpose: ClassificationRule["purpose"],
  project: string
): ClassificationRule => {
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


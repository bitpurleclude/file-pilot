import { createHash } from "node:crypto";

import {
  LOG_EXPORT_DEFAULTS,
  LOG_EXPORT_FILE_SUFFIX,
  LOG_EXPORT_SCHEMA_VERSION
} from "../../shared/config/log-export.config.js";
import type {
  JsonArray,
  JsonObject,
  JsonValue,
  LogExportInput,
  LogExportOptions,
  LogExportPayload
} from "../../shared/types/log-export.js";

const PATH_SEPARATOR_PATTERN = /[\\/]/;
// 常见邮箱与 API key 令牌做子串级脱敏；含分隔符的路径保持整串脱敏。
const EMAIL_TOKEN_PATTERN = /[^\s@"']+@[^\s@"']+\.[^\s@"']+/g;
const API_KEY_TOKEN_PATTERN = /\b(?:sk|rk|ak|ghp|gho|ghu|xoxb|xoxp)-[A-Za-z0-9_-]{12,}\b/g;

export const formatLogExportFileName = (date: Date): string => {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");

  return `${LOG_EXPORT_DEFAULTS.filenamePrefix}-${year}${month}${day}-${hours}${minutes}${seconds}${LOG_EXPORT_FILE_SUFFIX}`;
};

const redactToken = (value: string): string => {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 12);
  return `[redacted:${digest}]`;
};

const maskString = (value: string): string => {
  if (PATH_SEPARATOR_PATTERN.test(value)) {
    return redactToken(value);
  }

  return value
    .replace(EMAIL_TOKEN_PATTERN, (token) => redactToken(token))
    .replace(API_KEY_TOKEN_PATTERN, (token) => redactToken(token));
};

const anonymizeValue = (value: JsonValue): JsonValue => {
  if (typeof value === "string") {
    return maskString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => anonymizeValue(item));
  }

  if (value !== null && typeof value === "object") {
    return anonymizeObject(value);
  }

  return value;
};

const anonymizeObject = (value: JsonObject): JsonObject => {
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = anonymizeValue(item);
  }
  return result;
};

const maybeAnonymize = (logs: JsonArray, anonymize: boolean): JsonArray => {
  if (!anonymize) {
    return logs;
  }

  return logs.map((item) => anonymizeValue(item));
};

export const buildLogExportPayload = (
  input: LogExportInput,
  options: LogExportOptions
): LogExportPayload => {
  return {
    schema_version: LOG_EXPORT_SCHEMA_VERSION,
    exported_at: options.exportedAt.toISOString(),
    anonymized: options.anonymize,
    logs: {
      session_logs: maybeAnonymize(input.sessionLogs, options.anonymize),
      error_logs: maybeAnonymize(input.errorLogs, options.anonymize),
      execution_logs: maybeAnonymize(input.executionLogs, options.anonymize)
    }
  };
};

export const createDefaultLogExportOptions = (exportedAt: Date): LogExportOptions => {
  return {
    anonymize: LOG_EXPORT_DEFAULTS.anonymizeByDefault,
    exportedAt
  };
};

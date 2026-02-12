import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { LOGGING_CONFIG } from "../../shared/config/logging.config.js";
import type { LogCategory, LogLevel, LogRecord, WriteLogInput } from "../../shared/types/logging.js";

const logPath = (logRoot: string): string => join(logRoot, LOGGING_CONFIG.fileName);

const toLogRecord = (input: WriteLogInput): LogRecord => {
  const out: LogRecord = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    level: input.level,
    category: input.category,
    code: input.code,
    message: input.message,
    traceId: input.traceId
  };

  if (input.sessionId !== undefined) {
    out.sessionId = input.sessionId;
  }

  if (input.details !== undefined) {
    out.details = input.details;
  }

  return out;
};

export const writeLogRecord = async (logRoot: string, input: WriteLogInput): Promise<LogRecord> => {
  await mkdir(logRoot, { recursive: true });
  const record = toLogRecord(input);
  await appendFile(logPath(logRoot), `${JSON.stringify(record)}\n`, "utf-8");
  return record;
};

export const listLogRecords = async (
  logRoot: string,
  filter?: { category?: LogCategory; level?: LogLevel; sessionId?: string }
): Promise<LogRecord[]> => {
  try {
    const raw = await readFile(logPath(logRoot), "utf-8");
    const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
    const records = lines.map((line) => JSON.parse(line) as LogRecord);

    return records.filter((record) => {
      if (filter?.category !== undefined && record.category !== filter.category) {
        return false;
      }

      if (filter?.level !== undefined && record.level !== filter.level) {
        return false;
      }

      if (filter?.sessionId !== undefined && record.sessionId !== filter.sessionId) {
        return false;
      }

      return true;
    });
  } catch {
    return [];
  }
};

export const getLogFileSize = async (logRoot: string): Promise<number> => {
  try {
    const file = await stat(logPath(logRoot));
    return file.size;
  } catch {
    return 0;
  }
};

export const shouldWarnLogSize = (bytes: number): boolean => {
  return bytes >= LOGGING_CONFIG.warnThresholdBytes;
};

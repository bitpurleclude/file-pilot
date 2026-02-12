import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  clearAllLogs,
  getLogFileSize,
  getLogStatus,
  listLogRecords,
  rotateLogFileIfNeeded,
  shouldWarnLogSize,
  writeLogRecord
} from "../../infra/logging/file-logger.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("file-logger", () => {
  it("writes and reads categorized log records", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-logger-"));
    tempDirs.push(root);

    await writeLogRecord(root, {
      level: "info",
      category: "session",
      code: "SESSION_START",
      message: "start",
      traceId: "trace-1",
      sessionId: "session-1"
    });

    await writeLogRecord(root, {
      level: "error",
      category: "error",
      code: "SESSION_FAIL",
      message: "failed",
      traceId: "trace-2"
    });

    const sessionLogs = await listLogRecords(root, { category: "session" });
    const errorLogs = await listLogRecords(root, { category: "error" });

    expect(sessionLogs.length).toBe(1);
    expect(errorLogs.length).toBe(1);
    expect(sessionLogs[0]?.sessionId).toBe("session-1");
  });

  it("exposes size warning helper", () => {
    expect(shouldWarnLogSize(4 * 1024 * 1024)).toBe(true);
    expect(shouldWarnLogSize(128)).toBe(false);
  });

  it("rotates log file when size exceeds threshold", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-logger-rotate-"));
    tempDirs.push(root);

    const largeMessage = "x".repeat(220_000);
    for (let i = 0; i < 30; i += 1) {
      await writeLogRecord(root, {
        level: "info",
        category: "audit",
        code: "SPAM",
        message: `${largeMessage}-${i}`,
        traceId: `trace-${i}`
      });
    }

    const before = await getLogFileSize(root);
    expect(before).toBeGreaterThan(0);

    await rotateLogFileIfNeeded(root);

    await writeLogRecord(root, {
      level: "info",
      category: "audit",
      code: "AFTER_ROTATE",
      message: "new file",
      traceId: "trace-after"
    });

    const records = await listLogRecords(root);
    const hasAfterRotate = records.some((record) => record.code === "AFTER_ROTATE");
    expect(hasAfterRotate).toBe(true);
  });

  it("returns status and can clear logs", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-logger-clear-"));
    tempDirs.push(root);

    await writeLogRecord(root, {
      level: "info",
      category: "audit",
      code: "BEFORE_CLEAR",
      message: "before",
      traceId: "trace-before"
    });

    const before = await getLogStatus(root);
    expect(before.sizeBytes).toBeGreaterThan(0);

    await clearAllLogs(root);

    const after = await getLogStatus(root);
    expect(after.sizeBytes).toBe(0);
  });
});

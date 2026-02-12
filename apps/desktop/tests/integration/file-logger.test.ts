import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { listLogRecords, shouldWarnLogSize, writeLogRecord } from "../../infra/logging/file-logger.js";

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
});

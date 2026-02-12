import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { persistLogExportJson } from "../../infra/fs/log-export-file-repository.js";
import type { LogExportPayload } from "../../shared/types/log-export.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("log-export-file-repository", () => {
  it("writes payload as json with expected name pattern", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "file-pilot-log-export-"));
    tempDirs.push(tempDir);

    const payload: LogExportPayload = {
      schema_version: "1.0.0",
      exported_at: "2026-02-12T10:11:12.000Z",
      anonymized: true,
      logs: {
        session_logs: [{ id: "s-1" }],
        error_logs: [{ id: "e-1" }],
        execution_logs: [{ id: "x-1" }]
      }
    };

    const now = new Date(2026, 1, 12, 10, 11, 12);
    const filePath = await persistLogExportJson({ baseDirectory: tempDir, now, payload });
    const raw = await readFile(filePath, "utf-8");

    expect(filePath.endsWith("file-pilot-log-20260212-101112.json")).toBe(true);
    expect(JSON.parse(raw)).toEqual(payload);
  });
});

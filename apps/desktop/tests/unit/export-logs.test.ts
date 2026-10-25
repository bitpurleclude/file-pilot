import { describe, expect, it } from "vitest";

import {
  buildLogExportPayload,
  createDefaultLogExportOptions,
  formatLogExportFileName
} from "../../core/usecases/export-logs.js";

describe("export-logs usecase", () => {
  it("formats file name as file-pilot-log-YYYYMMDD-HHMMSS.json", () => {
    const date = new Date(2026, 1, 12, 10, 11, 12);
    expect(formatLogExportFileName(date)).toBe("file-pilot-log-20260212-101112.json");
  });

  it("anonymizes path-like strings by default", () => {
    const payload = buildLogExportPayload(
      {
        sessionLogs: [{ path: "C:/Users/demo/Documents/secret.txt" }],
        errorLogs: [],
        executionLogs: []
      },
      createDefaultLogExportOptions(new Date("2026-02-12T10:11:12.000Z"))
    );

    const firstSessionLog = payload.logs.session_logs[0];
    if (typeof firstSessionLog !== "object" || firstSessionLog === null || Array.isArray(firstSessionLog)) {
      throw new Error("unexpected test payload shape");
    }

    expect(payload.anonymized).toBe(true);
    expect(firstSessionLog.path).toMatch(/^\[redacted:[0-9a-f]{12}\]$/);
  });

  it("keeps original strings when anonymization disabled", () => {
    const payload = buildLogExportPayload(
      {
        sessionLogs: [{ path: "C:/Users/demo/Documents/secret.txt" }],
        errorLogs: [],
        executionLogs: []
      },
      {
        anonymize: false,
        exportedAt: new Date("2026-02-12T10:11:12.000Z")
      }
    );

    const firstSessionLog = payload.logs.session_logs[0];
    if (typeof firstSessionLog !== "object" || firstSessionLog === null || Array.isArray(firstSessionLog)) {
      throw new Error("unexpected test payload shape");
    }

    expect(payload.anonymized).toBe(false);
    expect(firstSessionLog.path).toBe("C:/Users/demo/Documents/secret.txt");
  });

  it("redacts email tokens embedded in messages while keeping other text", () => {
    const payload = buildLogExportPayload(
      {
        sessionLogs: [{ message: "user demo@example.com asked about files" }],
        errorLogs: [],
        executionLogs: []
      },
      createDefaultLogExportOptions(new Date("2026-02-12T10:11:12.000Z"))
    );

    const firstSessionLog = payload.logs.session_logs[0];
    if (typeof firstSessionLog !== "object" || firstSessionLog === null || Array.isArray(firstSessionLog)) {
      throw new Error("unexpected test payload shape");
    }

    const message = firstSessionLog.message;
    if (typeof message !== "string") {
      throw new Error("unexpected message type");
    }

    expect(message).not.toContain("demo@example.com");
    expect(message).toMatch(/user \[redacted:[0-9a-f]{12}\] asked about files/);
  });

  it("redacts common API key tokens", () => {
    const payload = buildLogExportPayload(
      {
        sessionLogs: [{ detail: "provider rejected key sk-abcdef0123456789abcdef" }],
        errorLogs: [],
        executionLogs: []
      },
      createDefaultLogExportOptions(new Date("2026-02-12T10:11:12.000Z"))
    );

    const firstSessionLog = payload.logs.session_logs[0];
    if (typeof firstSessionLog !== "object" || firstSessionLog === null || Array.isArray(firstSessionLog)) {
      throw new Error("unexpected test payload shape");
    }

    const detail = JSON.stringify(firstSessionLog);
    expect(detail).not.toContain("sk-abcdef0123456789abcdef");
    expect(detail).toMatch(/\[redacted:[0-9a-f]{12}\]/);
  });
});

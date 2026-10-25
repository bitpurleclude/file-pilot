import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { assertPathInsideRoot, sanitizePathSegment } from "../../core/usecases/path-safety.js";
import { EXECUTOR_CONFIG } from "../../shared/config/executor.config.js";
import { AppError } from "../../shared/errors/app-error.js";

const root = join(tmpdir(), "file-pilot-path-safety-spec");

describe("sanitizePathSegment", () => {
  it("removes Windows-forbidden and control characters", () => {
    expect(sanitizePathSegment('a/b\\c:d*e?f"g<h>i|j', "fallback")).toBe("abcdefghij");
    expect(sanitizePathSegment("a\u0000b\u0007c\u007fd", "fallback")).toBe("abcd");
  });

  it("collapses whitespace", () => {
    expect(sanitizePathSegment("  多  个   空格 \t 名 ", "fallback")).toBe("多 个 空格 名");
  });

  it("strips leading and trailing dots and spaces", () => {
    expect(sanitizePathSegment(".hidden.", "fallback")).toBe("hidden");
    expect(sanitizePathSegment(" . name . ", "fallback")).toBe("name");
  });

  it("rejects reserved device names including extension forms", () => {
    expect(sanitizePathSegment("CON", "fallback")).toBe("fallback");
    expect(sanitizePathSegment("con.txt", "fallback")).toBe("fallback");
    expect(sanitizePathSegment("AUX", "fallback")).toBe("fallback");
    expect(sanitizePathSegment("NUL", "fallback")).toBe("fallback");
    expect(sanitizePathSegment("COM9", "fallback")).toBe("fallback");
    expect(sanitizePathSegment("com3.md", "fallback")).toBe("fallback");
    expect(sanitizePathSegment("LPT1", "fallback")).toBe("fallback");
  });

  it("allows names that merely contain reserved words", () => {
    expect(sanitizePathSegment("my.CON.notes", "fallback")).toBe("my.CON.notes");
  });

  it("falls back for empty, dot-only and traversal segments", () => {
    expect(sanitizePathSegment("", "fallback")).toBe("fallback");
    expect(sanitizePathSegment("   ", "fallback")).toBe("fallback");
    expect(sanitizePathSegment(".", "fallback")).toBe("fallback");
    expect(sanitizePathSegment("..", "fallback")).toBe("fallback");
  });

  it("truncates by code points to the configured maximum", () => {
    expect(sanitizePathSegment("a".repeat(70), "fallback")).toBe("a".repeat(EXECUTOR_CONFIG.targetSegmentMaxLength));
    expect(sanitizePathSegment("漢".repeat(70), "fallback")).toBe("漢".repeat(EXECUTOR_CONFIG.targetSegmentMaxLength));
    expect(Array.from(sanitizePathSegment("𠮷".repeat(70), "fallback")).length).toBe(
      EXECUTOR_CONFIG.targetSegmentMaxLength
    );
  });
});

describe("assertPathInsideRoot", () => {
  it("allows paths inside the root", () => {
    expect(() => assertPathInsideRoot(join(root, "Documents", "a.txt"), root)).not.toThrow();
  });

  it("allows the root itself", () => {
    expect(() => assertPathInsideRoot(root, root)).not.toThrow();
  });

  it("allows traversal that stays inside the root", () => {
    expect(() => assertPathInsideRoot(join(root, "a", "..", "b.txt"), root)).not.toThrow();
  });

  it("rejects sibling roots sharing a string prefix", () => {
    const sibling = `${root}-private`;
    expect(() => assertPathInsideRoot(join(sibling, "a.txt"), root)).toThrowError(AppError);
  });

  it("rejects traversal that escapes the root", () => {
    expect(() => assertPathInsideRoot(join(root, "..", "outside.txt"), root)).toThrowError(AppError);
  });

  it("reports USER_PATH_NOT_ALLOWED as the error code", () => {
    try {
      assertPathInsideRoot(join(root, "..", "outside.txt"), root);
      expect.unreachable("expected assertPathInsideRoot to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("USER_PATH_NOT_ALLOWED");
    }
  });

  it.skipIf(process.platform !== "win32")("compares paths case-insensitively on Windows", () => {
    expect(() => assertPathInsideRoot(join(root, "DOCS", "a.txt"), root.toUpperCase())).not.toThrow();
  });
});

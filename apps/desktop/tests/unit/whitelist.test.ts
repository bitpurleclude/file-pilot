import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { AppError } from "../../shared/errors/app-error.js";
import { assertPathInWhitelist, normalizeWhitelist } from "../../core/usecases/whitelist.js";

const base = join(tmpdir(), "file-pilot-whitelist-spec");

describe("normalizeWhitelist", () => {
  it("resolves each directory", () => {
    expect(normalizeWhitelist([base])).toEqual([resolve(base)]);
  });

  it("deduplicates equivalent entries including trailing separators", () => {
    expect(normalizeWhitelist([base, base, `${base}${sep}`])).toEqual([resolve(base)]);
  });
});

describe("assertPathInWhitelist", () => {
  it("allows a file inside a whitelisted directory", () => {
    expect(() => assertPathInWhitelist(join(base, "notes", "a.txt"), [base])).not.toThrow();
  });

  it("allows the whitelisted directory itself", () => {
    expect(() => assertPathInWhitelist(base, [base])).not.toThrow();
  });

  it("rejects a file outside every whitelisted directory", () => {
    const outside = join(tmpdir(), "file-pilot-whitelist-spec-outside");
    expect(() => assertPathInWhitelist(join(outside, "a.txt"), [base])).toThrowError(AppError);
  });

  it("rejects sibling directories that merely share a string prefix", () => {
    const sibling = `${base}-private`;
    expect(() => assertPathInWhitelist(join(sibling, "a.txt"), [base])).toThrowError(AppError);
  });

  it("rejects traversal that escapes the whitelisted directory", () => {
    expect(() => assertPathInWhitelist(join(base, "..", "elsewhere", "a.txt"), [base])).toThrowError(AppError);
  });

  it("reports USER_PATH_NOT_ALLOWED as the error code", () => {
    const sibling = `${base}-private`;
    try {
      assertPathInWhitelist(join(sibling, "a.txt"), [base]);
      expect.unreachable("expected assertPathInWhitelist to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("USER_PATH_NOT_ALLOWED");
    }
  });

  it.skipIf(process.platform !== "win32")("compares paths case-insensitively on Windows", () => {
    const whitelisted = join(tmpdir(), "FilePilotCaseDir");
    expect(() => assertPathInWhitelist(join(tmpdir(), "filepilotcasedir", "a.txt"), [whitelisted])).not.toThrow();
  });
});

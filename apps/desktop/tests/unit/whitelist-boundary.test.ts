import { join, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { assertPathInWhitelist, normalizeWhitelist } from "../../core/usecases/whitelist.js";
import { AppError } from "../../shared/errors/app-error.js";

describe("whitelist boundary", () => {
  it("rejects sibling directories sharing a string prefix with a whitelisted root", () => {
    const root = join("D:", "safe");
    const sibling = join("D:", "safethings", "a.txt");

    expect(() => assertPathInWhitelist(sibling, [root])).toThrow(AppError);
  });

  it("accepts paths directly inside a whitelisted root", () => {
    const root = join("D:", "safe");
    const inside = join("D:", "safe", "sub", "a.txt");

    expect(() => assertPathInWhitelist(inside, [root])).not.toThrow();
  });

  it("accepts the whitelisted root itself", () => {
    const root = join("D:", "safe");

    expect(() => assertPathInWhitelist(root, [root])).not.toThrow();
  });

  it("does not admit traversal-encoded paths outside the root", () => {
    const root = join("D:", "safe");
    const escaping = join("D:", "safe", "..", "secret", "a.txt");

    expect(() => assertPathInWhitelist(escaping, [root])).toThrow(AppError);
  });

  it("normalizes whitelist entries to absolute paths", () => {
    const normalized = normalizeWhitelist([join(".", "somewhere")]);
    for (const entry of normalized) {
      expect(entry.includes(sep)).toBe(true);
    }
  });
});

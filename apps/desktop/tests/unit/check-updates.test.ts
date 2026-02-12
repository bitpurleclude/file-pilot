import { describe, expect, it } from "vitest";

import { __test__, checkForUpdates } from "../../infra/updater/check-updates.js";

describe("check-updates", () => {
  it("compares versions correctly", () => {
    expect(__test__.compareVersions("0.1.1", "0.1.0")).toBe(1);
    expect(__test__.compareVersions("0.1.0", "0.1.1")).toBe(-1);
    expect(__test__.compareVersions("0.1.0", "0.1.0")).toBe(0);
  });

  it("returns available when newer release exists", async () => {
    const fakeFetch: typeof fetch = (async () => {
      return {
        ok: true,
        json: async () => [
          {
            tag_name: "v0.1.2",
            prerelease: true,
            draft: false,
            html_url: "https://example.com/release",
            body: "notes"
          }
        ]
      } as Response;
    }) as typeof fetch;

    const result = await checkForUpdates({
      currentVersion: "0.1.0",
      channel: "beta",
      fetchImpl: fakeFetch
    });

    expect(result.available).toBe(true);
    expect(result.latestVersion).toBe("0.1.2");
  });
});

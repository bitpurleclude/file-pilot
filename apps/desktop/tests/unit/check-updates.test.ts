import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { __test__, checkForUpdates, downloadLatestInstaller } from "../../infra/updater/check-updates.js";

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
            body: "notes",
            assets: [{ name: "File Pilot Setup 0.1.2.exe", browser_download_url: "https://example.com/installer.exe" }]
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
    expect(result.downloadUrl).toBe("https://example.com/installer.exe");
  });

  it("downloads installer for latest channel release", async () => {
    const downloadRoot = await mkdtemp(join(tmpdir(), "file-pilot-update-test-"));

    const fakeFetch: typeof fetch = (async (input) => {
      const url = String(input);
      if (url.includes("/releases")) {
        return {
          ok: true,
          json: async () => [
            {
              tag_name: "v0.2.0",
              prerelease: true,
              draft: false,
              html_url: "https://example.com/release",
              body: "notes",
              assets: [{ name: "File Pilot Setup 0.2.0.exe", browser_download_url: "https://example.com/installer.exe" }]
            }
          ]
        } as Response;
      }

      return {
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode("installer-bytes").buffer
      } as Response;
    }) as typeof fetch;

    try {
      const result = await downloadLatestInstaller({
        channel: "beta",
        downloadRoot,
        fetchImpl: fakeFetch
      });

      const content = await readFile(result.installerPath, "utf-8");
      expect(result.version).toBe("0.2.0");
      expect(content).toBe("installer-bytes");
    } finally {
      await rm(downloadRoot, { recursive: true, force: true });
    }
  });
});

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

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
    expect(result.checkStatus).toBe("ok");
    expect(result.latestVersion).toBe("0.1.2");
    expect(result.downloadUrl).toBe("https://example.com/installer.exe");
  });

  it("returns unreachable when network request fails", async () => {
    const fakeFetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    const result = await checkForUpdates({
      currentVersion: "0.1.0",
      channel: "beta",
      fetchImpl: fakeFetch
    });

    expect(result.available).toBe(false);
    expect(result.checkStatus).toBe("unreachable");
    expect(result.errorCode).toBe("UPDATER_UNREACHABLE");
  });

  it("returns channel_no_release when selected channel has no release", async () => {
    const fakeFetch: typeof fetch = (async () => {
      return {
        ok: true,
        json: async () => [
          {
            tag_name: "v0.1.2",
            prerelease: false,
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

    expect(result.available).toBe(false);
    expect(result.checkStatus).toBe("channel_no_release");
    expect(result.errorCode).toBe("UPDATER_CHANNEL_NO_RELEASE");
  });

  it("returns asset_missing when release has no installer", async () => {
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
            assets: [{ name: "sha256.txt", browser_download_url: "https://example.com/checksum.txt" }]
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
    expect(result.checkStatus).toBe("asset_missing");
    expect(result.errorCode).toBe("UPDATER_ASSET_MISSING");
    expect(result.downloadUrl).toBeUndefined();
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

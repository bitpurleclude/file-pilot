import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { __test__, checkForUpdates, downloadLatestInstaller } from "../../infra/updater/check-updates.js";

const releasesResponse = (releases: unknown): Response => {
  return {
    ok: true,
    json: async () => releases
  } as Response;
};

const release = (tagName: string) => ({
  tag_name: tagName,
  prerelease: true,
  draft: false,
  html_url: "https://example.com/release",
  body: "notes",
  assets: [{ name: "File Pilot Setup 0.2.0.exe", browser_download_url: "https://example.com/installer.exe" }]
});

const installerResponseFromChunks = (chunks: Buffer[]): Response => {
  const webStream = Readable.toWeb(Readable.from(chunks)) as unknown as ReadableStream<Uint8Array>;
  return new Response(webStream, { status: 200 });
};

const failingInstallerResponse = (): Response => {
  const failingSource = Readable.from((async function* generatePartialDownload(): AsyncGenerator<Buffer> {
    yield Buffer.from("partial-bytes", "utf-8");
    throw new Error("stream interrupted");
  })());
  const webStream = Readable.toWeb(failingSource) as unknown as ReadableStream<Uint8Array>;
  return new Response(webStream, { status: 200 });
};

describe("check-updates", () => {
  it("compares versions correctly", () => {
    expect(__test__.compareVersions("0.1.1", "0.1.0")).toBe(1);
    expect(__test__.compareVersions("0.1.0", "0.1.1")).toBe(-1);
    expect(__test__.compareVersions("0.1.0", "0.1.0")).toBe(0);
  });

  it("compares prerelease versions per semver precedence", () => {
    // A prerelease has lower precedence than the matching release.
    expect(__test__.compareVersions("0.1.1-beta.1", "0.1.1")).toBe(-1);
    expect(__test__.compareVersions("0.1.1", "0.1.1-beta.1")).toBe(1);
    expect(__test__.compareVersions("v0.1.1-beta.1", "0.1.1")).toBe(-1);

    // Prerelease identifiers compare one by one.
    expect(__test__.compareVersions("0.1.1-beta.2", "0.1.1-beta.1")).toBe(1);
    expect(__test__.compareVersions("0.1.1-beta.1", "0.1.1-beta.1")).toBe(0);
    expect(__test__.compareVersions("0.1.1-beta", "0.1.1-alpha")).toBe(1);

    // Numeric identifiers compare numerically and rank below alphanumeric ones.
    expect(__test__.compareVersions("0.1.1-2", "0.1.1-10")).toBe(-1);
    expect(__test__.compareVersions("0.1.1-1", "0.1.1-alpha")).toBe(-1);

    // Fewer identifiers have lower precedence when all preceding ones match.
    expect(__test__.compareVersions("0.1.1-beta", "0.1.1-beta.1")).toBe(-1);

    // A higher core version wins regardless of prerelease.
    expect(__test__.compareVersions("0.2.0-alpha", "0.1.9")).toBe(1);
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

  it("downloads installer for latest channel release via streaming write", async () => {
    const downloadRoot = await mkdtemp(join(tmpdir(), "file-pilot-update-test-"));

    const fakeFetch: typeof fetch = (async (input) => {
      const url = String(input);
      if (url.includes("/releases")) {
        return releasesResponse([release("v0.2.0")]);
      }

      return installerResponseFromChunks([Buffer.from("installer-", "utf-8"), Buffer.from("bytes", "utf-8")]);
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

  it("removes the partial installer file when the download stream fails", async () => {
    const downloadRoot = await mkdtemp(join(tmpdir(), "file-pilot-update-test-"));

    const fakeFetch: typeof fetch = (async (input) => {
      const url = String(input);
      if (url.includes("/releases")) {
        return releasesResponse([release("v0.2.0")]);
      }

      return failingInstallerResponse();
    }) as typeof fetch;

    try {
      await expect(
        downloadLatestInstaller({
          channel: "beta",
          downloadRoot,
          fetchImpl: fakeFetch
        })
      ).rejects.toMatchObject({ code: "UPDATER_DOWNLOAD_FAILED" });

      const leftovers = await readdir(downloadRoot);
      expect(leftovers).toEqual([]);
    } finally {
      await rm(downloadRoot, { recursive: true, force: true });
    }
  });

  describe("pickWindowsInstallerAsset", () => {
    const installerAsset = (name: string) => ({ name, browser_download_url: `https://example.com/${name}` });
    const baseRelease = {
      tag_name: "v0.2.0",
      prerelease: true,
      draft: false,
      html_url: "https://example.com/release",
      body: "notes"
    };

    it("prefers the NSIS setup installer over the portable exe", () => {
      const picked = __test__.pickWindowsInstallerAsset({
        ...baseRelease,
        assets: [
          installerAsset("File-Pilot-0.2.0-Portable.exe"),
          installerAsset("File Pilot Setup 0.2.0.exe")
        ]
      });

      expect(picked?.name).toBe("File Pilot Setup 0.2.0.exe");
    });

    it("never picks a portable exe as the update asset", () => {
      const picked = __test__.pickWindowsInstallerAsset({
        ...baseRelease,
        assets: [
          installerAsset("File-Pilot-0.2.0-Portable.exe"),
          installerAsset("some-other-installer.exe")
        ]
      });

      expect(picked?.name).toBe("some-other-installer.exe");
    });

    it("reports asset_missing when a release only ships a portable exe", () => {
      const picked = __test__.pickWindowsInstallerAsset({
        ...baseRelease,
        assets: [installerAsset("File-Pilot-0.2.0-Portable.exe")]
      });

      expect(picked).toBeUndefined();
    });
  });
});

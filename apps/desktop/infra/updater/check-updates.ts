import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";

import { AppError } from "../../shared/errors/app-error.js";
import { UPDATER_CONFIG } from "../../shared/config/updater.config.js";
import type { DownloadedUpdateInfo, UpdateChannel, UpdateInfo } from "../../shared/types/updater.js";

interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  html_url: string;
  body: string;
  assets?: GithubReleaseAsset[];
}

const normalizeVersion = (value: string): string => value.trim().replace(/^v/i, "");

interface ParsedVersion {
  core: number[];
  prerelease: string[];
}

const parseVersion = (value: string): ParsedVersion => {
  const normalized = normalizeVersion(value);
  const withoutBuildMetadata = normalized.split("+", 1)[0] ?? normalized;
  const prereleaseIndex = withoutBuildMetadata.indexOf("-");
  const corePart = prereleaseIndex === -1 ? withoutBuildMetadata : withoutBuildMetadata.slice(0, prereleaseIndex);
  const prereleasePart = prereleaseIndex === -1 ? "" : withoutBuildMetadata.slice(prereleaseIndex + 1);

  return {
    core: corePart.split(".").map((part) => Number.parseInt(part, 10) || 0),
    prerelease: prereleasePart.split(".").filter((identifier) => identifier.length > 0)
  };
};

const isNumericIdentifier = (identifier: string): boolean => /^\d+$/.test(identifier);

const comparePrereleaseIdentifier = (a: string, b: string): number => {
  if (isNumericIdentifier(a) && isNumericIdentifier(b)) {
    const av = Number.parseInt(a, 10);
    const bv = Number.parseInt(b, 10);
    return av === bv ? 0 : av > bv ? 1 : -1;
  }

  // Semver: numeric identifiers always have lower precedence than alphanumeric ones.
  if (isNumericIdentifier(a)) {
    return -1;
  }
  if (isNumericIdentifier(b)) {
    return 1;
  }

  return a === b ? 0 : a < b ? -1 : 1;
};

const compareVersions = (a: string, b: string): number => {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  const maxCore = Math.max(av.core.length, bv.core.length);

  for (let i = 0; i < maxCore; i += 1) {
    const aCore = av.core[i] ?? 0;
    const bCore = bv.core[i] ?? 0;
    if (aCore !== bCore) {
      return aCore > bCore ? 1 : -1;
    }
  }

  // Semver: a prerelease version has lower precedence than the matching release.
  if (av.prerelease.length === 0 && bv.prerelease.length === 0) {
    return 0;
  }
  if (av.prerelease.length === 0) {
    return 1;
  }
  if (bv.prerelease.length === 0) {
    return -1;
  }

  const maxIdentifiers = Math.max(av.prerelease.length, bv.prerelease.length);
  for (let i = 0; i < maxIdentifiers; i += 1) {
    const aId = av.prerelease[i];
    const bId = bv.prerelease[i];
    if (aId === undefined) {
      return -1;
    }
    if (bId === undefined) {
      return 1;
    }

    const compared = comparePrereleaseIdentifier(aId, bId);
    if (compared !== 0) {
      return compared;
    }
  }

  return 0;
};

const isGithubReleaseAsset = (value: unknown): value is GithubReleaseAsset => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.name === "string" && typeof record.browser_download_url === "string";
};

const isGithubRelease = (value: unknown): value is GithubRelease => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const maybeAssets = record.assets;
  if (maybeAssets !== undefined && (!Array.isArray(maybeAssets) || !maybeAssets.every(isGithubReleaseAsset))) {
    return false;
  }

  return (
    typeof record.tag_name === "string"
    && typeof record.prerelease === "boolean"
    && typeof record.draft === "boolean"
    && typeof record.html_url === "string"
    && typeof record.body === "string"
  );
};

const parseReleasesPayload = (value: unknown): GithubRelease[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const releases = value.filter(isGithubRelease);
  return releases;
};

const pickRelease = (releases: GithubRelease[], channel: UpdateChannel): GithubRelease | undefined => {
  const filtered = releases.filter((release) => {
    if (release.draft) {
      return false;
    }

    return channel === "beta" ? release.prerelease : !release.prerelease;
  });

  return filtered
    .sort((a, b) => compareVersions(normalizeVersion(b.tag_name), normalizeVersion(a.tag_name)))[0];
};

const pickWindowsInstallerAsset = (release: GithubRelease): GithubReleaseAsset | undefined => {
  // A release may ship both the NSIS installer and a portable build. Only an
  // installer may drive the auto-update flow — launching the portable exe
  // would just open a second app copy and the update would silently fail.
  const installers = (release.assets ?? []).filter((asset) => {
    const name = asset.name.toLowerCase();
    return name.endsWith(".exe") && !name.includes("portable");
  });
  return installers.find((asset) => asset.name.toLowerCase().includes("setup")) ?? installers[0];
};

const updaterNetworkError = (message: string, error: unknown): AppError => {
  return new AppError("UPDATER_UNREACHABLE", message, "SYSTEM", {
    reason: error instanceof Error ? error.message : "unknown"
  });
};

const updaterInvalidResponseError = (message: string, details?: Record<string, unknown>): AppError => {
  return new AppError("UPDATER_INVALID_RESPONSE", message, "SYSTEM", details);
};

const parseReleasesFromResponse = async (response: Response): Promise<GithubRelease[]> => {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw updaterInvalidResponseError("GitHub releases response is not valid JSON", {
      reason: error instanceof Error ? error.message : "unknown"
    });
  }

  const releases = parseReleasesPayload(payload);
  if (releases === null) {
    throw updaterInvalidResponseError("GitHub releases payload has invalid shape");
  }

  return releases;
};

const getReleasesApiUrl = (): string => {
  return `https://api.github.com/repos/${UPDATER_CONFIG.githubOwner}/${UPDATER_CONFIG.githubRepo}/releases`;
};

export const checkForUpdates = async (params: {
  currentVersion: string;
  channel?: UpdateChannel;
  fetchImpl?: typeof fetch;
}): Promise<UpdateInfo> => {
  const fetchImpl = params.fetchImpl ?? fetch;
  const channel = params.channel ?? UPDATER_CONFIG.channel;

  const currentVersion = normalizeVersion(params.currentVersion);
  const apiUrl = getReleasesApiUrl();

  let response: Response;
  try {
    response = await fetchImpl(apiUrl, {
      headers: {
        Accept: "application/vnd.github+json"
      }
    });
  } catch (error) {
    const networkError = updaterNetworkError("Unable to reach update server", error);
    return {
      available: false,
      currentVersion,
      checkStatus: "unreachable",
      errorCode: networkError.code,
      errorMessage: networkError.message
    };
  }

  try {
    if (!response.ok) {
      const invalidResponseError = updaterInvalidResponseError(`Update server returned HTTP ${response.status}`);
      return {
        available: false,
        currentVersion,
        checkStatus: "invalid_response",
        errorCode: invalidResponseError.code,
        errorMessage: invalidResponseError.message
      };
    }

    const releases = await parseReleasesFromResponse(response);
    const latest = pickRelease(releases, channel);
    if (latest === undefined) {
      return {
        available: false,
        currentVersion,
        checkStatus: "channel_no_release",
        errorCode: "UPDATER_CHANNEL_NO_RELEASE",
        errorMessage: `No release found for ${channel} channel`
      };
    }

    const latestVersion = normalizeVersion(latest.tag_name);
    if (compareVersions(latestVersion, currentVersion) <= 0) {
      return {
        available: false,
        currentVersion,
        latestVersion,
        releaseUrl: latest.html_url,
        notes: latest.body,
        checkStatus: "ok"
      };
    }

    const downloadAsset = pickWindowsInstallerAsset(latest);
    if (downloadAsset === undefined) {
      return {
        available: true,
        currentVersion,
        latestVersion,
        releaseUrl: latest.html_url,
        notes: latest.body,
        checkStatus: "asset_missing",
        errorCode: "UPDATER_ASSET_MISSING",
        errorMessage: "Latest release does not contain a Windows installer asset"
      };
    }

    return {
      available: true,
      currentVersion,
      latestVersion,
      releaseUrl: latest.html_url,
      downloadUrl: downloadAsset.browser_download_url,
      checkStatus: "ok",
      notes: latest.body
    };
  } catch (error) {
    if (error instanceof AppError) {
      return {
        available: false,
        currentVersion,
        checkStatus: "invalid_response",
        errorCode: error.code,
        errorMessage: error.message
      };
    }

    const unexpectedError = updaterInvalidResponseError("Unexpected update check failure", {
      reason: error instanceof Error ? error.message : "unknown"
    });

    return {
      available: false,
      currentVersion,
      checkStatus: "invalid_response",
      errorCode: unexpectedError.code,
      errorMessage: unexpectedError.message
    };
  }
};

export const downloadLatestInstaller = async (params: {
  channel?: UpdateChannel;
  downloadRoot: string;
  fetchImpl?: typeof fetch;
}): Promise<DownloadedUpdateInfo> => {
  const fetchImpl = params.fetchImpl ?? fetch;
  const channel = params.channel ?? UPDATER_CONFIG.channel;
  const apiUrl = getReleasesApiUrl();

  let response: Response;
  try {
    response = await fetchImpl(apiUrl, {
      headers: {
        Accept: "application/vnd.github+json"
      }
    });
  } catch (error) {
    throw updaterNetworkError("Unable to reach update server", error);
  }

  if (!response.ok) {
    throw updaterInvalidResponseError(`Update server returned HTTP ${response.status}`);
  }

  const releases = await parseReleasesFromResponse(response);
  const latest = pickRelease(releases, channel);
  if (latest === undefined) {
    throw new AppError("UPDATER_CHANNEL_NO_RELEASE", `No release found for ${channel} channel`, "USER");
  }

  const installerAsset = pickWindowsInstallerAsset(latest);
  if (installerAsset === undefined) {
    throw new AppError("UPDATER_ASSET_MISSING", "Latest release does not contain a Windows installer asset", "USER", {
      latestVersion: normalizeVersion(latest.tag_name)
    });
  }

  let installerResponse: Response;
  try {
    installerResponse = await fetchImpl(installerAsset.browser_download_url);
  } catch (error) {
    throw updaterNetworkError("Unable to reach installer download URL", error);
  }

  if (!installerResponse.ok) {
    throw new AppError("UPDATER_DOWNLOAD_FAILED", `Installer download failed with HTTP ${installerResponse.status}`, "SYSTEM");
  }

  const responseBody = installerResponse.body;
  if (responseBody === null) {
    throw new AppError("UPDATER_DOWNLOAD_FAILED", "Installer download returned an empty response body", "SYSTEM");
  }

  await mkdir(params.downloadRoot, { recursive: true });
  const filePath = join(params.downloadRoot, basename(installerAsset.name));

  // The DOM ReadableStream type and node:stream/web ReadableStream are distinct
  // nominal types with identical runtime shape; bridge them without `any`.
  const installerStream = Readable.fromWeb(responseBody as unknown as NodeWebReadableStream<Uint8Array>);

  try {
    await pipeline(installerStream, createWriteStream(filePath));
  } catch (error) {
    // Best-effort cleanup of the partial download; a cleanup failure must not
    // mask the original download error.
    await rm(filePath, { force: true }).catch(() => undefined);
    throw new AppError("UPDATER_DOWNLOAD_FAILED", "Failed to write installer bytes to disk", "SYSTEM", {
      reason: error instanceof Error ? error.message : "unknown"
    });
  }

  return {
    version: normalizeVersion(latest.tag_name),
    installerPath: filePath
  };
};

export const __test__ = {
  compareVersions,
  isGithubRelease,
  parseReleasesPayload,
  normalizeVersion,
  pickRelease,
  pickWindowsInstallerAsset
};

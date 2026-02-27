import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

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

const compareVersions = (a: string, b: string): number => {
  const ap = normalizeVersion(a).split(".").map((v) => Number.parseInt(v, 10) || 0);
  const bp = normalizeVersion(b).split(".").map((v) => Number.parseInt(v, 10) || 0);
  const max = Math.max(ap.length, bp.length);

  for (let i = 0; i < max; i += 1) {
    const av = ap[i] ?? 0;
    const bv = bp[i] ?? 0;
    if (av > bv) {
      return 1;
    }
    if (av < bv) {
      return -1;
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
  const assets = release.assets ?? [];
  return assets.find((asset) => asset.name.toLowerCase().endsWith(".exe"));
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

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await installerResponse.arrayBuffer());
  } catch (error) {
    throw new AppError("UPDATER_DOWNLOAD_FAILED", "Failed to read installer bytes", "SYSTEM", {
      reason: error instanceof Error ? error.message : "unknown"
    });
  }

  await mkdir(params.downloadRoot, { recursive: true });
  const filePath = join(params.downloadRoot, basename(installerAsset.name));
  await writeFile(filePath, bytes);

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

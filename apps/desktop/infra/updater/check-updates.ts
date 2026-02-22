import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { UPDATER_CONFIG } from "../../shared/config/updater.config.js";
import type { DownloadedUpdateInfo, UpdateChannel, UpdateInfo } from "../../shared/types/updater.js";

interface GithubRelease {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  html_url: string;
  body: string;
  assets?: Array<{
    name: string;
    browser_download_url: string;
  }>;
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

const pickWindowsInstallerAsset = (release: GithubRelease): { name: string; browser_download_url: string } | undefined => {
  const assets = release.assets ?? [];
  return assets.find((asset) => asset.name.toLowerCase().endsWith(".exe"));
};

export const checkForUpdates = async (params: {
  currentVersion: string;
  channel?: UpdateChannel;
  fetchImpl?: typeof fetch;
}): Promise<UpdateInfo> => {
  const fetchImpl = params.fetchImpl ?? fetch;
  const channel = params.channel ?? UPDATER_CONFIG.channel;

  const currentVersion = normalizeVersion(params.currentVersion);
  const apiUrl = `https://api.github.com/repos/${UPDATER_CONFIG.githubOwner}/${UPDATER_CONFIG.githubRepo}/releases`;

  try {
    const response = await fetchImpl(apiUrl, {
      headers: {
        Accept: "application/vnd.github+json"
      }
    });

    if (!response.ok) {
      return { available: false, currentVersion };
    }

    const releases = (await response.json()) as GithubRelease[];
    const latest = pickRelease(releases, channel);
    if (latest === undefined) {
      return { available: false, currentVersion };
    }

    const latestVersion = normalizeVersion(latest.tag_name);
    if (compareVersions(latestVersion, currentVersion) <= 0) {
      return { available: false, currentVersion };
    }

    const downloadUrl = pickWindowsInstallerAsset(latest)?.browser_download_url;

    return {
      available: true,
      currentVersion,
      latestVersion,
      releaseUrl: latest.html_url,
      ...(downloadUrl === undefined ? {} : { downloadUrl }),
      notes: latest.body
    };
  } catch {
    return { available: false, currentVersion };
  }
};

export const downloadLatestInstaller = async (params: {
  channel?: UpdateChannel;
  downloadRoot: string;
  fetchImpl?: typeof fetch;
}): Promise<DownloadedUpdateInfo> => {
  const fetchImpl = params.fetchImpl ?? fetch;
  const channel = params.channel ?? UPDATER_CONFIG.channel;
  const apiUrl = `https://api.github.com/repos/${UPDATER_CONFIG.githubOwner}/${UPDATER_CONFIG.githubRepo}/releases`;

  const response = await fetchImpl(apiUrl, {
    headers: {
      Accept: "application/vnd.github+json"
    }
  });

  if (!response.ok) {
    throw new Error("failed to fetch releases");
  }

  const releases = (await response.json()) as GithubRelease[];
  const latest = pickRelease(releases, channel);
  if (latest === undefined) {
    throw new Error("no release found for selected channel");
  }

  const installerAsset = pickWindowsInstallerAsset(latest);
  if (installerAsset === undefined) {
    throw new Error("installer asset not found");
  }

  const installerResponse = await fetchImpl(installerAsset.browser_download_url);
  if (!installerResponse.ok) {
    throw new Error("failed to download installer");
  }

  const bytes = new Uint8Array(await installerResponse.arrayBuffer());
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
  normalizeVersion,
  pickRelease,
  pickWindowsInstallerAsset
};

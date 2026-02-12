import { UPDATER_CONFIG } from "../../shared/config/updater.config.js";
import type { UpdateChannel, UpdateInfo } from "../../shared/types/updater.js";

interface GithubRelease {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  html_url: string;
  body: string;
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

    return {
      available: true,
      currentVersion,
      latestVersion,
      releaseUrl: latest.html_url,
      notes: latest.body
    };
  } catch {
    return { available: false, currentVersion };
  }
};

export const __test__ = {
  compareVersions,
  normalizeVersion,
  pickRelease
};

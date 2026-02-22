export type UpdateChannel = "beta" | "stable";

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  downloadUrl?: string;
  notes?: string;
}

export interface DownloadedUpdateInfo {
  version: string;
  installerPath: string;
}

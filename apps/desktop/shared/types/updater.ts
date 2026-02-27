export type UpdateChannel = "beta" | "stable";
export type UpdateCheckStatus = "ok" | "unreachable" | "invalid_response" | "channel_no_release" | "asset_missing";

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  checkStatus: UpdateCheckStatus;
  errorCode?: string;
  errorMessage?: string;
  latestVersion?: string;
  releaseUrl?: string;
  downloadUrl?: string;
  notes?: string;
}

export interface DownloadedUpdateInfo {
  version: string;
  installerPath: string;
}

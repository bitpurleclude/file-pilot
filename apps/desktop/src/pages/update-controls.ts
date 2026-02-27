import type { UpdateInfo } from "../../shared/types/updater.js";

export type UpdateFlowState = "idle" | "checking" | "downloading" | "installing";

export interface UpdateMessageDescriptor {
  key: string;
  params?: Record<string, string>;
}

export interface UpdateButtonState {
  canCheck: boolean;
  canDownload: boolean;
  canInstall: boolean;
}

export const deriveUpdateButtonState = (params: {
  flowState: UpdateFlowState;
  checkResult: UpdateInfo | null;
  downloadedInstallerPath: string | null;
}): UpdateButtonState => {
  const isIdle = params.flowState === "idle";
  const hasDownloadAsset = (
    params.checkResult?.available === true
    && params.checkResult.checkStatus === "ok"
    && params.checkResult.downloadUrl !== undefined
  );

  return {
    canCheck: isIdle,
    canDownload: isIdle && hasDownloadAsset && params.downloadedInstallerPath === null,
    canInstall: isIdle && params.downloadedInstallerPath !== null
  };
};

export const resolveUpdateCheckMessage = (
  update: UpdateInfo,
  channel: "beta" | "stable"
): UpdateMessageDescriptor => {
  if (update.checkStatus === "ok") {
    if (update.available) {
      return {
        key: "app.updateFound",
        params: { version: update.latestVersion ?? "unknown" }
      };
    }

    return {
      key: "app.alreadyLatest",
      params: { version: update.currentVersion }
    };
  }

  if (update.checkStatus === "unreachable") {
    return {
      key: "app.updateServerUnreachable",
      params: { message: update.errorMessage ?? "network unreachable" }
    };
  }

  if (update.checkStatus === "invalid_response") {
    return {
      key: "app.updateServerInvalidResponse",
      params: { message: update.errorMessage ?? "invalid response" }
    };
  }

  if (update.checkStatus === "channel_no_release") {
    return {
      key: "app.updateChannelNoRelease",
      params: { channel }
    };
  }

  return {
    key: "app.updateAssetMissing",
    params: { version: update.latestVersion ?? "unknown" }
  };
};

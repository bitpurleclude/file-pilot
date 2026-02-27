import { describe, expect, it } from "vitest";

import { deriveUpdateButtonState, resolveUpdateCheckMessage } from "../../src/pages/update-controls.js";
import type { UpdateInfo } from "../../shared/types/updater.js";

const baseUpdateInfo: UpdateInfo = {
  available: false,
  currentVersion: "0.1.0",
  checkStatus: "ok"
};

describe("update-controls", () => {
  it("enables only check on initial state", () => {
    const state = deriveUpdateButtonState({
      flowState: "idle",
      checkResult: null,
      downloadedInstallerPath: null
    });

    expect(state).toEqual({
      canCheck: true,
      canDownload: false,
      canInstall: false
    });
  });

  it("enables download when update has installer asset", () => {
    const state = deriveUpdateButtonState({
      flowState: "idle",
      checkResult: {
        ...baseUpdateInfo,
        available: true,
        latestVersion: "0.2.0",
        downloadUrl: "https://example.com/setup.exe"
      },
      downloadedInstallerPath: null
    });

    expect(state.canCheck).toBe(true);
    expect(state.canDownload).toBe(true);
    expect(state.canInstall).toBe(false);
  });

  it("enables install after installer is downloaded", () => {
    const state = deriveUpdateButtonState({
      flowState: "idle",
      checkResult: {
        ...baseUpdateInfo,
        available: true,
        latestVersion: "0.2.0",
        downloadUrl: "https://example.com/setup.exe"
      },
      downloadedInstallerPath: "C:/updates/setup.exe"
    });

    expect(state.canCheck).toBe(true);
    expect(state.canDownload).toBe(false);
    expect(state.canInstall).toBe(true);
  });

  it("disables actions while checking/downloading/installing", () => {
    for (const flowState of ["checking", "downloading", "installing"] as const) {
      const state = deriveUpdateButtonState({
        flowState,
        checkResult: {
          ...baseUpdateInfo,
          available: true,
          latestVersion: "0.2.0",
          downloadUrl: "https://example.com/setup.exe"
        },
        downloadedInstallerPath: null
      });

      expect(state).toEqual({
        canCheck: false,
        canDownload: false,
        canInstall: false
      });
    }
  });

  it("maps check result statuses to actionable message keys", () => {
    expect(resolveUpdateCheckMessage({
      ...baseUpdateInfo,
      available: false
    }, "beta")).toEqual({
      key: "app.alreadyLatest",
      params: { version: "0.1.0" }
    });

    expect(resolveUpdateCheckMessage({
      ...baseUpdateInfo,
      available: true,
      latestVersion: "0.2.0",
      downloadUrl: "https://example.com/setup.exe"
    }, "beta")).toEqual({
      key: "app.updateFound",
      params: { version: "0.2.0" }
    });

    expect(resolveUpdateCheckMessage({
      ...baseUpdateInfo,
      checkStatus: "unreachable",
      errorMessage: "offline"
    }, "beta")).toEqual({
      key: "app.updateServerUnreachable",
      params: { message: "offline" }
    });

    expect(resolveUpdateCheckMessage({
      ...baseUpdateInfo,
      checkStatus: "invalid_response",
      errorMessage: "HTTP 500"
    }, "beta")).toEqual({
      key: "app.updateServerInvalidResponse",
      params: { message: "HTTP 500" }
    });

    expect(resolveUpdateCheckMessage({
      ...baseUpdateInfo,
      checkStatus: "channel_no_release"
    }, "stable")).toEqual({
      key: "app.updateChannelNoRelease",
      params: { channel: "stable" }
    });

    expect(resolveUpdateCheckMessage({
      ...baseUpdateInfo,
      available: true,
      checkStatus: "asset_missing",
      latestVersion: "0.2.0"
    }, "beta")).toEqual({
      key: "app.updateAssetMissing",
      params: { version: "0.2.0" }
    });
  });
});

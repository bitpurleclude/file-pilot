import {
  checkUpdatesRequestSchema,
  downloadUpdateRequestSchema,
  installUpdateRequestSchema
} from "../../../shared/ipc/contracts.js";
import { checkForUpdates, downloadLatestInstaller } from "../../../infra/updater/check-updates.js";
import { launchInstaller } from "../../../infra/updater/install-update.js";
import { toIpcError, type IpcResult } from "../../../shared/errors/app-error.js";
import type { DownloadedUpdateInfo, UpdateInfo } from "../../../shared/types/updater.js";
import {
  type HandlerContext,
  type UnknownPayload,
  safeWriteLog,
  traceId,
  updaterRootPath
} from "./shared.js";

export const updaterHandlers = {
  checkUpdates: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<UpdateInfo>> => {
    const t = traceId();
    try {
      const req = checkUpdatesRequestSchema.parse(payload);
      const update = await checkForUpdates({
        currentVersion: context.appVersion,
        ...(req.channel === undefined ? {} : { channel: req.channel })
      });
      const isOkState = update.checkStatus === "ok";
      const logCode = isOkState
        ? update.available ? "MANUAL_UPDATE_AVAILABLE" : "MANUAL_UPDATE_NOT_AVAILABLE"
        : "MANUAL_UPDATE_CHECK_DEGRADED";
      const logMessage = isOkState
        ? update.available ? "manual check found update" : "manual check no update"
        : "manual check completed with degraded status";

      await safeWriteLog(context, {
        level: "info",
        category: "audit",
        code: logCode,
        message: logMessage,
        traceId: t,
        details: {
          available: update.available,
          checkStatus: update.checkStatus,
          errorCode: update.errorCode,
          errorMessage: update.errorMessage,
          currentVersion: update.currentVersion,
          latestVersion: update.latestVersion,
          releaseUrl: update.releaseUrl,
          notes: update.notes
        }
      });

      return { ok: true, data: update };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  downloadUpdate: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<DownloadedUpdateInfo>> => {
    const t = traceId();
    try {
      const req = downloadUpdateRequestSchema.parse(payload);
      const downloaded = await downloadLatestInstaller({
        downloadRoot: updaterRootPath(context),
        ...(req.channel === undefined ? {} : { channel: req.channel })
      });

      await safeWriteLog(context, {
        level: "info",
        category: "audit",
        code: "UPDATE_DOWNLOADED",
        message: "update installer downloaded",
        traceId: t,
        details: {
          version: downloaded.version,
          installerPath: downloaded.installerPath
        }
      });

      return { ok: true, data: downloaded };
    } catch (error) {
      const ipcError = toIpcError(error);
      await safeWriteLog(context, {
        level: "error",
        category: "error",
        code: "UPDATE_DOWNLOAD_FAILED",
        message: ipcError.message,
        traceId: t,
        details: {
          errorCode: ipcError.code
        }
      });
      return { ok: false, error: ipcError };
    }
  },

  installUpdate: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    const t = traceId();
    try {
      const req = installUpdateRequestSchema.parse(payload);
      await launchInstaller(req.installerPath);

      await safeWriteLog(context, {
        level: "warn",
        category: "audit",
        code: "UPDATE_INSTALL_TRIGGERED",
        message: "installer launched and app will quit",
        traceId: t,
        details: {
          installerPath: req.installerPath
        }
      });

      context.quitApp();
      return { ok: true, data: { started: true } };
    } catch (error) {
      const ipcError = toIpcError(error);
      await safeWriteLog(context, {
        level: "error",
        category: "error",
        code: "UPDATE_INSTALL_FAILED",
        message: ipcError.message,
        traceId: t,
        details: {
          errorCode: ipcError.code
        }
      });
      return { ok: false, error: ipcError };
    }
  }
} as const;

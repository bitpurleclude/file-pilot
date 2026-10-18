import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, RefreshCw, Rocket } from "lucide-react";

import { Button } from "../../../components/ui/button.js";
import type { UpdateInfo } from "../../../../shared/types/updater.js";
import {
  deriveUpdateButtonState,
  resolveUpdateCheckMessage,
  type UpdateFlowState
} from "../../update-controls.js";

export const UpdatesPanel = (): JSX.Element => {
  const { t } = useTranslation();
  const [channel, setChannel] = useState<"beta" | "stable">("beta");
  const [flowState, setFlowState] = useState<UpdateFlowState>("idle");
  const [checkResult, setCheckResult] = useState<UpdateInfo | null>(null);
  const [installerPath, setInstallerPath] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");

  const buttonState = useMemo(
    () => deriveUpdateButtonState({ flowState, checkResult, downloadedInstallerPath: installerPath }),
    [checkResult, flowState, installerPath]
  );

  const check = async (): Promise<void> => {
    const api = window.filePilotApi;
    if (api === undefined) {
      return;
    }
    setFlowState("checking");
    const result = await api.checkUpdates({ channel });
    setFlowState("idle");
    if (!result.ok) {
      setMessage(t("app.checkUpdatesFailed", { message: result.error.message }));
      return;
    }
    setCheckResult(result.data);
    setInstallerPath(null);
    const resolved = resolveUpdateCheckMessage(result.data, channel);
    setMessage(
      resolved.params === undefined
        ? t(resolved.key)
        : t(resolved.key, resolved.params)
    );
  };

  const download = async (): Promise<void> => {
    const api = window.filePilotApi;
    if (api === undefined || !buttonState.canDownload) {
      return;
    }
    setFlowState("downloading");
    const result = await api.downloadUpdate({ channel });
    setFlowState("idle");
    if (!result.ok) {
      setMessage(t("app.downloadUpdateFailed", { message: `${result.error.code}: ${result.error.message}` }));
      return;
    }
    setInstallerPath(result.data.installerPath);
    setMessage(t("app.updateDownloaded", { version: result.data.version }));
  };

  const install = async (): Promise<void> => {
    const api = window.filePilotApi;
    if (api === undefined || installerPath === null) {
      return;
    }
    setFlowState("installing");
    const result = await api.installUpdate({ installerPath });
    setFlowState("idle");
    setMessage(result.ok
      ? t("app.installerLaunched")
      : t("app.installUpdateFailed", { message: `${result.error.code}: ${result.error.message}` }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">{t("settings.updates.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("settings.updates.description")}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-2 text-sm">
          <span className="text-muted-foreground">{t("updates.channelLabel")}</span>
          <select
            value={channel}
            onChange={(event) => {
              setChannel(event.target.value as "beta" | "stable");
              setCheckResult(null);
              setInstallerPath(null);
            }}
            className="block h-10 rounded-lg border border-input bg-background px-3"
          >
            <option value="beta">{t("updates.beta")}</option>
            <option value="stable">{t("updates.stable")}</option>
          </select>
        </label>
        <Button variant="outline" onClick={() => { void check(); }} disabled={!buttonState.canCheck}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          {t("updates.check")}
        </Button>
        <Button variant="outline" onClick={() => { void download(); }} disabled={!buttonState.canDownload}>
          <Download className="mr-2 h-3.5 w-3.5" />
          {t("updates.download")}
        </Button>
        <Button onClick={() => { void install(); }} disabled={!buttonState.canInstall}>
          <Rocket className="mr-2 h-3.5 w-3.5" />
          {t("updates.install")}
        </Button>
      </div>

      {message.length > 0 && (
        <p className="rounded-xl border border-border/70 bg-card/60 px-4 py-3 text-sm text-muted-foreground">
          {message}
        </p>
      )}

      {checkResult?.latestVersion !== undefined && (
        <p className="text-xs text-muted-foreground">
          {t("status.latestVersion", { version: checkResult.latestVersion })}
          {installerPath === null ? ` ${t("status.notDownloaded")}` : ` ${t("status.downloaded")}`}
        </p>
      )}
    </div>
  );
};

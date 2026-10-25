import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../components/ui/button.js";

interface LogsPanelProps {
  logStatus: { sizeBytes: number; warn: boolean } | null;
  onClearLogs: () => Promise<void>;
  onExportLogs: () => Promise<void>;
  onRefreshLogStatus: () => Promise<void>;
}

type LogsAction = "refresh" | "export" | "clear";

export const LogsPanel = ({
  logStatus,
  onClearLogs,
  onExportLogs,
  onRefreshLogStatus
}: LogsPanelProps): JSX.Element => {
  const { t } = useTranslation();
  const [busy, setBusy] = React.useState<LogsAction | null>(null);
  const [statusText, setStatusText] = React.useState<string>("");

  const run = async (action: LogsAction, task: () => Promise<void>): Promise<void> => {
    if (busy !== null) {
      return;
    }

    setBusy(action);
    setStatusText(t("settings.logsSettings.working"));
    try {
      await task();
      setStatusText(t("settings.logsSettings.done"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">
          {t("settings.logsSettings.currentSize")}
        </h3>
        {logStatus !== null ? (
          <p className="text-sm text-muted-foreground">
            {t("logs.sizeBytes", { size: logStatus.sizeBytes })}{" "}
            {logStatus.warn ? t("logs.warn") : t("logs.ok")}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          disabled={busy !== null}
          onClick={() => void run("refresh", onRefreshLogStatus)}
        >
          {t("logs.refreshStatus")}
        </Button>
        <Button
          variant="outline"
          disabled={busy !== null}
          onClick={() => void run("export", onExportLogs)}
        >
          {t("settings.logsSettings.exportAll")}
        </Button>
        <Button
          variant="destructive"
          disabled={busy !== null}
          onClick={() => void run("clear", onClearLogs)}
        >
          {t("settings.logsSettings.clearAll")}
        </Button>
      </div>

      {statusText.length > 0 && (
        <p className="text-sm text-muted-foreground">{statusText}</p>
      )}
    </div>
  );
};

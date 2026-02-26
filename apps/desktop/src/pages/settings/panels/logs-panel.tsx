import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../components/ui/button.js";

interface LogsPanelProps {
  logStatus: { sizeBytes: number; warn: boolean } | null;
  onClearLogs: () => Promise<void>;
  onExportLogs: () => Promise<void>;
  onRefreshLogStatus: () => Promise<void>;
}

export const LogsPanel = ({
  logStatus,
  onClearLogs,
  onExportLogs,
  onRefreshLogStatus,
}: LogsPanelProps): JSX.Element => {
  const { t } = useTranslation();

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

      <div className="flex gap-2">
        <Button variant="outline" onClick={onRefreshLogStatus}>
          {t("logs.refreshStatus")}
        </Button>
        <Button variant="outline" onClick={onExportLogs}>
          {t("settings.logsSettings.exportAll")}
        </Button>
        <Button variant="destructive" onClick={onClearLogs}>
          {t("settings.logsSettings.clearAll")}
        </Button>
      </div>
    </div>
  );
};

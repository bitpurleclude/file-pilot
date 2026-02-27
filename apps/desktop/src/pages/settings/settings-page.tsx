import * as React from "react";
import { useTranslation } from "react-i18next";

import type { AppSettings } from "../../../shared/types/settings.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { Separator } from "../../components/ui/separator.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs.js";
import { AdvancedPanel } from "./panels/advanced-panel.js";
import { ClassificationPanel } from "./panels/classification-panel.js";
import { GeneralPanel } from "./panels/general-panel.js";
import { LlmPanel } from "./panels/llm-panel.js";
import { LogsPanel } from "./panels/logs-panel.js";
import { SettingsAutosaveController, type SettingsAutosaveState } from "./settings-autosave-controller.js";
import type { SettingsDraftChange } from "./settings-change.js";

interface SettingsPageProps {
  settings: AppSettings;
  logStatus: { sizeBytes: number; warn: boolean } | null;
  onBack: () => void;
  onSettingsChange: (settings: AppSettings) => void;
  onClearLogs: () => Promise<void>;
  onExportLogs: () => Promise<void>;
  onRefreshLogStatus: () => Promise<void>;
}

const statusMessageKey = (status: SettingsAutosaveState["status"]): "settings.autoSave.idle" | "settings.autoSave.saving" | "settings.autoSave.saved" | "settings.autoSave.error" => {
  if (status === "saving") {
    return "settings.autoSave.saving";
  }
  if (status === "saved") {
    return "settings.autoSave.saved";
  }
  if (status === "error") {
    return "settings.autoSave.error";
  }
  return "settings.autoSave.idle";
};

export const SettingsPage = ({
  settings,
  logStatus,
  onBack,
  onSettingsChange,
  onClearLogs,
  onExportLogs,
  onRefreshLogStatus,
}: SettingsPageProps): JSX.Element => {
  const { t } = useTranslation();
  const [draft, setDraft] = React.useState<AppSettings>(settings);
  const [saveState, setSaveState] = React.useState<SettingsAutosaveState>({ status: "idle" });
  const autosaveRef = React.useRef<SettingsAutosaveController | null>(null);

  React.useEffect(() => {
    setDraft(settings);
  }, [settings]);

  React.useEffect(() => {
    autosaveRef.current?.dispose();
    autosaveRef.current = new SettingsAutosaveController({
      debounceMs: 600,
      save: async (nextSettings) => {
        if (window.filePilotApi === undefined) {
          throw new Error("IPC not ready");
        }

        const result = await window.filePilotApi.saveSettings(nextSettings);
        if (!result.ok) {
          throw new Error(result.error.message);
        }

        onSettingsChange(result.data);
        setDraft(result.data);
      },
      onStateChange: setSaveState
    });

    return () => {
      autosaveRef.current?.dispose();
      autosaveRef.current = null;
    };
  }, [onSettingsChange]);

  const handleDraftChange: SettingsDraftChange = (nextSettings, mode = "debounced") => {
    setDraft(nextSettings);
    autosaveRef.current?.schedule(nextSettings, mode);
  };

  return (
    <main className="container max-w-4xl py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
        <div className="flex items-center gap-2">
          <span className={`text-sm ${saveState.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
            {t(statusMessageKey(saveState.status), saveState.errorMessage === undefined ? {} : { message: saveState.errorMessage })}
          </span>
          {saveState.status === "error" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                autosaveRef.current?.retry();
              }}
            >
              {t("settings.autoSave.retry")}
            </Button>
          )}
          <Button variant="outline" onClick={onBack}>
            {t("settings.back")}
          </Button>
        </div>
      </div>

      <Separator className="mb-6" />

      <Tabs defaultValue="general">
        <TabsList className="mb-4">
          <TabsTrigger value="general">{t("settings.general.title")}</TabsTrigger>
          <TabsTrigger value="classification">{t("settings.classification.title")}</TabsTrigger>
          <TabsTrigger value="llm">{t("settings.llm.title")}</TabsTrigger>
          <TabsTrigger value="logs">{t("settings.logsSettings.title")}</TabsTrigger>
          <TabsTrigger value="advanced">{t("settings.advanced.title")}</TabsTrigger>
        </TabsList>

        <Card>
          <CardContent className="pt-6">
            <TabsContent value="general">
              <GeneralPanel settings={draft} onChange={handleDraftChange} />
            </TabsContent>

            <TabsContent value="classification">
              <ClassificationPanel settings={draft} onChange={handleDraftChange} />
            </TabsContent>

            <TabsContent value="llm">
              <LlmPanel settings={draft} onChange={handleDraftChange} />
            </TabsContent>

            <TabsContent value="logs">
              <LogsPanel
                logStatus={logStatus}
                onClearLogs={onClearLogs}
                onExportLogs={onExportLogs}
                onRefreshLogStatus={onRefreshLogStatus}
              />
            </TabsContent>

            <TabsContent value="advanced">
              <AdvancedPanel settings={draft} onChange={handleDraftChange} />
            </TabsContent>
          </CardContent>
        </Card>
      </Tabs>
    </main>
  );
};

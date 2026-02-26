import * as React from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Button } from "../../components/ui/button.js";
import { Separator } from "../../components/ui/separator.js";
import type { AppSettings } from "../../../shared/types/settings.js";
import { GeneralPanel } from "./panels/general-panel.js";
import { ClassificationPanel } from "./panels/classification-panel.js";
import { LlmPanel } from "./panels/llm-panel.js";
import { LogsPanel } from "./panels/logs-panel.js";
import { AdvancedPanel } from "./panels/advanced-panel.js";
import { ProvidersPanel } from "./panels/providers-panel.js";

interface SettingsPageProps {
  settings: AppSettings;
  logStatus: { sizeBytes: number; warn: boolean } | null;
  onBack: () => void;
  onSettingsChange: (settings: AppSettings) => void;
  onClearLogs: () => Promise<void>;
  onExportLogs: () => Promise<void>;
  onRefreshLogStatus: () => Promise<void>;
}

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
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saveMessage, setSaveMessage] = useState<string>("");

  const handleSave = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    const result = await window.filePilotApi.saveSettings(draft);
    if (result.ok) {
      onSettingsChange(result.data);
      setDraft(result.data);
      setSaveMessage(t("settings.saved"));
    } else {
      setSaveMessage(t("settings.saveFailed", { message: result.error.message }));
    }
  };

  return (
    <main className="container max-w-4xl py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
        <div className="flex items-center gap-2">
          {saveMessage.length > 0 && (
            <span className="text-sm text-muted-foreground">{saveMessage}</span>
          )}
          <Button variant="outline" onClick={onBack}>
            {t("settings.back")}
          </Button>
          <Button onClick={handleSave}>
            {t("settings.save")}
          </Button>
        </div>
      </div>

      <Separator className="mb-6" />

      <Tabs defaultValue="general">
        <TabsList className="mb-4">
          <TabsTrigger value="general">
            {t("settings.general.title")}
          </TabsTrigger>
          <TabsTrigger value="classification">
            {t("settings.classification.title")}
          </TabsTrigger>
          <TabsTrigger value="llm">
            {t("settings.llm.title")}
          </TabsTrigger>
          <TabsTrigger value="providers">
            {t("settings.providers.title")}
          </TabsTrigger>
          <TabsTrigger value="logs">
            {t("settings.logsSettings.title")}
          </TabsTrigger>
          <TabsTrigger value="advanced">
            {t("settings.advanced.title")}
          </TabsTrigger>
        </TabsList>

        <Card>
          <CardContent className="pt-6">
            <TabsContent value="general">
              <GeneralPanel settings={draft} onChange={setDraft} />
            </TabsContent>

            <TabsContent value="classification">
              <ClassificationPanel settings={draft} onChange={setDraft} />
            </TabsContent>

            <TabsContent value="llm">
              <LlmPanel settings={draft} onChange={setDraft} />
            </TabsContent>
            <TabsContent value="providers">
              <ProvidersPanel settings={draft} onChange={setDraft} />
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
              <AdvancedPanel settings={draft} onChange={setDraft} />
            </TabsContent>
          </CardContent>
        </Card>
      </Tabs>
    </main>
  );
};

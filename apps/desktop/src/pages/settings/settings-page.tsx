import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  Cpu,
  Library,
  ListChecks,
  ScrollText,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Wrench,
  X
} from "lucide-react";

import type { AppSettings } from "../../../shared/types/settings.js";
import { Button } from "../../components/ui/button.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs.js";
import { AdvancedPanel } from "./panels/advanced-panel.js";
import { ClassificationPanel } from "./panels/classification-panel.js";
import { GeneralPanel } from "./panels/general-panel.js";
import { LlmPanel } from "./panels/llm-panel.js";
import { LogsPanel } from "./panels/logs-panel.js";
import { RegistryPanel } from "./panels/registry-panel.js";
import { RulesPanel } from "./panels/rules-panel.js";
import { UpdatesPanel } from "./panels/updates-panel.js";
import { SettingsAutosaveController, type SettingsAutosaveState } from "./settings-autosave-controller.js";
import type { SettingsDraftChange } from "./settings-change.js";

interface SettingsPageProps {
  settings: AppSettings;
  logStatus: { sizeBytes: number; warn: boolean } | null;
  notice?: string | null;
  /** Exposes a best-effort flush so the close handshake can persist the last edit. */
  flushRef?: React.MutableRefObject<(() => Promise<void>) | null>;
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
  notice,
  flushRef,
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
  const settingsRef = React.useRef<AppSettings>(settings);

  React.useEffect(() => {
    settingsRef.current = settings;
    setDraft(settings);
  }, [settings]);

  React.useEffect(() => {
    if (flushRef === undefined) {
      return;
    }
    flushRef.current = async () => {
      await autosaveRef.current?.flush();
    };
    return () => {
      flushRef.current = null;
    };
  }, [flushRef]);

  React.useEffect(() => {
    autosaveRef.current?.dispose();
    autosaveRef.current = new SettingsAutosaveController({
      debounceMs: 600,
      save: async (nextSettings) => {
        if (window.filePilotApi === undefined) {
          throw new Error("IPC not ready");
        }
        const api = window.filePilotApi;

        // whitelistDirectories is managed through the dedicated saveWhitelist
        // channel and rejected by the strict saveSettings contract.
        const nextWhitelist = nextSettings.whitelistDirectories;
        const currentWhitelist = settingsRef.current.whitelistDirectories;
        const whitelistChanged = JSON.stringify(nextWhitelist) !== JSON.stringify(currentWhitelist);
        if (whitelistChanged) {
          if (nextWhitelist.length === 0) {
            throw new Error("Whitelist cannot be empty");
          }
          const whitelistResult = await api.saveWhitelist({ directories: nextWhitelist });
          if (!whitelistResult.ok) {
            throw new Error(whitelistResult.error.message);
          }
        }

        const { whitelistDirectories: _managedBySaveWhitelist, ...patchable } = nextSettings;
        const result = await api.saveSettings(patchable);
        if (!result.ok) {
          throw new Error(result.error.message);
        }

        const merged: AppSettings = {
          ...result.data,
          whitelistDirectories: nextWhitelist
        };
        settingsRef.current = merged;
        onSettingsChange(merged);
        setDraft(merged);
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
    <main className="settings-shell">
      <Tabs defaultValue="general" orientation="vertical" className="settings-layout">
        <aside className="settings-sidebar">
          <div className="settings-brand">
            <div className="brand-mark brand-mark-large">
              <Sparkles className="h-4 w-4" strokeWidth={2.2} />
            </div>
            <div>
              <p className="settings-brand-name">File-Pilot</p>
              <p className="settings-brand-caption">{t("settings.title")}</p>
            </div>
          </div>

          <TabsList className="settings-nav">
            <TabsTrigger value="general" data-testid="settings-tab-general">
              <Settings2 className="h-4 w-4" />
              {t("settings.general.title")}
            </TabsTrigger>
            <TabsTrigger value="classification" data-testid="settings-tab-classification">
              <SlidersHorizontal className="h-4 w-4" />
              {t("settings.classification.title")}
            </TabsTrigger>
            <TabsTrigger value="rules" data-testid="settings-tab-rules">
              <ListChecks className="h-4 w-4" />
              {t("settings.rules.title")}
            </TabsTrigger>
            <TabsTrigger value="registry" data-testid="settings-tab-registry">
              <Library className="h-4 w-4" />
              {t("registry.tabTitle")}
            </TabsTrigger>
            <TabsTrigger value="llm" data-testid="settings-tab-llm">
              <Cpu className="h-4 w-4" />
              {t("settings.llm.title")}
            </TabsTrigger>
            <TabsTrigger value="updates" data-testid="settings-tab-updates">
              <Wrench className="h-4 w-4" />
              {t("settings.updates.title")}
            </TabsTrigger>
            <TabsTrigger value="logs" data-testid="settings-tab-logs">
              <ScrollText className="h-4 w-4" />
              {t("settings.logsSettings.title")}
            </TabsTrigger>
            <TabsTrigger value="advanced" data-testid="settings-tab-advanced">
              <Wrench className="h-4 w-4" />
              {t("settings.advanced.title")}
            </TabsTrigger>
          </TabsList>

          <div className="settings-sidebar-footer">
            <span className="status-dot" />
            Local-first · v0.1.0
          </div>
        </aside>

        <section className="settings-main">
          <header className="settings-header">
            <div>
              <p className="eyebrow">File-Pilot</p>
              <h2>{t("settings.title")}</h2>
            </div>
            <div className="settings-header-actions">
              <span
                data-testid="settings-autosave-status"
                className={`settings-save-status${saveState.status === "error" ? " is-error" : ""}`}
              >
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
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("settings.back")}
                data-testid="settings-back"
                onClick={onBack}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </header>

          {notice !== null && notice !== undefined && notice.length > 0 && (
            <p className="settings-notice">{notice}</p>
          )}

          <div className="settings-content">
            <TabsContent value="general" className="mt-0">
              <GeneralPanel settings={draft} onChange={handleDraftChange} />
            </TabsContent>
            <TabsContent value="classification" className="mt-0">
              <ClassificationPanel settings={draft} onChange={handleDraftChange} />
            </TabsContent>
            <TabsContent value="rules" className="mt-0">
              <RulesPanel />
            </TabsContent>
            <TabsContent value="registry" className="mt-0">
              <RegistryPanel />
            </TabsContent>
            <TabsContent value="llm" className="mt-0">
              <LlmPanel settings={draft} onChange={handleDraftChange} />
            </TabsContent>
            <TabsContent value="updates" className="mt-0">
              <UpdatesPanel />
            </TabsContent>
            <TabsContent value="logs" className="mt-0">
              <LogsPanel
                logStatus={logStatus}
                onClearLogs={onClearLogs}
                onExportLogs={onExportLogs}
                onRefreshLogStatus={onRefreshLogStatus}
              />
            </TabsContent>
            <TabsContent value="advanced" className="mt-0">
              <AdvancedPanel settings={draft} onChange={handleDraftChange} />
            </TabsContent>
          </div>
        </section>
      </Tabs>
    </main>
  );
};

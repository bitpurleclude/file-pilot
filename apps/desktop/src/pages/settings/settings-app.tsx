import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AppSettings } from "../../../shared/types/settings.js";
import { SettingsPage } from "./settings-page.js";

const closeWindow = async (): Promise<void> => {
  if (window.filePilotApi !== undefined) {
    await window.filePilotApi.closeSettings();
    return;
  }
  window.close();
};

export const SettingsApp = (): JSX.Element => {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [logStatus, setLogStatus] = useState<{ sizeBytes: number; warn: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const flushRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    const bootstrap = async (): Promise<void> => {
      const api = window.filePilotApi;
      if (api === undefined) {
        setError("IPC not ready");
        return;
      }

      const settingsResult = await api.getSettings();
      if (!settingsResult.ok) {
        setError(settingsResult.error.message);
        return;
      }

      setSettings(settingsResult.data);
      if (settingsResult.data.language !== undefined && i18n.language !== settingsResult.data.language) {
        void i18n.changeLanguage(settingsResult.data.language);
      }

      const logResult = await api.getLogStatus();
      if (logResult.ok) {
        setLogStatus(logResult.data);
      }
    };

    void bootstrap();
  }, [i18n]);

  useEffect(() => {
    const api = window.filePilotApi;
    if (api === undefined || api.onSettingsCloseRequested === undefined) {
      return;
    }

    return api.onSettingsCloseRequested(() => {
      void (async () => {
        try {
          await flushRef.current?.();
        } finally {
          await api.confirmSettingsClose();
        }
      })();
    });
  }, []);

  const refreshLogStatus = useCallback(async (): Promise<void> => {
    const api = window.filePilotApi;
    if (api === undefined) {
      return;
    }
    const result = await api.getLogStatus();
    if (result.ok) {
      setLogStatus(result.data);
    }
  }, []);

  const clearLogs = useCallback(async (): Promise<void> => {
    const api = window.filePilotApi;
    if (api === undefined) {
      return;
    }
    const result = await api.clearLogs();
    if (!result.ok) {
      setNotice(t("app.logsClearFailed", { message: result.error.message }));
      return;
    }
    await refreshLogStatus();
    setNotice(t("app.logsCleared"));
  }, [refreshLogStatus, t]);

  const exportLogs = useCallback(async (): Promise<void> => {
    const api = window.filePilotApi;
    if (api === undefined) {
      return;
    }
    const result = await api.exportLogs({ anonymize: true });
    setNotice(result.ok
      ? t("app.logsExported", { path: result.data.path })
      : t("app.logsExportFailed", { message: result.error.message }));
  }, [t]);

  // Keep this identity stable across renders: SettingsPage recreates its
  // autosave controller when the callback changes, which would discard an
  // in-flight save and reset the status indicator to "idle".
  const handleSettingsChange = useCallback((updated: AppSettings): void => {
    setSettings(updated);
  }, []);

  if (error !== null) {
    return (
      <main className="settings-boot">
        <p>{error}</p>
        <button type="button" onClick={() => { void closeWindow(); }}>{t("settings.back")}</button>
      </main>
    );
  }

  if (settings === null) {
    return (
      <main className="settings-boot">
        <div className="settings-boot-mark" />
        <p>{t("settings.autoSave.saving")}</p>
      </main>
    );
  }

  return (
    <SettingsPage
      settings={settings}
      logStatus={logStatus}
      notice={notice}
      flushRef={flushRef}
      onBack={() => { void closeWindow(); }}
      onSettingsChange={handleSettingsChange}
      onClearLogs={clearLogs}
      onExportLogs={exportLogs}
      onRefreshLogStatus={refreshLogStatus}
    />
  );
};

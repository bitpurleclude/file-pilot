import { useEffect, useMemo, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { Settings } from "lucide-react";

import type { AppSettings } from "../../shared/types/settings.js";
import type { ClassificationRule } from "../../shared/types/rules.js";
import type { Purpose } from "../../shared/types/workflow.js";
import { Button } from "../components/ui/button.js";
import { mergeAnalyzeData } from "./analyze-state.js";
import { ClassificationFeedbackPanel } from "./components/classification-feedback-panel.js";
import { FirstRunWizard } from "./components/first-run-wizard.js";
import { RuleManagementPanel } from "./components/rule-management-panel.js";
import { SettingsPage } from "./settings/settings-page.js";
import type { AnalyzeData, SaveCorrectionsData, SubmitFollowupData } from "./types.js";

const genSessionId = (): string => crypto.randomUUID();

const parseDroppedFiles = (event: DragEvent<HTMLDivElement>): string[] => {
  const items = event.dataTransfer.files;
  return Array.from(items).map((file) => {
    const maybePath = (file as File & { path?: string }).path;
    return maybePath ?? file.name;
  });
};

const purposeOptions: Purpose[] = [
  "Documents",
  "Media",
  "Code",
  "Archives",
  "Installers",
  "Others",
  "Study",
  "Work",
  "Design",
  "Finance",
  "Research"
];

export const App = (): JSX.Element => {
  const { t, i18n } = useTranslation();
  const [currentPage, setCurrentPage] = useState<"main" | "settings">("main");
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [sessionId, setSessionId] = useState<string>(genSessionId());
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const [message, setMessage] = useState<string>("");
  const [anonymize, setAnonymize] = useState<boolean>(true);
  const [whitelistInput, setWhitelistInput] = useState<string>("");
  const [wizardVisible, setWizardVisible] = useState<boolean>(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [riskAccepted, setRiskAccepted] = useState<boolean>(false);
  const [logStatus, setLogStatus] = useState<{ sizeBytes: number; warn: boolean } | null>(null);
  const [readOnlyMode, setReadOnlyMode] = useState<boolean>(false);
  const [updateChannel, setUpdateChannel] = useState<"beta" | "stable">("beta");
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [downloadedInstallerPath, setDownloadedInstallerPath] = useState<string | null>(null);
  const [analyzeData, setAnalyzeData] = useState<AnalyzeData | null>(null);
  const [followupAnswer, setFollowupAnswer] = useState<string>("Default Project");
  const [correctionPurpose, setCorrectionPurpose] = useState<Purpose>("Documents");
  const [correctionProject, setCorrectionProject] = useState<string>("Default Project");
  const [saveAsRule, setSaveAsRule] = useState<boolean>(true);
  const [rules, setRules] = useState<ClassificationRule[]>([]);

  const canAnalyze = useMemo(() => filePaths.length > 0 && !readOnlyMode, [filePaths, readOnlyMode]);
  const firstItemId = analyzeData?.items[0]?.item.id;

  useEffect(() => {
    setMessage(t("app.dropMessage"));
  }, [t]);

  useEffect(() => {
    const bootstrap = async (): Promise<void> => {
      if (window.filePilotApi === undefined) {
        return;
      }

      const settingsResult = await window.filePilotApi.getSettings();
      if (settingsResult.ok) {
        setAppSettings(settingsResult.data);
        setReadOnlyMode(settingsResult.data.readOnlyMode);
        setReadOnlyMode(settingsResult.data.readOnlyMode);

        if (settingsResult.data.language !== undefined) {
          void i18n.changeLanguage(settingsResult.data.language);
        }

        if (settingsResult.data.whitelistDirectories.length === 0) {
          if (!settingsResult.data.readOnlyMode) {
            setWizardVisible(true);
            setMessage(t("app.firstRunDetected"));
          } else {
            setMessage(t("app.readOnlyLater"));
          }
        } else {
          setWhitelistInput(settingsResult.data.whitelistDirectories.join(";"));
        }
      }

      const logStatusResult = await window.filePilotApi.getLogStatus();
      if (logStatusResult.ok) {
        setLogStatus(logStatusResult.data);
      }
    };

    void bootstrap();
  }, [i18n, t]);

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setFilePaths(parseDroppedFiles(event));
    setMessage(t("app.filesReceived"));
  };

  const onAnalyze = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      setMessage(t("app.ipcNotReady"));
      return;
    }

    if (readOnlyMode) {
      setMessage(t("app.readOnlyActive"));
      return;
    }

    const result = await window.filePilotApi.analyze({ sessionId, filePaths });
    if (!result.ok) {
      setMessage(t("app.analyzeFailed", { message: result.error.message }));
      return;
    }

    setAnalyzeData(result.data);
    const data = result.data;
    setMessage(data.needsFollowUp ? t("app.analyzeCompletedFollowup") : t("app.analyzeCompleted"));
  };

  const onSubmitFollowup = async (): Promise<void> => {
    if (window.filePilotApi === undefined || analyzeData === null) {
      return;
    }

    const result = await window.filePilotApi.submitFollowup({
      sessionId: analyzeData.sessionId,
      answer: followupAnswer,
      applyToAll: true
    });

    if (!result.ok) {
      setMessage(t("app.followupFailed", { message: result.error.message }));
      return;
    }

    const data = result.data as SubmitFollowupData;
    setAnalyzeData((current) => mergeAnalyzeData(current, data));
    setMessage(data.needsFollowUp ? t("app.followupAppliedPending") : t("app.followupApplied"));
  };

  const onSaveCorrection = async (): Promise<void> => {
    if (window.filePilotApi === undefined || analyzeData === null || firstItemId === undefined) {
      return;
    }

    const result = await window.filePilotApi.saveCorrections({
      sessionId: analyzeData.sessionId,
      fileId: firstItemId,
      purpose: correctionPurpose,
      project: correctionProject,
      saveAsRule
    });

    if (!result.ok) {
      setMessage(t("app.correctionFailed", { message: result.error.message }));
      return;
    }

    const data = result.data as SaveCorrectionsData;
    setAnalyzeData((current) => mergeAnalyzeData(current, data));
    if (data.rule !== undefined) {
      const createdRule = data.rule;
      setRules((current) => {
        const existingIndex = current.findIndex((item) => item.id === createdRule.id);
        if (existingIndex === -1) {
          return [createdRule, ...current];
        }

        return current.map((item, index) => (index === existingIndex ? createdRule : item));
      });
    }

    setMessage(saveAsRule ? t("app.correctionSavedRule") : t("app.correctionSaved"));
  };

  const onListRules = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    const result = await window.filePilotApi.listRules({ includeDisabled: true });
    if (!result.ok) {
      setMessage(t("app.rulesFailed", { message: result.error.message }));
      return;
    }

    setRules(result.data);
    setMessage(t("app.rulesLoaded", { count: result.data.length }));
  };

  const onToggleRule = async (rule: ClassificationRule): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    const result = await window.filePilotApi.updateRule({
      ruleId: rule.id,
      enabled: !rule.enabled
    });

    if (!result.ok) {
      setMessage(t("app.ruleUpdateFailed", { message: result.error.message }));
      return;
    }

    setRules((current) => current.map((item) => (item.id === rule.id ? result.data : item)));
  };

  const onSaveWhitelist = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      setMessage(t("app.ipcNotReady"));
      return;
    }

    const directories = whitelistInput
      .split(";")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    if (directories.length === 0) {
      setMessage(t("whitelist.inputFirst"));
      return;
    }

    const result = await window.filePilotApi.saveWhitelist({ directories });
    if (result.ok) {
      setReadOnlyMode(false);
      setWizardVisible(false);
      setMessage(t("app.whitelistSaved"));
      return;
    }

    setMessage(t("app.whitelistFailed", { message: result.error.message }));
  };

  const onClearLogs = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    const result = await window.filePilotApi.clearLogs();
    if (!result.ok) {
      setMessage(t("app.logsClearFailed", { message: result.error.message }));
      return;
    }

    const status = await window.filePilotApi.getLogStatus();
    if (status.ok) {
      setLogStatus(status.data);
    }

    setMessage(t("app.logsCleared"));
  };

  const onEnableReadOnlyMode = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      setMessage(t("app.ipcNotReady"));
      return;
    }

    const result = await window.filePilotApi.setReadOnlyMode({ enabled: true });
    if (!result.ok) {
      setMessage(t("app.readOnlyFailed", { message: result.error.message }));
      return;
    }

    setReadOnlyMode(true);
    setWizardVisible(false);
    setMessage(t("app.readOnlyEnabled"));
  };

  const onRefreshLogStatus = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    const status = await window.filePilotApi.getLogStatus();
    if (status.ok) {
      setLogStatus(status.data);
      setMessage(status.data.warn ? t("app.logStatusWarn") : t("app.logStatusOk"));
    }
  };

  const onApplyDryRun = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    if (readOnlyMode) {
      setMessage(t("app.readOnlyBlocksDryRun"));
      return;
    }

    const result = await window.filePilotApi.apply({ sessionId, action: "move", dryRun: true });
    setMessage(result.ok ? t("app.dryRunCompleted") : t("app.dryRunFailed", { message: result.error.message }));
  };

  const onRollback = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    if (readOnlyMode) {
      setMessage(t("app.readOnlyBlocksRollback"));
      return;
    }

    const result = await window.filePilotApi.rollback({ sessionId });
    setMessage(result.ok ? t("app.rollbackCompleted") : t("app.rollbackFailed", { message: result.error.message }));
  };

  const onExportLogs = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    const result = await window.filePilotApi.exportLogs({ anonymize });
    setMessage(result.ok ? t("app.logsExported", { path: result.data.path }) : t("app.logsExportFailed", { message: result.error.message }));
  };

  const onCheckUpdates = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      setMessage(t("app.ipcNotReady"));
      return;
    }

    const result = await window.filePilotApi.checkUpdates({ channel: updateChannel });
    if (!result.ok) {
      setMessage(t("app.checkUpdatesFailed", { message: result.error.message }));
      return;
    }

    setLatestVersion(result.data.latestVersion ?? null);
    setDownloadedInstallerPath(null);
    setMessage(
      result.data.available
        ? t("app.updateFound", { version: result.data.latestVersion ?? "unknown" })
        : t("app.alreadyLatest", { version: result.data.currentVersion })
    );
  };

  const onDownloadUpdate = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      setMessage(t("app.ipcNotReady"));
      return;
    }

    const result = await window.filePilotApi.downloadUpdate({ channel: updateChannel });
    if (!result.ok) {
      setMessage(t("app.downloadUpdateFailed", { message: result.error.message }));
      return;
    }

    setDownloadedInstallerPath(result.data.installerPath);
    setLatestVersion(result.data.version);
    setMessage(t("app.updateDownloaded", { version: result.data.version }));
  };

  const onInstallUpdate = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      setMessage(t("app.ipcNotReady"));
      return;
    }

    if (downloadedInstallerPath === null) {
      setMessage(t("app.downloadFirst"));
      return;
    }

    const result = await window.filePilotApi.installUpdate({ installerPath: downloadedInstallerPath });
    if (!result.ok) {
      setMessage(t("app.installUpdateFailed", { message: result.error.message }));
      return;
    }

    setMessage(t("app.installerLaunched"));
  };

  const handleSettingsChange = (updated: AppSettings): void => {
    setAppSettings(updated);
    setReadOnlyMode(updated.readOnlyMode);
    setWhitelistInput(updated.whitelistDirectories.join(";"));
  };

  if (currentPage === "settings" && appSettings !== null) {
    return (
      <SettingsPage
        settings={appSettings}
        logStatus={logStatus}
        onBack={() => setCurrentPage("main")}
        onSettingsChange={handleSettingsChange}
        onClearLogs={onClearLogs}
        onExportLogs={onExportLogs}
        onRefreshLogStatus={onRefreshLogStatus}
      />
    );
  }

  return (
    <main className="container">
      <div className="flex items-center justify-between mb-4">
        <h1>{t("app.title")}</h1>
        <Button variant="ghost" size="icon" onClick={() => setCurrentPage("settings")}>
          <Settings className="h-5 w-5" />
        </Button>
      </div>
      <p>{message}</p>

      <FirstRunWizard
        visible={wizardVisible}
        step={wizardStep}
        whitelistInput={whitelistInput}
        riskAccepted={riskAccepted}
        onWhitelistInputChange={setWhitelistInput}
        onRiskAcceptedChange={setRiskAccepted}
        onStepChange={setWizardStep}
        onSkipReadOnly={onEnableReadOnlyMode}
        onSaveWhitelist={onSaveWhitelist}
      />

      <section
        className="dropzone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        {t("dropzone.hint")}
      </section>

      <div className="controls">
        <input
          id="whitelist-directories"
          name="whitelistDirectories"
          placeholder={t("whitelist.placeholder")}
          value={whitelistInput}
          onChange={(event) => setWhitelistInput(event.target.value)}
        />
        <button onClick={onSaveWhitelist}>{t("whitelist.save")}</button>
      </div>

      <div className="controls">
        <button onClick={onAnalyze} disabled={!canAnalyze}>
          {t("actions.analyze")}
        </button>
        <button onClick={onApplyDryRun} disabled={readOnlyMode}>
          {t("actions.dryRun")}
        </button>
        <button onClick={onRollback} disabled={readOnlyMode}>
          {t("actions.rollback")}
        </button>
      </div>

      <ClassificationFeedbackPanel
        analyzeData={analyzeData}
        firstItemId={firstItemId}
        followupAnswer={followupAnswer}
        onFollowupAnswerChange={setFollowupAnswer}
        onSubmitFollowup={onSubmitFollowup}
        correctionPurpose={correctionPurpose}
        purposeOptions={purposeOptions}
        onCorrectionPurposeChange={setCorrectionPurpose}
        correctionProject={correctionProject}
        onCorrectionProjectChange={setCorrectionProject}
        saveAsRule={saveAsRule}
        onSaveAsRuleChange={setSaveAsRule}
        onSaveCorrection={onSaveCorrection}
      />

      <RuleManagementPanel
        rules={rules}
        onRefreshRules={onListRules}
        onToggleRule={onToggleRule}
      />

      <div className="controls">
        <label>
          {t("updates.channelLabel")}
          <select
            id="update-channel"
            name="updateChannel"
            value={updateChannel}
            onChange={(event) => setUpdateChannel(event.target.value as "beta" | "stable")}
          >
            <option value="beta">{t("updates.beta")}</option>
            <option value="stable">{t("updates.stable")}</option>
          </select>
        </label>
        <label>
          <input
            id="anonymize-logs"
            name="anonymizeLogs"
            type="checkbox"
            checked={anonymize}
            onChange={(event) => setAnonymize(event.target.checked)}
          />
          {t("logs.anonymize")}
        </label>
        <button onClick={onExportLogs}>{t("logs.export")}</button>
        <button onClick={onRefreshLogStatus}>{t("logs.refreshStatus")}</button>
        <button onClick={onClearLogs}>{t("logs.clear")}</button>
        <button onClick={onCheckUpdates}>{t("updates.check")}</button>
        <button onClick={onDownloadUpdate}>{t("updates.download")}</button>
        <button onClick={onInstallUpdate} disabled={downloadedInstallerPath === null}>{t("updates.install")}</button>
        <button onClick={() => setSessionId(genSessionId())}>{t("actions.newSession")}</button>
      </div>

      {logStatus !== null && (
        <p>
          {t("logs.sizeBytes", { size: logStatus.sizeBytes })} {logStatus.warn ? t("logs.warn") : t("logs.ok")}
        </p>
      )}

      {readOnlyMode && <p>{t("status.readOnly")}</p>}

      {latestVersion !== null && (
        <p>
          {t("status.latestVersion", { version: latestVersion })}
          {downloadedInstallerPath === null ? ` ${t("status.notDownloaded")}` : ` ${t("status.downloaded")}`}
        </p>
      )}

      <pre>{JSON.stringify({ sessionId, filePaths, analyzeData }, null, 2)}</pre>
    </main>
  );
};

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { Settings } from "lucide-react";

import type { AppSettings } from "../../shared/types/settings.js";
import type { ClassificationRule } from "../../shared/types/rules.js";
import type { UpdateInfo } from "../../shared/types/updater.js";
import type { Purpose } from "../../shared/types/workflow.js";
import { Button } from "../components/ui/button.js";
import { mergeAnalyzeData } from "./analyze-state.js";
import { ClassificationFeedbackPanel } from "./components/classification-feedback-panel.js";
import { FirstRunWizard } from "./components/first-run-wizard.js";
import { RuleManagementPanel } from "./components/rule-management-panel.js";
import { SettingsPage } from "./settings/settings-page.js";
import type { AnalyzeData } from "./types.js";
import { deriveUpdateButtonState, resolveUpdateCheckMessage, type UpdateFlowState } from "./update-controls.js";

const genSessionId = (): string => crypto.randomUUID();

const parseDroppedFiles = (event: DragEvent<HTMLDivElement>): string[] => {
  const items = event.dataTransfer.files;
  return Array.from(items).map((file) => {
    // Electron 32 移除了渲染层 File.path；经 preload 的 webUtils 包装取绝对路径。
    const maybePath = window.filePilotApi?.pathForFile(file);
    return maybePath !== undefined && maybePath.length > 0 ? maybePath : file.name;
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
  const [updateCheckResult, setUpdateCheckResult] = useState<UpdateInfo | null>(null);
  const [updateFlowState, setUpdateFlowState] = useState<UpdateFlowState>("idle");
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [downloadedInstallerPath, setDownloadedInstallerPath] = useState<string | null>(null);
  const [analyzeData, setAnalyzeData] = useState<AnalyzeData | null>(null);
  const [followupAnswer, setFollowupAnswer] = useState<string>("Default Project");
  const [correctionPurpose, setCorrectionPurpose] = useState<Purpose>("Documents");
  const [correctionProject, setCorrectionProject] = useState<string>("Default Project");
  const [saveAsRule, setSaveAsRule] = useState<boolean>(true);
  const [rules, setRules] = useState<ClassificationRule[]>([]);
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const actionBusyRef = useRef<boolean>(false);
  const updateChannelRef = useRef<"beta" | "stable">("beta");
  const tRef = useRef(t);

  updateChannelRef.current = updateChannel;
  tRef.current = t;

  const canAnalyze = useMemo(() => filePaths.length > 0 && !readOnlyMode, [filePaths, readOnlyMode]);
  const updateButtonState = useMemo(
    () => deriveUpdateButtonState({
      flowState: updateFlowState,
      checkResult: updateCheckResult,
      downloadedInstallerPath
    }),
    [downloadedInstallerPath, updateCheckResult, updateFlowState]
  );
  const firstItemId = analyzeData?.items[0]?.item.id;

  // 会话主链路互斥守卫：双击/并发请求用 ref 防竞态，state 驱动按钮禁用。
  const runExclusive = async (action: () => Promise<void>): Promise<void> => {
    if (actionBusyRef.current) {
      return;
    }

    actionBusyRef.current = true;
    setActionBusy(true);
    try {
      await action();
    } finally {
      actionBusyRef.current = false;
      setActionBusy(false);
    }
  };

  useEffect(() => {
    setMessage(t("app.dropMessage"));
  }, [t]);

  useEffect(() => {
    // 仅在挂载时引导一次：文案经 tRef 取值，避免语言切换重跑本流程。
    const bootstrap = async (): Promise<void> => {
      if (window.filePilotApi === undefined) {
        return;
      }

      const settingsResult = await window.filePilotApi.getSettings();
      if (settingsResult.ok) {
        setAppSettings(settingsResult.data);
        setReadOnlyMode(settingsResult.data.readOnlyMode);

        if (settingsResult.data.language !== undefined) {
          void i18n.changeLanguage(settingsResult.data.language);
        }

        if (settingsResult.data.whitelistDirectories.length === 0) {
          if (!settingsResult.data.readOnlyMode) {
            setWizardVisible(true);
            setMessage(tRef.current("app.firstRunDetected"));
          } else {
            setMessage(tRef.current("app.readOnlyLater"));
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
  }, [i18n]);

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setFilePaths(parseDroppedFiles(event));
    setMessage(t("app.filesReceived"));
  };

  const onAnalyze = (): Promise<void> => runExclusive(async () => {
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
  });

  const onSubmitFollowup = (): Promise<void> => runExclusive(async () => {
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

    const data = result.data;
    setAnalyzeData((current) => mergeAnalyzeData(current, data));
    setMessage(data.needsFollowUp ? t("app.followupAppliedPending") : t("app.followupApplied"));
  });

  const onSaveCorrection = (): Promise<void> => runExclusive(async () => {
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

    const data = result.data;
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
  });

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
      // 以主进程返回的（脱敏）settings 为唯一事实来源，防止旧快照
      // 经设置页自动保存把白名单/只读状态整体写回覆盖。
      handleSettingsChange(result.data);
      setWizardVisible(false);
      setWizardStep(1);
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

    handleSettingsChange(result.data);
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

  const onApplyDryRun = (): Promise<void> => runExclusive(async () => {
    if (window.filePilotApi === undefined) {
      return;
    }

    if (readOnlyMode) {
      setMessage(t("app.readOnlyBlocksDryRun"));
      return;
    }

    const result = await window.filePilotApi.apply({ sessionId, action: "move", dryRun: true });
    setMessage(result.ok ? t("app.dryRunCompleted") : t("app.dryRunFailed", { message: result.error.message }));
  });

  const onRollback = (): Promise<void> => runExclusive(async () => {
    if (window.filePilotApi === undefined) {
      return;
    }

    if (readOnlyMode) {
      setMessage(t("app.readOnlyBlocksRollback"));
      return;
    }

    const result = await window.filePilotApi.rollback({ sessionId });
    setMessage(result.ok ? t("app.rollbackCompleted") : t("app.rollbackFailed", { message: result.error.message }));
  });

  const onExportLogs = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    const result = await window.filePilotApi.exportLogs({ anonymize });
    setMessage(result.ok ? t("app.logsExported", { path: result.data.path }) : t("app.logsExportFailed", { message: result.error.message }));
  };

  const onUpdateChannelChange = (channel: "beta" | "stable"): void => {
    setUpdateChannel(channel);
    setUpdateCheckResult(null);
    setDownloadedInstallerPath(null);
    setLatestVersion(null);
  };

  const onCheckUpdates = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      setMessage(t("app.ipcNotReady"));
      return;
    }

    const requestChannel = updateChannel;
    setUpdateFlowState("checking");
    setMessage(t("app.checkingUpdates"));
    const result = await window.filePilotApi.checkUpdates({ channel: requestChannel });
    setUpdateFlowState("idle");
    if (updateChannelRef.current !== requestChannel) {
      return; // 用户在请求期间切换了通道，丢弃过期结果
    }

    if (!result.ok) {
      setMessage(t("app.checkUpdatesFailed", { message: result.error.message }));
      return;
    }

    setUpdateCheckResult(result.data);
    setLatestVersion(result.data.latestVersion ?? null);
    setDownloadedInstallerPath(null);

    const updateMessage = resolveUpdateCheckMessage(result.data, updateChannel);
    setMessage(t(updateMessage.key, updateMessage.params ?? {}));
  };

  const onDownloadUpdate = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      setMessage(t("app.ipcNotReady"));
      return;
    }

    if (!updateButtonState.canDownload) {
      setMessage(t("app.downloadNotReady"));
      return;
    }

    const requestChannel = updateChannel;
    setUpdateFlowState("downloading");
    setMessage(t("app.downloadingUpdate"));
    const result = await window.filePilotApi.downloadUpdate({ channel: requestChannel });
    setUpdateFlowState("idle");
    if (updateChannelRef.current !== requestChannel) {
      return; // 通道已切换：旧通道的安装包不可作为当前通道的安装来源
    }

    if (!result.ok) {
      setMessage(t("app.downloadUpdateFailed", { message: `${result.error.code}: ${result.error.message}` }));
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

    setUpdateFlowState("installing");
    setMessage(t("app.installingUpdate"));
    const result = await window.filePilotApi.installUpdate();
    setUpdateFlowState("idle");
    if (!result.ok) {
      setMessage(t("app.installUpdateFailed", { message: `${result.error.code}: ${result.error.message}` }));
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
        <button onClick={onAnalyze} disabled={!canAnalyze || actionBusy}>
          {t("actions.analyze")}
        </button>
        <button onClick={onApplyDryRun} disabled={readOnlyMode || actionBusy}>
          {t("actions.dryRun")}
        </button>
        <button onClick={onRollback} disabled={readOnlyMode || actionBusy}>
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
            disabled={updateFlowState !== "idle"}
            onChange={(event) => onUpdateChannelChange(event.target.value as "beta" | "stable")}
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
        <button onClick={onCheckUpdates} disabled={!updateButtonState.canCheck}>{t("updates.check")}</button>
        <button onClick={onDownloadUpdate} disabled={!updateButtonState.canDownload}>{t("updates.download")}</button>
        <button onClick={onInstallUpdate} disabled={!updateButtonState.canInstall}>{t("updates.install")}</button>
        <button onClick={() => {
          setSessionId(genSessionId());
          setAnalyzeData(null);
          setFilePaths([]);
          setMessage(t("app.newSessionReady"));
        }}>{t("actions.newSession")}</button>
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
    </main>
  );
};

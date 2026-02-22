import { useEffect, useMemo, useState, type DragEvent } from "react";

import type { ClassificationRule } from "../../shared/types/rules.js";
import type { Purpose } from "../../shared/types/workflow.js";
import { ClassificationFeedbackPanel } from "./components/classification-feedback-panel.js";
import { FirstRunWizard } from "./components/first-run-wizard.js";
import { RuleManagementPanel } from "./components/rule-management-panel.js";
import type { AnalyzeData } from "./types.js";

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
  const [sessionId, setSessionId] = useState<string>(genSessionId());
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const [message, setMessage] = useState<string>("Drop files to start M2/M3 workflow");
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
    const bootstrap = async (): Promise<void> => {
      if (window.filePilotApi === undefined) {
        return;
      }

      const settingsResult = await window.filePilotApi.getSettings();
      if (settingsResult.ok) {
        setReadOnlyMode(settingsResult.data.readOnlyMode);
        if (settingsResult.data.whitelistDirectories.length === 0) {
          if (!settingsResult.data.readOnlyMode) {
            setWizardVisible(true);
            setMessage("First run detected, complete whitelist setup");
          } else {
            setMessage("Read-only mode enabled, configure whitelist later");
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
  }, []);

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setFilePaths(parseDroppedFiles(event));
    setMessage("Files received, ready to analyze");
  };

  const onAnalyze = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      setMessage("IPC not ready");
      return;
    }

    if (readOnlyMode) {
      setMessage("Read-only mode is active, configure whitelist first");
      return;
    }

    const result = await window.filePilotApi.analyze({ sessionId, filePaths });
    if (!result.ok) {
      setMessage(`Analyze failed: ${result.error.message}`);
      return;
    }

    const data = result.data as AnalyzeData;
    setAnalyzeData(data);
    setMessage(data.needsFollowUp ? "Analyze completed, follow-up is required" : "Analyze completed with dry-run plan");
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
      setMessage(`Submit follow-up failed: ${result.error.message}`);
      return;
    }

    setMessage("Follow-up answers applied");
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
      setMessage(`Save correction failed: ${result.error.message}`);
      return;
    }

    setMessage(saveAsRule ? "Correction saved and promoted to rule" : "Correction saved");
  };

  const onListRules = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    const result = await window.filePilotApi.listRules({ includeDisabled: true });
    if (!result.ok) {
      setMessage(`List rules failed: ${result.error.message}`);
      return;
    }

    setRules(result.data);
    setMessage(`Loaded ${result.data.length} rules`);
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
      setMessage(`Update rule failed: ${result.error.message}`);
      return;
    }

    setRules((current) => current.map((item) => (item.id === rule.id ? result.data : item)));
  };

  const onSaveWhitelist = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      setMessage("IPC not ready");
      return;
    }

    const directories = whitelistInput
      .split(";")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    if (directories.length === 0) {
      setMessage("Input whitelist directories first, use ';' to split");
      return;
    }

    const result = await window.filePilotApi.saveWhitelist({ directories });
    if (result.ok) {
      setReadOnlyMode(false);
      setWizardVisible(false);
      setMessage("Whitelist saved");
      return;
    }

    setMessage(`Save whitelist failed: ${result.error.message}`);
  };

  const onClearLogs = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    const result = await window.filePilotApi.clearLogs();
    if (!result.ok) {
      setMessage(`Clear logs failed: ${result.error.message}`);
      return;
    }

    const status = await window.filePilotApi.getLogStatus();
    if (status.ok) {
      setLogStatus(status.data);
    }

    setMessage("Logs cleared");
  };

  const onEnableReadOnlyMode = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      setMessage("IPC not ready");
      return;
    }

    const result = await window.filePilotApi.setReadOnlyMode({ enabled: true });
    if (!result.ok) {
      setMessage(`Set read-only failed: ${result.error.message}`);
      return;
    }

    setReadOnlyMode(true);
    setWizardVisible(false);
    setMessage("Read-only mode enabled");
  };

  const onRefreshLogStatus = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    const status = await window.filePilotApi.getLogStatus();
    if (status.ok) {
      setLogStatus(status.data);
      setMessage(status.data.warn ? "Log size is close to warning threshold" : "Log size is healthy");
    }
  };

  const onApplyDryRun = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    if (readOnlyMode) {
      setMessage("Read-only mode blocks dry-run execution");
      return;
    }

    const result = await window.filePilotApi.apply({ sessionId, action: "move", dryRun: true });
    setMessage(result.ok ? "Dry-run completed" : `Dry-run failed: ${result.error.message}`);
  };

  const onRollback = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    if (readOnlyMode) {
      setMessage("Read-only mode blocks rollback");
      return;
    }

    const result = await window.filePilotApi.rollback({ sessionId });
    setMessage(result.ok ? "Rollback completed" : `Rollback failed: ${result.error.message}`);
  };

  const onExportLogs = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    const result = await window.filePilotApi.exportLogs({ anonymize });
    setMessage(result.ok ? `Logs exported: ${result.data.path}` : `Export logs failed: ${result.error.message}`);
  };

  const onCheckUpdates = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      setMessage("IPC not ready");
      return;
    }

    const result = await window.filePilotApi.checkUpdates({ channel: updateChannel });
    if (!result.ok) {
      setMessage(`Check updates failed: ${result.error.message}`);
      return;
    }

    setLatestVersion(result.data.latestVersion ?? null);
    setDownloadedInstallerPath(null);
    setMessage(
      result.data.available
        ? `Update found: ${result.data.latestVersion ?? "unknown"}`
        : `Already latest version (${result.data.currentVersion})`
    );
  };

  const onDownloadUpdate = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      setMessage("IPC not ready");
      return;
    }

    const result = await window.filePilotApi.downloadUpdate({ channel: updateChannel });
    if (!result.ok) {
      setMessage(`Download update failed: ${result.error.message}`);
      return;
    }

    setDownloadedInstallerPath(result.data.installerPath);
    setLatestVersion(result.data.version);
    setMessage(`Update downloaded: v${result.data.version}`);
  };

  const onInstallUpdate = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      setMessage("IPC not ready");
      return;
    }

    if (downloadedInstallerPath === null) {
      setMessage("Download installer first");
      return;
    }

    const result = await window.filePilotApi.installUpdate({ installerPath: downloadedInstallerPath });
    if (!result.ok) {
      setMessage(`Install update failed: ${result.error.message}`);
      return;
    }

    setMessage("Installer launched, app will exit");
  };

  return (
    <main className="container">
      <h1>File-Pilot M2/M3</h1>
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
        Drop files here
      </section>

      <div className="controls">
        <input
          placeholder="Whitelist directories, split with ';'"
          value={whitelistInput}
          onChange={(event) => setWhitelistInput(event.target.value)}
        />
        <button onClick={onSaveWhitelist}>Save Whitelist</button>
      </div>

      <div className="controls">
        <button onClick={onAnalyze} disabled={!canAnalyze}>
          Analyze and Plan
        </button>
        <button onClick={onApplyDryRun} disabled={readOnlyMode}>
          Dry-run
        </button>
        <button onClick={onRollback} disabled={readOnlyMode}>
          Rollback
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
          Update Channel
          <select value={updateChannel} onChange={(event) => setUpdateChannel(event.target.value as "beta" | "stable")}>
            <option value="beta">beta</option>
            <option value="stable">stable</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={anonymize}
            onChange={(event) => setAnonymize(event.target.checked)}
          />
          Anonymize logs
        </label>
        <button onClick={onExportLogs}>Export Logs</button>
        <button onClick={onRefreshLogStatus}>Refresh Log Status</button>
        <button onClick={onClearLogs}>Clear Logs</button>
        <button onClick={onCheckUpdates}>Check Updates</button>
        <button onClick={onDownloadUpdate}>Download Update</button>
        <button onClick={onInstallUpdate} disabled={downloadedInstallerPath === null}>Install Update</button>
        <button onClick={() => setSessionId(genSessionId())}>New Session</button>
      </div>

      {logStatus !== null && (
        <p>
          Log Size: {logStatus.sizeBytes} bytes {logStatus.warn ? "(warn)" : "(ok)"}
        </p>
      )}

      {readOnlyMode && <p>Current Mode: Read-only</p>}

      {latestVersion !== null && (
        <p>
          Latest Version: {latestVersion}
          {downloadedInstallerPath === null ? " (not downloaded)" : " (downloaded)"}
        </p>
      )}

      <pre>{JSON.stringify({ sessionId, filePaths, analyzeData }, null, 2)}</pre>
    </main>
  );
};


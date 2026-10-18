import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Play, Sparkles } from "lucide-react";

import type { AppSettings } from "../../shared/types/settings.js";
import type { Purpose } from "../../shared/types/workflow.js";
import { Button } from "../components/ui/button.js";
import { mergeAnalyzeData } from "./analyze-state.js";
import { ClassificationFeedbackPanel } from "./components/classification-feedback-panel.js";
import { FirstRunWizard } from "./components/first-run-wizard.js";
import { FileDropzone } from "./popover/file-dropzone.js";
import { PlanCard } from "./popover/plan-card.js";
import { PopoverFooter } from "./popover/popover-footer.js";
import { PopoverHeader } from "./popover/popover-header.js";
import { usePopoverSizing } from "./popover/use-popover-sizing.js";
import type { AnalyzeData, SaveCorrectionsData, SubmitFollowupData } from "./types.js";

const genSessionId = (): string => crypto.randomUUID();

const parseDroppedFiles = (event: DragEvent<HTMLDivElement>): string[] => {
  const items = event.dataTransfer.files;
  return Array.from(items).map((file) => {
    const maybePath = (file as File & { path?: string }).path;
    return maybePath ?? file.name;
  });
};

const basenameOf = (path: string): string => {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
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
  const { cardRef, contentRef } = usePopoverSizing();
  const [sessionId, setSessionId] = useState<string>(genSessionId());
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const [message, setMessage] = useState<string>("");
  const [whitelistInput, setWhitelistInput] = useState<string>("");
  const [wizardVisible, setWizardVisible] = useState<boolean>(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [riskAccepted, setRiskAccepted] = useState<boolean>(false);
  const [readOnlyMode, setReadOnlyMode] = useState<boolean>(false);
  const [analyzeData, setAnalyzeData] = useState<AnalyzeData | null>(null);
  const [followupAnswer, setFollowupAnswer] = useState<string>("");
  const [correctionPurpose, setCorrectionPurpose] = useState<Purpose>("Documents");
  const [correctionProject, setCorrectionProject] = useState<string>("Default Project");
  const [saveAsRule, setSaveAsRule] = useState<boolean>(true);
  const [applyConfirm, setApplyConfirm] = useState<boolean>(false);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const bootstrappedRef = useRef<boolean>(false);

  const canAnalyze = useMemo(() => filePaths.length > 0 && !readOnlyMode, [filePaths, readOnlyMode]);
  const firstItemId = analyzeData?.items[0]?.item.id;

  const applySettings = useCallback((settings: AppSettings): void => {
    setReadOnlyMode(settings.readOnlyMode);
    setWhitelistInput(settings.whitelistDirectories.join(";"));

    if (settings.language !== undefined && i18n.language !== settings.language) {
      void i18n.changeLanguage(settings.language);
    }

    if (settings.whitelistDirectories.length === 0) {
      if (!settings.readOnlyMode) {
        setWizardVisible(true);
      }
    } else {
      setWizardVisible(false);
      setMessage(t("app.dropMessage"));
    }
  }, [i18n, t]);

  useEffect(() => {
    setMessage(t("app.dropMessage"));
  }, [i18n.language, t]);

  useEffect(() => {
    if (bootstrappedRef.current) {
      return;
    }
    bootstrappedRef.current = true;

    const bootstrap = async (): Promise<void> => {
      const api = window.filePilotApi;
      if (api === undefined) {
        return;
      }

      const settingsResult = await api.getSettings();
      if (!settingsResult.ok) {
        setMessage(t("app.analyzeFailed", { message: settingsResult.error.message }));
        return;
      }

      applySettings(settingsResult.data);
      if (settingsResult.data.whitelistDirectories.length === 0) {
        setMessage(settingsResult.data.readOnlyMode ? t("app.readOnlyLater") : t("app.firstRunDetected"));
      }
    };

    void bootstrap();
  }, [applySettings, t]);

  useEffect(() => {
    const api = window.filePilotApi;
    if (api === undefined || api.onPopoverShown === undefined) {
      return;
    }

    return api.onPopoverShown(() => {
      void (async () => {
        const result = await api.getSettings();
        if (result.ok) {
          applySettings(result.data);
        }
      })();
    });
  }, [applySettings]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        void window.filePilotApi?.hidePopover();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const receiveFiles = (paths: string[]): void => {
    if (paths.length === 0) {
      return;
    }
    setFilePaths(paths);
    setAnalyzeData(null);
    setApplyConfirm(false);
    setMessage(t("app.filesReceived"));
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragActive(false);
    receiveFiles(parseDroppedFiles(event));
  };

  const onPickFiles = async (): Promise<void> => {
    const api = window.filePilotApi;
    if (api === undefined) {
      setMessage(t("app.ipcNotReady"));
      return;
    }
    const result = await api.pickFiles();
    if (!result.ok) {
      setMessage(t("app.analyzeFailed", { message: result.error.message }));
      return;
    }
    receiveFiles(result.data.paths);
  };

  const onOpenSettings = async (): Promise<void> => {
    await window.filePilotApi?.openSettings();
  };

  const onHidePopover = async (): Promise<void> => {
    await window.filePilotApi?.hidePopover();
  };

  const onOpenWorkspace = async (): Promise<void> => {
    const result = await window.filePilotApi?.openWorkspace();
    if (result !== undefined && !result.ok) {
      setMessage(t("app.analyzeFailed", { message: result.error.message }));
    }
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

    setApplyConfirm(false);
    const result = await window.filePilotApi.analyze({ sessionId, filePaths });
    if (!result.ok) {
      setMessage(t("app.analyzeFailed", { message: result.error.message }));
      return;
    }

    setAnalyzeData(result.data);
    setMessage(result.data.needsFollowUp ? t("app.analyzeCompletedFollowup") : t("app.analyzeCompleted"));
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
    setMessage(saveAsRule ? t("app.correctionSavedRule") : t("app.correctionSaved"));
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
    if (!result.ok) {
      setMessage(t("app.whitelistFailed", { message: result.error.message }));
      return;
    }

    const readOnlyResult = await window.filePilotApi.setReadOnlyMode({ enabled: false });
    if (!readOnlyResult.ok) {
      setMessage(t("app.readOnlyDisableFailed", { message: readOnlyResult.error.message }));
      return;
    }

    setReadOnlyMode(false);
    setWizardVisible(false);
    setMessage(t("app.whitelistSaved"));
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

  const onApplyDryRun = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    if (readOnlyMode) {
      setMessage(t("app.readOnlyBlocksDryRun"));
      return;
    }

    if (analyzeData === null) {
      setMessage(t("app.dryRunRequiresAnalyze"));
      return;
    }

    const result = await window.filePilotApi.apply({
      sessionId: analyzeData.sessionId,
      action: "move",
      dryRun: true
    });
    setMessage(result.ok ? t("app.dryRunCompleted") : t("app.dryRunFailed", { message: result.error.message }));
  };

  const onApply = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    if (readOnlyMode) {
      setMessage(t("app.readOnlyBlocksApply"));
      return;
    }

    if (analyzeData === null) {
      setMessage(t("app.applyRequiresAnalyze"));
      return;
    }

    if (!applyConfirm) {
      setApplyConfirm(true);
      setMessage(t("app.applyConfirm"));
      return;
    }

    setApplyConfirm(false);
    const result = await window.filePilotApi.apply({
      sessionId: analyzeData.sessionId,
      action: "move",
      dryRun: false
    });
    setMessage(result.ok ? t("app.applyCompleted") : t("app.applyFailed", { message: result.error.message }));
  };

  const onRollback = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    if (readOnlyMode) {
      setMessage(t("app.readOnlyBlocksRollback"));
      return;
    }

    if (analyzeData === null) {
      setMessage(t("app.rollbackRequiresAnalyze"));
      return;
    }

    setApplyConfirm(false);
    const result = await window.filePilotApi.rollback({ sessionId: analyzeData.sessionId });
    setMessage(result.ok ? t("app.rollbackCompleted") : t("app.rollbackFailed", { message: result.error.message }));
  };

  const onNewSession = (): void => {
    setSessionId(genSessionId());
    setFilePaths([]);
    setAnalyzeData(null);
    setApplyConfirm(false);
    setFollowupAnswer("");
    setMessage(t("app.dropMessage"));
  };

  return (
    <div className="popover-stage">
      <div ref={cardRef} className="popover-card">
        <PopoverHeader
          readOnly={readOnlyMode}
          onOpenSettings={() => { void onOpenSettings(); }}
          onHide={() => { void onHidePopover(); }}
        />

        <div className="popover-body">
          <div ref={contentRef} className="popover-content">
            <p data-testid="app-message" className="status-line" aria-live="polite">
              {message}
            </p>

            <FirstRunWizard
              visible={wizardVisible}
              step={wizardStep}
              whitelistInput={whitelistInput}
              riskAccepted={riskAccepted}
              onWhitelistInputChange={setWhitelistInput}
              onRiskAcceptedChange={setRiskAccepted}
              onStepChange={setWizardStep}
              onSkipReadOnly={() => { void onEnableReadOnlyMode(); }}
              onSaveWhitelist={() => { void onSaveWhitelist(); }}
            />

            <FileDropzone
              dragActive={dragActive}
              fileCount={filePaths.length}
              onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDrop}
              onPickFiles={() => { void onPickFiles(); }}
            />

            {filePaths.length > 0 && (
              <div className="file-strip">
                {filePaths.slice(0, 3).map((path) => (
                  <span key={path} className="file-chip" title={path}>
                    <FileText className="h-3 w-3" />
                    {basenameOf(path)}
                  </span>
                ))}
                {filePaths.length > 3 && <span className="file-chip">+{filePaths.length - 3}</span>}
              </div>
            )}

            <div className="action-row">
              <Button
                className="primary-action flex-1"
                onClick={() => { void onAnalyze(); }}
                disabled={!canAnalyze}
              >
                <Sparkles className="h-4 w-4" />
                {t("actions.analyze")}
              </Button>
              <Button
                variant="outline"
                className="secondary-action"
                onClick={() => { void onApplyDryRun(); }}
                disabled={analyzeData === null || readOnlyMode}
              >
                <Play className="h-4 w-4" />
                {t("actions.dryRun")}
              </Button>
            </div>

            {analyzeData !== null && (
              <PlanCard
                analyzeData={analyzeData}
                applyConfirm={applyConfirm}
                readOnly={readOnlyMode}
                onApply={() => { void onApply(); }}
                onRollback={() => { void onRollback(); }}
              />
            )}

            <div className="refine-card">
              <ClassificationFeedbackPanel
                analyzeData={analyzeData}
                firstItemId={firstItemId}
                followupAnswer={followupAnswer}
                onFollowupAnswerChange={setFollowupAnswer}
                onSubmitFollowup={() => { void onSubmitFollowup(); }}
                correctionPurpose={correctionPurpose}
                purposeOptions={purposeOptions}
                onCorrectionPurposeChange={setCorrectionPurpose}
                correctionProject={correctionProject}
                onCorrectionProjectChange={setCorrectionProject}
                saveAsRule={saveAsRule}
                onSaveAsRuleChange={setSaveAsRule}
                onSaveCorrection={() => { void onSaveCorrection(); }}
              />
            </div>

            <PopoverFooter
              onOpenWorkspace={() => { void onOpenWorkspace(); }}
              onNewSession={onNewSession}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

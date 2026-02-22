import { useEffect, useMemo, useState, type DragEvent } from "react";

import type { ClassificationRule } from "../../shared/types/rules.js";
import type { Purpose } from "../../shared/types/workflow.js";

const genSessionId = (): string => crypto.randomUUID();

const parseDroppedFiles = (event: DragEvent<HTMLDivElement>): string[] => {
  const items = event.dataTransfer.files;
  return Array.from(items).map((file) => {
    const maybePath = (file as File & { path?: string }).path;
    return maybePath ?? file.name;
  });
};

interface AnalyzeData {
  sessionId: string;
  needsFollowUp: boolean;
  followUpQuestions: Array<{ fileId: string; question: string }>;
  items: Array<{
    item: { id: string; name: string };
    classification: { purpose: Purpose; project: string; confidence: number; decisionSource?: string };
  }>;
}

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
  const [message, setMessage] = useState<string>("拖入文件开始 M2/M3 流程");
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
  const [followupAnswer, setFollowupAnswer] = useState<string>("默认项目");
  const [correctionPurpose, setCorrectionPurpose] = useState<Purpose>("Documents");
  const [correctionProject, setCorrectionProject] = useState<string>("默认项目");
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
            setMessage("首次运行，请完成白名单三步引导");
          } else {
            setMessage("当前为只读模式，可先体验界面后再配置白名单");
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
    setMessage("已获取拖拽文件，准备分析");
  };

  const onAnalyze = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      setMessage("IPC 未就绪");
      return;
    }

    if (readOnlyMode) {
      setMessage("当前为只读模式，请先配置白名单后再分析");
      return;
    }

    const result = await window.filePilotApi.analyze({ sessionId, filePaths });
    if (!result.ok) {
      setMessage(`分析失败: ${result.error.message}`);
      return;
    }

    const data = result.data as AnalyzeData;
    setAnalyzeData(data);
    setMessage(data.needsFollowUp ? "分析完成，存在低置信度项，请先补充追问" : "分析完成，已生成 Dry-run 计划");
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
      setMessage(`追问提交失败: ${result.error.message}`);
      return;
    }

    setMessage("追问答案已应用");
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
      setMessage(`保存修正失败: ${result.error.message}`);
      return;
    }

    setMessage(saveAsRule ? "修正已保存并沉淀为规则" : "修正已保存");
  };

  const onListRules = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    const result = await window.filePilotApi.listRules({ includeDisabled: true });
    if (!result.ok) {
      setMessage(`读取规则失败: ${result.error.message}`);
      return;
    }

    setRules(result.data);
    setMessage(`已加载 ${result.data.length} 条规则`);
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
      setMessage(`更新规则失败: ${result.error.message}`);
      return;
    }

    setRules((current) => current.map((item) => (item.id === rule.id ? result.data : item)));
  };

  const onSaveWhitelist = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      setMessage("IPC 未就绪");
      return;
    }

    const directories = whitelistInput
      .split(";")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    if (directories.length === 0) {
      setMessage("请先输入白名单目录，多个目录用分号分隔");
      return;
    }

    const result = await window.filePilotApi.saveWhitelist({ directories });
    if (result.ok) {
      setReadOnlyMode(false);
      setWizardVisible(false);
      setMessage("白名单已保存");
      return;
    }

    setMessage(`白名单保存失败: ${result.error.message}`);
  };

  const onClearLogs = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    const result = await window.filePilotApi.clearLogs();
    if (!result.ok) {
      setMessage(`日志清理失败: ${result.error.message}`);
      return;
    }

    const status = await window.filePilotApi.getLogStatus();
    if (status.ok) {
      setLogStatus(status.data);
    }

    setMessage("日志已清理");
  };

  const onEnableReadOnlyMode = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      setMessage("IPC 未就绪");
      return;
    }

    const result = await window.filePilotApi.setReadOnlyMode({ enabled: true });
    if (!result.ok) {
      setMessage(`只读模式设置失败: ${result.error.message}`);
      return;
    }

    setReadOnlyMode(true);
    setWizardVisible(false);
    setMessage("已进入只读模式，可稍后在白名单中完成配置");
  };

  const onRefreshLogStatus = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    const status = await window.filePilotApi.getLogStatus();
    if (status.ok) {
      setLogStatus(status.data);
      setMessage(status.data.warn ? "日志体积接近阈值" : "日志体积正常");
    }
  };

  const renderWizard = (): JSX.Element | null => {
    if (!wizardVisible) {
      return null;
    }

    return (
      <section className="wizard">
        <h2>首次运行白名单引导（第 {wizardStep} / 3 步）</h2>

        {wizardStep === 1 && (
          <>
            <p>请选择允许操作的目录（多个用 ; 分隔）。</p>
            <input
              placeholder="例如 D:/Workspace;D:/Study"
              value={whitelistInput}
              onChange={(event) => setWhitelistInput(event.target.value)}
            />
            <div className="controls">
              <button onClick={() => setWizardStep(2)}>下一步</button>
              <button onClick={onEnableReadOnlyMode}>跳过（只读体验）</button>
            </div>
          </>
        )}

        {wizardStep === 2 && (
          <>
            <p>风险提示：程序仅会在白名单目录内执行移动/复制。</p>
            <label>
              <input
                type="checkbox"
                checked={riskAccepted}
                onChange={(event) => setRiskAccepted(event.target.checked)}
              />
              我已阅读并理解风险提示
            </label>
            <div className="controls">
              <button onClick={() => setWizardStep(1)}>上一步</button>
              <button onClick={() => setWizardStep(3)} disabled={!riskAccepted}>下一步</button>
            </div>
          </>
        )}

        {wizardStep === 3 && (
          <>
            <p>确认后将保存白名单并启用主流程。</p>
            <div className="controls">
              <button onClick={() => setWizardStep(2)}>上一步</button>
              <button onClick={onSaveWhitelist}>确认并完成</button>
            </div>
          </>
        )}
      </section>
    );
  };

  const onApplyDryRun = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    if (readOnlyMode) {
      setMessage("当前为只读模式，无法执行 Dry-run");
      return;
    }

    const result = await window.filePilotApi.apply({ sessionId, action: "move", dryRun: true });
    setMessage(result.ok ? "Dry-run 完成，可确认执行" : `Dry-run 失败: ${result.error.message}`);
  };

  const onRollback = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    if (readOnlyMode) {
      setMessage("当前为只读模式，无法执行回滚");
      return;
    }

    const result = await window.filePilotApi.rollback({ sessionId });
    setMessage(result.ok ? "会话回滚完成" : `回滚失败: ${result.error.message}`);
  };

  const onExportLogs = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      return;
    }

    const result = await window.filePilotApi.exportLogs({ anonymize });
    setMessage(result.ok ? `日志已导出: ${result.data.path}` : `导出失败: ${result.error.message}`);
  };

  const onCheckUpdates = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      setMessage("IPC 未就绪");
      return;
    }

    const result = await window.filePilotApi.checkUpdates({ channel: updateChannel });
    if (!result.ok) {
      setMessage(`更新检查失败: ${result.error.message}`);
      return;
    }

    setLatestVersion(result.data.latestVersion ?? null);
    setDownloadedInstallerPath(null);

    setMessage(
      result.data.available
        ? `发现新版本: ${result.data.latestVersion ?? "unknown"}`
        : `当前已是最新版本 (${result.data.currentVersion})`
    );
  };

  const onDownloadUpdate = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      setMessage("IPC 未就绪");
      return;
    }

    const result = await window.filePilotApi.downloadUpdate({ channel: updateChannel });
    if (!result.ok) {
      setMessage(`下载更新失败: ${result.error.message}`);
      return;
    }

    setDownloadedInstallerPath(result.data.installerPath);
    setLatestVersion(result.data.version);
    setMessage(`更新已下载: v${result.data.version}`);
  };

  const onInstallUpdate = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
      setMessage("IPC 未就绪");
      return;
    }

    if (downloadedInstallerPath === null) {
      setMessage("请先下载更新安装包");
      return;
    }

    const result = await window.filePilotApi.installUpdate({ installerPath: downloadedInstallerPath });
    if (!result.ok) {
      setMessage(`启动安装失败: ${result.error.message}`);
      return;
    }

    setMessage("安装器已启动，应用将退出完成安装");
  };

  return (
    <main className="container">
      <h1>File-Pilot M2/M3</h1>
      <p>{message}</p>

      {renderWizard()}

      <section
        className="dropzone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        拖拽文件到这里
      </section>

      <div className="controls">
        <input
          placeholder="白名单目录，多个用 ; 分隔"
          value={whitelistInput}
          onChange={(event) => setWhitelistInput(event.target.value)}
        />
        <button onClick={onSaveWhitelist}>保存白名单</button>
      </div>

      <div className="controls">
        <button onClick={onAnalyze} disabled={!canAnalyze}>
          分析并规划
        </button>
        <button onClick={onApplyDryRun} disabled={readOnlyMode}>
          Dry-run
        </button>
        <button onClick={onRollback} disabled={readOnlyMode}>
          回滚
        </button>
      </div>

      {analyzeData !== null && analyzeData.needsFollowUp && (
        <section className="controls">
          <input
            value={followupAnswer}
            onChange={(event) => setFollowupAnswer(event.target.value)}
            placeholder="低置信度追问答案（可整批）"
          />
          <button onClick={onSubmitFollowup}>提交追问</button>
        </section>
      )}

      {analyzeData !== null && firstItemId !== undefined && (
        <section className="controls">
          <label>
            修正用途
            <select
              value={correctionPurpose}
              onChange={(event) => setCorrectionPurpose(event.target.value as Purpose)}
            >
              {purposeOptions.map((purpose) => (
                <option key={purpose} value={purpose}>{purpose}</option>
              ))}
            </select>
          </label>
          <input
            value={correctionProject}
            onChange={(event) => setCorrectionProject(event.target.value)}
            placeholder="修正项目"
          />
          <label>
            <input
              type="checkbox"
              checked={saveAsRule}
              onChange={(event) => setSaveAsRule(event.target.checked)}
            />
            沉淀为规则
          </label>
          <button onClick={onSaveCorrection}>保存修正</button>
        </section>
      )}

      <section className="controls">
        <button onClick={onListRules}>刷新规则列表</button>
        {rules.map((rule) => (
          <button key={rule.id} onClick={() => onToggleRule(rule)}>
            {rule.enabled ? "禁用" : "启用"} {rule.project}
          </button>
        ))}
      </section>

      <div className="controls">
        <label>
          更新通道
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
          日志匿名化
        </label>
        <button onClick={onExportLogs}>导出日志</button>
        <button onClick={onRefreshLogStatus}>日志状态</button>
        <button onClick={onClearLogs}>清理日志</button>
        <button onClick={onCheckUpdates}>检查更新</button>
        <button onClick={onDownloadUpdate}>下载更新</button>
        <button onClick={onInstallUpdate} disabled={downloadedInstallerPath === null}>重启安装</button>
        <button onClick={() => setSessionId(genSessionId())}>新建会话</button>
      </div>

      {logStatus !== null && (
        <p>
          日志大小: {logStatus.sizeBytes} bytes {logStatus.warn ? "(接近阈值)" : "(正常)"}
        </p>
      )}

      {readOnlyMode && <p>当前模式: 只读（白名单未配置）</p>}

      {latestVersion !== null && (
        <p>
          最新版本: {latestVersion}
          {downloadedInstallerPath === null ? " (未下载)" : " (已下载)"}
        </p>
      )}

      <pre>{JSON.stringify({ sessionId, filePaths, analyzeData }, null, 2)}</pre>
    </main>
  );
};


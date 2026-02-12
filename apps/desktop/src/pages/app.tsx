import { useEffect, useMemo, useState, type DragEvent } from "react";

const genSessionId = (): string => crypto.randomUUID();

const parseDroppedFiles = (event: DragEvent<HTMLDivElement>): string[] => {
  const items = event.dataTransfer.files;
  return Array.from(items).map((file) => {
    const maybePath = (file as File & { path?: string }).path;
    return maybePath ?? file.name;
  });
};

export const App = (): JSX.Element => {
  const [sessionId, setSessionId] = useState<string>(genSessionId());
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const [message, setMessage] = useState<string>("拖入文件开始 M1 流程");
  const [anonymize, setAnonymize] = useState<boolean>(true);
  const [whitelistInput, setWhitelistInput] = useState<string>("");
  const [wizardVisible, setWizardVisible] = useState<boolean>(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [riskAccepted, setRiskAccepted] = useState<boolean>(false);
  const [logStatus, setLogStatus] = useState<{ sizeBytes: number; warn: boolean } | null>(null);

  const canAnalyze = useMemo(() => filePaths.length > 0, [filePaths]);

  useEffect(() => {
    const bootstrap = async (): Promise<void> => {
      if (window.filePilotApi === undefined) {
        return;
      }

      const settingsResult = await window.filePilotApi.getSettings();
      if (settingsResult.ok) {
        if (settingsResult.data.whitelistDirectories.length === 0) {
          setWizardVisible(true);
          setMessage("首次运行，请完成白名单三步引导");
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

    const result = await window.filePilotApi.analyze({ sessionId, filePaths });
    if (result.ok) {
      setMessage("分析完成，已生成 Dry-run 计划");
      return;
    }

    setMessage(`分析失败: ${result.error.message}`);
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
            <button onClick={() => setWizardStep(2)}>下一步</button>
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

    const result = await window.filePilotApi.apply({ sessionId, action: "move", dryRun: true });
    setMessage(result.ok ? "Dry-run 完成，可确认执行" : `Dry-run 失败: ${result.error.message}`);
  };

  const onRollback = async (): Promise<void> => {
    if (window.filePilotApi === undefined) {
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

    const result = await window.filePilotApi.checkUpdates();
    if (!result.ok) {
      setMessage(`更新检查失败: ${result.error.message}`);
      return;
    }

    setMessage(
      result.data.available
        ? `发现新版本: ${result.data.latestVersion ?? "unknown"}`
        : `当前已是最新版本 (${result.data.currentVersion})`
    );
  };

  return (
    <main className="container">
      <h1>File-Pilot M1</h1>
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
        <button onClick={onApplyDryRun}>
          Dry-run
        </button>
        <button onClick={onRollback}>
          回滚
        </button>
      </div>

      <div className="controls">
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
        <button onClick={() => setSessionId(genSessionId())}>新建会话</button>
      </div>

      {logStatus !== null && (
        <p>
          日志大小: {logStatus.sizeBytes} bytes {logStatus.warn ? "(接近阈值)" : "(正常)"}
        </p>
      )}

      <pre>{JSON.stringify({ sessionId, filePaths }, null, 2)}</pre>
    </main>
  );
};

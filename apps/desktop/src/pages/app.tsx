import { useMemo, useState, type DragEvent } from "react";

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

  const canAnalyze = useMemo(() => filePaths.length > 0, [filePaths]);

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

  return (
    <main className="container">
      <h1>File-Pilot M1</h1>
      <p>{message}</p>

      <section
        className="dropzone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        拖拽文件到这里
      </section>

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
        <button onClick={() => setSessionId(genSessionId())}>新建会话</button>
      </div>

      <pre>{JSON.stringify({ sessionId, filePaths }, null, 2)}</pre>
    </main>
  );
};

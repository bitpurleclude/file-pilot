import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import type { LlmProviderConfig } from "../../shared/types/llm-provider.js";
import { launchElectronApp } from "./helpers/electron-launch.js";
import { startLlmStub } from "./helpers/llm-stub.js";

const STUB_API_KEY = "e2e-stub-key";
const STUB_PROJECT = "StubProject";
const FILE_A_NAME = "rollback-alpha-e2e.txt";
const FILE_B_NAME = "rollback-bravo-e2e.txt";

interface AnalyzedFileSnapshot {
  name: string;
  decisionSource: string;
  project: string;
  sourcePath: string;
  targetPath: string;
}

interface AnalyzePhaseSnapshot {
  sessionId: string;
  items: AnalyzedFileSnapshot[];
}

interface ExecutionSnapshot {
  sourcePath: string;
  targetPath: string;
  executed: boolean;
  rollbackable: boolean;
  reason: string | null;
}

interface SessionSnapshot {
  id: string;
  status: string;
  executions: ExecutionSnapshot[];
}

/**
 * evaluate 载荷必须是可序列化的未知结构：用类型守卫收窄 IPC 信封（禁止 any）。
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

interface IpcOkEnvelope {
  ok: true;
  data: unknown;
}

interface IpcErrorEnvelope {
  ok: false;
  error: { code: string; message: string };
}

const asIpcEnvelope = (value: unknown, stage: string): IpcOkEnvelope | IpcErrorEnvelope => {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    throw new Error(`${stage}: unexpected ipc envelope shape: ${JSON.stringify(value)}`);
  }
  if (value.ok) {
    return { ok: true, data: value.data };
  }
  const error = value.error;
  if (!isRecord(error) || typeof error.code !== "string" || typeof error.message !== "string") {
    throw new Error(`${stage}: unexpected ipc error shape: ${JSON.stringify(value)}`);
  }
  return { ok: false, error: { code: error.code, message: error.message } };
};

const expectOkData = (envelope: IpcOkEnvelope | IpcErrorEnvelope, stage: string): unknown => {
  const failure = envelope.ok ? "" : ` — ${JSON.stringify(envelope.error)}`;
  expect(envelope.ok, `${stage} must succeed${failure}`).toBe(true);
  if (!envelope.ok) {
    throw new Error(`${stage}: unreachable after ok assertion`);
  }
  return envelope.data;
};

const toAnalyzeSnapshot = (data: unknown, stage: string): AnalyzePhaseSnapshot => {
  if (!isRecord(data) || typeof data.sessionId !== "string" || !Array.isArray(data.items)) {
    throw new Error(`${stage}: analyze payload shape mismatch: ${JSON.stringify(data)}`);
  }
  return {
    sessionId: data.sessionId,
    items: data.items.map((entry): AnalyzedFileSnapshot => {
      if (
        !isRecord(entry)
        || !isRecord(entry.item)
        || !isRecord(entry.classification)
        || !isRecord(entry.plan)
      ) {
        throw new Error(`${stage}: analyze item shape mismatch`);
      }
      const item = entry.item;
      const classification = entry.classification;
      const plan = entry.plan;
      if (
        typeof item.name !== "string"
        || typeof classification.decisionSource !== "string"
        || typeof classification.project !== "string"
        || typeof plan.sourcePath !== "string"
        || typeof plan.targetPath !== "string"
      ) {
        throw new Error(`${stage}: analyze item field shape mismatch`);
      }
      return {
        name: item.name,
        decisionSource: classification.decisionSource,
        project: classification.project,
        sourcePath: plan.sourcePath,
        targetPath: plan.targetPath
      };
    })
  };
};

const toSessionSnapshot = (data: unknown, stage: string): SessionSnapshot => {
  if (
    !isRecord(data)
    || typeof data.id !== "string"
    || typeof data.status !== "string"
    || !Array.isArray(data.executions)
  ) {
    throw new Error(`${stage}: session payload shape mismatch: ${JSON.stringify(data)}`);
  }
  return {
    id: data.id,
    status: data.status,
    executions: data.executions.map((entry): ExecutionSnapshot => {
      if (!isRecord(entry) || !isRecord(entry.plan)) {
        throw new Error(`${stage}: execution payload shape mismatch`);
      }
      const plan = entry.plan;
      if (typeof plan.sourcePath !== "string" || typeof plan.targetPath !== "string") {
        throw new Error(`${stage}: execution plan path shape mismatch`);
      }
      return {
        sourcePath: plan.sourcePath,
        targetPath: plan.targetPath,
        executed: entry.executed === true,
        rollbackable: entry.rollbackable === true,
        reason: typeof entry.reason === "string" ? entry.reason : null
      };
    })
  };
};

/**
 * 阶段 1：白名单 → saveSettings 指向本地 stub → analyze。
 * 返回原始 IPC 信封（可序列化），由 Node 侧收窄断言。
 */
const analyzePhase = async (
  page: Page,
  params: { sandboxDir: string; stubUrl: string; stubApiKey: string; filePaths: string[] }
): Promise<unknown> => {
  return page.evaluate(async ({ sandboxDir, stubUrl, stubApiKey, filePaths }) => {
    if (window.filePilotApi === undefined) {
      throw new Error("window.filePilotApi is missing");
    }
    const api = window.filePilotApi;

    const whitelist = await api.saveWhitelist({ directories: [sandboxDir] });
    if (!whitelist.ok) {
      throw new Error(`saveWhitelist failed: ${whitelist.error.message}`);
    }

    // providerConfigSchema 是 strict 的：从 getSettings 结果原样改字段后回传。
    const settings = await api.getSettings();
    if (!settings.ok) {
      throw new Error(`getSettings failed: ${settings.error.message}`);
    }
    const activeProviderId = settings.data.llmProviders.activeProviderId;
    const providers: LlmProviderConfig[] = settings.data.llmProviders.providers.map((provider) => (
      provider.id === activeProviderId
        ? { ...provider, baseUrl: stubUrl, apiKey: stubApiKey }
        : provider
    ));
    const [firstProvider, ...restProviders] = providers;
    if (firstProvider === undefined) {
      throw new Error("no providers in settings");
    }
    const saved = await api.saveSettings({
      llmProviders: { activeProviderId, providers: [firstProvider, ...restProviders] }
    });
    if (!saved.ok) {
      throw new Error(`saveSettings failed: ${saved.error.message}`);
    }

    return api.analyze({ sessionId: crypto.randomUUID(), filePaths });
  }, params);
};

const applyPhase = async (
  page: Page,
  params: { sessionId: string; dryRun: boolean }
): Promise<unknown> => {
  return page.evaluate(async ({ sessionId, dryRun }) => {
    if (window.filePilotApi === undefined) {
      throw new Error("window.filePilotApi is missing");
    }
    return window.filePilotApi.apply({ sessionId, action: "move", dryRun });
  }, params);
};

const rollbackPhase = async (page: Page, sessionId: string): Promise<unknown> => {
  return page.evaluate(async (id) => {
    if (window.filePilotApi === undefined) {
      throw new Error("window.filePilotApi is missing");
    }
    return window.filePilotApi.rollback({ sessionId: id });
  }, sessionId);
};

const logStatusPhase = async (page: Page): Promise<unknown> => {
  return page.evaluate(async () => {
    if (window.filePilotApi === undefined) {
      throw new Error("window.filePilotApi is missing");
    }
    return window.filePilotApi.getLogStatus();
  });
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

/** child 是否位于 root 内（大小写不敏感，覆盖 Windows 盘符大小写差异）。 */
const isInsideRoot = (child: string, root: string): boolean => {
  const rel = relative(root.toLowerCase(), child.toLowerCase());
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
};

test("real move then rollback restores every sandbox file end to end", async () => {
  const sandbox = await mkdtemp(join(process.cwd(), "tmp-file-pilot-rollback-"));
  const stub = await startLlmStub();
  const contentA = `rollback alpha payload ${crypto.randomUUID()}`;
  const contentB = `rollback bravo payload ${crypto.randomUUID()}`;
  const fileA = join(sandbox, FILE_A_NAME);
  const fileB = join(sandbox, FILE_B_NAME);
  await writeFile(fileA, contentA, "utf-8");
  await writeFile(fileB, contentB, "utf-8");

  const electronApp = await launchElectronApp();
  expect(electronApp.launchDirs.userDataDir).toContain("file-pilot-e2e-userdata-");

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const workspaceRoot = electronApp.launchDirs.workspaceRoot;

    // ---- analyze：确定性 stub 分类（Documents/StubProject），plan 目标必须落在隔离 workspaceRoot 下 ----
    const analyzed = toAnalyzeSnapshot(
      expectOkData(
        asIpcEnvelope(
          await analyzePhase(page, {
            sandboxDir: sandbox,
            stubUrl: stub.url,
            stubApiKey: STUB_API_KEY,
            filePaths: [fileA, fileB]
          }),
          "analyze"
        ),
        "analyze"
      ),
      "analyze"
    );
    expect(analyzed.items).toHaveLength(2);
    for (const item of analyzed.items) {
      expect(item.decisionSource).toBe("llm-primary");
      expect(item.project).toBe(STUB_PROJECT);
      expect(isInsideRoot(item.targetPath, workspaceRoot)).toBe(true);
      expect(basename(item.targetPath)).toBe(item.name);
      expect(item.sourcePath.startsWith(sandbox)).toBe(true);
    }
    const byName = new Map(analyzed.items.map((item) => [item.name, item]));
    const itemA = byName.get(FILE_A_NAME);
    const itemB = byName.get(FILE_B_NAME);
    if (itemA === undefined || itemB === undefined) {
      throw new Error("unreachable: both analyzed items asserted present");
    }

    // ---- dry-run 先行：文件一个都不能动 ----
    const dryRunSession = toSessionSnapshot(
      expectOkData(
        asIpcEnvelope(
          await applyPhase(page, { sessionId: analyzed.sessionId, dryRun: true }),
          "apply(dry-run)"
        ),
        "apply(dry-run)"
      ),
      "apply(dry-run)"
    );
    expect(dryRunSession.status).toBe("planned");
    expect(dryRunSession.executions).toHaveLength(2);
    for (const execution of dryRunSession.executions) {
      expect(execution.executed).toBe(false);
      expect(execution.rollbackable).toBe(false);
      expect(execution.reason).toBe("dry-run");
    }
    await expect(pathExists(itemA.targetPath)).resolves.toBe(false);
    await expect(pathExists(itemB.targetPath)).resolves.toBe(false);
    await expect(readFile(itemA.sourcePath, "utf-8")).resolves.toBe(contentA);
    await expect(readFile(itemB.sourcePath, "utf-8")).resolves.toBe(contentB);

    // ---- 真实执行：executed=true 且可回滚；fs 上源文件离位、目标文件落地 ----
    const movedSession = toSessionSnapshot(
      expectOkData(
        asIpcEnvelope(
          await applyPhase(page, { sessionId: analyzed.sessionId, dryRun: false }),
          "apply(real move)"
        ),
        "apply(real move)"
      ),
      "apply(real move)"
    );
    expect(movedSession.status).toBe("done");
    expect(movedSession.executions).toHaveLength(2);
    for (const execution of movedSession.executions) {
      expect(execution.executed).toBe(true);
      expect(execution.rollbackable).toBe(true);
      expect(isInsideRoot(execution.targetPath, workspaceRoot)).toBe(true);
    }
    // 全新 workspace 不可能有命名冲突：执行后的目标路径必须与 analyze 计划一致。
    expect(movedSession.executions.map((execution) => execution.targetPath).sort())
      .toEqual([itemA.targetPath, itemB.targetPath].sort());
    await expect(pathExists(itemA.sourcePath)).resolves.toBe(false);
    await expect(pathExists(itemB.sourcePath)).resolves.toBe(false);
    await expect(readFile(itemA.targetPath, "utf-8")).resolves.toBe(contentA);
    await expect(readFile(itemB.targetPath, "utf-8")).resolves.toBe(contentB);

    // ---- 回滚：源文件原位复原（内容一致），目标位置清空 ----
    const rolledBackSession = toSessionSnapshot(
      expectOkData(
        asIpcEnvelope(await rollbackPhase(page, analyzed.sessionId), "rollback"),
        "rollback"
      ),
      "rollback"
    );
    expect(rolledBackSession.status).toBe("rolled_back");
    expect(rolledBackSession.executions).toHaveLength(2);
    for (const execution of rolledBackSession.executions) {
      expect(execution.executed).toBe(false);
      expect(execution.reason).toBe("rolled-back");
    }
    await expect(readFile(itemA.sourcePath, "utf-8")).resolves.toBe(contentA);
    await expect(readFile(itemB.sourcePath, "utf-8")).resolves.toBe(contentB);
    await expect(pathExists(itemA.targetPath)).resolves.toBe(false);
    await expect(pathExists(itemB.targetPath)).resolves.toBe(false);

    // ---- 回滚后日志系统仍然健康 ----
    expectOkData(asIpcEnvelope(await logStatusPhase(page), "getLogStatus"), "getLogStatus");

    // ---- stub 侧：2 个文件恰好 1 次批式确定性分类，无任何外部请求 ----
    const requests = stub.requests();
    expect(requests).toHaveLength(1);
    const batchRequest = requests[0];
    if (batchRequest === undefined) {
      throw new Error("unreachable: stub request asserted present");
    }
    expect(batchRequest.isBatch).toBe(true);
  } finally {
    await electronApp.close();
    await stub.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});

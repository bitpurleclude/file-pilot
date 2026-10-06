import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { CLASSIFICATION_CONFIG } from "../../shared/config/classification.config.js";
import type { LlmProviderConfig } from "../../shared/types/llm-provider.js";
import type { ContentSummary, FileItem } from "../../shared/types/workflow.js";
import { launchElectronApp } from "./helpers/electron-launch.js";
import type { IsolatedElectronApplication } from "./helpers/electron-launch.js";
import {
  SINGLE_PROMPT_MARKER,
  extractBatchIds,
  isBatchPrompt,
  startLlmStub
} from "./helpers/llm-stub.js";

const STUB_API_KEY = "e2e-stub-key";
const STUB_PROJECT = "StubProject";
const STUB_USAGE_REASON = "usage:pt:42:ct:17";
const MISMATCHED_BATCH_ID = "stub-mismatched-id";
/** 401 兜底时 txt/md（Documents 类）的本地规则 reason（buildLocalFallback 的历史前缀）。 */
const LOCAL_FALLBACK_DOC_REASON = "llm-fallback-rule:doc";

interface AnalyzedItemSnapshot {
  fileId: string;
  name: string;
  decisionSource: string;
  project: string;
  reasons: string[];
  promptVersion: string | null;
}

type AnalyzeFlowResult =
  | { ok: false; stage: string; detail: string }
  | { ok: true; primaryModel: string; items: AnalyzedItemSnapshot[] };

interface RenderedPrompts {
  single: string;
  batch: string;
  singleVersion: string;
  batchVersion: string;
}

/**
 * electron-launch 默认 isolate=true：每次启动注入全新临时 userData/workspace
 * （FILE_PILOT_USER_DATA_DIR / FILE_PILOT_WORKSPACE_ROOT），close 时自动清理。
 */
const expectIsolatedLaunch = (electronApp: IsolatedElectronApplication): void => {
  expect(electronApp.launchDirs.userDataDir).toContain("file-pilot-e2e-userdata-");
};

const fakeItem = (id: string, name: string, ext: string): FileItem => {
  return {
    id,
    path: join("C:", "fake-sandbox", name),
    name,
    ext,
    size: 128,
    createdAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    mime: "text/plain"
  };
};

const fakeSummary = (): ContentSummary => {
  return { textSnippet: "e2e stub probe content", keywords: ["e2e", "stub"], language: "en" };
};

/**
 * 用真实的 prompt-renderer 渲染两种真实模板（classify.v1 / classify-batch.v1）。
 * Playwright 以 ESM 跑 spec（无 __dirname），而 prompt-renderer 按 CJS 假设解析模板目录，
 * 因此在动态导入期间临时注入 __dirname 指向 infra/llm，结束后恢复。
 */
const renderRealTemplatePrompts = async (): Promise<RenderedPrompts> => {
  const infraRoot = join(process.cwd(), "apps", "desktop", "infra", "llm");
  const carrier = globalThis as { __dirname?: string };
  const previous = carrier.__dirname;
  carrier.__dirname = infraRoot;
  try {
    const renderer = await import("../../infra/llm/prompt-renderer.js");
    const single = renderer.renderClassifyPrompt({
      item: fakeItem("single-probe-id", "probe.txt", "txt"),
      summary: fakeSummary()
    });
    const batch = renderer.renderClassifyBatchPrompt([
      { item: fakeItem("batch-id-1", "a.txt", "txt"), summary: fakeSummary() },
      { item: fakeItem("batch-id-2", "b.txt", "txt"), summary: fakeSummary() },
      { item: fakeItem("batch-id-3", "c.md", "md"), summary: fakeSummary() }
    ]);
    return {
      single,
      batch,
      singleVersion: renderer.CLASSIFY_PROMPT_VERSION,
      batchVersion: renderer.CLASSIFY_BATCH_PROMPT_VERSION
    };
  } finally {
    if (previous === undefined) {
      delete carrier.__dirname;
    } else {
      carrier.__dirname = previous;
    }
  }
};

/**
 * 在被测应用内完成：白名单 → getSettings → 改 baseUrl/apiKey → saveSettings → analyze。
 * 返回扁平快照（evaluate 载荷必须可 JSON 序列化，且不得引用闭包外部变量）。
 */
const runWhitelistAndAnalyze = async (
  page: Page,
  params: { sandboxDir: string; stubUrl: string; apiKey: string; filePaths: string[] }
): Promise<AnalyzeFlowResult> => {
  return page.evaluate(async ({ sandboxDir, stubUrl, apiKey, filePaths }) => {
    if (window.filePilotApi === undefined) {
      return { ok: false as const, stage: "preload", detail: "window.filePilotApi is missing" };
    }
    const api = window.filePilotApi;

    const whitelist = await api.saveWhitelist({ directories: [sandboxDir] });
    if (!whitelist.ok) {
      return { ok: false as const, stage: "save-whitelist", detail: whitelist.error.message };
    }

    const settings = await api.getSettings();
    if (!settings.ok) {
      return { ok: false as const, stage: "get-settings", detail: settings.error.message };
    }

    // saveSettings 的 providerConfigSchema 是 strict 的：从 getSettings 结果原样改字段后回传。
    const activeProviderId = settings.data.llmProviders.activeProviderId;
    const providers: LlmProviderConfig[] = settings.data.llmProviders.providers.map((provider) => (
      provider.id === activeProviderId
        ? { ...provider, baseUrl: stubUrl, apiKey }
        : provider
    ));
    const [firstProvider, ...restProviders] = providers;
    if (firstProvider === undefined) {
      return { ok: false as const, stage: "providers", detail: "no providers in settings" };
    }

    const saved = await api.saveSettings({
      llmProviders: {
        activeProviderId,
        providers: [firstProvider, ...restProviders]
      }
    });
    if (!saved.ok) {
      return { ok: false as const, stage: "save-settings", detail: saved.error.message };
    }

    const active = saved.data.llmProviders.providers.find(
      (provider) => provider.id === saved.data.llmProviders.activeProviderId
    );
    if (active === undefined) {
      return { ok: false as const, stage: "active-provider", detail: "active provider not found" };
    }
    const primaryModel = active.modelControlMode === "manual"
      ? active.primaryModel
      : active.intensityProfiles[active.intensity].primaryModel;

    const analyze = await api.analyze({ sessionId: crypto.randomUUID(), filePaths });
    if (!analyze.ok) {
      return { ok: false as const, stage: "analyze", detail: analyze.error.message };
    }

    return {
      ok: true as const,
      primaryModel,
      items: analyze.data.items.map((item) => ({
        fileId: item.item.id,
        name: item.item.name,
        decisionSource: item.decisionSource,
        project: item.classification.project,
        reasons: item.classification.reasons,
        promptVersion: item.classification.promptVersion ?? null
      }))
    };
  }, params);
};

const expectFlowOk = (flow: AnalyzeFlowResult): Extract<AnalyzeFlowResult, { ok: true }> => {
  expect(flow.ok, `analyze flow failed: ${JSON.stringify(flow)} `).toBe(true);
  if (!flow.ok) {
    throw new Error("unreachable: flow asserted ok");
  }
  return flow;
};

test("单文件成功路径：主模型 LLM 分类命中 + 单文件模板判别正确", async () => {
  // 用真实模板渲染结果验证 stub 判别器（单文件模板：有"摘要："，无批式特征）。
  const prompts = await renderRealTemplatePrompts();
  expect(isBatchPrompt(prompts.single)).toBe(false);
  expect(prompts.single).toContain(SINGLE_PROMPT_MARKER);
  expect(extractBatchIds(prompts.single)).toEqual([]);

  const sandbox = await mkdtemp(join(process.cwd(), "tmp-file-pilot-llm-"));
  const stub = await startLlmStub({
    responder: (request) => {
      if (!request.isBatch) {
        return undefined; // 单文件请求走默认确定性响应（```json 围栏包裹）
      }
      // 1 个文件也会先走批式模板：返回错位 id，触发"逐条降级到单文件模板"链路。
      return {
        status: 200,
        content: JSON.stringify([{
          id: MISMATCHED_BATCH_ID,
          purpose: "Documents",
          project: STUB_PROJECT,
          confidence: 0.9,
          reasons: ["stub"]
        }])
      };
    }
  });
  const filePath = join(sandbox, "alpha-llm-e2e.txt");
  await writeFile(filePath, "zephyr quartz lantern probe", "utf-8");
  const electronApp = await launchElectronApp();
  expectIsolatedLaunch(electronApp);

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const flow = expectFlowOk(await runWhitelistAndAnalyze(page, {
      sandboxDir: sandbox,
      stubUrl: stub.url,
      apiKey: STUB_API_KEY,
      filePaths: [filePath]
    }));

    expect(flow.items).toHaveLength(1);
    const item = flow.items[0];
    if (item === undefined) {
      throw new Error("unreachable: item asserted present");
    }
    expect(item.decisionSource).toBe("llm-primary");
    expect(item.project).toBe(STUB_PROJECT);
    expect(item.reasons).toContain(STUB_USAGE_REASON);
    expect(item.reasons).toContain(`model:${flow.primaryModel}`);
    expect(item.promptVersion).toBe(prompts.singleVersion);

    const requests = stub.requests();
    expect(requests).toHaveLength(2); // 1 次批式触发 + 1 次降级单文件调用
    const singleRequests = requests.filter((request) => !request.isBatch);
    expect(singleRequests).toHaveLength(1);
    const single = singleRequests[0];
    if (single === undefined) {
      throw new Error("unreachable: single request asserted present");
    }
    expect(single.model).toBe(flow.primaryModel);
    for (const request of requests) {
      expect(request.headers["authorization"]).toBe(`Bearer ${STUB_API_KEY}`);
    }
  } finally {
    await electronApp.close();
    await stub.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("批式路径：3 个文件仅 1 次批式调用（批量降成本）+ 批式模板判别正确", async () => {
  // 用真实模板渲染结果验证 stub 判别器与 id 提取（批式模板：- id: 行 + 批式特征）。
  const prompts = await renderRealTemplatePrompts();
  expect(isBatchPrompt(prompts.batch)).toBe(true);
  expect(extractBatchIds(prompts.batch)).toEqual(["batch-id-1", "batch-id-2", "batch-id-3"]);

  const sandbox = await mkdtemp(join(process.cwd(), "tmp-file-pilot-llm-"));
  const stub = await startLlmStub();
  const fileNames = ["alpha-llm-e2e.txt", "bravo-llm-e2e.txt", "charlie-llm-e2e.md"];
  const filePaths: string[] = [];
  for (const name of fileNames) {
    const filePath = join(sandbox, name);
    await writeFile(filePath, `zephyr quartz lantern probe ${name}`, "utf-8");
    filePaths.push(filePath);
  }
  const electronApp = await launchElectronApp();
  expectIsolatedLaunch(electronApp);

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const flow = expectFlowOk(await runWhitelistAndAnalyze(page, {
      sandboxDir: sandbox,
      stubUrl: stub.url,
      apiKey: STUB_API_KEY,
      filePaths
    }));

    expect(flow.items).toHaveLength(3);
    for (const item of flow.items) {
      expect(item.decisionSource).toBe("llm-primary");
      expect(item.project).toBe(STUB_PROJECT);
      expect(item.reasons).toContain(STUB_USAGE_REASON);
      expect(item.reasons).toContain(`model:${flow.primaryModel}`);
      expect(item.promptVersion).toBe(prompts.batchVersion);
    }

    const requests = stub.requests();
    // 3 个文件在默认 batchSize=10 内：应为 1 次批式调用（≤1）。
    expect(requests).toHaveLength(1);
    const batchRequest = requests[0];
    if (batchRequest === undefined) {
      throw new Error("unreachable: batch request asserted present");
    }
    expect(batchRequest.isBatch).toBe(true);
    expect(batchRequest.model).toBe(flow.primaryModel);
    expect(batchRequest.headers["authorization"]).toBe(`Bearer ${STUB_API_KEY}`);
    expect([...batchRequest.ids].sort()).toEqual([...flow.items.map((item) => item.fileId)].sort());
  } finally {
    await electronApp.close();
    await stub.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("401 降级：不重试、不切备模型，快速落到本地规则兜底", async () => {
  const sandbox = await mkdtemp(join(process.cwd(), "tmp-file-pilot-llm-"));
  const stub = await startLlmStub({ mode: "unauthorized" });
  const filePath = join(sandbox, "alpha-llm-e2e.txt");
  await writeFile(filePath, "zephyr quartz lantern probe", "utf-8");
  const electronApp = await launchElectronApp();
  expectIsolatedLaunch(electronApp);

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const flow = expectFlowOk(await runWhitelistAndAnalyze(page, {
      sandboxDir: sandbox,
      stubUrl: stub.url,
      apiKey: STUB_API_KEY,
      filePaths: [filePath]
    }));

    expect(flow.items).toHaveLength(1);
    const item = flow.items[0];
    if (item === undefined) {
      throw new Error("unreachable: item asserted present");
    }
    expect(item.decisionSource).toBe("local-fallback");
    expect(item.project).toBe(CLASSIFICATION_CONFIG.fallbackProject);
    expect(item.reasons).toContain(LOCAL_FALLBACK_DOC_REASON);

    const requests = stub.requests();
    // 1 次批式（401 后不重试：retryCount=2 若重试会是 3 次批式）
    // + 1 次逐条降级单文件（同样 401 → 本地兜底）。
    expect(requests).toHaveLength(2);
    expect(requests.filter((request) => request.isBatch)).toHaveLength(1);
    // 403/401 意味着同一把 key 不可用：备模型绝不能被尝试，所有请求都指向主模型。
    for (const request of requests) {
      expect(request.model).toBe(flow.primaryModel);
      expect(request.headers["authorization"]).toBe(`Bearer ${STUB_API_KEY}`);
    }
  } finally {
    await electronApp.close();
    await stub.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("批式响应非法 JSON：整块降级逐条单调用，analyze 仍成功且结果确定", async () => {
  const sandbox = await mkdtemp(join(process.cwd(), "tmp-file-pilot-llm-"));
  const stub = await startLlmStub({
    responder: (request) => {
      if (!request.isBatch) {
        return undefined; // 降级后的单文件请求走默认成功响应
      }
      // 批式响应体本身是合法 OpenAI JSON，但 content 无任何 JSON 结构 → 整块降级（不触发重试）。
      return { status: 200, content: "抱歉，我无法完成该任务。" };
    }
  });
  const fileNames = ["alpha-llm-e2e.txt", "bravo-llm-e2e.txt", "charlie-llm-e2e.md"];
  const filePaths: string[] = [];
  for (const name of fileNames) {
    const filePath = join(sandbox, name);
    await writeFile(filePath, `zephyr quartz lantern probe ${name}`, "utf-8");
    filePaths.push(filePath);
  }
  const electronApp = await launchElectronApp();
  expectIsolatedLaunch(electronApp);

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const flow = expectFlowOk(await runWhitelistAndAnalyze(page, {
      sandboxDir: sandbox,
      stubUrl: stub.url,
      apiKey: STUB_API_KEY,
      filePaths
    }));

    expect(flow.items).toHaveLength(3);
    for (const item of flow.items) {
      expect(item.decisionSource).toBe("llm-primary");
      expect(item.project).toBe(STUB_PROJECT);
      expect(item.promptVersion).toBe("classify.v1");
    }

    const requests = stub.requests();
    const batchRequests = requests.filter((request) => request.isBatch);
    const singleRequests = requests.filter((request) => !request.isBatch);
    expect(batchRequests).toHaveLength(1); // content 级不可解析不触发 invalid-response 重试
    expect(singleRequests).toHaveLength(3);
    for (const name of fileNames) {
      expect(singleRequests.some((request) => request.userMessage.includes(name))).toBe(true);
    }
    for (const request of requests) {
      expect(request.headers["authorization"]).toBe(`Bearer ${STUB_API_KEY}`);
    }
  } finally {
    await electronApp.close();
    await stub.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});

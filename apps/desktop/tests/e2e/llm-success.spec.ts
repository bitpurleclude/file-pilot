import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { CLASSIFICATION_CONFIG } from "../../shared/config/classification.config.js";
import type { ContentSummary, FileItem } from "../../shared/types/workflow.js";
import { launchElectronApp } from "./helpers/electron-launch.js";
import type { IsolatedElectronApplication } from "./helpers/electron-launch.js";
import {
  COORDINATE_LIST_MARKER,
  SINGLE_PROMPT_MARKER,
  extractBatchIds,
  extractCoordinateLines,
  isBatchPrompt,
  startLlmStub
} from "./helpers/llm-stub.js";
import { redirectActiveProvider } from "./helpers/provider-redirect.js";

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
  | { ok: true; items: AnalyzedItemSnapshot[] };

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
 * 在被测应用内完成：白名单 → analyze。
 * provider 重定向（getSettings → 改 baseUrl/apiKey → saveSettings → 返回主模型名）
 * 由 helpers/provider-redirect.ts 统一处理，调用方在进入本流程前先
 * await redirectActiveProvider(...)，主模型名直接取 helper 返回值。
 * 返回扁平快照（evaluate 载荷必须可 JSON 序列化，且不得引用闭包外部变量）。
 */
const runWhitelistAndAnalyze = async (
  page: Page,
  params: { sandboxDir: string; filePaths: string[] }
): Promise<AnalyzeFlowResult> => {
  return page.evaluate(async ({ sandboxDir, filePaths }) => {
    if (window.filePilotApi === undefined) {
      return { ok: false as const, stage: "preload", detail: "window.filePilotApi is missing" };
    }
    const api = window.filePilotApi;

    const whitelist = await api.saveWhitelist({ directories: [sandboxDir] });
    if (!whitelist.ok) {
      return { ok: false as const, stage: "save-whitelist", detail: whitelist.error.message };
    }

    const analyze = await api.analyze({ sessionId: crypto.randomUUID(), filePaths });
    if (!analyze.ok) {
      return { ok: false as const, stage: "analyze", detail: analyze.error.message };
    }

    return {
      ok: true as const,
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
    // 重定向 active provider 到本地 stub；主模型名取自保存后的 settings（helper 返回值）。
    const { primaryModel } = await redirectActiveProvider(page, { baseUrl: stub.url, apiKey: STUB_API_KEY });
    const flow = expectFlowOk(await runWhitelistAndAnalyze(page, {
      sandboxDir: sandbox,
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
    expect(item.reasons).toContain(`model:${primaryModel}`);
    expect(item.promptVersion).toBe(prompts.singleVersion);

    const requests = stub.requests();
    // 脆弱性：以下请求次数为精确断言，依赖 LLM_CONFIG.batchSize = 10（1 个文件也先走
    // 1 次批式）与空规则库（无预置规则短路 LLM）；调整 batchSize / llmConcurrency 或
    // 引入预置规则时需同步更新这些计数。
    expect(requests).toHaveLength(2); // 1 次批式触发 + 1 次降级单文件调用
    const singleRequests = requests.filter((request) => !request.isBatch);
    expect(singleRequests).toHaveLength(1);
    const single = singleRequests[0];
    if (single === undefined) {
      throw new Error("unreachable: single request asserted present");
    }
    expect(single.model).toBe(primaryModel);
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
    // 重定向 active provider 到本地 stub；主模型名取自保存后的 settings（helper 返回值）。
    const { primaryModel } = await redirectActiveProvider(page, { baseUrl: stub.url, apiKey: STUB_API_KEY });
    const flow = expectFlowOk(await runWhitelistAndAnalyze(page, {
      sandboxDir: sandbox,
      filePaths
    }));

    expect(flow.items).toHaveLength(3);
    for (const item of flow.items) {
      expect(item.decisionSource).toBe("llm-primary");
      expect(item.project).toBe(STUB_PROJECT);
      expect(item.reasons).toContain(STUB_USAGE_REASON);
      expect(item.reasons).toContain(`model:${primaryModel}`);
      expect(item.promptVersion).toBe(prompts.batchVersion);
    }

    const requests = stub.requests();
    // 脆弱性：以下请求次数为精确断言，依赖 LLM_CONFIG.batchSize = 10（3 个文件落在一个
    // 批次内）与空规则库；调整 batchSize / llmConcurrency 或引入预置规则时需同步更新这些计数。
    // 3 个文件在默认 batchSize=10 内：应为 1 次批式调用（≤1）。
    expect(requests).toHaveLength(1);
    const batchRequest = requests[0];
    if (batchRequest === undefined) {
      throw new Error("unreachable: batch request asserted present");
    }
    expect(batchRequest.isBatch).toBe(true);
    expect(batchRequest.model).toBe(primaryModel);
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
    // 主模型名取自保存后的 settings（helper 返回值），用于断言备模型绝不被尝试。
    const { primaryModel } = await redirectActiveProvider(page, { baseUrl: stub.url, apiKey: STUB_API_KEY });
    const flow = expectFlowOk(await runWhitelistAndAnalyze(page, {
      sandboxDir: sandbox,
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
    // 脆弱性：以下请求次数为精确断言，依赖 LLM_CONFIG.batchSize = 10（1 个文件先走
    // 1 次批式）与空规则库；调整 batchSize / llmConcurrency 或引入预置规则时需同步更新这些计数。
    // 1 次批式（401 后不重试：retryCount=2 若重试会是 3 次批式）
    // + 1 次逐条降级单文件（同样 401 → 本地兜底）。
    expect(requests).toHaveLength(2);
    expect(requests.filter((request) => request.isBatch)).toHaveLength(1);
    // 403/401 意味着同一把 key 不可用：备模型绝不能被尝试，所有请求都指向主模型。
    for (const request of requests) {
      expect(request.model).toBe(primaryModel);
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
    await redirectActiveProvider(page, { baseUrl: stub.url, apiKey: STUB_API_KEY });
    const flow = expectFlowOk(await runWhitelistAndAnalyze(page, {
      sandboxDir: sandbox,
      filePaths
    }));

    expect(flow.items).toHaveLength(3);
    for (const item of flow.items) {
      expect(item.decisionSource).toBe("llm-primary");
      expect(item.project).toBe(STUB_PROJECT);
      expect(item.promptVersion).toBe("classify.v1");
    }

    const requests = stub.requests();
    // 脆弱性：以下请求次数为精确断言，依赖 LLM_CONFIG.batchSize = 10（3 个文件落在一个
    // 批次内）与空规则库；调整 batchSize / llmConcurrency 或引入预置规则时需同步更新这些计数。
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

test("无注册表坐标：analyze 成功且提示词不含坐标清单段（legacy 行为回归保护）", async () => {
  // 治理层阶段①向后兼容：analyze 未携带 registry 坐标（空注册表 / R2 接线前）时，
  // 单文件与批式模板都不得渲染「可用项目坐标清单」条件段，分类行为与阶段①之前一致。
  const sandbox = await mkdtemp(join(process.cwd(), "tmp-file-pilot-llm-"));
  const stub = await startLlmStub();
  const filePath = join(sandbox, "alpha-llm-e2e.txt");
  await writeFile(filePath, "zephyr quartz lantern probe", "utf-8");
  const electronApp = await launchElectronApp();
  expectIsolatedLaunch(electronApp);

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await redirectActiveProvider(page, { baseUrl: stub.url, apiKey: STUB_API_KEY });
    const flow = expectFlowOk(await runWhitelistAndAnalyze(page, {
      sandboxDir: sandbox,
      filePaths: [filePath]
    }));

    expect(flow.items).toHaveLength(1);
    const item = flow.items[0];
    if (item === undefined) {
      throw new Error("unreachable: item asserted present");
    }
    expect(item.decisionSource).toBe("llm-primary");
    expect(item.project).toBe(STUB_PROJECT);

    // 1 个文件：1 次批式 + （默认响应 id 对齐时无降级）→ 至少 1 次请求；每条提示词都不得含清单段。
    const requests = stub.requests();
    expect(requests.length).toBeGreaterThanOrEqual(1);
    for (const request of requests) {
      expect(request.userMessage).not.toContain(COORDINATE_LIST_MARKER);
    }
  } finally {
    await electronApp.close();
    await stub.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});

// 坐标接线（Wave1：process-session / session-handlers 把 registry 坐标经 analyze →
// LlmClassifier input.coordinates 传入 rule-first-llm）与登记册（R4：registry 六通道 +
// preload API）均已落地，本用例经 IPC 预置「考公/行测」坐标后运行。
// 预置必须发生在 redirectActiveProvider 之前：默认 provider 无 apiKey，dedup 判官
// 不会发起任何请求；若先重定向再建域，建域查重会向 stub 发出非分类请求，破坏计数断言。
test("坐标清单注入：提示词包含清单段且 stub 认领第一条坐标", async () => {
  const sandbox = await mkdtemp(join(process.cwd(), "tmp-file-pilot-llm-"));
  const stub = await startLlmStub({ coordinateMode: "claim-first" });
  const filePath = join(sandbox, "alpha-llm-e2e.txt");
  await writeFile(filePath, "zephyr quartz lantern probe", "utf-8");
  const electronApp = await launchElectronApp();
  expectIsolatedLaunch(electronApp);

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    // 种子：经 registry IPC 建「考公」域 +「行测」项目（默认 provider 无 apiKey，不触发查重 LLM）。
    const seeded = await page.evaluate(async () => {
      if (window.filePilotApi === undefined) {
        return { ok: false as const, detail: "window.filePilotApi is missing" };
      }
      const api = window.filePilotApi;
      const area = await api.registryCreateArea({ name: "考公" });
      if (!area.ok) {
        return { ok: false as const, detail: area.error.message };
      }
      const project = await api.registryCreateProject({ areaId: area.data.area.id, name: "行测" });
      if (!project.ok) {
        return { ok: false as const, detail: project.error.message };
      }
      return {
        ok: true as const,
        coordinate: `${area.data.area.number}-考公/${project.data.project.number}-行测`
      };
    });
    expect(seeded.ok, `registry seeding failed: ${JSON.stringify(seeded)}`).toBe(true);
    if (!seeded.ok) {
      throw new Error("unreachable: seeding asserted ok");
    }

    await redirectActiveProvider(page, { baseUrl: stub.url, apiKey: STUB_API_KEY });
    const flow = expectFlowOk(await runWhitelistAndAnalyze(page, {
      sandboxDir: sandbox,
      filePaths: [filePath]
    }));

    const requests = stub.requests();
    expect(requests.length).toBeGreaterThanOrEqual(1);
    // 每条提示词都注入了坐标清单段，且清单行可被 stub 解析。
    for (const request of requests) {
      expect(request.userMessage).toContain(COORDINATE_LIST_MARKER);
      expect(extractCoordinateLines(request.userMessage).length).toBeGreaterThan(0);
    }

    // stub 按清单第一条坐标返回 project → classifier 坐标校验命中 → coord:claimed 审计 reason。
    const firstRequest = requests[0];
    if (firstRequest === undefined) {
      throw new Error("unreachable: request asserted present");
    }
    const claimedCoordinate = extractCoordinateLines(firstRequest.userMessage)[0];
    if (claimedCoordinate === undefined) {
      throw new Error("unreachable: coordinate line asserted present");
    }
    // 种子坐标确实进入提示词清单（清单第一条 = 10-考公/1-行测）。
    expect(claimedCoordinate).toBe(seeded.coordinate);
    expect(flow.items).toHaveLength(1);
    const item = flow.items[0];
    if (item === undefined) {
      throw new Error("unreachable: item asserted present");
    }
    expect(item.decisionSource).toBe("llm-primary");
    expect(item.project).toBe(claimedCoordinate);
    expect(item.reasons).toContain("coord:claimed");
  } finally {
    await electronApp.close();
    await stub.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});

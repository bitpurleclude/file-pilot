import type { Page } from "@playwright/test";

import type { LlmProviderConfig } from "../../../shared/types/llm-provider.js";

/** redirectActiveProvider 成功时返回的快照（evaluate 返回值必须可 JSON 序列化）。 */
export interface ProviderRedirectSnapshot {
  /**
   * 保存后 active provider 的主模型名：
   * manual 模式取 primaryModel，强度模式取当前档位（intensity）的 primaryModel。
   * 供 spec 断言 reasons 中的 `model:<name>` 与 stub 收到的 model 字段。
   */
  primaryModel: string;
}

interface RedirectFailure {
  ok: false;
  reason: string;
  detail: string;
}

interface RedirectSuccess {
  ok: true;
  primaryModel: string;
}

type RedirectEvaluateResult = RedirectFailure | RedirectSuccess;

export interface RedirectActiveProviderParams {
  /** 目标 baseUrl（如本地 LLM stub 的 http://127.0.0.1:<port>/v1）。 */
  baseUrl: string;
  /** 可选：同时覆盖 apiKey；省略时保留 provider 现有 apiKey。 */
  apiKey?: string;
}

/**
 * evaluate 载荷必须是自包含函数（Playwright 只序列化函数源码，不能引用闭包外变量）：
 * getSettings → 改 active provider 的 baseUrl（可选 apiKey）→ saveSettings → 返回主模型名。
 * providerConfigSchema 是 strict 的：从 getSettings 结果原样改字段后回传。
 */
const evaluateRedirect = async ({
  baseUrl,
  apiKey
}: RedirectActiveProviderParams): Promise<RedirectEvaluateResult> => {
  if (window.filePilotApi === undefined) {
    return { ok: false, reason: "missing-api", detail: "window.filePilotApi is missing" };
  }
  const api = window.filePilotApi;

  const settings = await api.getSettings();
  if (!settings.ok) {
    return { ok: false, reason: "get-settings-failed", detail: settings.error.message };
  }
  const activeProviderId = settings.data.llmProviders.activeProviderId;
  const providers: LlmProviderConfig[] = settings.data.llmProviders.providers.map((provider) => (
    provider.id === activeProviderId
      ? { ...provider, baseUrl, ...(apiKey === undefined ? {} : { apiKey }) }
      : provider
  ));
  const [firstProvider, ...restProviders] = providers;
  if (firstProvider === undefined) {
    return { ok: false, reason: "no-providers", detail: "llmProviders.providers is empty" };
  }
  const saved = await api.saveSettings({
    llmProviders: { activeProviderId, providers: [firstProvider, ...restProviders] }
  });
  if (!saved.ok) {
    return { ok: false, reason: "save-settings-failed", detail: saved.error.message };
  }
  const active = saved.data.llmProviders.providers.find(
    (provider) => provider.id === saved.data.llmProviders.activeProviderId
  );
  if (active === undefined) {
    return { ok: false, reason: "active-provider-missing", detail: "active provider not found after save" };
  }
  const primaryModel = active.modelControlMode === "manual"
    ? active.primaryModel
    : active.intensityProfiles[active.intensity].primaryModel;
  return { ok: true, primaryModel };
};

/**
 * 把被测应用当前 active provider 重定向到给定 baseUrl（如本地 LLM stub）。
 * 只改 settings（llmProviders），与 stub 的响应模式（200/401/自定义 responder）无关。
 *
 * 成功：返回保存后 active provider 的主模型名快照。
 * 失败（preload 缺失 / getSettings / saveSettings 失败、无 provider 等）：
 * 抛出带 reason 与 detail 的错误，使测试直接失败且可诊断——与原内联样板的
 * "重定向失败必然导致用例失败"语义一致。
 */
export const redirectActiveProvider = async (
  page: Page,
  params: RedirectActiveProviderParams
): Promise<ProviderRedirectSnapshot> => {
  const result = await page.evaluate(evaluateRedirect, params);
  if (!result.ok) {
    throw new Error(`redirectActiveProvider failed (${result.reason}): ${result.detail}`);
  }
  return { primaryModel: result.primaryModel };
};

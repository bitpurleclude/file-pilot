import {
  clearLogsRequestSchema,
  exportLogsRequestSchema,
  getLogStatusRequestSchema,
  getSettingsRequestSchema,
  reportClientErrorRequestSchema,
  saveSettingsRequestSchema,
  saveWhitelistRequestSchema,
  setReadOnlyModeRequestSchema,
  testProviderConnectionRequestSchema
} from "../../../shared/ipc/contracts.js";
import { saveSettings } from "../../../infra/storage/settings-repository.js";
import { buildHttpRequest } from "../../../infra/llm/provider-adapter.js";
import { createDefaultIntensityProfiles } from "../../../shared/config/llm-providers.js";
import { buildLogExportPayload, createDefaultLogExportOptions } from "../../../core/usecases/export-logs.js";
import { normalizeWhitelist } from "../../../core/usecases/whitelist.js";
import { persistLogExportJson } from "../../../infra/fs/log-export-file-repository.js";
import {
  clearAllLogs,
  getLogStatus,
  listLogRecords
} from "../../../infra/logging/file-logger.js";
import { toIpcError, type IpcResult } from "../../../shared/errors/app-error.js";
import type { ProviderConfigPayload } from "../../../shared/ipc/contracts.js";
import { MASKED_API_KEY, type LlmProviderConfig } from "../../../shared/types/llm-provider.js";
import {
  type HandlerContext,
  type UnknownPayload,
  loadSettingsWithContext,
  logRootPath,
  resolveKeyCodec,
  safeWriteLog,
  settingsRootPath,
  toJsonArray,
  traceId
} from "./shared.js";
import type { AppSettings } from "../../../shared/types/settings.js";

const maskSettingsApiKeys = (settings: AppSettings): AppSettings => {
  const [firstMasked, ...restMasked] = settings.llmProviders.providers.map((provider) => (
    provider.apiKey === undefined ? provider : { ...provider, apiKey: MASKED_API_KEY }
  ));

  if (firstMasked === undefined) {
    return settings;
  }

  return {
    ...settings,
    llmProviders: {
      ...settings.llmProviders,
      providers: [firstMasked, ...restMasked]
    }
  };
};

/**
 * Restore real keys for providers whose incoming apiKey is the mask sentinel
 * (renderer never sees plaintext keys, so it echoes the sentinel to keep them).
 */
const restoreMaskedProviderKeys = (
  incoming: [LlmProviderConfig, ...LlmProviderConfig[]],
  current: [LlmProviderConfig, ...LlmProviderConfig[]]
): [LlmProviderConfig, ...LlmProviderConfig[]] => {
  const [first, ...rest] = incoming.map((provider) => {
    if (provider.apiKey !== MASKED_API_KEY) {
      const { apiKey, ...restProvider } = provider;
      return apiKey === undefined || apiKey.length === 0
        ? restProvider
        : { ...restProvider, apiKey };
    }

    const stored = current.find((candidate) => candidate.id === provider.id);
    if (stored?.apiKey === undefined) {
      const { apiKey: _mask, ...restProvider } = provider;
      return restProvider;
    }

    return { ...provider, apiKey: stored.apiKey };
  });

  if (first === undefined) {
    throw new Error("providers must be non-empty");
  }

  return [first, ...rest];
};

/**
 * Zod 推断的 optional 字段允许显式 undefined；在 exactOptionalPropertyTypes
 * 下需归一化为领域类型（省略未设置的可选键）。
 */
const toDomainProviders = (providers: ProviderConfigPayload[]): LlmProviderConfig[] => {
  return providers.map((provider) => {
    const { presetId, apiKey, customHeaders, endpoint, ...core } = provider;
    return {
      ...core,
      ...(presetId === undefined ? {} : { presetId }),
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(customHeaders === undefined ? {} : { customHeaders }),
      ...(endpoint === undefined ? {} : { endpoint })
    };
  });
};

export const systemHandlers = {
  exportLogs: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    const t = traceId();
    try {
      const req = exportLogsRequestSchema.parse(payload);

      await safeWriteLog(context, {
        level: "info",
        category: "audit",
        code: "LOG_EXPORT_START",
        message: "log export started",
        traceId: t,
        details: { anonymize: req.anonymize }
      });

      const sessionLogs = await listLogRecords(logRootPath(context), { category: "session" });
      const errorLogs = await listLogRecords(logRootPath(context), { category: "error" });
      const executionLogs = await listLogRecords(logRootPath(context), { category: "execution" });

      const options = createDefaultLogExportOptions(new Date());
      const data = buildLogExportPayload(
        {
          sessionLogs: toJsonArray(sessionLogs),
          errorLogs: toJsonArray(errorLogs),
          executionLogs: toJsonArray(executionLogs)
        },
        { ...options, anonymize: req.anonymize }
      );

      const path = await persistLogExportJson({
        baseDirectory: logRootPath(context),
        now: new Date(),
        payload: data
      });

      await safeWriteLog(context, {
        level: "info",
        category: "audit",
        code: "LOG_EXPORT_DONE",
        message: "log export completed",
        traceId: t,
        details: { path }
      });

      return { ok: true, data: { path } };
    } catch (error) {
      await safeWriteLog(context, {
        level: "error",
        category: "error",
        code: "LOG_EXPORT_FAILED",
        message: error instanceof Error ? error.message : "unknown error",
        traceId: t
      });
      return { ok: false, error: toIpcError(error) };
    }
  },

  saveWhitelist: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    try {
      const req = saveWhitelistRequestSchema.parse(payload);
      const settings = await loadSettingsWithContext(context);
      const isFirstWhitelist = settings.whitelistDirectories.length === 0 && req.directories.length > 0;
      const next = {
        ...settings,
        whitelistDirectories: normalizeWhitelist(req.directories),
        // 首次配置白名单（onboarding 完成信号）时才解锁只读模式；
        // 之后修改白名单不再隐式更改只读状态。
        readOnlyMode: isFirstWhitelist ? false : settings.readOnlyMode
      };
      await saveSettings(settingsRootPath(context), next, { codec: resolveKeyCodec(context) });
      return { ok: true, data: maskSettingsApiKeys(next) };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  setReadOnlyMode: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    try {
      const req = setReadOnlyModeRequestSchema.parse(payload);
      const settings = await loadSettingsWithContext(context);
      const next = { ...settings, readOnlyMode: req.enabled };
      await saveSettings(settingsRootPath(context), next, { codec: resolveKeyCodec(context) });
      return { ok: true, data: maskSettingsApiKeys(next) };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  getSettings: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    try {
      getSettingsRequestSchema.parse(payload);
      const settings = await loadSettingsWithContext(context);
      return { ok: true, data: maskSettingsApiKeys(settings) };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  getLogStatus: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    try {
      getLogStatusRequestSchema.parse(payload);
      const status = await getLogStatus(logRootPath(context));
      return { ok: true, data: status };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  clearLogs: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    const t = traceId();
    try {
      clearLogsRequestSchema.parse(payload);
      await clearAllLogs(logRootPath(context));
      await safeWriteLog(context, {
        level: "warn",
        category: "audit",
        code: "LOG_CLEARED",
        message: "all logs cleared",
        traceId: t
      });
      return { ok: true, data: { cleared: true } };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  reportClientError: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    const t = traceId();
    try {
      const req = reportClientErrorRequestSchema.parse(payload);
      await safeWriteLog(context, {
        level: "error",
        category: "error",
        code: req.code,
        message: req.message,
        traceId: t,
        ...(req.details === undefined ? {} : { details: req.details })
      });

      return { ok: true, data: { recorded: true } };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  saveSettingsHandler: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    try {
      const req = saveSettingsRequestSchema.parse(payload);
      const current = await loadSettingsWithContext(context);
      let nextProviders = current.llmProviders;
      if (req.llmProviders !== undefined) {
        const normalizedIncoming = toDomainProviders(req.llmProviders.providers);
        const [firstIncoming] = normalizedIncoming;
        if (firstIncoming === undefined) {
          throw new Error("llmProviders.providers cannot be empty");
        }
        const restoredProviders = restoreMaskedProviderKeys(
          [firstIncoming, ...normalizedIncoming.slice(1)],
          current.llmProviders.providers
        );
        const firstProvider = restoredProviders[0];
        if (firstProvider === undefined) {
          throw new Error("llmProviders.providers cannot be empty");
        }
        nextProviders = {
          activeProviderId: req.llmProviders.activeProviderId,
          providers: [firstProvider, ...restoredProviders.slice(1)]
        };
      }

      const next: AppSettings = {
        ...current,
        ...(req.language === undefined ? {} : { language: req.language }),
        ...(req.readOnlyMode === undefined ? {} : { readOnlyMode: req.readOnlyMode }),
        classification: {
          ...current.classification,
          ...req.classification
        },
        ruleLearning: {
          ...current.ruleLearning,
          ...req.ruleLearning
        },
        llmProviders: nextProviders
      };
      await saveSettings(settingsRootPath(context), next, { codec: resolveKeyCodec(context) });
      return { ok: true, data: maskSettingsApiKeys(next) };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  testProviderConnectionHandler: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    const t = traceId();
    try {
      const req = testProviderConnectionRequestSchema.parse(payload);

      await safeWriteLog(context, {
        level: "info",
        category: "audit",
        code: "PROVIDER_TEST_START",
        message: "provider connection test started",
        traceId: t,
        details: { providerId: req.providerId, baseUrl: req.baseUrl }
      });

      // 渲染层只持有掩码哨兵；真实 key 由主进程从加密存储解析。
      const settings = await loadSettingsWithContext(context);
      const storedProvider = settings.llmProviders.providers.find((provider) => provider.id === req.providerId);
      let apiKey = req.apiKey;
      if (apiKey === undefined || apiKey === MASKED_API_KEY) {
        apiKey = storedProvider?.apiKey;
      }

      const provider: LlmProviderConfig = {
        id: req.providerId,
        name: storedProvider?.name ?? req.providerId,
        isPreset: false,
        baseUrl: req.baseUrl,
        authType: req.authType,
        ...(apiKey === undefined || apiKey.length === 0 ? {} : { apiKey }),
        protocol: "openai",
        primaryModel: req.model,
        secondaryModel: req.model,
        modelControlMode: "manual",
        intensity: "balanced",
        intensityProfiles: createDefaultIntensityProfiles(req.model, req.model),
        enabled: true,
        ...(req.customHeaders === undefined ? {} : { customHeaders: req.customHeaders }),
        ...(req.endpoint === undefined ? {} : { endpoint: req.endpoint })
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);

      try {
        const request = buildHttpRequest({
          provider,
          messages: [{ role: "user", content: "test" }],
          model: req.model
        });
        const response = await fetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          signal: controller.signal
        });

        clearTimeout(timer);

        if (!response.ok) {
          const errorText = await response.text();
          await safeWriteLog(context, {
            level: "warn",
            category: "audit",
            code: "PROVIDER_TEST_FAILED",
            message: "provider connection test failed",
            traceId: t,
            details: { providerId: req.providerId, status: response.status, error: errorText.slice(0, 200) }
          });

          return {
            ok: false,
            error: {
              code: "PROVIDER_TEST_FAILED",
              message: `HTTP ${response.status}: ${errorText.slice(0, 200)}`
            }
          };
        }

        await safeWriteLog(context, {
          level: "info",
          category: "audit",
          code: "PROVIDER_TEST_SUCCESS",
          message: "provider connection test succeeded",
          traceId: t,
          details: { providerId: req.providerId }
        });

        return { ok: true, data: { success: true } };
      } catch (fetchError) {
        clearTimeout(timer);

        await safeWriteLog(context, {
          level: "error",
          category: "error",
          code: "PROVIDER_TEST_ERROR",
          message: "provider connection test error",
          traceId: t,
          details: { providerId: req.providerId, error: String(fetchError) }
        });

        return {
          ok: false,
          error: {
            code: "PROVIDER_TEST_ERROR",
            message: String(fetchError)
          }
        };
      }
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  }
} as const;

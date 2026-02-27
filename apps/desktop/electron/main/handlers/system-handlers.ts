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
import { loadSettings, saveSettings } from "../../../infra/storage/settings-repository.js";
import { buildLogExportPayload, createDefaultLogExportOptions } from "../../../core/usecases/export-logs.js";
import { normalizeWhitelist } from "../../../core/usecases/whitelist.js";
import { persistLogExportJson } from "../../../infra/fs/log-export-file-repository.js";
import {
  clearAllLogs,
  getLogStatus,
  listLogRecords
} from "../../../infra/logging/file-logger.js";
import { toIpcError, type IpcResult } from "../../../shared/errors/app-error.js";
import {
  type HandlerContext,
  type UnknownPayload,
  logRootPath,
  safeWriteLog,
  settingsRootPath,
  toJsonArray,
  traceId
} from "./shared.js";
import type { AppSettings } from "../../../shared/types/settings.js";

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
      const settings = await loadSettings(settingsRootPath(context));
      const next = { ...settings, whitelistDirectories: normalizeWhitelist(req.directories), readOnlyMode: false };
      await saveSettings(settingsRootPath(context), next);
      return { ok: true, data: next };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  setReadOnlyMode: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    try {
      const req = setReadOnlyModeRequestSchema.parse(payload);
      const settings = await loadSettings(settingsRootPath(context));
      const next = { ...settings, readOnlyMode: req.enabled };
      await saveSettings(settingsRootPath(context), next);
      return { ok: true, data: next };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  },

  getSettings: async (context: HandlerContext, payload: UnknownPayload): Promise<IpcResult<unknown>> => {
    try {
      getSettingsRequestSchema.parse(payload);
      const settings = await loadSettings(settingsRootPath(context));
      return { ok: true, data: settings };
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
      const current = await loadSettings(settingsRootPath(context));
      let nextProviders = current.llmProviders;
      if (req.llmProviders !== undefined) {
        const normalizedProviders = req.llmProviders.providers.map((provider) => {
          const {
            presetId,
            apiKey,
            customHeaders,
            endpoint,
            ...rest
          } = provider;
          return {
            ...rest,
            ...(presetId === undefined ? {} : { presetId }),
            ...(apiKey === undefined ? {} : { apiKey }),
            ...(customHeaders === undefined ? {} : { customHeaders }),
            ...(endpoint === undefined ? {} : { endpoint })
          };
        });
        const firstProvider = normalizedProviders[0];
        if (firstProvider === undefined) {
          throw new Error("llmProviders.providers cannot be empty");
        }
        nextProviders = {
          activeProviderId: req.llmProviders.activeProviderId,
          providers: [firstProvider, ...normalizedProviders.slice(1)]
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
      await saveSettings(settingsRootPath(context), next);
      return { ok: true, data: next };
    } catch (error) {
      return { ok: false, error: toIpcError(error) };
    }
  }
,

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

      // 构建测试请求
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000); // 10s timeout

      try {
        const endpoint = req.endpoint ?? "/chat/completions";
        const url = `${req.baseUrl}${endpoint}`;
        
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          ...(req.customHeaders ?? {})
        };
        
        // 添加认证头
        if (req.authType === "bearer" && req.apiKey !== undefined && req.apiKey.length > 0) {
          headers["Authorization"] = `Bearer ${req.apiKey}`;
        } else if (req.authType === "api-key" && req.apiKey !== undefined && req.apiKey.length > 0) {
          headers["X-API-Key"] = req.apiKey;
        }
        
        // 发送测试请求（简单的 chat completion）
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: req.model,
            messages: [{ role: "user", content: "test" }],
            max_tokens: 5
          }),
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
            details: { providerId: req.providerId, status: response.status, error: errorText }
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

import { join } from "node:path";

import { checkDuplicate, withTimeout } from "../../../core/usecases/registry-dedup.js";
import type { DedupJudge, DedupJudgeEntry, DedupJudgeInput } from "../../../shared/ipc/contracts.js";
import {
  registryArchiveRequestSchema,
  registryCheckDuplicateRequestSchema,
  registryCreateAreaRequestSchema,
  registryCreateProjectRequestSchema,
  registryListRequestSchema,
  registryProposalsRequestSchema,
  type DedupEvidence,
  type RegistryArchiveData,
  type RegistryCheckDuplicateData,
  type RegistryCreateAreaData,
  type RegistryCreateProjectData,
  type RegistryIpcResult,
  type RegistryListData,
  type RegistryProposalsData
} from "../../../shared/ipc/contracts.js";
import { REGISTRY_CONFIG } from "../../../shared/config/registry.config.js";
import { AppError, toIpcError } from "../../../shared/errors/app-error.js";
import { callLlmWithFallback } from "../../../infra/llm/llm-gateway.js";
import { openSqliteDatabase } from "../../../infra/storage/sqlite/db.js";
import {
  archiveArea,
  archiveProject,
  createArea,
  createProject,
  listAreas,
  listProposals,
  listProjects
} from "../../../infra/storage/sqlite/repositories/registry-repository.js";
import {
  createFileCredentialStore
} from "../../../infra/security/settings-credentials.js";
import { loadSettings } from "../../../infra/storage/settings-repository.js";
import {
  type HandlerContext,
  type UnknownPayload,
  safeWriteLog,
  settingsRootPath,
  sqlitePath,
  traceId
} from "./shared.js";

/** Default page size for NEW: proposals when the caller omits `limit`. */
const PROPOSALS_DEFAULT_LIMIT = 50;

const hasNonEmpty = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.length > 0;

/**
 * Registry errors keep the unified IpcResult shape but may carry structured
 * details (dedup evidence travels in error.details for REGISTRY_DUPLICATE_NAME).
 */
const toRegistryIpcError = (
  error: unknown
): { code: string; message: string; details?: Record<string, unknown> } => {
  if (error instanceof AppError && error.details !== undefined) {
    return { code: error.code, message: error.message, details: error.details };
  }
  return toIpcError(error);
};

const DEDUP_JUDGE_SYSTEM_PROMPT = [
  "你是文件整理系统的建域查重助手。",
  "判断候选名称与每个现有名称是否指同一个领域或项目（同义、简写、中英混写都算 same）。",
  "只输出一个 JSON 数组，不要输出任何其他文字或代码围栏。",
  "数组每项形如 {\"name\": string, \"verdict\": \"same\" | \"different\" | \"unsure\", \"reason\": string}。",
  "name 必须原样返回输入中的现有名称；每个输入名称恰好输出一项。"
].join("\n");

const buildJudgeUserPrompt = (candidate: string, existing: DedupJudgeInput[]): string => {
  const lines = existing.map((entry) => JSON.stringify(
    { name: entry.name, ...(entry.sampleText === undefined ? {} : { sampleText: entry.sampleText }) }
  ));
  return ["候选名称:", candidate, "现有名称列表:", ...lines].join("\n");
};

const parseJudgeVerdict = (value: unknown): DedupJudgeEntry | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const { name, verdict, reason } = record;
  if (typeof name !== "string" || name.length === 0) {
    return null;
  }

  if (verdict !== "same" && verdict !== "different" && verdict !== "unsure") {
    return null;
  }

  return {
    name,
    verdict,
    reason: typeof reason === "string" ? reason : ""
  };
};

/**
 * Strict-JSON parsing of the judge reply. Anything unparseable throws so the
 * caller's catch path degrades every entry to "unsure".
 */
const parseJudgeOutput = (content: string, existing: DedupJudgeInput[]): DedupJudgeEntry[] => {
  let text = content.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence !== null && fence[1] !== undefined) {
    text = fence[1].trim();
  }

  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) {
    throw new Error("dedup judge output is not a JSON array");
  }

  const parsed: unknown = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) {
    throw new Error("dedup judge output is not a JSON array");
  }

  const byName = new Map<string, DedupJudgeEntry>();
  for (const item of parsed) {
    const entry = parseJudgeVerdict(item);
    if (entry !== null) {
      byName.set(entry.name.trim().toLowerCase(), entry);
    }
  }

  return existing.map((input) => {
    const found = byName.get(input.name.trim().toLowerCase());
    if (found !== undefined) {
      return found;
    }
    return { name: input.name, verdict: "unsure" as const, reason: "judge 输出未覆盖该名称" };
  });
};

/**
 * Builds the semantic dedup judge from persisted settings. Returns undefined
 * (pure level a+b dedup) when settings cannot be loaded or no enabled provider
 * carries an API key — a key-less default provider is never "available", so a
 * fresh install never performs network calls during dedup.
 */
const buildSemanticJudge = async (context: HandlerContext): Promise<DedupJudge | undefined> => {
  try {
    const root = settingsRootPath(context);
    const store = createFileCredentialStore(join(root, "credentials"));
    const settings = await loadSettings(root, store);
    const hasUsableProvider = settings.llmProviders.providers.some(
      (provider) => provider.enabled && hasNonEmpty(provider.apiKey)
    );
    if (!hasUsableProvider) {
      return undefined;
    }

    const judge: DedupJudge = async (candidate, existing) => {
      const result = await callLlmWithFallback({
        settings,
        messages: [
          { role: "system", content: DEDUP_JUDGE_SYSTEM_PROMPT },
          { role: "user", content: buildJudgeUserPrompt(candidate, existing) }
        ],
        maxTokens: 512
      });
      if (result === null) {
        throw new Error("no llm provider available for dedup judge");
      }
      return parseJudgeOutput(result.content, existing);
    };

    return withTimeout(judge, REGISTRY_CONFIG.semanticJudgeTimeoutMs);
  } catch {
    // Settings/credential failures must not break registry creation paths.
    return undefined;
  }
};

/** Exact hit throws REGISTRY_DUPLICATE_NAME; similar/semantic entries become warnings. */
const preflightDuplicate = async (
  context: HandlerContext,
  db: Parameters<typeof checkDuplicate>[0],
  name: string
): Promise<DedupEvidence[]> => {
  const judge = await buildSemanticJudge(context);
  const evidence = await checkDuplicate(db, name, judge);
  const exactHit = evidence.some((item) => item.level === "exact");
  if (exactHit) {
    throw new AppError(
      "REGISTRY_DUPLICATE_NAME",
      `名称与现有领域/项目重复: ${name.trim()}`,
      "USER",
      { evidence }
    );
  }
  return evidence;
};

export const registryHandlers = {
  registryList: async (context: HandlerContext, payload: UnknownPayload): Promise<RegistryIpcResult<RegistryListData>> => {
    const t = traceId();
    try {
      registryListRequestSchema.parse(payload);
      await safeWriteLog(context, {
        level: "info",
        category: "audit",
        code: "REGISTRY_LIST_START",
        message: "registry list started",
        traceId: t
      });

      const db = openSqliteDatabase(sqlitePath(context));
      const areas = listAreas(db, { includeArchived: true });
      // listProjects returns every status inside one area; combined with the
      // archived-inclusive area list this yields the full project inventory.
      const projects = areas.flatMap((area) => listProjects(db, area.id));

      await safeWriteLog(context, {
        level: "info",
        category: "audit",
        code: "REGISTRY_LIST_DONE",
        message: "registry list completed",
        traceId: t,
        details: { areaCount: areas.length, projectCount: projects.length }
      });

      return { ok: true, data: { areas, projects } };
    } catch (error) {
      await safeWriteLog(context, {
        level: "error",
        category: "error",
        code: "REGISTRY_LIST_FAILED",
        message: error instanceof Error ? error.message : "unknown error",
        traceId: t
      });
      return { ok: false, error: toRegistryIpcError(error) };
    }
  },

  registryCreateArea: async (context: HandlerContext, payload: UnknownPayload): Promise<RegistryIpcResult<RegistryCreateAreaData>> => {
    const t = traceId();
    try {
      const req = registryCreateAreaRequestSchema.parse(payload);
      await safeWriteLog(context, {
        level: "info",
        category: "audit",
        code: "REGISTRY_CREATE_AREA_START",
        message: "create area started",
        traceId: t,
        details: { name: req.name }
      });

      const db = openSqliteDatabase(sqlitePath(context));
      const warnings = await preflightDuplicate(context, db, req.name);
      const area = createArea(db, { name: req.name });

      await safeWriteLog(context, {
        level: "info",
        category: "audit",
        code: "REGISTRY_CREATE_AREA_DONE",
        message: "create area completed",
        traceId: t,
        details: { areaId: area.id, number: area.number, warnings: warnings.length }
      });

      return { ok: true, data: { area, warnings } };
    } catch (error) {
      await safeWriteLog(context, {
        level: "error",
        category: "error",
        code: "REGISTRY_CREATE_AREA_FAILED",
        message: error instanceof Error ? error.message : "unknown error",
        traceId: t
      });
      return { ok: false, error: toRegistryIpcError(error) };
    }
  },

  registryCreateProject: async (context: HandlerContext, payload: UnknownPayload): Promise<RegistryIpcResult<RegistryCreateProjectData>> => {
    const t = traceId();
    try {
      const req = registryCreateProjectRequestSchema.parse(payload);
      await safeWriteLog(context, {
        level: "info",
        category: "audit",
        code: "REGISTRY_CREATE_PROJECT_START",
        message: "create project started",
        traceId: t,
        details: { areaId: req.areaId, name: req.name }
      });

      const db = openSqliteDatabase(sqlitePath(context));
      const warnings = await preflightDuplicate(context, db, req.name);
      const project = createProject(db, {
        areaId: req.areaId,
        name: req.name,
        ...(req.aliases === undefined ? {} : { aliases: req.aliases })
      });

      await safeWriteLog(context, {
        level: "info",
        category: "audit",
        code: "REGISTRY_CREATE_PROJECT_DONE",
        message: "create project completed",
        traceId: t,
        details: { projectId: project.id, number: project.number, warnings: warnings.length }
      });

      return { ok: true, data: { project, warnings } };
    } catch (error) {
      await safeWriteLog(context, {
        level: "error",
        category: "error",
        code: "REGISTRY_CREATE_PROJECT_FAILED",
        message: error instanceof Error ? error.message : "unknown error",
        traceId: t
      });
      return { ok: false, error: toRegistryIpcError(error) };
    }
  },

  registryArchive: async (context: HandlerContext, payload: UnknownPayload): Promise<RegistryIpcResult<RegistryArchiveData>> => {
    const t = traceId();
    try {
      const req = registryArchiveRequestSchema.parse(payload);
      await safeWriteLog(context, {
        level: "info",
        category: "audit",
        code: "REGISTRY_ARCHIVE_START",
        message: "registry archive started",
        traceId: t,
        details: { kind: req.kind, id: req.id }
      });

      const db = openSqliteDatabase(sqlitePath(context));
      if (req.kind === "area") {
        archiveArea(db, req.id);
      } else {
        archiveProject(db, req.id);
      }

      await safeWriteLog(context, {
        level: "info",
        category: "audit",
        code: "REGISTRY_ARCHIVE_DONE",
        message: "registry archive completed",
        traceId: t,
        details: { kind: req.kind, id: req.id }
      });

      return { ok: true, data: { archived: true } };
    } catch (error) {
      await safeWriteLog(context, {
        level: "error",
        category: "error",
        code: "REGISTRY_ARCHIVE_FAILED",
        message: error instanceof Error ? error.message : "unknown error",
        traceId: t
      });
      return { ok: false, error: toRegistryIpcError(error) };
    }
  },

  registryCheckDuplicate: async (context: HandlerContext, payload: UnknownPayload): Promise<RegistryIpcResult<RegistryCheckDuplicateData>> => {
    const t = traceId();
    try {
      const req = registryCheckDuplicateRequestSchema.parse(payload);
      const db = openSqliteDatabase(sqlitePath(context));
      const judge = await buildSemanticJudge(context);
      const evidence = await checkDuplicate(db, req.name, judge);

      await safeWriteLog(context, {
        level: "info",
        category: "audit",
        code: "REGISTRY_CHECK_DUPLICATE_DONE",
        message: "registry check-duplicate completed",
        traceId: t,
        details: { name: req.name, evidenceCount: evidence.length }
      });

      return { ok: true, data: { evidence } };
    } catch (error) {
      await safeWriteLog(context, {
        level: "error",
        category: "error",
        code: "REGISTRY_CHECK_DUPLICATE_FAILED",
        message: error instanceof Error ? error.message : "unknown error",
        traceId: t
      });
      return { ok: false, error: toRegistryIpcError(error) };
    }
  },

  registryProposals: async (context: HandlerContext, payload: UnknownPayload): Promise<RegistryIpcResult<RegistryProposalsData>> => {
    const t = traceId();
    try {
      const req = registryProposalsRequestSchema.parse(payload);
      const db = openSqliteDatabase(sqlitePath(context));
      const proposals = listProposals(db, req.limit ?? PROPOSALS_DEFAULT_LIMIT);

      await safeWriteLog(context, {
        level: "info",
        category: "audit",
        code: "REGISTRY_PROPOSALS_DONE",
        message: "registry proposals read",
        traceId: t,
        details: { count: proposals.length }
      });

      return { ok: true, data: { proposals } };
    } catch (error) {
      await safeWriteLog(context, {
        level: "error",
        category: "error",
        code: "REGISTRY_PROPOSALS_FAILED",
        message: error instanceof Error ? error.message : "unknown error",
        traceId: t
      });
      return { ok: false, error: toRegistryIpcError(error) };
    }
  }
} as const;

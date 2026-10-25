import type Database from "better-sqlite3";

import { LLM_CONFIG } from "../../shared/config/llm.config.js";
import {
  buildLocalDecisionRequest,
  parseLocalDecisionResponse
} from "./provider-adapter.js";
import type { LocalDecisionMode } from "./provider-adapter.js";
import { appendShadowRecords } from "../storage/sqlite/repositories/shadow-repository.js";

/**
 * 本地决策模型影子模式（decision-models.md §5 T1）。
 *
 * 纯旁路：主链路（规则 → 云端 LLM → 兜底）照常；本模块用可插拔的"本地决策
 * 客户端"对同一输入做两级分解（先领域 ≤8 选项、后项目 ≤9 选项，research-notes
 * §4 的 local 层级分类路线），只记录对齐、绝不影响 plan。端点未配置时静默跳过
 * （全链路零开销）。
 */

export interface DecisionOption {
  id: string;
  text: string;
}

export interface LocalDecisionInput {
  id: string;
  prompt: string;
  options: DecisionOption[];
}

export interface LocalDecisionChoice {
  choiceId: string | null;
  confidence: number;
}

/** 可插拔本地决策客户端：批量提问，按输入顺序返回应答（失败题为 null）。 */
export interface LocalDecisionClient {
  choose(inputs: LocalDecisionInput[]): Promise<Array<LocalDecisionChoice | null>>;
}

export interface ShadowRecord {
  sessionId: string;
  fileId: string;
  fileName: string;
  level: "area" | "project";
  expectedId: string | null;
  predictedId: string | null;
  confidence: number | null;
  agree: boolean | null;
  at: string;
}

/** 影子输入项的最小结构视图（ProcessedSessionItem 按结构兼容直接传入）。 */
export interface ShadowSourceItem {
  item: { id: string; name: string };
  plan: {
    coordinate?: {
      areaNumber: number;
      areaName: string;
      projectNumber: number;
      projectName: string;
    };
  };
}

/** 带坐标的影子输入（expected 坐标以登记册编号为准，id 取编号字符串）。 */
interface ShadowCandidate {
  fileId: string;
  fileName: string;
  areaNumber: number;
  areaName: string;
  projectNumber: number;
  projectName: string;
}

export interface ShadowRunResult {
  recorded: number;
  skipped: "no-client" | "no-coordinates" | null;
}

const areaQuestionId = (fileId: string): string => `area:${fileId}`;
const projectQuestionId = (fileId: string): string => `project:${fileId}`;

/** 期望 id 统一取登记册编号字符串，与发给客户端的选项 id 同一空间，可直接比对。 */
const areaOptionId = (areaNumber: number): string => String(areaNumber);
const projectOptionId = (projectNumber: number): string => String(projectNumber);

const toCandidates = (items: ReadonlyArray<ShadowSourceItem>): ShadowCandidate[] => {
  const candidates: ShadowCandidate[] = [];
  for (const item of items) {
    const coordinate = item.plan.coordinate;
    if (coordinate === undefined) {
      continue;
    }
    candidates.push({
      fileId: item.item.id,
      fileName: item.item.name,
      areaNumber: coordinate.areaNumber,
      areaName: coordinate.areaName,
      projectNumber: coordinate.projectNumber,
      projectName: coordinate.projectName
    });
  }
  return candidates;
};

/**
 * 两级分解（decision-models.md §4.2）：
 * 1. 域级——选项 = 本次涉及的全部去重领域（≤8），每文件一题，prompt 含文件名，
 *    期望 = coordinate.areaNumber；
 * 2. 项目级——域级预测命中已知领域后，选项 = 该领域涉及的项目（≤9），
 *    期望 = coordinate.projectNumber；域级弃权/未知的文件跳过项目级（无法确定
 *    选项集，记录空缺比臆测选项集更忠实）。
 */
export const runShadowAlignment = async (params: {
  client: LocalDecisionClient | null;
  sessionId: string;
  items: Array<{ fileId: string; fileName: string; coordinate?: ShadowSourceItem["plan"]["coordinate"] }>;
  record: (rec: ShadowRecord) => Promise<void> | void;
}): Promise<ShadowRunResult> => {
  const { client, sessionId, items, record } = params;

  if (client === null) {
    return { recorded: 0, skipped: "no-client" };
  }

  const candidates: ShadowCandidate[] = [];
  for (const item of items) {
    const coordinate = item.coordinate;
    if (coordinate === undefined) {
      continue;
    }
    candidates.push({
      fileId: item.fileId,
      fileName: item.fileName,
      areaNumber: coordinate.areaNumber,
      areaName: coordinate.areaName,
      projectNumber: coordinate.projectNumber,
      projectName: coordinate.projectName
    });
  }

  if (candidates.length === 0) {
    return { recorded: 0, skipped: "no-coordinates" };
  }

  let recorded = 0;
  const at = new Date().toISOString();

  // 批量记录失败不中断旁路（record 是存储侧，失败只丢这批影子数据）。
  const safeRecord = async (rec: ShadowRecord): Promise<void> => {
    try {
      await record(rec);
      recorded += 1;
    } catch {
      // 影子记录失败静默吞掉：绝不影响主链路。
    }
  };

  try {
    // ---- 第一级：领域（选项 = 涉及领域的并集，去重） ----
    const areaById = new Map<number, string>();
    for (const candidate of candidates) {
      if (!areaById.has(candidate.areaNumber)) {
        areaById.set(candidate.areaNumber, candidate.areaName);
      }
    }
    const areaOptions: DecisionOption[] = [...areaById.entries()].map(([number, name]) => ({
      id: areaOptionId(number),
      text: `${number}-${name}`
    }));

    const areaInputs: LocalDecisionInput[] = candidates.map((candidate) => ({
      id: areaQuestionId(candidate.fileId),
      prompt: `文件「${candidate.fileName}」应归入哪个领域？`,
      options: areaOptions
    }));

    const areaAnswers = await chooseAll(client, areaInputs);

    // ---- 第二级：项目（选项 = 域级预测领域的项目并集，按域批量） ----
    const projectOptionsByArea = new Map<number, DecisionOption[]>();
    for (const [number] of areaById) {
      const options: DecisionOption[] = [];
      const seenProjects = new Set<number>();
      for (const candidate of candidates) {
        if (candidate.areaNumber === number && !seenProjects.has(candidate.projectNumber)) {
          seenProjects.add(candidate.projectNumber);
          options.push({ id: projectOptionId(candidate.projectNumber), text: `${candidate.projectNumber}-${candidate.projectName}` });
        }
      }
      projectOptionsByArea.set(number, options);
    }

    const pendingProjectRecords: ShadowRecord[] = [];
    const projectInputs: LocalDecisionInput[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (candidate === undefined) {
        continue;
      }
      const answer = areaAnswers[index] ?? null;
      const predictedArea = answer === null || answer.choiceId === null ? null : Number(answer.choiceId);
      const predictedAreaName = predictedArea === null || !areaById.has(predictedArea)
        ? null
        : areaById.get(predictedArea) ?? null;
      const options = predictedArea === null ? undefined : projectOptionsByArea.get(predictedArea);

      await safeRecord({
        sessionId,
        fileId: candidate.fileId,
        fileName: candidate.fileName,
        level: "area",
        expectedId: areaOptionId(candidate.areaNumber),
        predictedId: answer === null ? null : answer.choiceId,
        confidence: answer === null ? null : answer.confidence,
        agree: answer === null || answer.choiceId === null ? null : answer.choiceId === areaOptionId(candidate.areaNumber),
        at
      });

      if (predictedArea === null || options === undefined || options.length === 0) {
        // 域级弃权/未知：项目级跳过（选项集无法确定）。
        continue;
      }

      projectInputs.push({
        id: projectQuestionId(candidate.fileId),
        prompt: `文件「${candidate.fileName}」在领域「${predictedAreaName ?? candidate.areaName}」中应归入哪个项目？`,
        options
      });
      pendingProjectRecords.push({
        sessionId,
        fileId: candidate.fileId,
        fileName: candidate.fileName,
        level: "project",
        expectedId: projectOptionId(candidate.projectNumber),
        predictedId: null,
        confidence: null,
        agree: null,
        at
      });
    }

    const projectAnswers = await chooseAll(client, projectInputs);
    for (let index = 0; index < projectInputs.length; index += 1) {
      const pending = pendingProjectRecords[index];
      if (pending === undefined) {
        continue;
      }
      const answer = projectAnswers[index] ?? null;
      await safeRecord({
        ...pending,
        predictedId: answer === null ? null : answer.choiceId,
        confidence: answer === null ? null : answer.confidence,
        agree: answer === null || answer.choiceId === null
          ? null
          : answer.choiceId === pending.expectedId
      });
    }

    return { recorded, skipped: null };
  } catch {
    // runShadowAlignment 绝不向主链路抛异常：任何意外以已记录数收尾。
    return { recorded, skipped: null };
  }
};

/** 单批 choose 的安全封装：整批异常按逐题 null 处理（等价于全部弃权）。 */
const chooseAll = async (
  client: LocalDecisionClient,
  inputs: LocalDecisionInput[]
): Promise<Array<LocalDecisionChoice | null>> => {
  if (inputs.length === 0) {
    return [];
  }
  try {
    const answers = await client.choose(inputs);
    if (!Array.isArray(answers)) {
      return inputs.map(() => null);
    }
    return inputs.map((_input, index) => answers[index] ?? null);
  } catch {
    return inputs.map(() => null);
  }
};

// ==== HTTP 客户端实现 ====

export interface HttpDecisionClientParams {
  baseUrl: string;
  mode: LocalDecisionMode;
  /** 覆盖默认端点路径（systemone→/v1/systemone，openai-chat→/chat/completions）。 */
  endpointPath?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** 创建走 HTTP 的本地决策客户端。非 2xx / 解析失败 / 超时 → 该题 null。 */
export const createHttpDecisionClient = (params: HttpDecisionClientParams): LocalDecisionClient => {
  const baseUrl = params.baseUrl.replace(/\/+$/, "");
  const mode = params.mode;
  const timeoutMs = params.timeoutMs ?? 3000;
  const fetchImpl = params.fetchImpl ?? fetch;

  return {
    choose: async (inputs: LocalDecisionInput[]): Promise<Array<LocalDecisionChoice | null>> => {
      if (inputs.length === 0) {
        return [];
      }

      try {
        const request = buildLocalDecisionRequest({
          questions: inputs,
          baseUrl,
          mode,
          ...(params.endpointPath === undefined ? {} : { endpointPath: params.endpointPath })
        });

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response: Response;
        try {
          response = await fetchImpl(request.url, {
            method: request.method,
            headers: request.headers,
            body: request.body,
            signal: controller.signal
          });
        } catch {
          return inputs.map(() => null);
        } finally {
          clearTimeout(timer);
        }

        if (!response.ok) {
          return inputs.map(() => null);
        }

        const responseBody = await response.text();
        const answers = parseLocalDecisionResponse({ mode, responseBody });
        return inputs.map((input) => {
          const answer = answers.get(input.id);
          if (answer === undefined) {
            return null;
          }
          return { choiceId: answer.choiceId, confidence: answer.confidence };
        });
      } catch {
        return inputs.map(() => null);
      }
    }
  };
};

/**
 * 从 LLM_CONFIG.shadow 组装客户端；未启用或 baseUrl 为空返回 null
 * （保持端点未配置时全链路零开销的约定）。
 */
export const createClientFromShadowConfig = (config: {
  enabled: boolean;
  endpointBaseUrl: string;
  mode: LocalDecisionMode;
  timeoutMs?: number;
}): LocalDecisionClient | null => {
  const baseUrl = config.endpointBaseUrl.trim();
  if (!config.enabled || baseUrl.length === 0) {
    return null;
  }
  return createHttpDecisionClient({
    baseUrl,
    mode: config.mode,
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs })
  });
};

/**
 * analyze 成功后的 fire-and-forget 旁路（session-handlers 单行触发）：
 * 组装客户端 → 两级分解 → 批量落库；整体 try/catch 吞掉，绝不影响主链路。
 */
export const triggerShadowAlignments = async (params: {
  sessionId: string;
  items: ShadowSourceItem[];
  db: Database.Database;
}): Promise<void> => {
  try {
    const config = LLM_CONFIG.shadow;
    const client = createClientFromShadowConfig(config);
    const pending: ShadowRecord[] = [];

    await runShadowAlignment({
      client,
      sessionId: params.sessionId,
      items: params.items.map((item) => ({
        fileId: item.item.id,
        fileName: item.item.name,
        ...(item.plan.coordinate === undefined ? {} : { coordinate: item.plan.coordinate })
      })),
      record: (rec) => {
        pending.push(rec);
      }
    });

    if (pending.length > 0) {
      appendShadowRecords(params.db, pending);
    }
  } catch {
    // 影子旁路绝不影响主链路（T1 只记录不生效）。
  }
};

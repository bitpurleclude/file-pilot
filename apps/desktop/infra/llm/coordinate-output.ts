import { LLM_CONFIG } from "../../shared/config/llm.config.js";
import type { CoordinateOption } from "../../shared/types/registry.js";
import {
  parseCoordinateClaim,
  type CoordinateClaim
} from "../../shared/validation/registry.js";

/**
 * 模型 project 输出校验（governance-design.md §4.3 的机械保证）：
 * 提供坐标清单时，project 字段只允许两种形态——
 * 1. 清单内坐标串：`<areaNumber>-<areaName>/<projectNumber>-<projectName>`；
 * 2. `NEW:<简短名称>`（提议新建，交建域向导）。
 * 其余一律判定 invalid，由调用方（rule-first-llm）走既有降级链路。
 *
 * CoordinateOption 复用 shared/types/registry.ts 的共享契约（类型导入，零运行时依赖）。
 */

/** parseCoordinateClaim 的解析结果（与 CoordinateOption 的坐标四元组同构）。 */
export type ParsedCoordinateClaim = CoordinateClaim;

export { parseCoordinateClaim };

/** validateProjectOutput 的判定结果。 */
export type ProjectOutputVerdict =
  | ({ kind: "coordinate" } & ParsedCoordinateClaim)
  | { kind: "new"; name: string }
  | { kind: "invalid" };

/** 清洗模型输出中的空白：去首尾空白，内部连续空白折叠为单个空格。 */
const cleanWhitespace = (value: string): string => {
  return value.trim().replace(/\s+/g, " ");
};

/**
 * 解析 NEW 提案："NEW:名称" → 清洗后的名称；非 NEW: 前缀（或名称为空）返回 null。
 * 前缀匹配对大小写不敏感（容错模型输出 new:/New:），规范前缀以 LLM_CONFIG.newProjectPrefix 为准。
 */
export const parseNewProposal = (value: string): string | null => {
  const prefix = LLM_CONFIG.newProjectPrefix;
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
    return null;
  }

  const name = cleanWhitespace(trimmed.slice(prefix.length));
  if (name.length === 0) {
    return null;
  }
  return name;
};

/** 坐标是否命中清单：编号与名称全部精确匹配。 */
export const isCoordinateInList = (
  claim: ParsedCoordinateClaim,
  coordinates: readonly CoordinateOption[]
): boolean => {
  return coordinates.some((option) =>
    option.areaNumber === claim.areaNumber &&
    option.areaName === claim.areaName &&
    option.projectNumber === claim.projectNumber &&
    option.projectName === claim.projectName
  );
};

/**
 * project 输出总判定（先 NEW 后坐标；两者都无法命中 → invalid）：
 * - { kind: "coordinate", ... }：命中清单，project 原样保留供上游落位；
 * - { kind: "new", name }：NEW 提案，project 原样保留（上游转换为 proposedProject）；
 * - { kind: "invalid" }：清单外自由命名等，调用方视为无效输出走降级。
 */
export const validateProjectOutput = (
  value: string,
  coordinates: readonly CoordinateOption[]
): ProjectOutputVerdict => {
  const proposal = parseNewProposal(value);
  if (proposal !== null) {
    return { kind: "new", name: proposal };
  }

  const claim = parseCoordinateClaim(value);
  if (claim !== null && isCoordinateInList(claim, coordinates)) {
    return { kind: "coordinate", ...claim };
  }

  return { kind: "invalid" };
};

import type { FollowUpQuestion, ProcessedSessionItem } from "../../shared/types/workflow.js";

// 响应载荷类型与 preload API 同源，避免重复定义漂移。
export type {
  SaveCorrectionsResponseData as SaveCorrectionsData,
  SubmitFollowupResponseData as SubmitFollowupData
} from "../../electron/preload/api.js";

/** 渲染层分析状态：analyze 响应的四字段投影（classifications/plans 不入状态）。 */
export interface AnalyzeData {
  sessionId: string;
  needsFollowUp: boolean;
  followUpQuestions: FollowUpQuestion[];
  items: ProcessedSessionItem[];
}

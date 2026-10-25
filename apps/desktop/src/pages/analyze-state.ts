import type { AnalyzeData, SubmitFollowupData } from "./types.js";

/**
 * 用会话更新响应（followup/纠错）投影出渲染层分析状态。
 * 后端返回的是全量 items，直接替换即可；保留函数形态便于将来切换增量合并。
 */
export const mergeAnalyzeData = (
  _current: AnalyzeData | null,
  update: SubmitFollowupData
): AnalyzeData => {
  return {
    sessionId: update.sessionId,
    items: update.items,
    needsFollowUp: update.needsFollowUp,
    followUpQuestions: update.followUpQuestions
  };
};

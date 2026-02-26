import type { AnalyzeData, SessionAnalyzeUpdateData } from "./types.js";

export const mergeAnalyzeData = (
  _current: AnalyzeData | null,
  update: SessionAnalyzeUpdateData
): AnalyzeData => {
  return {
    sessionId: update.sessionId,
    items: update.items,
    needsFollowUp: update.needsFollowUp,
    followUpQuestions: update.followUpQuestions
  };
};

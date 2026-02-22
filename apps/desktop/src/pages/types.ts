import type { Purpose } from "../../shared/types/workflow.js";

export interface AnalyzeData {
  sessionId: string;
  needsFollowUp: boolean;
  followUpQuestions: Array<{ fileId: string; question: string }>;
  items: Array<{
    item: { id: string; name: string };
    classification: { purpose: Purpose; project: string; confidence: number; decisionSource?: string };
  }>;
}


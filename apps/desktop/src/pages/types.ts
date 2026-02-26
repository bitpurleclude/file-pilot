import type { ClassificationRule } from "../../shared/types/rules.js";
import type { FollowUpQuestion, ProcessedSessionItem } from "../../shared/types/workflow.js";

export interface AnalyzeData {
  sessionId: string;
  needsFollowUp: boolean;
  followUpQuestions: FollowUpQuestion[];
  items: ProcessedSessionItem[];
}

export interface SessionAnalyzeUpdateData {
  sessionId: string;
  needsFollowUp: boolean;
  followUpQuestions: FollowUpQuestion[];
  items: ProcessedSessionItem[];
}

export interface SubmitFollowupData extends SessionAnalyzeUpdateData {
  updatedCount: number;
}

export interface SaveCorrectionsData extends SessionAnalyzeUpdateData {
  updatedCount: number;
  rule?: ClassificationRule;
}

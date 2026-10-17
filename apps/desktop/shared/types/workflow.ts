import type { CoordinateOption } from "./registry.js";

export type Purpose =
  | "Documents"
  | "Media"
  | "Code"
  | "Archives"
  | "Installers"
  | "Others"
  | "Study"
  | "Work"
  | "Design"
  | "Finance"
  | "Research";

export type SessionStatus =
  | "pending"
  | "analyzing"
  | "planned"
  | "applying"
  | "done"
  | "failed"
  | "rolled_back";

export type ConflictPolicy = "rename" | "overwrite" | "skip";
export type ExecuteAction = "move" | "copy";
export type ConfidenceBand = "high" | "medium" | "low";
export type DecisionSource =
  | "rule"
  | "llm-primary"
  | "llm-secondary"
  | "local-fallback"
  | "followup"
  | "manual-correction";

export interface FileItem {
  id: string;
  path: string;
  name: string;
  ext: string;
  size: number;
  createdAt: string;
  modifiedAt: string;
  mime: string;
}

export interface ContentSummary {
  textSnippet: string;
  keywords: string[];
  language: string;
}

export interface Classification {
  purpose: Purpose;
  project: string;
  timeBucket?: string;
  confidence: number;
  reasons: string[];
  confidenceBand?: ConfidenceBand;
  decisionSource?: DecisionSource;
  promptVersion?: string;
  model?: string;
  usage?: { promptTokens: number; completionTokens: number };
  /** Clean name behind a `NEW:<name>` LLM claim, for the domain-creation wizard. */
  proposedProject?: string;
}

export interface PlacementPlan {
  fileId: string;
  sourcePath: string;
  targetPath: string;
  action: ExecuteAction;
  conflictPolicy: ConflictPolicy;
  /** Registry coordinate the item was placed under (coordinated track only). */
  coordinate?: CoordinateOption;
  /** True when the target keeps the legacy purpose/project[/time-bucket] layout. */
  uncoordinated?: boolean;
}

export interface ExecutionResult {
  plan: PlacementPlan;
  executed: boolean;
  rollbackable: boolean;
  reason?: string;
}

export interface Session {
  id: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  itemIds: string[];
  executions: ExecutionResult[];
}

export interface FollowUpQuestion {
  fileId: string;
  question: string;
}

export interface ProcessedSessionItem {
  item: FileItem;
  summary: ContentSummary;
  classification: Classification;
  plan: PlacementPlan;
  needsFollowUp: boolean;
  followUpQuestion?: string;
  decisionSource: DecisionSource;
}

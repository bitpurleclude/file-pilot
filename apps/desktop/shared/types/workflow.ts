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
}

export interface PlacementPlan {
  fileId: string;
  sourcePath: string;
  targetPath: string;
  action: ExecuteAction;
  conflictPolicy: ConflictPolicy;
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

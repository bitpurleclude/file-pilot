export const EXECUTOR_CONFIG = {
  defaultMode: "dry-run",
  hashConcurrency: 4,
  ipcTimeoutMs: 30_000,
  defaultConflictPolicy: "rename",
  batchSoftLimit: 100,
  manualCorrectionConfidence: 0.95,
  conflictRenameMaxAttempts: 2,
  targetSegmentMaxLength: 64,
  fallbackProjectName: "默认项目",
  fallbackPurposeName: "Others"
} as const;

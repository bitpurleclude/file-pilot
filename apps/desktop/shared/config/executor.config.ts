export const EXECUTOR_CONFIG = {
  defaultMode: "dry-run",
  hashConcurrency: 4,
  ipcTimeoutMs: 30_000,
  defaultConflictPolicy: "rename",
  batchSoftLimit: 100
} as const;

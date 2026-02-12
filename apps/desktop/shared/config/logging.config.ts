export const LOGGING_CONFIG = {
  fileName: "events.jsonl",
  maxFileBytes: 5 * 1024 * 1024,
  warnThresholdBytes: 4 * 1024 * 1024
} as const;

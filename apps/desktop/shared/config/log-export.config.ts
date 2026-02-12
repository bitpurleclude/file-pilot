export const LOG_EXPORT_SCHEMA_VERSION = "1.0.0";

export const LOG_EXPORT_DEFAULTS = {
  anonymizeByDefault: true,
  format: "json",
  filenamePrefix: "file-pilot-log",
  outputDirName: "Downloads"
} as const;

export const LOG_EXPORT_FILE_SUFFIX = ".json";

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonArray = JsonValue[];

export interface LogExportInput {
  sessionLogs: JsonArray;
  errorLogs: JsonArray;
  executionLogs: JsonArray;
}

export interface LogExportOptions {
  anonymize: boolean;
  exportedAt: Date;
}

export interface LogExportPayload {
  schema_version: string;
  exported_at: string;
  anonymized: boolean;
  logs: {
    session_logs: JsonArray;
    error_logs: JsonArray;
    execution_logs: JsonArray;
  };
}

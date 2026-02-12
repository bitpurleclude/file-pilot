export type LogLevel = "info" | "warn" | "error";

export type LogCategory = "session" | "execution" | "error" | "audit";

export interface LogRecord {
  id: string;
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  code: string;
  message: string;
  traceId: string;
  sessionId?: string;
  details?: Record<string, unknown>;
}

export interface WriteLogInput {
  level: LogLevel;
  category: LogCategory;
  code: string;
  message: string;
  traceId: string;
  sessionId?: string;
  details?: Record<string, unknown>;
}

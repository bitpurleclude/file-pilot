export type ErrorLevel = "USER" | "SYSTEM" | "FATAL";

export class AppError extends Error {
  public readonly code: string;
  public readonly level: ErrorLevel;
  public readonly details: Record<string, unknown> | undefined;

  public constructor(
    code: string,
    message: string,
    level: ErrorLevel,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.level = level;
    this.details = details;
  }
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export const toIpcError = (error: unknown): { code: string; message: string } => {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message };
  }

  if (error instanceof Error) {
    return { code: "SYSTEM_UNKNOWN", message: error.message };
  }

  return { code: "SYSTEM_UNKNOWN", message: "未知错误" };
};

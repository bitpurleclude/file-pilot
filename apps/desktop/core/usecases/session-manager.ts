import type { ExecutionResult, Session, SessionStatus } from "../../shared/types/workflow.js";

const nowIso = (): string => new Date().toISOString();

export const createSession = (itemIds: string[]): Session => {
  const now = nowIso();
  return {
    id: crypto.randomUUID(),
    status: "pending",
    createdAt: now,
    updatedAt: now,
    itemIds,
    executions: []
  };
};

export const updateSessionStatus = (session: Session, status: SessionStatus): Session => {
  return {
    ...session,
    status,
    updatedAt: nowIso()
  };
};

export const withExecutions = (session: Session, executions: ExecutionResult[]): Session => {
  return {
    ...session,
    executions,
    updatedAt: nowIso()
  };
};

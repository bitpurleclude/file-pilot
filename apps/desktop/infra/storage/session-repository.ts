import { join } from "node:path";

import type { Session } from "../../shared/types/workflow.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";

const sessionsPath = (root: string): string => join(root, "sessions.json");

export const listSessions = async (root: string): Promise<Session[]> => {
  return readJsonFile<Session[]>(sessionsPath(root), []);
};

export const upsertSession = async (root: string, session: Session): Promise<void> => {
  const sessions = await listSessions(root);
  const idx = sessions.findIndex((item) => item.id === session.id);
  if (idx >= 0) {
    sessions[idx] = session;
  } else {
    sessions.push(session);
  }

  await writeJsonFile(sessionsPath(root), sessions);
};

export const getSessionById = async (root: string, id: string): Promise<Session | undefined> => {
  const sessions = await listSessions(root);
  return sessions.find((session) => session.id === id);
};

import type Database from "better-sqlite3";

import type { ProcessedSessionItem, Session } from "../../../../shared/types/workflow.js";

interface SessionRow {
  id: string;
  status: Session["status"];
  created_at: string;
  updated_at: string;
  item_ids_json: string;
  executions_json: string;
}

interface SessionItemRow {
  id: string;
  session_id: string;
  item_json: string;
  summary_json: string;
  classification_json: string;
  plan_json: string;
  needs_followup: number;
  followup_question: string | null;
  decision_source: ProcessedSessionItem["decisionSource"];
}

const safeParseJson = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const upsertSessionSqlite = (db: Database.Database, session: Session): void => {
  db.prepare(`
    INSERT INTO sessions (
      id,
      status,
      created_at,
      updated_at,
      item_ids_json,
      executions_json
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      updated_at = excluded.updated_at,
      item_ids_json = excluded.item_ids_json,
      executions_json = excluded.executions_json
  `).run(
    session.id,
    session.status,
    session.createdAt,
    session.updatedAt,
    JSON.stringify(session.itemIds),
    JSON.stringify(session.executions)
  );
};

export const getSessionByIdSqlite = (db: Database.Database, id: string): Session | undefined => {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
  if (row === undefined) {
    return undefined;
  }

  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    itemIds: safeParseJson<string[]>(row.item_ids_json, []),
    executions: safeParseJson<Session["executions"]>(row.executions_json, [])
  };
};

export const listSessionsSqlite = (db: Database.Database): Session[] => {
  const rows = db.prepare("SELECT * FROM sessions ORDER BY created_at DESC").all() as SessionRow[];
    return rows.map((row) => ({
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    itemIds: safeParseJson<string[]>(row.item_ids_json, []),
    executions: safeParseJson<Session["executions"]>(row.executions_json, [])
  }));
};

export interface StoredSessionItem {
  sessionId: string;
  data: ProcessedSessionItem;
}

export const replaceSessionItemsSqlite = (db: Database.Database, items: StoredSessionItem[]): void => {
  if (items.length === 0) {
    return;
  }

  const sessionId = items[0]?.sessionId;
  if (sessionId === undefined) {
    return;
  }

  const tx = db.transaction((records: StoredSessionItem[]) => {
    db.prepare("DELETE FROM session_items WHERE session_id = ?").run(sessionId);
    const insert = db.prepare(`
      INSERT INTO session_items (
        id,
        session_id,
        source_path,
        item_json,
        summary_json,
        classification_json,
        plan_json,
        needs_followup,
        followup_question,
        decision_source,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    for (const record of records) {
      insert.run(
        record.data.item.id,
        record.sessionId,
        record.data.item.path,
        JSON.stringify(record.data.item),
        JSON.stringify(record.data.summary),
        JSON.stringify(record.data.classification),
        JSON.stringify(record.data.plan),
        record.data.needsFollowUp ? 1 : 0,
        record.data.followUpQuestion ?? null,
        record.data.decisionSource,
        now,
        now
      );
    }
  });

  tx(items);
};

export const listSessionItemsSqlite = (db: Database.Database, sessionId: string): ProcessedSessionItem[] => {
  const rows = db
    .prepare("SELECT * FROM session_items WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId) as SessionItemRow[];

  return rows.map((row) => ({
    item: safeParseJson<ProcessedSessionItem["item"]>(row.item_json, {
      id: row.id,
      path: "",
      name: "",
      ext: "",
      size: 0,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      mime: "application/octet-stream"
    }),
    summary: safeParseJson<ProcessedSessionItem["summary"]>(row.summary_json, {
      textSnippet: "",
      keywords: [],
      language: "zh-CN"
    }),
    classification: safeParseJson<ProcessedSessionItem["classification"]>(row.classification_json, {
      purpose: "Others",
      project: "default",
      confidence: 0,
      reasons: []
    }),
    plan: safeParseJson<ProcessedSessionItem["plan"]>(row.plan_json, {
      fileId: row.id,
      sourcePath: "",
      targetPath: "",
      action: "move",
      conflictPolicy: "rename"
    }),
    needsFollowUp: row.needs_followup === 1,
    ...(row.followup_question === null ? {} : { followUpQuestion: row.followup_question }),
    decisionSource: row.decision_source
  }));
};

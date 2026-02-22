import type Database from "better-sqlite3";

import type { DecisionSource, Purpose } from "../../../../shared/types/workflow.js";

export interface ClassificationDecisionRecord {
  id: string;
  sessionId: string;
  fileId: string;
  source: DecisionSource;
  confidence: number;
  purpose: Purpose;
  project: string;
  promptVersion?: string;
  model?: string;
  reasons: string[];
  createdAt: string;
}

interface DecisionRow {
  id: string;
  session_id: string;
  file_id: string;
  source: DecisionSource;
  confidence: number;
  purpose: Purpose;
  project: string;
  prompt_version: string | null;
  model: string | null;
  reasons_json: string;
  created_at: string;
}

const safeReasons = (raw: string): string[] => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
};

export const appendDecisionRecordsSqlite = (db: Database.Database, records: ClassificationDecisionRecord[]): void => {
  if (records.length === 0) {
    return;
  }

  const insert = db.prepare(`
    INSERT INTO classification_decisions (
      id,
      session_id,
      file_id,
      source,
      confidence,
      purpose,
      project,
      prompt_version,
      model,
      reasons_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((rows: ClassificationDecisionRecord[]) => {
    for (const record of rows) {
      insert.run(
        record.id,
        record.sessionId,
        record.fileId,
        record.source,
        record.confidence,
        record.purpose,
        record.project,
        record.promptVersion ?? null,
        record.model ?? null,
        JSON.stringify(record.reasons),
        record.createdAt
      );
    }
  });

  tx(records);
};

export const listDecisionsBySessionSqlite = (db: Database.Database, sessionId: string): ClassificationDecisionRecord[] => {
  const rows = db
    .prepare("SELECT * FROM classification_decisions WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId) as DecisionRow[];

  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    fileId: row.file_id,
    source: row.source,
    confidence: row.confidence,
    purpose: row.purpose,
    project: row.project,
    ...(row.prompt_version === null ? {} : { promptVersion: row.prompt_version }),
    ...(row.model === null ? {} : { model: row.model }),
    reasons: safeReasons(row.reasons_json),
    createdAt: row.created_at
  }));
};


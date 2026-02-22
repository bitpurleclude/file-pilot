import type Database from "better-sqlite3";

export interface LogIndexRecord {
  category: string;
  code: string;
  traceId: string;
  timestamp: string;
  sessionId?: string;
}

export const appendLogIndexRecordSqlite = (db: Database.Database, record: LogIndexRecord): void => {
  db.prepare(`
    INSERT INTO logs_index (
      category,
      code,
      trace_id,
      session_id,
      timestamp
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    record.category,
    record.code,
    record.traceId,
    record.sessionId ?? null,
    record.timestamp
  );
};

export const listLogIndexBySessionSqlite = (db: Database.Database, sessionId: string): LogIndexRecord[] => {
  const rows = db
    .prepare(`
      SELECT category, code, trace_id, session_id, timestamp
      FROM logs_index
      WHERE session_id = ?
      ORDER BY timestamp ASC
    `)
    .all(sessionId) as Array<{
    category: string;
    code: string;
    trace_id: string;
    session_id: string | null;
    timestamp: string;
  }>;

  return rows.map((row) => ({
    category: row.category,
    code: row.code,
    traceId: row.trace_id,
    timestamp: row.timestamp,
    ...(row.session_id === null ? {} : { sessionId: row.session_id })
  }));
};


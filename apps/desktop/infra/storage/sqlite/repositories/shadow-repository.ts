import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

/**
 * 影子模式对齐记录仓储（shadow_alignments，0005_shadow.sql）。
 *
 * 结构上与 infra/llm/shadow-runner.ts 的 ShadowRecord 兼容（不反向依赖
 * LLM 基础设施层），由触发方直接把 runner 产出的记录批量落库。
 */
export interface ShadowAlignmentRecord {
  sessionId: string;
  fileId: string;
  fileName: string;
  level: "area" | "project";
  expectedId: string | null;
  predictedId: string | null;
  confidence: number | null;
  agree: boolean | null;
  at: string;
}

export interface ShadowLevelSummary {
  total: number;
  agreed: number;
  /** agreeRate = agreed / agree 非 NULL 的行数；分母为 0 时为 null。 */
  agreeRate: number | null;
}

export interface ShadowSummary extends ShadowLevelSummary {
  byLevel: {
    area: ShadowLevelSummary;
    project: ShadowLevelSummary;
  };
}

interface SummaryRow {
  level: "area" | "project";
  total: number;
  agreed: number;
  comparable: number;
}

const levelSummaryOf = (total: number, agreed: number, comparable: number): ShadowLevelSummary => ({
  total,
  agreed,
  ...(comparable > 0 ? { agreeRate: agreed / comparable } : { agreeRate: null })
});

export const appendShadowRecords = (db: Database.Database, records: ShadowAlignmentRecord[]): void => {
  if (records.length === 0) {
    return;
  }

  const insert = db.prepare(`
    INSERT INTO shadow_alignments (
      id,
      session_id,
      file_id,
      file_name,
      level,
      expected_id,
      predicted_id,
      confidence,
      agree,
      at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((rows: ShadowAlignmentRecord[]) => {
    for (const record of rows) {
      insert.run(
        randomUUID(),
        record.sessionId,
        record.fileId,
        record.fileName,
        record.level,
        record.expectedId,
        record.predictedId,
        record.confidence,
        record.agree === null ? null : record.agree ? 1 : 0,
        record.at
      );
    }
  });

  tx(records);
};

/** 影子对齐汇总：总数、一致数、对齐率（分母 = agree 非 NULL 的行）与分级明细。 */
export const shadowSummary = (
  db: Database.Database,
  params?: { level?: "area" | "project"; sinceAt?: string }
): ShadowSummary => {
  const conditions: string[] = [];
  const bindValues: Array<string> = [];
  if (params?.level !== undefined) {
    conditions.push("level = ?");
    bindValues.push(params.level);
  }
  if (params?.sinceAt !== undefined) {
    conditions.push("at >= ?");
    bindValues.push(params.sinceAt);
  }
  const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";

  const rows = db
    .prepare(`
      SELECT
        level,
        COUNT(*) AS total,
        SUM(CASE WHEN agree = 1 THEN 1 ELSE 0 END) AS agreed,
        SUM(CASE WHEN agree IS NOT NULL THEN 1 ELSE 0 END) AS comparable
      FROM shadow_alignments${whereClause}
      GROUP BY level
    `)
    .all(...bindValues) as SummaryRow[];

  const byLevel: Record<"area" | "project", ShadowLevelSummary> = {
    area: levelSummaryOf(0, 0, 0),
    project: levelSummaryOf(0, 0, 0)
  };
  let total = 0;
  let agreed = 0;
  let comparable = 0;
  for (const row of rows) {
    const summary = levelSummaryOf(row.total, row.agreed, row.comparable);
    byLevel[row.level] = summary;
    total += row.total;
    agreed += row.agreed;
    comparable += row.comparable;
  }

  return { ...levelSummaryOf(total, agreed, comparable), byLevel };
};

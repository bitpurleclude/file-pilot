import type Database from "better-sqlite3";

import type { ClassificationRule, RuleUpdatePayload } from "../../../../shared/types/rules.js";

interface RuleRow {
  id: string;
  purpose: ClassificationRule["purpose"];
  project: string;
  project_id: string | null;
  ext: string | null;
  path_prefix: string | null;
  keywords_json: string;
  negative_keywords_json: string;
  priority: number;
  enabled: number;
  source: ClassificationRule["source"];
  hits: number;
  created_at: string;
  updated_at: string;
  last_matched_at: string | null;
}

const safeArrayJson = (raw: string): string[] => {
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

const toRule = (row: RuleRow): ClassificationRule => {
  return {
    id: row.id,
    purpose: row.purpose,
    project: row.project,
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
    matcher: {
      ...(row.ext === null ? {} : { ext: row.ext }),
      ...(row.path_prefix === null ? {} : { pathPrefix: row.path_prefix }),
      keywords: safeArrayJson(row.keywords_json),
      negativeKeywords: safeArrayJson(row.negative_keywords_json)
    },
    priority: row.priority,
    enabled: row.enabled === 1,
    source: row.source,
    hits: row.hits,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_matched_at === null ? {} : { lastMatchedAt: row.last_matched_at })
  };
};

export const listRulesSqlite = (db: Database.Database, params?: { includeDisabled?: boolean }): ClassificationRule[] => {
  const includeDisabled = params?.includeDisabled ?? true;
  const query = includeDisabled
    ? "SELECT * FROM classification_rules ORDER BY priority DESC, updated_at DESC"
    : "SELECT * FROM classification_rules WHERE enabled = 1 ORDER BY priority DESC, updated_at DESC";
  const rows = db.prepare(query).all() as RuleRow[];
  return rows.map((row) => toRule(row));
};

export const createRuleSqlite = (db: Database.Database, rule: ClassificationRule): ClassificationRule => {
  db.prepare(`
    INSERT INTO classification_rules (
      id,
      purpose,
      project,
      ext,
      path_prefix,
      keywords_json,
      negative_keywords_json,
      priority,
      enabled,
      source,
      hits,
      created_at,
      updated_at,
      last_matched_at,
      project_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    rule.id,
    rule.purpose,
    rule.project,
    rule.matcher.ext ?? null,
    rule.matcher.pathPrefix ?? null,
    JSON.stringify(rule.matcher.keywords),
    JSON.stringify(rule.matcher.negativeKeywords),
    rule.priority,
    rule.enabled ? 1 : 0,
    rule.source,
    rule.hits,
    rule.createdAt,
    rule.updatedAt,
    rule.lastMatchedAt ?? null,
    rule.projectId ?? null
  );

  return rule;
};

export const getRuleByIdSqlite = (db: Database.Database, ruleId: string): ClassificationRule | undefined => {
  const row = db.prepare("SELECT * FROM classification_rules WHERE id = ?").get(ruleId) as RuleRow | undefined;
  if (row === undefined) {
    return undefined;
  }

  return toRule(row);
};

export const updateRuleSqlite = (db: Database.Database, payload: RuleUpdatePayload): ClassificationRule => {
  const current = getRuleByIdSqlite(db, payload.ruleId);
  if (current === undefined) {
    throw new Error("rule not found");
  }

  const next: ClassificationRule = {
    ...current,
    ...(payload.enabled === undefined ? {} : { enabled: payload.enabled }),
    ...(payload.priority === undefined ? {} : { priority: payload.priority }),
    ...(payload.project === undefined ? {} : { project: payload.project }),
    ...(payload.projectId === undefined ? {} : { projectId: payload.projectId }),
    ...(payload.purpose === undefined ? {} : { purpose: payload.purpose }),
    updatedAt: new Date().toISOString()
  };

  db.prepare(`
    UPDATE classification_rules
    SET
      purpose = ?,
      project = ?,
      project_id = ?,
      priority = ?,
      enabled = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    next.purpose,
    next.project,
    next.projectId ?? null,
    next.priority,
    next.enabled ? 1 : 0,
    next.updatedAt,
    payload.ruleId
  );

  return next;
};

export const incrementRuleHitSqlite = (db: Database.Database, ruleId: string): void => {
  db.prepare(`
    UPDATE classification_rules
    SET
      hits = hits + 1,
      last_matched_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), new Date().toISOString(), ruleId);
};


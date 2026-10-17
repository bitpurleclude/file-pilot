import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import { REGISTRY_CONFIG } from "../../../../shared/config/registry.config.js";
import { AppError } from "../../../../shared/errors/app-error.js";
import type {
  RegistryArea,
  RegistryCoordinate,
  RegistryProject,
  RegistryStatus
} from "../../../../shared/types/registry.js";
import { AREA_NUMBER_MAX, AREA_NUMBER_MIN, PROJECT_NUMBER_MAX } from "../../../../shared/types/registry.js";
import type { DecisionSource, Purpose } from "../../../../shared/types/workflow.js";

const NEW_PROJECT_PREFIX = "NEW:";

/** True for SQLite UNIQUE-constraint violations (the CI name indexes). */
const isSqliteUniqueViolation = (error: unknown): boolean => {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE";
};

interface AreaRow {
  id: string;
  number: number;
  name: string;
  status: RegistryStatus;
  created_at: string;
  retired_at: string | null;
}

interface ProjectRow {
  id: string;
  area_id: string;
  number: number;
  name: string;
  aliases_json: string;
  status: RegistryStatus;
  created_at: string;
  retired_at: string | null;
  sample_paths_json: string | null;
}

interface CoordinateRow {
  area_id: string;
  area_number: number;
  area_name: string;
  project_id: string;
  project_number: number;
  project_name: string;
}

/** A `NEW:`-prefixed project claim extracted from stored classification decisions. */
export interface RegistryProposal {
  id: string;
  sessionId: string;
  fileId: string;
  proposedName: string;
  purpose: Purpose;
  confidence: number;
  source: DecisionSource;
  createdAt: string;
}

interface ProposalRow {
  id: string;
  session_id: string;
  file_id: string;
  source: DecisionSource;
  confidence: number;
  purpose: Purpose;
  project: string;
  created_at: string;
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

const safeOptionalArrayJson = (raw: string | null): string[] | undefined => {
  if (raw === null) {
    return undefined;
  }

  return safeArrayJson(raw);
};

const toArea = (row: AreaRow): RegistryArea => {
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    ...(row.retired_at === null ? {} : { retiredAt: row.retired_at })
  };
};

const toProject = (row: ProjectRow): RegistryProject => {
  const samplePaths = safeOptionalArrayJson(row.sample_paths_json);
  return {
    id: row.id,
    areaId: row.area_id,
    number: row.number,
    name: row.name,
    aliases: safeArrayJson(row.aliases_json),
    status: row.status,
    createdAt: row.created_at,
    ...(row.retired_at === null ? {} : { retiredAt: row.retired_at }),
    ...(samplePaths === undefined ? {} : { samplePaths })
  };
};

const getAreaRow = (db: Database.Database, areaId: string): AreaRow => {
  const row = db.prepare("SELECT * FROM registry_areas WHERE id = ?").get(areaId) as AreaRow | undefined;
  if (row === undefined) {
    throw new AppError("REGISTRY_AREA_NOT_FOUND", `领域不存在: ${areaId}`, "USER", { areaId });
  }

  return row;
};

export const listAreas = (
  db: Database.Database,
  params?: { includeArchived?: boolean }
): RegistryArea[] => {
  const includeArchived = params?.includeArchived ?? false;
  const rows = (
    includeArchived
      ? db.prepare("SELECT * FROM registry_areas ORDER BY number ASC")
      : db.prepare("SELECT * FROM registry_areas WHERE status = 'active' ORDER BY number ASC")
  ).all() as AreaRow[];

  return rows.map((row) => toArea(row));
};

export const findAreaByNumber = (db: Database.Database, number: number): RegistryArea | undefined => {
  const row = db.prepare("SELECT * FROM registry_areas WHERE number = ?").get(number) as AreaRow | undefined;
  return row === undefined ? undefined : toArea(row);
};

/**
 * Claims the next free area slot (10..80 step 10). Archived areas keep their
 * numbers (retirement protocol: numbers are never reused), so archived rows
 * count as occupied.
 */
export const createArea = (db: Database.Database, params: { name: string }): RegistryArea => {
  const name = params.name.trim();
  if (name.length === 0) {
    throw new AppError("REGISTRY_AREA_NAME_REQUIRED", "领域名称不能为空", "USER");
  }

  try {
    const tx = db.transaction((): RegistryArea => {
      const occupiedRows = db.prepare("SELECT number FROM registry_areas").all() as { number: number }[];
      const occupied = new Set(occupiedRows.map((row) => row.number));

      let claimed: number | undefined;
      for (let candidate = AREA_NUMBER_MIN; candidate <= AREA_NUMBER_MAX; candidate += 10) {
        if (!occupied.has(candidate)) {
          claimed = candidate;
          break;
        }
      }

      if (claimed === undefined) {
        throw new AppError(
          "REGISTRY_AREA_SLOTS_EXHAUSTED",
          `领域编号槽位已用尽（${AREA_NUMBER_MIN}-${AREA_NUMBER_MAX}）`,
          "USER",
          { maxAreas: REGISTRY_CONFIG.maxAreas }
        );
      }

      const now = new Date().toISOString();
      const area: RegistryArea = {
        id: randomUUID(),
        number: claimed,
        name,
        status: "active",
        createdAt: now
      };

      db
        .prepare("INSERT INTO registry_areas (id, number, name, status, created_at, retired_at) VALUES (?, ?, ?, ?, ?, NULL)")
        .run(area.id, area.number, area.name, area.status, area.createdAt);

      return area;
    });

    return tx();
  } catch (error) {
    if (isSqliteUniqueViolation(error)) {
      // CI unique index: a case variant of an active name raced the preflight.
      throw new AppError("REGISTRY_DUPLICATE_NAME", `领域名称已存在: ${name}`, "USER", { name });
    }
    throw error;
  }
};

/** Archives an area and cascades archival to its active projects. Idempotent. */
export const archiveArea = (db: Database.Database, areaId: string): void => {
  const tx = db.transaction(() => {
    const area = getAreaRow(db, areaId);
    if (area.status === "archived") {
      return;
    }

    const now = new Date().toISOString();
    db.prepare("UPDATE registry_areas SET status = 'archived', retired_at = ? WHERE id = ?").run(now, areaId);
    db
      .prepare("UPDATE registry_projects SET status = 'archived', retired_at = ? WHERE area_id = ? AND status = 'active'")
      .run(now, areaId);
  });

  tx();
};

export const listProjects = (db: Database.Database, areaId: string): RegistryProject[] => {
  const rows = db
    .prepare("SELECT * FROM registry_projects WHERE area_id = ? ORDER BY number ASC")
    .all(areaId) as ProjectRow[];

  return rows.map((row) => toProject(row));
};

export const findProjectById = (db: Database.Database, projectId: string): RegistryProject | undefined => {
  const row = db.prepare("SELECT * FROM registry_projects WHERE id = ?").get(projectId) as ProjectRow | undefined;
  return row === undefined ? undefined : toProject(row);
};

/**
 * Archives a project. Its slot number stays occupied forever (unique index on
 * (area_id, number) remains and slot claiming scans all statuses), so numbers
 * are never reused after retirement.
 */
export const archiveProject = (db: Database.Database, projectId: string): void => {
  const tx = db.transaction(() => {
    const row = db.prepare("SELECT * FROM registry_projects WHERE id = ?").get(projectId) as ProjectRow | undefined;
    if (row === undefined) {
      throw new AppError("REGISTRY_PROJECT_NOT_FOUND", `项目不存在: ${projectId}`, "USER", { projectId });
    }

    if (row.status === "archived") {
      return;
    }

    db.prepare("UPDATE registry_projects SET status = 'archived', retired_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      projectId
    );
  });

  tx();
};

/**
 * Claims the next free project slot (1..9) inside the area. Archived projects
 * keep their numbers, so they count as occupied. Slot exhaustion uses a
 * dedicated error code distinct from the area-level one.
 */
export const createProject = (
  db: Database.Database,
  params: { areaId: string; name: string; aliases?: string[] }
): RegistryProject => {
  const name = params.name.trim();
  if (name.length === 0) {
    throw new AppError("REGISTRY_PROJECT_NAME_REQUIRED", "项目名称不能为空", "USER");
  }

  const aliases = params.aliases ?? [];

  try {
    return createProjectTx(db, { areaId: params.areaId, name, aliases });
  } catch (error) {
    if (isSqliteUniqueViolation(error)) {
      // CI unique index: a case variant of an active name raced the preflight.
      throw new AppError("REGISTRY_DUPLICATE_NAME", `活跃项目名称已存在: ${name}`, "USER", {
        areaId: params.areaId,
        name
      });
    }
    throw error;
  }
};

const createProjectTx = (
  db: Database.Database,
  params: { areaId: string; name: string; aliases: string[] }
): RegistryProject => {
  const name = params.name;
  const aliases = params.aliases;

  const tx = db.transaction((): RegistryProject => {
    const area = getAreaRow(db, params.areaId);
    if (area.status !== "active") {
      throw new AppError("REGISTRY_AREA_ARCHIVED", `领域已归档，不能新建项目: ${area.name}`, "USER", {
        areaId: area.id
      });
    }

    const nameTaken = db
      .prepare("SELECT 1 FROM registry_projects WHERE area_id = ? AND name = ? AND status = 'active' LIMIT 1")
      .get(params.areaId, name);
    if (nameTaken !== undefined) {
      throw new AppError("REGISTRY_PROJECT_NAME_TAKEN", `活跃项目名称已存在: ${name}`, "USER", {
        areaId: params.areaId,
        name
      });
    }

    const occupiedRows = db
      .prepare("SELECT number FROM registry_projects WHERE area_id = ?")
      .all(params.areaId) as { number: number }[];
    const occupied = new Set(occupiedRows.map((row) => row.number));

    let claimed: number | undefined;
    for (let candidate = 1; candidate <= PROJECT_NUMBER_MAX; candidate += 1) {
      if (!occupied.has(candidate)) {
        claimed = candidate;
        break;
      }
    }

    if (claimed === undefined) {
      throw new AppError(
        "REGISTRY_PROJECT_SLOTS_EXHAUSTED",
        `领域「${area.name}」项目槽位已满（1-${PROJECT_NUMBER_MAX}）`,
        "USER",
        { areaId: params.areaId, maxProjectsPerArea: REGISTRY_CONFIG.maxProjectsPerArea }
      );
    }

    const now = new Date().toISOString();
    const project: RegistryProject = {
      id: randomUUID(),
      areaId: params.areaId,
      number: claimed,
      name,
      aliases,
      status: "active",
      createdAt: now
    };

    db
      .prepare(`
        INSERT INTO registry_projects (
          id, area_id, number, name, aliases_json, status, created_at, retired_at, sample_paths_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      `)
      .run(project.id, project.areaId, project.number, project.name, JSON.stringify(project.aliases), project.status, project.createdAt);

    return project;
  });

  return tx();
};

/** Active coordinates only: they are the canonical "destination" surface. */
export const listActiveCoordinates = (db: Database.Database): RegistryCoordinate[] => {
  const rows = db
    .prepare(`
      SELECT
        a.id AS area_id,
        a.number AS area_number,
        a.name AS area_name,
        p.id AS project_id,
        p.number AS project_number,
        p.name AS project_name
      FROM registry_areas a
      JOIN registry_projects p ON p.area_id = a.id
      WHERE a.status = 'active' AND p.status = 'active'
      ORDER BY a.number ASC, p.number ASC
    `)
    .all() as CoordinateRow[];

  return rows.map((row) => ({
    areaId: row.area_id,
    areaNumber: row.area_number,
    areaName: row.area_name,
    projectId: row.project_id,
    projectNumber: row.project_number,
    projectName: row.project_name
  }));
};

/** Resolves an active coordinate by its two-level numbers, or undefined. */
export const resolveCoordinate = (
  db: Database.Database,
  areaNumber: number,
  projectNumber: number
): RegistryCoordinate | undefined => {
  const row = db
    .prepare(`
      SELECT
        a.id AS area_id,
        a.number AS area_number,
        a.name AS area_name,
        p.id AS project_id,
        p.number AS project_number,
        p.name AS project_name
      FROM registry_areas a
      JOIN registry_projects p ON p.area_id = a.id
      WHERE a.number = ? AND p.number = ? AND a.status = 'active' AND p.status = 'active'
      LIMIT 1
    `)
    .get(areaNumber, projectNumber) as CoordinateRow | undefined;

  return row === undefined
    ? undefined
    : {
        areaId: row.area_id,
        areaNumber: row.area_number,
        areaName: row.area_name,
        projectId: row.project_id,
        projectNumber: row.project_number,
        projectName: row.project_name
      };
};

/** Appends a sample path with dedup, keeping at most `maxSamplePaths` recent entries. */
export const addSamplePath = (db: Database.Database, projectId: string, path: string): void => {
  const tx = db.transaction(() => {
    const row = db
      .prepare("SELECT sample_paths_json FROM registry_projects WHERE id = ?")
      .get(projectId) as { sample_paths_json: string | null } | undefined;
    if (row === undefined) {
      throw new AppError("REGISTRY_PROJECT_NOT_FOUND", `项目不存在: ${projectId}`, "USER", { projectId });
    }

    const existing = safeOptionalArrayJson(row.sample_paths_json) ?? [];
    if (existing.includes(path)) {
      return;
    }

    const next = [...existing, path].slice(-REGISTRY_CONFIG.maxSamplePaths);
    db.prepare("UPDATE registry_projects SET sample_paths_json = ? WHERE id = ?").run(
      JSON.stringify(next),
      projectId
    );
  });

  tx();
};

/**
 * Reads recent new-project proposals from classification_decisions.
 *
 * The `project` column is where the `NEW:` prefix lives (governance-design
 * §4.3: the prompt instructs the model to emit `NEW:<name>` in the project
 * field), so we match on that dedicated column instead of LIKE-scanning the
 * free-form reasons_json — no extra migration column needed.
 */
export const listProposals = (db: Database.Database, limit: number): RegistryProposal[] => {
  if (limit <= 0) {
    return [];
  }

  const rows = db
    .prepare(`
      SELECT id, session_id, file_id, source, confidence, purpose, project, created_at
      FROM classification_decisions
      WHERE project LIKE ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(`${NEW_PROJECT_PREFIX}%`, limit) as ProposalRow[];

  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    fileId: row.file_id,
    proposedName: row.project.slice(NEW_PROJECT_PREFIX.length).trim(),
    purpose: row.purpose,
    confidence: row.confidence,
    source: row.source,
    createdAt: row.created_at
  }));
};

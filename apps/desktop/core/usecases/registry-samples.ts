import type Database from "better-sqlite3";

import { addSamplePath } from "../../infra/storage/sqlite/repositories/registry-repository.js";
import type { ProcessedSessionItem } from "../../shared/types/workflow.js";

/**
 * Accumulates registry sample paths at analyze/correction time (governance
 * design §1.2/§2): the dedup judge can then compare candidate names against
 * representative basenames. Recording is best-effort — a project archived
 * between planning and recording must never fail the analyze request.
 */
export const recordCoordinateSamples = (
  db: Database.Database,
  items: ReadonlyArray<ProcessedSessionItem>
): number => {
  let recorded = 0;
  for (const item of items) {
    const projectId = item.plan.coordinate?.projectId;
    if (projectId === undefined) {
      continue;
    }

    try {
      addSamplePath(db, projectId, item.item.path);
      recorded += 1;
    } catch {
      // Best-effort side channel; the placement result is already persisted.
    }
  }
  return recorded;
};

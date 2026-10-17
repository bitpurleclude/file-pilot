import type Database from "better-sqlite3";

import { REGISTRY_CONFIG } from "../../shared/config/registry.config.js";
import type {
  DedupEvidence,
  DedupJudge,
  DedupJudgeInput
} from "../../shared/ipc/contracts.js";
import { listAreas, listProjects } from "../../infra/storage/sqlite/repositories/registry-repository.js";
import type { RegistryProject } from "../../shared/types/registry.js";

export type { DedupEvidence, DedupJudge, DedupJudgeEntry, DedupJudgeInput } from "../../shared/ipc/contracts.js";

/**
 * Three-level duplicate detection (birth protocol, governance-design §2):
 *
 * - exact: normalized (trim + case-insensitive, win32-style) equality against
 *   active area/project names and project aliases;
 * - similar: normalized similarity (Levenshtein ratio / bigram Dice) at or
 *   above `REGISTRY_CONFIG.similarNameThreshold`, plus two CJK-friendly
 *   shortcuts (containment, tail-only digit/suffix difference);
 * - semantic: delegated to the injected judge, only when neither level above
 *   produced evidence and a judge was provided. Judge failures/timeouts never
 *   throw: every uncovered name degrades to an "unsure" semantic entry.
 *
 * The returned evidence is always sorted exact > similar (by score desc) > semantic.
 */

/** Score assigned when one name is a contiguous substring of the other. */
const CONTAINMENT_SCORE = 0.85;
/** Score assigned for tail-only digit/suffix differences (e.g. 考公 vs 考公2). */
const TAIL_DIFFERENCE_SCORE = 0.9;
/** Literal copy-style suffixes stripped by the tail-only rule. */
const TAIL_MARKERS = ["copy", "副本"] as const;
/** Trailing characters ignored by the tail-only rule. */
const TAIL_NOISE = /[\s\d_\-·（）()]+$/u;

interface RegistryEntry extends DedupJudgeInput {
  kind: "area" | "project";
  aliases: string[];
}

const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }

  const row: number[] = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) {
    row[j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0] ?? 0;
    row[0] = i;
    const charA = a.charAt(i - 1);
    for (let j = 1; j <= b.length; j += 1) {
      const upper = row[j] ?? 0;
      const left = row[j - 1] ?? 0;
      const cost = charA === b.charAt(j - 1) ? 0 : 1;
      const next = Math.min(upper + 1, left + 1, diagonal + cost);
      diagonal = upper;
      row[j] = next;
    }
  }

  return row[b.length] ?? Math.max(a.length, b.length);
};

const levenshteinRatio = (a: string, b: string): number => {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) {
    return 1;
  }

  return 1 - levenshteinDistance(a, b) / maxLen;
};

const bigrams = (value: string): string[] => {
  const result: string[] = [];
  for (let i = 0; i + 1 < value.length; i += 1) {
    result.push(value.slice(i, i + 2));
  }
  return result;
};

/** Sørensen–Dice coefficient over character bigrams; CJK-friendly. */
const bigramDice = (a: string, b: string): number => {
  if (a.length < 2 || b.length < 2) {
    return a === b ? 1 : 0;
  }

  const gramsA = bigrams(a);
  const gramsB = bigrams(b);
  const remaining = new Map<string, number>();
  for (const gram of gramsB) {
    remaining.set(gram, (remaining.get(gram) ?? 0) + 1);
  }

  let intersection = 0;
  for (const gram of gramsA) {
    const count = remaining.get(gram) ?? 0;
    if (count > 0) {
      intersection += 1;
      remaining.set(gram, count - 1);
    }
  }

  return (2 * intersection) / (gramsA.length + gramsB.length);
};

const stripTailDifference = (value: string): string => {
  let out = value.toLowerCase();
  let changed = true;
  while (changed) {
    changed = false;
    for (const marker of TAIL_MARKERS) {
      if (out.length > marker.length && out.endsWith(marker)) {
        out = out.slice(0, out.length - marker.length);
        changed = true;
      }
    }
  }
  return out.replace(TAIL_NOISE, "");
};

interface SimilarityResult {
  score: number;
  containment: boolean;
  tailOnly: boolean;
}

const similarityScore = (candidate: string, existing: string): SimilarityResult => {
  const base = Math.max(levenshteinRatio(candidate, existing), bigramDice(candidate, existing));
  const containment = Math.min(candidate.length, existing.length) >= 2
    && (candidate.includes(existing) || existing.includes(candidate));
  const strippedCandidate = stripTailDifference(candidate);
  const tailOnly = strippedCandidate.length > 0 && strippedCandidate === stripTailDifference(existing);

  let score = base;
  if (containment) {
    score = Math.max(score, CONTAINMENT_SCORE);
  }
  if (tailOnly) {
    score = Math.max(score, TAIL_DIFFERENCE_SCORE);
  }

  return { score, containment, tailOnly };
};

const sampleTextFor = (project: RegistryProject): string | undefined => {
  const basenames = (project.samplePaths ?? [])
    .map((path) => path.split(/[\\/]/).pop() ?? path)
    .filter((basename) => basename.length > 0);
  return basenames.length === 0 ? undefined : basenames.join("；");
};

const collectEntries = (db: Database.Database): RegistryEntry[] => {
  const areas = listAreas(db);
  const entries: RegistryEntry[] = areas.map((area) => ({
    name: area.name,
    kind: "area",
    aliases: []
  }));

  const activeProjects = areas
    .flatMap((area) => listProjects(db, area.id))
    .filter((project) => project.status === "active");
  for (const project of activeProjects) {
    const sampleText = sampleTextFor(project);
    entries.push({
      name: project.name,
      kind: "project",
      aliases: project.aliases,
      ...(sampleText === undefined ? {} : { sampleText })
    });
  }

  return entries;
};

const roundScore = (score: number): number => Math.round(score * 10000) / 10000;

export const checkDuplicate = async (
  db: Database.Database,
  name: string,
  judge?: DedupJudge
): Promise<DedupEvidence[]> => {
  const candidate = name.trim();
  if (candidate.length === 0) {
    return [];
  }
  const normalizedCandidate = candidate.toLowerCase();
  const entries = collectEntries(db);

  const evidence: DedupEvidence[] = [];
  const exactNames = new Set<string>();

  // Level 1: exact against names and project aliases.
  for (const entry of entries) {
    if (entry.name.trim().toLowerCase() === normalizedCandidate) {
      exactNames.add(entry.name);
      evidence.push({
        level: "exact",
        matchedName: entry.name,
        matchedKind: entry.kind,
        detail: `名称完全一致（忽略大小写与首尾空白）: ${candidate}`
      });
      continue;
    }

    const alias = entry.aliases.find((value) => value.trim().toLowerCase() === normalizedCandidate);
    if (alias !== undefined) {
      exactNames.add(entry.name);
      evidence.push({
        level: "exact",
        matchedName: entry.name,
        matchedKind: entry.kind,
        detail: `别名完全一致: ${alias}`
      });
    }
  }

  // Level 2: normalized similarity + tail-only/containment shortcuts.
  for (const entry of entries) {
    if (exactNames.has(entry.name)) {
      continue;
    }

    const normalized = entry.name.trim().toLowerCase();
    const { score, containment, tailOnly } = similarityScore(normalizedCandidate, normalized);
    if (score < REGISTRY_CONFIG.similarNameThreshold) {
      continue;
    }

    const reason = tailOnly
      ? "仅尾部数字/后缀差异"
      : containment
        ? "名称存在包含关系"
        : "归一化相似度达标";
    evidence.push({
      level: "similar",
      matchedName: entry.name,
      matchedKind: entry.kind,
      detail: `${reason}: ${candidate} ~ ${entry.name}`,
      score: roundScore(score)
    });
  }

  // Level 3: semantic judge, only when nothing above hit and a judge exists.
  if (evidence.length === 0 && judge !== undefined) {
    const inputs: DedupJudgeInput[] = entries.map((entry) => (
      { name: entry.name, ...(entry.sampleText === undefined ? {} : { sampleText: entry.sampleText }) }
    ));
    // rank 0 = "same", rank 1 = "unsure": stronger verdicts sort first inside
    // the semantic level (stable for equal ranks).
    const semanticHits: Array<{ item: DedupEvidence; rank: number }> = [];
    try {
      const verdicts = await judge(candidate, inputs);
      const byName = new Map(
        verdicts.map((verdict) => [verdict.name.trim().toLowerCase(), verdict])
      );

      for (const entry of entries) {
        const verdict = byName.get(entry.name.trim().toLowerCase());
        if (verdict === undefined) {
          semanticHits.push({
            rank: 1,
            item: {
              level: "semantic",
              matchedName: entry.name,
              matchedKind: entry.kind,
              detail: "语义判定 unsure: judge 未覆盖该名称"
            }
          });
          continue;
        }

        if (verdict.verdict === "different") {
          continue;
        }

        semanticHits.push({
          rank: verdict.verdict === "same" ? 0 : 1,
          item: {
            level: "semantic",
            matchedName: entry.name,
            matchedKind: entry.kind,
            detail: `语义判定 ${verdict.verdict}: ${verdict.reason}`
          }
        });
      }
    } catch (error) {
      const reasonText = error instanceof Error ? error.message : String(error);
      for (const entry of entries) {
        semanticHits.push({
          rank: 1,
          item: {
            level: "semantic",
            matchedName: entry.name,
            matchedKind: entry.kind,
            detail: `语义判定 unsure: judge 调用失败（${reasonText}）`
          }
        });
      }
    }

    semanticHits.sort((left, right) => left.rank - right.rank);
    evidence.push(...semanticHits.map((hit) => hit.item));
  }

  const levelOrder: Record<DedupEvidence["level"], number> = { exact: 0, similar: 1, semantic: 2 };
  return evidence.sort((left, right) =>
    levelOrder[left.level] - levelOrder[right.level] || (right.score ?? 0) - (left.score ?? 0)
  );
};

/**
 * Wraps a judge with a wall-clock budget. On timeout the returned promise
 * rejects; checkDuplicate converts that rejection into "unsure" entries, so
 * callers stay permissive instead of blocking creation.
 */
export const withTimeout = (judge: DedupJudge, timeoutMs: number): DedupJudge => {
  return async (candidate, existing) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        judge(candidate, existing),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`dedup judge timed out after ${timeoutMs}ms`)),
            timeoutMs
          );
        })
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  };
};

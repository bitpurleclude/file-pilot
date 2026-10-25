/**
 * Registry container layout and slot capacity constants (Stage 1,
 * docs/product/governance-design.md §1.3/§1.2).
 * Container names are filesystem directory names owned by the path side;
 * capacities align semantically with the slot constants in
 * shared/types/registry.ts (AREA_NUMBER_MIN/MAX, PROJECT_NUMBER_MAX).
 */
export const REGISTRY_CONFIG = {
  containerInbox: "00-Inbox",
  containerArchive: "90-Archive",
  containerTemp: "99-Temp",
  maxSamplePaths: 50,
  maxAreas: 8,
  maxProjectsPerArea: 9,
  /**
   * Level-2 (similar) dedup threshold: normalized name similarity score in
   * [0,1] at or above this value yields a "similar" evidence entry. Kept just
   * below the containment/tail-difference shortcut scores in registry-dedup
   * (0.85/0.9) so those heuristics always fire.
   */
  similarNameThreshold: 0.82,
  /** Wall-clock budget for the level-3 (semantic) dedup judge call. */
  semanticJudgeTimeoutMs: 8000
} as const;

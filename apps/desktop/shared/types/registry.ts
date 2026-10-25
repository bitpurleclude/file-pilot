// Registry coordinate contract (Stage 1, docs/product/governance-design.md §1).
// Single source of truth for area/project shapes shared across data layer,
// pipeline, IPC, and UI. Do not duplicate these shapes elsewhere.

export type RegistryStatus = "active" | "archived";

export interface RegistryArea {
  id: string;
  /** Slot number 10..80 in steps of 10; 90+ is reserved for containers. */
  number: number;
  name: string;
  status: RegistryStatus;
  createdAt: string;
  retiredAt?: string;
}

export interface RegistryProject {
  id: string;
  areaId: string;
  /** Slot number 1..9 within its area; never reused after retirement. */
  number: number;
  name: string;
  aliases: string[];
  status: RegistryStatus;
  createdAt: string;
  retiredAt?: string;
  /** Sample file paths accumulated at creation/correction time, for dedup. */
  samplePaths?: string[];
}

/** Canonical coordinate: `<areaNumber>-<areaName>/<projectNumber>-<projectName>`. */
export interface RegistryCoordinate {
  areaNumber: number;
  areaName: string;
  projectNumber: number;
  projectName: string;
  areaId: string;
  projectId: string;
}

export const RESERVED_AREA_NUMBERS = { inbox: 0, archive: 90, temp: 99 } as const;
export const AREA_NUMBER_MIN = 10;
export const AREA_NUMBER_MAX = 80;
export const PROJECT_NUMBER_MAX = 9;

/** Lightweight coordinate option handed to classifiers and prompt templates. */
export interface CoordinateOption {
  areaNumber: number;
  areaName: string;
  projectNumber: number;
  projectName: string;
}

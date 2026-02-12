export type UpdateChannel = "beta" | "stable";

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  notes?: string;
}

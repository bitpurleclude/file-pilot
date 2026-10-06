import { resolve } from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import { isPathInsideRoot } from "./path-safety.js";

export const normalizeWhitelist = (directories: string[]): string[] => {
  const unique = new Set<string>();
  for (const directory of directories) {
    unique.add(resolve(directory));
  }
  return [...unique];
};

// The asserted path is a file path (including file name): the file must live
// inside one of the whitelisted directories. The comparison is segment-aware
// (no bare string prefix) and case-insensitive on Windows.
export const assertPathInWhitelist = (path: string, whitelist: string[]): void => {
  const allowed = whitelist.some((root) => isPathInsideRoot(path, root));
  if (!allowed) {
    throw new AppError("USER_PATH_NOT_ALLOWED", `路径不在白名单内: ${path}`, "USER");
  }
};

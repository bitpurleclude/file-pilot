import { resolve } from "node:path";

import { AppError } from "../../shared/errors/app-error.js";

export const normalizeWhitelist = (directories: string[]): string[] => {
  const unique = new Set<string>();
  for (const directory of directories) {
    unique.add(resolve(directory));
  }
  return [...unique];
};

export const assertPathInWhitelist = (path: string, whitelist: string[]): void => {
  const normalized = resolve(path);
  const allowed = whitelist.some((root) => normalized.startsWith(resolve(root)));
  if (!allowed) {
    throw new AppError("USER_PATH_NOT_ALLOWED", `路径不在白名单内: ${path}`, "USER");
  }
};

import { resolve, sep } from "node:path";

import { AppError } from "../../shared/errors/app-error.js";

export const normalizeWhitelist = (directories: string[]): string[] => {
  const unique = new Set<string>();
  for (const directory of directories) {
    unique.add(resolve(directory));
  }
  return [...unique];
};

const isCaseInsensitivePlatform = process.platform === "win32";

const toComparable = (path: string): string => {
  return isCaseInsensitivePlatform ? path.toLowerCase() : path;
};

const isPathWithinRoot = (path: string, root: string): boolean => {
  const comparablePath = toComparable(resolve(path));
  const resolvedRoot = resolve(root);
  const comparableRoot = toComparable(resolvedRoot);
  if (comparablePath === comparableRoot) {
    return true;
  }

  // Boundary must be a path separator so "D:\safe" does NOT admit "D:\safethings".
  const rootWithSep = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
  return comparablePath.startsWith(toComparable(rootWithSep));
};

export const assertPathInWhitelist = (path: string, whitelist: string[]): void => {
  const allowed = whitelist.some((root) => isPathWithinRoot(path, root));
  if (!allowed) {
    throw new AppError("USER_PATH_NOT_ALLOWED", `路径不在白名单内: ${path}`, "USER");
  }
};

import { resolve, sep } from "node:path";

import { EXECUTOR_CONFIG } from "../../shared/config/executor.config.js";
import { AppError } from "../../shared/errors/app-error.js";

const WINDOWS_RESERVED_NAMES = new Set<string>([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9"
]);

// Windows-forbidden characters plus control characters (DEL included).
const INVALID_SEGMENT_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const LEADING_DOTS_OR_SPACES = /^[\s.]+/;
const TRAILING_DOTS_OR_SPACES = /[\s.]+$/;

const isCaseInsensitivePlatform = process.platform === "win32";

const stripTrailingSeparators = (value: string): string => {
  let result = value;
  while (result.length > 1 && (result.endsWith("/") || result.endsWith("\\"))) {
    result = result.slice(0, -1);
  }
  return result;
};

const toComparablePath = (value: string): string => {
  return isCaseInsensitivePlatform ? value.toLowerCase() : value;
};

// Turns an untrusted string into a safe single-level path segment.
export const sanitizePathSegment = (raw: string, fallback: string): string => {
  const withoutInvalidChars = raw.replace(INVALID_SEGMENT_CHARS, "");
  const collapsed = withoutInvalidChars.replace(/\s+/g, " ").trim();
  const withoutEdgeDots = collapsed.replace(LEADING_DOTS_OR_SPACES, "").replace(TRAILING_DOTS_OR_SPACES, "");
  const truncated = Array.from(withoutEdgeDots)
    .slice(0, EXECUTOR_CONFIG.targetSegmentMaxLength)
    .join("");
  const candidate = truncated.replace(TRAILING_DOTS_OR_SPACES, "");

  if (candidate.length === 0 || candidate === "." || candidate === "..") {
    return fallback;
  }

  const baseName = candidate.split(".")[0] ?? "";
  if (WINDOWS_RESERVED_NAMES.has(baseName.toUpperCase())) {
    return fallback;
  }

  return candidate;
};

// Segment-aware containment check: resolve both sides, then require
// path === root or path under root + separator. Windows comparison is
// case-insensitive because NTFS paths are case-insensitive.
export const isPathInsideRoot = (path: string, root: string): boolean => {
  const normalizedPath = toComparablePath(resolve(path));
  const normalizedRoot = toComparablePath(stripTrailingSeparators(resolve(root)));
  if (normalizedPath === normalizedRoot) {
    return true;
  }

  const rootPrefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
  return normalizedPath.startsWith(rootPrefix);
};

// Second line of defense: generated target paths must stay inside the workspace root.
export const assertPathInsideRoot = (path: string, root: string): void => {
  if (!isPathInsideRoot(path, root)) {
    throw new AppError("USER_PATH_NOT_ALLOWED", `目标路径超出工作区根目录: ${path}`, "USER", { path, root });
  }
};

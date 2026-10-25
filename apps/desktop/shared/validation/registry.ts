import { AppError } from "../errors/app-error.js";

/**
 * Shared registry-name rules (governance stage 1).
 *
 * Registry names become filesystem directory names (`<number>-<name>`), so the
 * same characters that would be stripped by `sanitizePathSegment` must be
 * rejected at creation time. Otherwise the stored coordinate (and the prompt
 * option shown to the model) would differ from the actual directory name.
 */

export const REGISTRY_NAME_MAX_LENGTH = 64;

/** Windows-invalid path characters plus C0 controls and DEL. */
const INVALID_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/;
/** Reserved DOS device names; `CON.txt` is just as unusable as `CON`. */
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
/** Leading/trailing dots or spaces are stripped by the path sanitizer. */
const EDGE_DOT_OR_SPACE = /^[.\s]|[.\s]$/;

/** Trim and collapse internal whitespace so stored names match their path segments. */
export const normalizeRegistryName = (value: string): string => {
  return value.trim().replace(/\s+/g, " ");
};

export const isRegistryNameValid = (value: string): boolean => {
  const name = normalizeRegistryName(value);
  if (name.length === 0 || name.length > REGISTRY_NAME_MAX_LENGTH) {
    return false;
  }
  if (INVALID_NAME_CHARS.test(name) || EDGE_DOT_OR_SPACE.test(name)) {
    return false;
  }
  if (name === "." || name === "..") {
    return false;
  }
  return !WINDOWS_RESERVED_NAME.test(name);
};

/**
 * Throws REGISTRY_NAME_INVALID instead of silently letting the path sanitizer
 * change the name later. Returns the normalized name for persistence.
 */
export const assertRegistryNameValid = (value: string, field = "name"): string => {
  const name = normalizeRegistryName(value);
  if (!isRegistryNameValid(name)) {
    throw new AppError(
      "REGISTRY_NAME_INVALID",
      `名称包含非法字符或格式: ${value}`,
      "USER",
      { field, value }
    );
  }
  return name;
};

export interface CoordinateClaim {
  areaNumber: number;
  areaName: string;
  projectNumber: number;
  projectName: string;
}

const NUMBER_NAME_SEPARATOR = "-";
const COORDINATE_SEPARATOR = "/";

const parseNumberNameSegment = (segment: string): { number: number; name: string } | null => {
  const separatorIndex = segment.indexOf(NUMBER_NAME_SEPARATOR);
  if (separatorIndex <= 0) {
    return null;
  }

  const numberText = segment.slice(0, separatorIndex).trim();
  const name = segment.slice(separatorIndex + NUMBER_NAME_SEPARATOR.length).trim();
  if (!/^\d+$/.test(numberText) || name.length === 0) {
    return null;
  }

  return { number: Number.parseInt(numberText, 10), name };
};

/**
 * Canonical coordinate parser shared by the LLM output validator and the
 * placement resolver. Requires exactly `<areaNumber>-<areaName>/<projectNumber>-<projectName>`;
 * names containing `/` are rejected because creation now forbids them.
 */
export const parseCoordinateClaim = (value: string): CoordinateClaim | null => {
  const segments = value.trim().split(COORDINATE_SEPARATOR);
  if (segments.length !== 2) {
    return null;
  }

  const areaSegment = parseNumberNameSegment((segments[0] ?? "").trim());
  const projectSegment = parseNumberNameSegment((segments[1] ?? "").trim());
  if (areaSegment === null || projectSegment === null) {
    return null;
  }

  return {
    areaNumber: areaSegment.number,
    areaName: areaSegment.name,
    projectNumber: projectSegment.number,
    projectName: projectSegment.name
  };
};

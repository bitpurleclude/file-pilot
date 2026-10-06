import type { Purpose } from "../types/workflow.js";

/**
 * 扩展名 → 用途 的本地兜底规则表。
 * 从 core/usecases/classify-files.ts 的硬编码表迁入 shared/config，
 * 并按分类需求扩充了 Media/Archives/Installers/Work/Code 覆盖面。
 */
const EXTENSION_PURPOSES: Record<string, Purpose> = {
  // Media
  jpg: "Media",
  jpeg: "Media",
  png: "Media",
  gif: "Media",
  webp: "Media",
  svg: "Media",
  bmp: "Media",
  mp4: "Media",
  mov: "Media",
  avi: "Media",
  mkv: "Media",
  mp3: "Media",
  wav: "Media",
  flac: "Media",
  // Archives
  zip: "Archives",
  rar: "Archives",
  "7z": "Archives",
  tar: "Archives",
  gz: "Archives",
  // Installers
  exe: "Installers",
  msi: "Installers",
  // Documents
  pdf: "Documents",
  doc: "Documents",
  docx: "Documents",
  txt: "Documents",
  md: "Documents",
  rtf: "Documents",
  // Work
  xls: "Work",
  xlsx: "Work",
  csv: "Work",
  ppt: "Work",
  pptx: "Work",
  // Code
  ts: "Code",
  tsx: "Code",
  js: "Code",
  jsx: "Code",
  py: "Code",
  java: "Code",
  c: "Code",
  cpp: "Code",
  go: "Code",
  rs: "Code"
};

export const CLASSIFICATION_CONFIG = {
  highConfidenceMin: 0.85,
  mediumConfidenceMin: 0.6,
  askThreshold: 0.6,
  extensionPurposes: EXTENSION_PURPOSES,
  fallbackPurpose: "Others",
  fallbackProject: "默认项目",
  fallbackConfidence: 0.72,
  llmFallbackMediaConfidence: 0.88,
  llmFallbackDocumentsConfidence: 0.7
} as const;

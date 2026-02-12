import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { formatLogExportFileName } from "../../core/usecases/export-logs.js";
import type { LogExportPayload } from "../../shared/types/log-export.js";

export interface PersistLogExportParams {
  baseDirectory: string;
  now: Date;
  payload: LogExportPayload;
}

export const persistLogExportJson = async (params: PersistLogExportParams): Promise<string> => {
  await mkdir(params.baseDirectory, { recursive: true });

  const fileName = formatLogExportFileName(params.now);
  const targetPath = join(params.baseDirectory, fileName);
  const content = JSON.stringify(params.payload, null, 2);

  await writeFile(targetPath, content, { encoding: "utf-8" });
  return targetPath;
};

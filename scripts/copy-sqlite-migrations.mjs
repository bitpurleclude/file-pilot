import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const sourceDir = join(repoRoot, "apps", "desktop", "infra", "storage", "sqlite", "migrations");
const outputDir = join(repoRoot, "dist", "electron", "migrations");

mkdirSync(outputDir, { recursive: true });

for (const file of readdirSync(sourceDir)) {
  if (extname(file) !== ".sql") {
    continue;
  }

  copyFileSync(join(sourceDir, file), join(outputDir, file));
}


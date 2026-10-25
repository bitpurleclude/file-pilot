import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const sqliteMigrationsSourceDir = join(repoRoot, "apps", "desktop", "infra", "storage", "sqlite", "migrations");
const sqliteMigrationsOutputDir = join(repoRoot, "dist", "electron", "migrations");
const llmTemplateSourceDir = join(repoRoot, "apps", "desktop", "infra", "llm", "templates");
const llmTemplateOutputDir = join(repoRoot, "dist", "electron", "templates");
const electronAssetsSourceDir = join(repoRoot, "apps", "desktop", "electron", "assets");
const electronAssetsOutputDir = join(repoRoot, "dist", "electron", "assets");

const copyFilesByExtension = (inputDir, outputDir, extension) => {
  mkdirSync(outputDir, { recursive: true });

  for (const file of readdirSync(inputDir)) {
    if (extname(file) !== extension) {
      continue;
    }

    copyFileSync(join(inputDir, file), join(outputDir, file));
  }
};

copyFilesByExtension(sqliteMigrationsSourceDir, sqliteMigrationsOutputDir, ".sql");
copyFilesByExtension(llmTemplateSourceDir, llmTemplateOutputDir, ".njk");
copyFilesByExtension(electronAssetsSourceDir, electronAssetsOutputDir, ".png");

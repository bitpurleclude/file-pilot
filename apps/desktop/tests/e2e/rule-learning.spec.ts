import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { launchElectronApp } from "./helpers/electron-launch.js";

test("manual correction can be saved as rule and reused in next analyze", async () => {
  const sandbox = await mkdtemp(join(process.cwd(), "tmp-file-pilot-rule-learning-"));
  const fileA = join(sandbox, "session-a.txt");
  const fileB = join(sandbox, "session-b.txt");
  await writeFile(fileA, "chemistry notes A", "utf-8");
  await writeFile(fileB, "chemistry notes B", "utf-8");

  const electronApp = await launchElectronApp();

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    const result = await page.evaluate(async ({ sandboxDir, firstFile, secondFile }) => {
      if (window.filePilotApi === undefined) {
        return { ok: false, reason: "missing-api" };
      }

      await window.filePilotApi.saveWhitelist({ directories: [sandboxDir] });

      const firstSessionId = crypto.randomUUID();
      const analyze1 = await window.filePilotApi.analyze({ sessionId: firstSessionId, filePaths: [firstFile] });
      if (!analyze1.ok) {
        return { analyze1 };
      }

      const firstItemId = (analyze1.data as { items?: Array<{ item: { id: string } }> }).items?.[0]?.item.id ?? "";
      const correction = await window.filePilotApi.saveCorrections({
        sessionId: firstSessionId,
        fileId: firstItemId,
        purpose: "Study",
        project: "RuleLearnProject",
        saveAsRule: true
      });

      const analyze2 = await window.filePilotApi.analyze({
        sessionId: crypto.randomUUID(),
        filePaths: [secondFile]
      });

      return { analyze1, correction, analyze2 };
    }, { sandboxDir: sandbox, firstFile: fileA, secondFile: fileB });

    expect(result).toHaveProperty("analyze1.ok", true);
    expect(result).toHaveProperty("correction.ok", true);
    expect(result).toHaveProperty("analyze2.ok", true);
    expect(result).toHaveProperty("analyze2.data.items.0.classification.project", "RuleLearnProject");
    expect(result).toHaveProperty("analyze2.data.items.0.classification.decisionSource", "rule");
  } finally {
    await electronApp.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});


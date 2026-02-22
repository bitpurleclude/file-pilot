import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { executePlans, rollbackExecutions } from "../../core/usecases/execute-and-rollback.js";
import type { PlacementPlan } from "../../shared/types/workflow.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("qa-rollback-reliability", () => {
  it("keeps rollback success rate above 99%", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-qa-rollback-"));
    tempDirs.push(root);

    const sourceRoot = join(root, "source");
    const targetRoot = join(root, "target");
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(targetRoot, { recursive: true });

    const plans: PlacementPlan[] = [];
    for (let i = 0; i < 150; i += 1) {
      const source = join(sourceRoot, `f-${i}.txt`);
      const target = join(targetRoot, `f-${i}.txt`);
      await writeFile(source, `rollback-${i}`, "utf-8");
      plans.push({
        fileId: `f-${i}`,
        sourcePath: source,
        targetPath: target,
        action: "move",
        conflictPolicy: "rename"
      });
    }

    const executed = await executePlans(plans, { dryRun: false });
    const rolledBack = await rollbackExecutions(executed);

    const rollbackable = rolledBack.filter((item) => item.rollbackable).length;
    const rollbackSuccess = rolledBack.filter((item) => item.reason === "rolled-back").length;
    const successRate = rollbackable === 0 ? 1 : rollbackSuccess / rollbackable;

    await mkdir(join(process.cwd(), "test-results", "qa"), { recursive: true });
    await writeFile(
      join(process.cwd(), "test-results", "qa", `rollback-${Date.now()}.json`),
      JSON.stringify({
        rollbackable,
        rollbackSuccess,
        successRate
      }, null, 2),
      "utf-8"
    );

    expect(successRate).toBeGreaterThan(0.99);
  });
});


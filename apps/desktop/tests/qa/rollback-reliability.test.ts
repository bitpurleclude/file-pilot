import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { executePlans, rollbackExecutions } from "../../core/usecases/execute-and-rollback.js";
import type { PlacementPlan } from "../../shared/types/workflow.js";

const tempDirs: string[] = [];
const MISSING_FILE_INDEX = 7;

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("qa-rollback-reliability", () => {
  it("keeps rollback success rate above 99% even with partial execution failures", async () => {
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
      // One plan is left without a source file so a single execution failure
      // happens mid-batch; the rest must still execute and roll back cleanly.
      if (i !== MISSING_FILE_INDEX) {
        await writeFile(source, `rollback-${i}`, "utf-8");
      }
      plans.push({
        fileId: `f-${i}`,
        sourcePath: source,
        targetPath: target,
        action: "move",
        conflictPolicy: "rename"
      });
    }

    const executed = await executePlans(plans, { dryRun: false });

    const executedCount = executed.filter((item) => item.executed).length;
    const failed = executed.filter((item) => !item.executed);
    expect(executedCount).toBe(149);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.plan.fileId).toBe(`f-${MISSING_FILE_INDEX}`);
    expect(failed[0]?.reason?.startsWith("error:")).toBe(true);

    const rolledBack = await rollbackExecutions(executed);

    const rollbackable = rolledBack.filter((item) => item.rollbackable).length;
    const rollbackSuccess = rolledBack.filter((item) => item.reason === "rolled-back").length;
    const rollbackFailed = rolledBack.filter((item) => item.reason?.startsWith("rollback-failed:")).length;
    const successRate = rollbackable === 0 ? 1 : rollbackSuccess / rollbackable;

    await mkdir(join(process.cwd(), "test-results", "qa"), { recursive: true });
    await writeFile(
      join(process.cwd(), "test-results", "qa", `rollback-${Date.now()}.json`),
      JSON.stringify({
        executedCount,
        failedCount: failed.length,
        rollbackable,
        rollbackSuccess,
        rollbackFailed,
        successRate
      }, null, 2),
      "utf-8"
    );

    expect(rollbackFailed).toBe(0);
    expect(successRate).toBeGreaterThan(0.99);
    expect(await readFile(join(sourceRoot, "f-0.txt"), "utf-8")).toBe("rollback-0");
    // The failed plan left the source missing and must not have created a target.
    await expect(access(join(sourceRoot, `f-${MISSING_FILE_INDEX}.txt`), constants.F_OK)).rejects.toThrow();
    await expect(access(join(targetRoot, `f-${MISSING_FILE_INDEX}.txt`), constants.F_OK)).rejects.toThrow();
  });
});

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { executePlans, rollbackExecutions } from "../../core/usecases/execute-and-rollback.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("execute-and-rollback", () => {
  it("respects move/copy action and marks non-rollbackable items", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-execute-"));
    tempDirs.push(root);
    const sourceMove = join(root, "move.txt");
    const sourceCopy = join(root, "copy.txt");
    const targetMove = join(root, "out", "move.txt");
    const targetCopy = join(root, "out", "copy.txt");
    await writeFile(sourceMove, "move", "utf-8");
    await writeFile(sourceCopy, "copy", "utf-8");

    const executed = await executePlans([
      {
        fileId: "1",
        sourcePath: sourceMove,
        targetPath: targetMove,
        action: "move",
        conflictPolicy: "rename"
      },
      {
        fileId: "2",
        sourcePath: sourceCopy,
        targetPath: targetCopy,
        action: "copy",
        conflictPolicy: "rename"
      }
    ], { dryRun: false });

    const rolled = await rollbackExecutions(executed);
    const moveItem = rolled.find((item) => item.plan.fileId === "1");
    const copyItem = rolled.find((item) => item.plan.fileId === "2");

    expect(moveItem?.reason).toBe("rolled-back");
    expect(copyItem?.reason).toBe("copy-action rollback skipped");
    expect(await readFile(sourceMove, "utf-8")).toBe("move");
    expect(await readFile(targetCopy, "utf-8")).toBe("copy");
  });
});


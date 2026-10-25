import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

  it("renames on target conflict and rolls back to the original source", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-execute-"));
    tempDirs.push(root);
    const source = join(root, "a.txt");
    const target = join(root, "out", "a.txt");
    await writeFile(source, "new", "utf-8");
    await mkdir(join(root, "out"), { recursive: true });
    await writeFile(target, "existing", "utf-8");

    const executed = await executePlans([
      {
        fileId: "1",
        sourcePath: source,
        targetPath: target,
        action: "move",
        conflictPolicy: "rename"
      }
    ], { dryRun: false });

    const item = executed[0];
    expect(item?.executed).toBe(true);
    expect(item?.resolvedTargetPath).toBeDefined();
    expect(item?.resolvedTargetPath).not.toBe(target);
    if (item?.resolvedTargetPath === undefined) {
      return;
    }
    expect(await readFile(item.resolvedTargetPath, "utf-8")).toBe("new");
    expect(await readFile(target, "utf-8")).toBe("existing");

    const rolled = await rollbackExecutions(executed);
    expect(rolled[0]?.reason).toBe("rolled-back");
    expect(await readFile(source, "utf-8")).toBe("new");
    expect(await readFile(target, "utf-8")).toBe("existing");
  });

  it("skips execution for existing targets under the skip policy", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-execute-"));
    tempDirs.push(root);
    const source = join(root, "b.txt");
    const target = join(root, "out", "b.txt");
    await writeFile(source, "source", "utf-8");
    await mkdir(join(root, "out"), { recursive: true });
    await writeFile(target, "taken", "utf-8");

    const executed = await executePlans([
      { fileId: "1", sourcePath: source, targetPath: target, action: "move", conflictPolicy: "skip" }
    ], { dryRun: false });

    expect(executed[0]?.executed).toBe(false);
    expect(executed[0]?.reason).toBe("conflict-skip");
    expect(await readFile(source, "utf-8")).toBe("source");
    expect(await readFile(target, "utf-8")).toBe("taken");
  });

  it("isolates per-item failures so successful moves stay rollbackable", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-execute-"));
    tempDirs.push(root);
    const goodSource = join(root, "good.txt");
    const missingSource = join(root, "missing.txt");
    await writeFile(goodSource, "good", "utf-8");

    const executed = await executePlans([
      {
        fileId: "1",
        sourcePath: goodSource,
        targetPath: join(root, "out", "good.txt"),
        action: "move",
        conflictPolicy: "rename"
      },
      {
        fileId: "2",
        sourcePath: missingSource,
        targetPath: join(root, "out", "missing.txt"),
        action: "move",
        conflictPolicy: "rename"
      }
    ], { dryRun: false });

    const good = executed.find((item) => item.plan.fileId === "1");
    const missing = executed.find((item) => item.plan.fileId === "2");
    expect(good?.executed).toBe(true);
    expect(good?.rollbackable).toBe(true);
    expect(missing?.executed).toBe(false);
    expect(missing?.reason).toMatch(/^execute-failed:/);

    // The moved file must still be recoverable after the batch reported failure.
    const rolled = await rollbackExecutions(executed);
    const rolledGood = rolled.find((item) => item.plan.fileId === "1");
    expect(rolledGood?.reason).toBe("rolled-back");
    expect(await readFile(goodSource, "utf-8")).toBe("good");
  });
});


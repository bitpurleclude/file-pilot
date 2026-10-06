import { constants } from "node:fs";
import type { PathLike } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { executePlans, rollbackExecutions } from "../../core/usecases/execute-and-rollback.js";
import type { ConflictPolicy } from "../../shared/types/workflow.js";

const exdevOverride = vi.hoisted(() => ({
  enabled: false,
  targetPath: null as string | null
}));

// Intercepts rename() so cross-device (EXDEV) moves can be simulated without
// a second physical drive. All other fs/promises calls pass through.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const renameMock = async (sourcePath: PathLike, targetPath: PathLike): Promise<void> => {
    if (
      exdevOverride.enabled
      && (exdevOverride.targetPath === null || exdevOverride.targetPath === String(targetPath))
    ) {
      const error: NodeJS.ErrnoException = new Error(
        `rename ${String(sourcePath)} -> ${String(targetPath)}: cross-device link not permitted`
      );
      error.code = "EXDEV";
      throw error;
    }
    return actual.rename(sourcePath, targetPath);
  };

  return {
    ...actual,
    rename: renameMock as unknown as typeof actual.rename
  };
});

const tempDirs: string[] = [];

afterEach(async () => {
  exdevOverride.enabled = false;
  exdevOverride.targetPath = null;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const createTempDir = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

describe("execute-and-rollback", () => {
  it("respects move/copy action and marks non-rollbackable items", async () => {
    const root = await createTempDir("file-pilot-execute-");
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

  it("returns dry-run results without touching the file system", async () => {
    const root = await createTempDir("file-pilot-dryrun-");
    const source = join(root, "source.txt");
    await writeFile(source, "content", "utf-8");

    const results = await executePlans([
      {
        fileId: "1",
        sourcePath: source,
        targetPath: join(root, "out", "source.txt"),
        action: "move",
        conflictPolicy: "rename"
      }
    ], { dryRun: true });

    expect(results).toHaveLength(1);
    expect(results[0]?.executed).toBe(false);
    expect(results[0]?.rollbackable).toBe(false);
    expect(results[0]?.reason).toBe("dry-run");
    expect(await readFile(source, "utf-8")).toBe("content");
  });

  it("keeps executed results when a single plan fails instead of throwing", async () => {
    const root = await createTempDir("file-pilot-partial-");
    const okSource = join(root, "ok.txt");
    await writeFile(okSource, "ok", "utf-8");

    const results = await executePlans([
      {
        fileId: "bad",
        sourcePath: join(root, "missing.txt"),
        targetPath: join(root, "out", "missing.txt"),
        action: "move",
        conflictPolicy: "rename"
      },
      {
        fileId: "good",
        sourcePath: okSource,
        targetPath: join(root, "out", "ok.txt"),
        action: "move",
        conflictPolicy: "rename"
      }
    ], { dryRun: false });

    expect(results).toHaveLength(2);
    const bad = results.find((item) => item.plan.fileId === "bad");
    const good = results.find((item) => item.plan.fileId === "good");

    expect(bad?.executed).toBe(false);
    expect(bad?.rollbackable).toBe(false);
    expect(bad?.reason?.startsWith("error:")).toBe(true);
    expect(good?.executed).toBe(true);
    expect(good?.rollbackable).toBe(true);
    expect(await readFile(join(root, "out", "ok.txt"), "utf-8")).toBe("ok");

    const rolled = await rollbackExecutions(results);
    const rolledGood = rolled.find((item) => item.plan.fileId === "good");
    const rolledBad = rolled.find((item) => item.plan.fileId === "bad");
    expect(rolledGood?.reason).toBe("rolled-back");
    expect(await readFile(okSource, "utf-8")).toBe("ok");
    expect(rolledBad?.executed).toBe(false);
    expect(rolledBad?.reason?.startsWith("error:")).toBe(true);
  });

  it("applies the rename conflict policy with a timestamp suffix", async () => {
    const root = await createTempDir("file-pilot-conflict-rename-");
    const source = join(root, "src.txt");
    const target = join(root, "out", "name.txt");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(source, "new-content", "utf-8");
    await writeFile(target, "old-content", "utf-8");

    const results = await executePlans([
      {
        fileId: "1",
        sourcePath: source,
        targetPath: target,
        action: "move",
        conflictPolicy: "rename"
      }
    ], { dryRun: false });

    const result = results[0];
    expect(result?.executed).toBe(true);
    expect(result?.plan.targetPath).not.toBe(target);
    expect(result?.plan.targetPath.replaceAll("\\", "/")).toMatch(/name-\d{14}\.txt$/);

    const movedPath = result?.plan.targetPath ?? "";
    expect(await readFile(movedPath, "utf-8")).toBe("new-content");
    expect(await readFile(target, "utf-8")).toBe("old-content");
    await expect(access(source, constants.F_OK)).rejects.toThrow();

    const rolled = await rollbackExecutions(results);
    expect(rolled[0]?.reason).toBe("rolled-back");
    expect(await readFile(source, "utf-8")).toBe("new-content");
    expect(await readFile(target, "utf-8")).toBe("old-content");
  });

  it("applies the overwrite and skip conflict policies", async () => {
    const root = await createTempDir("file-pilot-conflict-policies-");
    const overwriteSource = join(root, "overwrite-src.txt");
    const overwriteTarget = join(root, "out", "overwrite.txt");
    await mkdir(dirname(overwriteTarget), { recursive: true });
    await writeFile(overwriteSource, "overwrite-new", "utf-8");
    await writeFile(overwriteTarget, "overwrite-old", "utf-8");

    const skipSource = join(root, "skip-src.txt");
    const skipTarget = join(root, "out", "skip.txt");
    await writeFile(skipSource, "skip-new", "utf-8");
    await writeFile(skipTarget, "skip-old", "utf-8");

    const results = await executePlans([
      {
        fileId: "overwrite",
        sourcePath: overwriteSource,
        targetPath: overwriteTarget,
        action: "move",
        conflictPolicy: "overwrite"
      },
      {
        fileId: "skip",
        sourcePath: skipSource,
        targetPath: skipTarget,
        action: "move",
        conflictPolicy: "skip"
      }
    ], { dryRun: false });

    const overwriteResult = results.find((item) => item.plan.fileId === "overwrite");
    const skipResult = results.find((item) => item.plan.fileId === "skip");

    expect(overwriteResult?.executed).toBe(true);
    expect(await readFile(overwriteTarget, "utf-8")).toBe("overwrite-new");
    await expect(access(overwriteSource, constants.F_OK)).rejects.toThrow();

    expect(skipResult?.executed).toBe(false);
    expect(skipResult?.rollbackable).toBe(false);
    expect(skipResult?.reason).toBe("skipped:target-exists");
    expect(await readFile(skipTarget, "utf-8")).toBe("skip-old");
    expect(await readFile(skipSource, "utf-8")).toBe("skip-new");
  });

  it("records a failure for unsupported conflict policies", async () => {
    const root = await createTempDir("file-pilot-conflict-unsupported-");
    const source = join(root, "src.txt");
    const target = join(root, "out", "name.txt");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(source, "content", "utf-8");
    // The unsupported policy is only consulted on conflict, so the target exists.
    await writeFile(target, "existing", "utf-8");

    const results = await executePlans([
      {
        fileId: "1",
        sourcePath: source,
        targetPath: target,
        action: "move",
        conflictPolicy: "error" as unknown as ConflictPolicy
      }
    ], { dryRun: false });

    const result = results[0];
    expect(result?.executed).toBe(false);
    expect(result?.reason?.startsWith("error:unsupported-conflict-policy")).toBe(true);
    expect(await readFile(source, "utf-8")).toBe("content");
    expect(await readFile(target, "utf-8")).toBe("existing");
  });

  it("falls back to copy and delete on EXDEV and rolls that back", async () => {
    const root = await createTempDir("file-pilot-exdev-");
    const source = join(root, "cross.txt");
    const target = join(root, "out", "cross.txt");
    await writeFile(source, "cross-device", "utf-8");

    exdevOverride.enabled = true;
    exdevOverride.targetPath = target;

    const results = await executePlans([
      {
        fileId: "1",
        sourcePath: source,
        targetPath: target,
        action: "move",
        conflictPolicy: "rename"
      }
    ], { dryRun: false });

    const result = results[0];
    expect(result?.executed).toBe(true);
    expect(result?.rollbackable).toBe(true);
    expect(result?.reason).toBe("moved-via-copy");
    expect(await readFile(target, "utf-8")).toBe("cross-device");
    await expect(access(source, constants.F_OK)).rejects.toThrow();

    const rolled = await rollbackExecutions(results);
    expect(rolled[0]?.reason).toBe("rolled-back");
    expect(await readFile(source, "utf-8")).toBe("cross-device");
    await expect(access(target, constants.F_OK)).rejects.toThrow();
  });
});

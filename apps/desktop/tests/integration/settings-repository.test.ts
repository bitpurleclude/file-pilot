import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadSettings, saveSettings } from "../../infra/storage/settings-repository.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("settings-repository", () => {
  it("loads defaults and persists readOnlyMode", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-settings-"));
    tempRoots.push(root);

    const defaults = await loadSettings(root);
    expect(defaults.readOnlyMode).toBe(false);

    await saveSettings(root, {
      ...defaults,
      readOnlyMode: true
    });

    const updated = await loadSettings(root);
    expect(updated.readOnlyMode).toBe(true);
  });

  it("backfills readOnlyMode for legacy settings file", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-settings-legacy-"));
    tempRoots.push(root);

    const filePath = join(root, "settings.json");
    await writeFile(
      filePath,
      JSON.stringify({
        whitelistDirectories: ["D:/Workspace"],
        llm: {
          baseUrl: "https://api.openai.com/v1",
          primaryModel: "gpt-4.1",
          secondaryModel: "gpt-4.1-mini"
        }
      }),
      "utf-8"
    );

    const loaded = await loadSettings(root);
    expect(loaded.readOnlyMode).toBe(false);
    expect(loaded.whitelistDirectories).toEqual(["D:/Workspace"]);
  });
});

import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, type ElectronApplication } from "@playwright/test";

interface LaunchElectronAppOptions {
  executablePath?: string;
  args?: string[];
  cwd?: string;
  /**
   * Master switch for per-launch isolation. Defaults to true: two fresh temp
   * directories (userData + workspace) are created and injected into the app
   * via FILE_PILOT_USER_DATA_DIR / FILE_PILOT_WORKSPACE_ROOT. Set to false to
   * launch without redirection.
   */
  isolate?: boolean;
  /** Explicit userData dir; used instead of a fresh temp dir when provided. */
  userDataDir?: string;
  /** Explicit workspace root; used instead of a fresh temp dir when provided. */
  workspaceRoot?: string;
}

export interface LaunchDirs {
  userDataDir: string;
  workspaceRoot: string;
}

export type IsolatedElectronApplication = ElectronApplication & {
  /** The userData/workspace paths the launched app actually used. */
  launchDirs: LaunchDirs;
};

const USER_DATA_TMP_PREFIX = "file-pilot-e2e-userdata-";
const WORKSPACE_TMP_PREFIX = "file-pilot-e2e-workspace-";
const DEFAULT_WORKSPACE_DIR_NAME = "File-Pilot-Workspace";

const removeDirQuietly = (dir: string): void => {
  // Synchronous with retries so cleanup cannot race the test worker teardown
  // (the "close" event may be the last code the worker runs); retry absorbs
  // transient Windows EBUSY/EPERM while the app process releases file locks.
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    console.warn(`[e2e] failed to remove temp dir ${dir}:`, error);
  }
};

const resolveAppDefaults = async (app: ElectronApplication): Promise<LaunchDirs> => {
  const paths = await app.evaluate(({ app: electronApp }) => ({
    userData: electronApp.getPath("userData"),
    documents: electronApp.getPath("documents")
  }));
  return {
    userDataDir: paths.userData,
    workspaceRoot: join(paths.documents, DEFAULT_WORKSPACE_DIR_NAME)
  };
};

export const launchElectronApp = async (
  options: LaunchElectronAppOptions = {}
): Promise<IsolatedElectronApplication> => {
  const isolate = options.isolate ?? true;

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  delete env.ELECTRON_RUN_AS_NODE;

  const createdDirs: string[] = [];

  // Create both temp dirs under one failure-cleanup path (same createdDirs sweep
  // as electron.launch below): if the workspace mkdtemp throws after the userData
  // mkdtemp already succeeded, the first dir would otherwise leak.
  let userDataDir: string | undefined = options.userDataDir;
  let workspaceRoot: string | undefined = options.workspaceRoot;
  if (isolate) {
    try {
      if (userDataDir === undefined) {
        userDataDir = await mkdtemp(join(tmpdir(), USER_DATA_TMP_PREFIX));
        createdDirs.push(userDataDir);
      }
      if (workspaceRoot === undefined) {
        workspaceRoot = await mkdtemp(join(tmpdir(), WORKSPACE_TMP_PREFIX));
        createdDirs.push(workspaceRoot);
      }
    } catch (error) {
      for (const dir of createdDirs) {
        removeDirQuietly(dir);
      }
      throw error;
    }
  }
  if (userDataDir !== undefined) {
    env.FILE_PILOT_USER_DATA_DIR = userDataDir;
  }
  if (workspaceRoot !== undefined) {
    env.FILE_PILOT_WORKSPACE_ROOT = workspaceRoot;
  }

  const launchArgs = options.executablePath === undefined
    ? {
        args: options.args ?? ["dist/electron/main.cjs"],
        env,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd })
      }
    : {
        executablePath: options.executablePath,
        args: options.args ?? [],
        env,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd })
      };

  let electronApp: ElectronApplication;
  try {
    electronApp = await electron.launch(launchArgs);
  } catch (error) {
    for (const dir of createdDirs) {
      removeDirQuietly(dir);
    }
    throw error;
  }

  // electronApp.close() terminates the process, which fires "close", so the
  // temp dirs are removed on every termination path of the launched app.
  electronApp.on("close", () => {
    for (const dir of createdDirs) {
      removeDirQuietly(dir);
    }
  });

  let launchDirs: LaunchDirs;
  if (userDataDir !== undefined && workspaceRoot !== undefined) {
    launchDirs = { userDataDir, workspaceRoot };
  } else {
    const defaults = await resolveAppDefaults(electronApp);
    launchDirs = {
      userDataDir: userDataDir ?? defaults.userDataDir,
      workspaceRoot: workspaceRoot ?? defaults.workspaceRoot
    };
  }

  const isolatedApp = electronApp as IsolatedElectronApplication;
  isolatedApp.launchDirs = launchDirs;
  return isolatedApp;
};

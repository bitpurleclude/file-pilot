import { _electron as electron } from "@playwright/test";

interface LaunchElectronAppOptions {
  executablePath?: string;
  args?: string[];
  cwd?: string;
}

export const launchElectronApp = async (options: LaunchElectronAppOptions = {}) => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  delete env.ELECTRON_RUN_AS_NODE;

  return electron.launch(
    options.executablePath === undefined
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
        }
  );
};

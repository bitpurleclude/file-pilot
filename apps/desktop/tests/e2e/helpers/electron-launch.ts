import { _electron as electron } from "@playwright/test";

export const launchElectronApp = async () => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  delete env.ELECTRON_RUN_AS_NODE;

  return electron.launch({
    args: ["dist/electron/main.cjs"],
    env
  });
};

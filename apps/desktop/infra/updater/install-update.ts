import { spawn } from "node:child_process";

export const launchInstaller = async (installerPath: string): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(installerPath, [], {
      detached: true,
      stdio: "ignore"
    });

    child.once("error", (error) => reject(error));
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
};

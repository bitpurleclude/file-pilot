import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

import { test, expect } from "@playwright/test";

test("packaged installer artifact exists after dist build", async () => {
  const installer = join(process.cwd(), "release", "File Pilot Setup 0.1.0.exe");
  await expect(access(installer, constants.R_OK)).resolves.toBeUndefined();
});

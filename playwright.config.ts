import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "apps/desktop/tests/e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list"
});

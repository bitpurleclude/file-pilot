import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "apps/desktop/tests/e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: process.env.CI ? 1 : 0,
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "test-results/e2e-html" }]
  ]
});

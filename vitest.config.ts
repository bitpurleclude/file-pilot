import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/desktop/tests/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      ".worktrees/**",
      "dist/**",
      "release/**",
      "apps/desktop/tests/e2e/**"
    ],
    setupFiles: ["./apps/desktop/tests/setup/sqlite-close.ts"]
  }
});

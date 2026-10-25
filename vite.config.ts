import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  root: "apps/desktop/src",
  build: {
    outDir: "../../../dist/renderer",
    emptyOutDir: false
  },
  test: {
    // Local git worktrees contain full working copies of other branches;
    // without this exclusion their tests pollute every run from the main tree.
    exclude: [...configDefaults.exclude, "**/.worktrees/**"]
  }
});

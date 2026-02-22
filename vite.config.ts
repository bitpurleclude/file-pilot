import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  root: "apps/desktop/src",
  build: {
    outDir: "../../../dist/renderer",
    emptyOutDir: false
  }
});

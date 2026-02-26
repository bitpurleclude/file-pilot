import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  root: "apps/desktop/src",
  build: {
    outDir: "../../../dist/renderer",
    emptyOutDir: false
  }
});

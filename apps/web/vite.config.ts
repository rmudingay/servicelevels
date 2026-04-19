import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@service-levels/shared": resolve(__dirname, "../../packages/shared/src/index.ts")
    }
  },
  server: {
    fs: {
      allow: [resolve(__dirname, "../..")]
    }
  }
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.GITHUB_REPOSITORY ? "/JaxMABLStatsArchive/" : "/",
  plugins: [react()],
  build: {
    sourcemap: true,
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const gladePort = process.env.GLADE_PORT ?? "8787";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${gladePort}`,
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});

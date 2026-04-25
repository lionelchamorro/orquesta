import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./src/ui", import.meta.url)),
  plugins: [react()],
  server: {
    port: 4173,
    proxy: {
      "/api": "http://localhost:8000",
      "/events": {
        target: "ws://localhost:8000",
        ws: true,
      },
      "/tty": {
        target: "ws://localhost:8000",
        ws: true,
      },
      "/mcp": "http://localhost:8000",
      "/theme.css": "http://localhost:8000",
    },
  },
});

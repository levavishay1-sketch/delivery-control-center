import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Bind on all network interfaces (not just localhost) so the same
    // dev server is reachable from other devices on the local Wi-Fi
    // (e.g. a phone) at http://<this PC's LAN IP>:5173 — localhost still
    // works exactly as before. The API server and its "/api" proxy below
    // are unaffected: the proxy runs server-side on this PC and always
    // talks to localhost:3001, regardless of which host the browser used.
    host: true,
    proxy: {
      "/api": {
        target: process.env.DCC_API_URL ?? "http://localhost:3001",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});

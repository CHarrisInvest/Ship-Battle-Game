import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { engineHash } from "./server/enginehash.js";

// Served from the domain root on Vercel. Set BASE_PATH to build for a host that
// serves it from a subpath, such as /Ship-Battle-Game/.
//
// Two pages: the game, and the privacy policy at /privacy/, which has to be an address of its own
// because AdSense and Google's consent message are given it as a link.
//
// The engine's fingerprint is built in as `__ENGINE__`, from the same files the server hashes, so a
// page left open across a deploy is told to reload rather than sail a round the server would replay
// under other rules. Locally, `/api` is forwarded to a game server on API_TARGET (port 8787 unless
// said otherwise), the way Vercel's edge function forwards it in production.
const api = { "/api": { target: process.env.API_TARGET || "http://localhost:8787" } };

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  define: { __ENGINE__: JSON.stringify(engineHash()) },
  server: { proxy: api },
  preview: { proxy: api },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        privacy: fileURLToPath(new URL("privacy/index.html", import.meta.url)),
      },
    },
  },
});

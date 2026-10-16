import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { engineHash } from "./server/enginehash.js";

// Served from the root of its address on Vercel (`vercel.json`). Set BASE_PATH to build for a host
// that serves it from a subpath, such as /Ship-Battle-Game/.
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
  define: {
    __ENGINE__: JSON.stringify(engineHash()),
    // Which host the build is for, so the privacy policy names the one that actually receives a
    // visitor's IP address. Vercel sets VERCEL=1 in its build environment; anything else is Pages.
    __HOST__: JSON.stringify(process.env.VERCEL ? "vercel" : "pages"),
    // Whether this build is a preview deployment on Vercel: staging.sternchase.org and every feature
    // branch's preview. Vercel sets VERCEL_ENV to "preview" for those and "production" for the real
    // site. A preview build loads no ads and no analytics (`ads.js`, `analytics.js`), so staging play
    // never lands in the real site's figures. It is decided per build, never per visitor.
    __PREVIEW__: JSON.stringify(process.env.VERCEL_ENV === "preview"),
  },
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

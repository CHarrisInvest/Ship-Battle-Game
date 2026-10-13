import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Served from the root of https://sternchase.org/, on Vercel (`vercel.json`) or GitHub Pages
// (`.github/workflows/deploy.yml`). Set BASE_PATH to build for a host that serves it from a subpath, such
// as /Ship-Battle-Game/ for the project URL the domain replaced.
//
// Two pages: the game, and the privacy policy at /privacy/, which has to be an address of its own
// because AdSense and Google's consent message are given it as a link.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  // Which host the build is for, so the privacy policy names the one that actually receives a
  // visitor's IP address. Vercel sets VERCEL=1 in its build environment; anything else is Pages.
  define: {
    __HOST__: JSON.stringify(process.env.VERCEL ? "vercel" : "pages"),
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        privacy: fileURLToPath(new URL("privacy/index.html", import.meta.url)),
      },
    },
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Served from the root of https://sternchase.org/, GitHub Pages with a custom
// domain. Set BASE_PATH to build for a host that serves it from a subpath, such
// as /Ship-Battle-Game/ for the project URL the domain replaced.
//
// Two pages: the game, and the privacy policy at /privacy/, which has to be an address of its own
// because AdSense and Google's consent message are given it as a link.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        privacy: fileURLToPath(new URL("privacy/index.html", import.meta.url)),
      },
    },
  },
});

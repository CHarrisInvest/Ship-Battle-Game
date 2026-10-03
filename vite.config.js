import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from the root of https://sternchase.org/, GitHub Pages with a custom
// domain. Set BASE_PATH to build for a host that serves it from a subpath, such
// as /Ship-Battle-Game/ for the project URL the domain replaced.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from https://charrisinvest.github.io/Ship-Battle-Game/, so assets need
// the repo name as their base. Override with BASE_PATH=/ for other hosts.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/Ship-Battle-Game/",
  plugins: [react()],
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from https://charrisinvest.github.io/Ship-Battle-Game/, so assets need
// the repo name as their base. Override with BASE_PATH=/ for other hosts.
// The base is the repository's name, not the game's: the repo is still
// Ship-Battle-Game while the game is Sternchase, and this has to match the repo.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/Ship-Battle-Game/",
  plugins: [react()],
});

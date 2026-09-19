/**
 * THE HOME-SCREEN ICON — `npm run icon`
 *
 * Draws the menu's galleon into the icons a phone shows when the game is saved to the home screen,
 * and writes them into `public/`: the touch icon iOS reads, the two sizes the web manifest lists for
 * Android and desktop Chrome, and a maskable one with the ship held inside the circle Android may
 * cut the icon to. It is the real `drawGalleon`, run in a headless Chromium against the dev server,
 * so the icon is the ship on the menu at her three-quarter view and follows her art when it changes.
 *
 * Needs `playwright-core` (a dev dependency) and a Chromium: `npx playwright install chromium`
 * fetches one, or point SMOKE_CHROME at an executable, as the smoke test does.
 */

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.ICON_PORT || 4183);
const SITE = `http://127.0.0.1:${PORT}/`;
// Her bearing: from her starboard quarter, sails filling towards the viewer, which is the view that
// shows the most of her. The three-quarter view the menu holds under reduced motion foreshortens
// her to a third of the box.
const DEG = 150;

// served from the root so the module is at /src/galleon.js whatever the Pages base is
const env = { ...process.env, BASE_PATH: "/" };
const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: root, stdio: "ignore", env });
const up = async () => { try { return (await fetch(SITE)).ok; } catch { return false; } };
for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
if (!(await up())) { server.kill(); throw new Error(`nothing answered at ${SITE}`); }

const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROME || undefined, headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.goto(SITE, { waitUntil: "networkidle" });
  // name, pixel size, and how wide the ship's 1 : 0.62 frame is drawn against the box. The frame
  // is wider than the box because the frame holds room for her to turn in and at this bearing she
  // uses the middle of it: 1.3 keeps her flag and bowsprit clear of the edges. A maskable icon
  // keeps everything inside the middle 80%, which is the safe zone of the mask.
  const icons = [
    ["apple-touch-icon.png", 180, 1.3],
    ["icon-192.png", 192, 1.3],
    ["icon-512.png", 512, 1.3],
    ["icon-maskable-512.png", 512, 1.0],
  ];
  for (const [name, size, span] of icons) {
    const url = await page.evaluate(async ({ size, span, deg }) => {
      const { drawGalleon } = await import("/src/galleon.js");
      const c = document.createElement("canvas");
      c.width = size; c.height = size;
      const ctx = c.getContext("2d");
      // the menu's own ground: dark water under the plate, a little lighter where the ship sits
      const g = ctx.createRadialGradient(size / 2, size * 0.55, size * 0.1, size / 2, size * 0.55, size * 0.75);
      g.addColorStop(0, "#155450");
      g.addColorStop(1, "#0b3331");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      // her waterline sits at 0.71 of the frame, so the frame rides a little high to centre her
      const w = size * span, h = w * 0.62;
      ctx.translate((size - w) / 2, (size - h) / 2 - size * 0.03);
      drawGalleon(ctx, w, h, deg, null);
      return c.toDataURL("image/png");
    }, { size, span, deg: DEG });
    writeFileSync(join(root, "public", name), Buffer.from(url.split(",")[1], "base64"));
    console.log("wrote public/" + name);
  }
} finally {
  await browser.close();
  server.kill();
}

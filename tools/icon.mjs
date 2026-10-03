/**
 * THE HOME-SCREEN ICON AND THE SHARE CARD — `npm run icon`
 *
 * Draws the game's mark into the images a phone shows when the game is saved to the home screen,
 * and the card a search result or a shared link shows, and writes them all into `public/`: the
 * touch icon iOS reads, the two sizes the web manifest lists for Android and desktop Chrome, a
 * maskable one with the ship held inside the circle Android may cut the icon to, a favicon, and a
 * 1200 x 630 share card. It is the real `drawGalleon`, run in a headless Chromium against the dev
 * server, so the mark follows the ship's art when it changes.
 *
 * The mark is a Cutter light, fully found: two cut gaff mainsails on a gaff mast and two cut jibs
 * on a jibboom, seen off her port bow. A single mast and its canvas read at 32 pixels where a
 * galleon's three masts turn to a smudge. The rig is built through `resolve` and `rigSpec` like any ship in the yard, so a part
 * renamed in the catalogue fails here loudly rather than drawing a bare hull.
 *
 * Needs `playwright-core` (a dev dependency) and a Chromium: `npx playwright install chromium`
 * fetches one, or point SMOKE_CHROME at an executable, as the smoke test does.
 */

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { MARK, MARK_DEG } from "./mark.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.ICON_PORT || 4183);
const SITE = `http://127.0.0.1:${PORT}/`;

// The ship and her bearing live in `mark.mjs`, which the promotional art reads as well.
const DEG = MARK_DEG;

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
  // name, width, height, and the share of the box the ship may fill. The ship is drawn once, large,
  // on a clear canvas, trimmed to what she actually covers and then fitted, so she sits in the
  // middle of every box whatever her rig's shape. A maskable icon keeps her inside the middle 80%,
  // the circle the mask may cut to, which a box of 0.58 a side clears at the corners.
  const images = [
    ["apple-touch-icon.png", 180, 180, 0.84],
    ["icon-192.png", 192, 192, 0.84],
    ["icon-512.png", 512, 512, 0.84],
    ["icon-maskable-512.png", 512, 512, 0.58],
    ["favicon-32.png", 32, 32, 0.96],
    ["og-image.png", 1200, 630, 0.8],
  ];
  for (const [name, W, H, fill] of images) {
    const url = await page.evaluate(async ({ W, H, fill, deg, mark }) => {
      const { drawGalleon } = await import("/src/galleon.js");
      const Y = await import("/src/shipyard.js");
      const hull = Y.HULLS[mark.hull];
      if (!hull) throw new Error(`no hull ${mark.hull}`);
      const rig = Object.fromEntries(hull.sockets.map((s, i) => [s.id, mark.rig[i] || null]));
      const lo = Y.resolve({ hull: hull.id, rig, guns: { broadside: Array(hull.guns.broadside).fill(mark.gun), bow: [], swivel: [] } });
      const spec = Y.rigSpec(lo);
      const sails = spec.masts.reduce((n, m) => n + m.sails.length, 0);
      if (sails !== mark.rig.reduce((n, m) => n + m.sails.length, 0)) throw new Error("the mark's rig no longer fits her");

      // her, large and alone, then the box she covers
      const S = 1600, ship = document.createElement("canvas");
      ship.width = S; ship.height = Math.round(S * 0.62);
      drawGalleon(ship.getContext("2d"), ship.width, ship.height, deg, spec);
      const px = ship.getContext("2d").getImageData(0, 0, ship.width, ship.height).data;
      let x0 = ship.width, y0 = ship.height, x1 = 0, y1 = 0;
      for (let y = 0; y < ship.height; y++) for (let x = 0; x < ship.width; x++) {
        if (px[(y * ship.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;

      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const ctx = c.getContext("2d");
      // the menu's own ground: dark water, a little lighter where the ship sits
      const r = Math.max(W, H);
      const card = W > H;
      const cx = card ? W * 0.75 : W / 2;
      const g = ctx.createRadialGradient(cx, H * 0.55, r * 0.1, cx, H * 0.55, r * 0.75);
      g.addColorStop(0, "#155450");
      g.addColorStop(1, "#0b3331");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // the share card puts her on the right and the title on the left, the way the menu stacks it
      const room = card ? H : Math.min(W, H);
      const k = Math.min((room * fill) / bw, (room * fill) / bh);
      const dw = bw * k, dh = bh * k;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(ship, x0, y0, bw, bh, cx - dw / 2, (H - dh) / 2, dw, dh);

      if (card) {
        const DISPLAY = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "#e8c877";
        ctx.font = `86px ${DISPLAY}`;
        ctx.fillText("STERNCHASE", W * 0.28, H * 0.5);
        ctx.fillStyle = "rgba(238,244,242,0.82)";
        ctx.font = `44px ${DISPLAY}`;
        ctx.fillText("HELM & HULL", W * 0.28, H * 0.5 + 66);
      }
      return c.toDataURL("image/png");
    }, { W, H, fill, deg: DEG, mark: MARK });
    writeFileSync(join(root, "public", name), Buffer.from(url.split(",")[1], "base64"));
    console.log("wrote public/" + name);
  }
} finally {
  await browser.close();
  server.kill();
}

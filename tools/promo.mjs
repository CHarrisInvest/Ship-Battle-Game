/**
 * THE PROMOTIONAL IMAGES — `npm run promo`
 *
 * Draws the art an advertisement or a store listing needs and writes it into `promo/`: a video
 * thumbnail, a share card, square and story posts for social feeds, the standard display-ad sizes,
 * and a line-up of the fleet. Like `npm run icon` it is the real `drawGalleon` run in a headless
 * Chromium against the dev server, so the art follows the ship's when it changes and no ship here is
 * a picture of something the game does not draw. The ships are rigged by `maximumLoadout`, which is
 * what "fully found" means everywhere else.
 *
 * `npm run promo -- --play` also plays a round of Free-for-all in a phone held sideways and upright,
 * sailing a fully found first rate, and writes a burst of real frames to a temporary folder, printed
 * at the end. A round is not repeatable, so those are a contact sheet to choose from rather than
 * outputs: the ones worth keeping are copied into `promo/screens/` by hand. `--clean` hides the DOM
 * HUD in that burst too, for frames of the sea and nothing else.
 *
 * Copy here is player-facing and follows the rules in CLAUDE.md: no em dashes, numerals, the title
 * in caps and everything a player is told in sentence case. Counts are read off the catalogue.
 *
 * Needs `playwright-core` (a dev dependency) and a Chromium: point SMOKE_CHROME at an executable.
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "promo");
const PORT = Number(process.env.PROMO_PORT || 4185);
const SITE = `http://127.0.0.1:${PORT}/`;
const PLAY = process.argv.includes("--play");
const CLEAN = process.argv.includes("--clean");

// The hero, and her bearing: off her starboard bow with every square sail filling towards us.
const HERO = "firstRate";
const HERO_DEG = 2;
// The line-up, smallest to largest, all at one bearing and one scale so their sizes compare.
const LINEUP = ["cutter", "brigantine", "corvette", "fifthRate", "thirdRate", "firstRate"];

// name, width, height, layout
const ART = [
  ["thumbnail-1280x720.png", 1280, 720, "card"],
  ["share-card-1200x630.png", 1200, 630, "card"],
  ["square-1080x1080.png", 1080, 1080, "tall"],
  ["portrait-1080x1350.png", 1080, 1350, "tall"],
  ["story-1080x1920.png", 1080, 1920, "tall"],
  ["fleet-1920x1080.png", 1920, 1080, "fleet"],
  ["ad-leaderboard-728x90.jpg", 728, 90, "strip"],
  ["ad-billboard-970x250.jpg", 970, 250, "card"],
  ["ad-mobile-banner-320x50.jpg", 320, 50, "strip"],
  ["ad-large-mobile-320x100.jpg", 320, 100, "strip"],
  ["ad-medium-rectangle-300x250.jpg", 300, 250, "tall"],
  ["ad-half-page-300x600.jpg", 300, 600, "tall"],
  ["ad-skyscraper-160x600.jpg", 160, 600, "tall"],
];

const env = { ...process.env, BASE_PATH: "/" };
const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: root, stdio: "ignore", env, detached: true });
const up = async () => { try { return (await fetch(SITE)).ok; } catch { return false; } };
for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
if (!(await up())) { try { process.kill(-server.pid); } catch { server.kill(); } throw new Error(`nothing answered at ${SITE}`); }

const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROME || undefined, headless: true, args: ["--no-sandbox"] });
try {
  mkdirSync(out, { recursive: true });
  const page = await browser.newPage();
  await page.goto(SITE, { waitUntil: "networkidle" });
  for (const [name, W, H, layout] of ART) {
    // Display ads go up as JPEG, because Google Ads refuses an upload over 150 KB and the larger
    // banners come out of the canvas well over that as PNG.
    const type = name.endsWith(".jpg") ? "image/jpeg" : "image/png";
    const url = await page.evaluate(compose, { W, H, layout, hero: HERO, deg: HERO_DEG, lineup: LINEUP, type });
    writeFileSync(join(out, name), Buffer.from(url.split(",")[1], "base64"));
    console.log("wrote promo/" + name);
  }
  if (PLAY) await play();
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { server.kill(); }
}

/* ---- the art, drawn in the page ---------------------------------------------------------------- */

async function compose({ W, H, layout, hero, deg, lineup, type }) {
  const { drawGalleon } = await import("/src/galleon.js");
  const Y = await import("/src/shipyard.js");
  const DISPLAY = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
  const UI = '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const GOLD = "#e8c877", INK = "rgba(238,244,242,0.86)", DIM = "rgba(238,244,242,0.62)";
  const classes = Y.HULL_LIST.length;
  const smallest = Y.HULL_LIST[0].name, largest = Y.HULL_LIST[Y.HULL_LIST.length - 1].name;

  // A ship drawn large and alone, then trimmed to what she covers. `span` fixes the drawing box so
  // ships drawn with the same span keep their sizes relative to one another.
  const drawn = (id, bearing, span = 2400) => {
    const c = document.createElement("canvas");
    c.width = span; c.height = Math.round(span * 0.7);
    drawGalleon(c.getContext("2d"), c.width, c.height, bearing, Y.rigSpec(Y.maximumLoadout(id)));
    const px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (px[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    return { c, x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };

  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  const u = Math.min(W, H); // the unit everything is sized off

  // The menu's ground, dark water lit where the ship sits, with the sea's own wave marks over it.
  const ground = (cx, cy) => {
    const r = Math.max(W, H);
    const g = ctx.createRadialGradient(cx, cy, r * 0.05, cx, cy, r * 0.8);
    g.addColorStop(0, "#1b6560");
    g.addColorStop(0.55, "#0f3f3c");
    g.addColorStop(1, "#082826");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // a fixed scatter, so a redraw is the same picture
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const k = Math.max(4, u * 0.012);
    ctx.strokeStyle = "rgba(160,220,210,0.10)";
    ctx.lineWidth = Math.max(1, k * 0.28);
    ctx.lineCap = "round";
    const n = Math.round((W * H) / (u * u) * 26);
    for (let i = 0; i < n; i++) {
      const x = rnd() * W, y = rnd() * H;
      ctx.beginPath();
      ctx.moveTo(x - k, y); ctx.lineTo(x - k / 2, y - k * 0.45); ctx.lineTo(x, y);
      ctx.lineTo(x + k / 2, y - k * 0.45); ctx.lineTo(x + k, y);
      ctx.stroke();
    }
  };

  // Her on the water: a shadow and a little white at the waterline, so she sits rather than floats.
  const ship = (s, cx, cy, dw) => {
    const k = dw / s.w, dh = s.h * k;
    const top = cy - dh / 2, foot = top + dh * 0.93;
    ctx.save();
    ctx.fillStyle = "rgba(0,20,18,0.35)";
    ctx.beginPath(); ctx.ellipse(cx + dw * 0.02, foot, dw * 0.42, dh * 0.07, -0.12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(230,245,240,0.10)";
    ctx.beginPath(); ctx.ellipse(cx, foot - dh * 0.01, dw * 0.36, dh * 0.04, -0.12, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.drawImage(s.c, s.x0, s.y0, s.w, s.h, cx - dw / 2, top, dw, dh);
    return { top, bottom: top + dh, h: dh };
  };

  // Text that shrinks to fit the width it is given.
  const text = (str, x, y, size, font, color, maxW, align = "center", spacing = 0) => {
    let px = size;
    ctx.font = `${px}px ${font}`;
    ctx.letterSpacing = `${spacing * px}px`;
    while (ctx.measureText(str).width > maxW && px > 6) { px -= 1; ctx.font = `${px}px ${font}`; ctx.letterSpacing = `${spacing * px}px`; }
    ctx.textAlign = align;
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.letterSpacing = "0px";
    return px;
  };

  const button = (label, cx, cy, h, maxW) => {
    ctx.font = `600 ${Math.round(h * 0.46)}px ${UI}`;
    const w = Math.min(maxW, ctx.measureText(label).width + h * 1.1);
    const r = Math.min(h / 2, 20);
    ctx.fillStyle = GOLD;
    ctx.beginPath(); ctx.roundRect(cx - w / 2, cy - h / 2, w, h, r); ctx.fill();
    ctx.textBaseline = "middle";
    text(label, cx, cy + h * 0.03, Math.round(h * 0.46), `600 ${UI}`.replace("600 ", ""), "#10302e", w - h * 0.6);
    ctx.textBaseline = "alphabetic";
  };
  ctx.textBaseline = "alphabetic";

  const TAG = "Fit out a ship. Fight her broadside to broadside.";
  const FLEET = `${classes} classes of sail, from a ${smallest} to a ${largest}.`;
  const CTA = "Play free in your browser";
  const SITE = "sternchase.org";

  if (layout === "card") {
    // ship right, words left, the way the share card has always stood
    const cx = W * 0.74;
    ground(cx, H * 0.55);
    const s = drawn(hero, deg);
    const room = Math.min(W * 0.44, (H * 0.84) * (s.w / s.h));
    ship(s, cx, H * 0.5, room);
    const lx = W * 0.27, tw = W * 0.46;
    const big = text("STERNCHASE", lx, H * 0.40, H * 0.15, DISPLAY, GOLD, tw, "center", 0.04);
    text("HELM & HULL", lx, H * 0.40 + big * 0.72, big * 0.46, DISPLAY, INK, tw, "center", 0.12);
    if (H >= 300) {
      text(TAG, lx, H * 0.40 + big * 1.5, big * 0.29, UI, INK, tw);
      text(FLEET, lx, H * 0.40 + big * 1.95, big * 0.23, UI, DIM, tw);
      button(CTA, lx, H * 0.40 + big * 2.85, big * 0.62, tw);
      text(SITE, lx, H * 0.40 + big * 3.55, big * 0.24, UI, DIM, tw);
    } else {
      text(TAG, lx, H * 0.40 + big * 1.38, big * 0.25, UI, INK, tw);
      button("Play free", lx, H * 0.40 + big * 2.15, big * 0.5, tw);
    }
  } else if (layout === "tall") {
    ground(W / 2, H * 0.52);
    const s = drawn(hero, deg);
    const pad = W * 0.07, tw = W - pad * 2;
    const tall = H / W > 1.5;
    // title band at the top
    const titleY = pad * 0.6 + Math.min(W * 0.11, H * 0.09);
    const big = text("STERNCHASE", W / 2, titleY, Math.min(W * 0.11, H * 0.09), DISPLAY, GOLD, tw, "center", 0.04);
    const sub = text("HELM & HULL", W / 2, titleY + big * 0.72, big * 0.42, DISPLAY, INK, tw, "center", 0.12);
    const titleFoot = titleY + big * 0.72 + sub * 0.4;
    // the words at the foot, sized to the width
    const unit = Math.min(W * 0.055, H * 0.04);
    const ctaH = Math.max(unit * 1.7, 22);
    const small = W < 400;
    const lines = small
      ? [[TAG.split(". ")[0] + ".", unit * 0.95, INK], ["Fight her broadside to broadside.", unit * 0.95, INK]]
      : [[TAG, unit, INK], [FLEET, unit * 0.78, DIM]];
    const footGap = unit * 0.7;
    let y = H - pad * 0.9 - (small ? 0 : unit * 1.2);
    const siteY = y;
    const ctaY = siteY - (small ? ctaH * 0.5 : unit * 1.0) - ctaH / 2;
    let ly = ctaY - ctaH / 2 - footGap;
    const placed = [];
    for (let i = lines.length - 1; i >= 0; i--) { placed.unshift([lines[i], ly]); ly -= lines[i][1] * 1.35; }
    const wordsTop = ly;
    // the ship in what is left between
    const gapTop = titleFoot + unit * 0.4, gapBottom = wordsTop;
    const roomH = gapBottom - gapTop;
    const dw = Math.min(W * 0.86, roomH * 0.94 * (s.w / s.h));
    ship(s, W / 2, gapTop + roomH / 2, dw);
    for (const [[str, size, color], yy] of placed) text(str, W / 2, yy, size, UI, color, tw);
    button(small ? "Play free" : CTA, W / 2, ctaY, ctaH, tw);
    if (!small) text(SITE, W / 2, siteY, unit * 0.8, UI, DIM, tw);
  } else if (layout === "strip") {
    // a banner too short for a line-up of words: ship, title, one line, button
    ground(W * 0.12, H / 2);
    const s = drawn(hero, deg);
    const sh = H * 0.84, dw = Math.min(W * 0.2, sh * (s.w / s.h));
    ship(s, dw / 2 + H * 0.12, H / 2, dw);
    const left = dw + H * 0.3;
    const btnW = Math.min(W * 0.26, H * 2.4);
    const right = W - btnW - H * 0.3;
    ctx.textBaseline = "middle";
    if (H >= 80 && W >= 600) {
      const big = text("STERNCHASE", left, H * 0.36, H * 0.32, DISPLAY, GOLD, (right - left) * 0.42, "left", 0.04);
      text("HELM & HULL", left, H * 0.36 + big * 0.82, big * 0.42, DISPLAY, INK, (right - left) * 0.42, "left", 0.12);
      const tx = left + (right - left) * 0.47, tw2 = (right - left) * 0.53;
      text("Fit out a ship.", tx, H * 0.37, H * 0.2, UI, INK, tw2, "left");
      text("Fight her broadside to broadside.", tx, H * 0.63, H * 0.2, UI, INK, tw2, "left");
    } else if (H >= 80) {
      const big = text("STERNCHASE", left, H * 0.3, H * 0.27, DISPLAY, GOLD, right - left, "left", 0.04);
      text("HELM & HULL", left, H * 0.3 + big * 0.8, big * 0.42, DISPLAY, INK, right - left, "left", 0.12);
      text("Fight her broadside", left, H * 0.3 + big * 1.65, big * 0.44, UI, DIM, right - left, "left");
      text("to broadside.", left, H * 0.3 + big * 2.15, big * 0.44, UI, DIM, right - left, "left");
    } else {
      const big = text("STERNCHASE", left, H * 0.4, H * 0.34, DISPLAY, GOLD, right - left, "left", 0.04);
      text("HELM & HULL", left, H * 0.4 + big * 0.85, big * 0.42, DISPLAY, INK, right - left, "left", 0.12);
    }
    ctx.textBaseline = "alphabetic";
    button("Play free", W - btnW / 2 - H * 0.12, H / 2, Math.min(H * 0.56, 44), btnW);
  } else if (layout === "fleet") {
    ground(W / 2, H * 0.6);
    const ships = lineup.map((id) => ({ id, s: drawn(id, 345, 1400) }));
    const name = (id) => Y.HULLS[id].name;
    // one scale for all of them, so a cutter stands beside a first rate at her own size
    const gap = W * 0.012;
    const totalW = ships.reduce((a, x) => a + x.s.w, 0);
    const k = Math.min((W * 0.94 - gap * (ships.length - 1)) / totalW, (H * 0.56) / Math.max(...ships.map((x) => x.s.h)));
    const used = totalW * k + gap * (ships.length - 1);
    const base = H * 0.76;
    let x = (W - used) / 2;
    for (const { id, s } of ships) {
      const dw = s.w * k, dh = s.h * k;
      ship(s, x + dw / 2, base - dh / 2, dw);
      ctx.textBaseline = "alphabetic";
      text(name(id), x + dw / 2, base + u * 0.07, u * 0.028, UI, INK, dw + gap);
      x += dw + gap;
    }
    const big = text("STERNCHASE", W / 2, H * 0.17, H * 0.085, DISPLAY, GOLD, W * 0.8, "center", 0.04);
    text(`${classes} classes of sail. Fit any of them out in the yard.`, W / 2, H * 0.17 + big * 0.85, H * 0.034, UI, INK, W * 0.8);
    text(`${CTA} at ${SITE}`, W / 2, H * 0.94, H * 0.03, UI, DIM, W * 0.8);
  }
  return c.toDataURL(type, 0.9);
}

/* ---- a round, for real frames ------------------------------------------------------------------ */

async function play() {
  const dir = mkdtempSync(join(tmpdir(), "sternchase-promo-"));
  for (const [tag, vw, vh] of [["sideways", 844, 390], ["upright", 390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, timezoneId: "America/New_York" });
    // Answered and funded before the page loads: no cookie sheet over the frame, and enough in the
    // hold to buy her. The purse is set back to an ordinary figure before the frames are taken.
    await ctx.addInitScript(() => {
      if (!localStorage.getItem("sternchase.consent")) localStorage.setItem("sternchase.consent", JSON.stringify({ status: "rejected", analytics: false, advertising: false, functionality: true }));
      if (!localStorage.getItem("sternchase.hold")) localStorage.setItem("sternchase.hold", JSON.stringify({ coins: 99999999 }));
    });
    await ctx.route(/googlesyndication\.com|googletagmanager\.com|google-analytics\.com|fundingchoicesmessages\.google\.com/, (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
    const page = await ctx.newPage();
    await page.goto(SITE, { waitUntil: "networkidle" });
    await page.evaluate(async (hullId) => {
      const H = await import("/src/hold.js");
      const Y = await import("/src/shipyard.js");
      const { ship } = H.buyShip(hullId);
      const lo = Y.maximumLoadout(hullId);
      for (const s of lo.hull.sockets) {
        const e = lo.rig[s.id];
        if (!e?.mast) continue;
        H.buyPart(e.mast.id);
        for (const p of [...(e.sails || []), ...(e.studs || [])]) if (p) H.buyPart(p.id);
      }
      for (const m of ["broadside", "bow", "swivel"]) for (const g of lo.guns[m] || []) if (g) H.buyPart(g.id);
      H.fitOwned(ship);
      H.setActiveShip(ship);
      const rec = JSON.parse(localStorage.getItem("sternchase.hold"));
      rec.coins = 4820;
      localStorage.setItem("sternchase.hold", JSON.stringify(rec));
    }, HERO);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(dir, `${tag}-menu.png`) });
    await page.locator("button", { hasText: "FREE-FOR-ALL" }).first().click();
    await page.waitForTimeout(1500);
    const cdp = await ctx.newCDPSession(page);
    const joy = await page.locator("div[style*='touch-action: none'][style*='border-radius: 50%']").first().boundingBox();
    const jx = joy.x + joy.width / 2, jy = joy.y + joy.height / 2;
    if (CLEAN) await page.addStyleTag({ content: "canvas ~ * { visibility: hidden !important; }" });
    for (let i = 0; i < 24; i++) {
      const a = i * 0.6;
      const stick = { x: jx + 30 * Math.cos(a), y: jy - 30 * Math.sin(a), id: 1 };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: jx, y: jy, id: 1 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [stick] });
      await page.waitForTimeout(1200);
      const side = await page.locator("button", { hasText: /^SIDE/ }).first().boundingBox().catch(() => null);
      if (side && i % 2) await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [stick, { x: side.x + side.width / 2, y: side.y + side.height / 2, id: 2 }] });
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(dir, `${tag}-play-${String(i).padStart(2, "0")}.png`) });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      if (await page.locator("button", { hasText: /^Rematch$/ }).count()) break;
    }
    await ctx.close();
  }
  console.log(`\nframes in ${dir}`);
}

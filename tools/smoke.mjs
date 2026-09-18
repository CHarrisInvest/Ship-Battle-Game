/**
 * THE SMOKE TEST — `npm run smoke`
 *
 * Plays the built game in a headless phone-sized browser and fails loudly on what the bench cannot
 * see: a screen that throws, a mode that never reaches its end screen, an end screen whose column
 * does not add up to what reached the hold, or a round that leaves a runtime error in the console.
 * It is a regression net for the running game, not a judge of play: nothing here says whether a
 * fight is fair, whether the AI is any good, or whether a screen looks right. Screenshots and the
 * text of every screen are written to a folder for a person to look at, and the folder is printed.
 *
 * It builds the bundle with a root base path into a temporary folder, serves it with vite preview,
 * tours the menu, the yard, the outfitter, the shop and the records, then plays every mode twice in
 * parallel, once with no input and once with the stick held and every fire button down, until the
 * end screen. About four minutes. Needs `playwright-core` (a dev dependency) and a Chromium:
 * `npx playwright install chromium` fetches one, or point SMOKE_CHROME at an executable.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "sternchase-smoke-"));
const dist = join(out, "dist");
const PORT = Number(process.env.SMOKE_PORT || 4179);
const SITE = `http://127.0.0.1:${PORT}/`;
const ROUND_LIMIT = Number(process.env.SMOKE_ROUND_SECONDS || 330); // the longest round left alone is about 200 s
const failures = [];
const fail = (what) => { failures.push(what); console.log("  FAIL  " + what); };
const ok = (what) => console.log("  ok    " + what);
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ---- build and serve ------------------------------------------------------------------------- */

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], ...opts });
    let text = "";
    p.stdout.on("data", (d) => (text += d));
    p.stderr.on("data", (d) => (text += d));
    p.on("exit", (code) => (code === 0 ? resolve(text) : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}\n${text}`))));
  });
}

// Built and served from the root rather than from the Pages base path, and the preview has to be
// told the same thing as the build: it reads `vite.config.js` too, and with the base left at
// `/Ship-Battle-Game/` it redirected the root to a folder the build had not written.
const env = { ...process.env, BASE_PATH: "/" };
say("building into", dist);
await run("npx", ["vite", "build", "--outDir", dist], { env });
const server = spawn("npx", ["vite", "preview", "--outDir", dist, "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: root, stdio: "ignore", env });
const up = async () => { try { return (await fetch(SITE)).ok; } catch { return false; } };
for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
if (!(await up())) { server.kill(); throw new Error(`nothing answered at ${SITE}`); }
say("serving", SITE);

/* ---- the browser ----------------------------------------------------------------------------- */

const executablePath = process.env.SMOKE_CHROME || undefined;
const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });

async function open(tag) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = [];
  // a missing favicon is not a fault of the game
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errs.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => errs.push(`page: ${e.message}`));
  page.errs = errs;
  page.tag = tag;
  page.setDefaultTimeout(8000); // a control that is not there is a failure, not a half-minute wait
  await page.goto(SITE, { waitUntil: "networkidle" });
  return page;
}
const text = (page) => page.evaluate(() => document.body.innerText);
async function snap(page, name) {
  await page.screenshot({ path: join(out, `${page.tag}-${name}.png`) });
  writeFileSync(join(out, `${page.tag}-${name}.txt`), await text(page));
}
const hold = async (page) => JSON.parse((await page.evaluate(() => localStorage.getItem("sternchase.hold"))) || "null");
const coins = (s) => Number(String(s).replace(/[^\d-]/g, ""));

/* ---- the tour -------------------------------------------------------------------------------- */

async function tour() {
  const page = await open("tour");
  await page.waitForTimeout(800);
  const expect = async (name, heading) => {
    await page.waitForTimeout(300);
    await snap(page, name);
    const t = await text(page);
    if (t.includes(heading)) ok(`${name} shows ${heading}`);
    else fail(`${name} does not show "${heading}"`);
  };
  await expect("01-menu", "GAME MODES");
  await page.locator("button[aria-label^='Open the yard']").click();
  await expect("02-yard", "THE YARD");
  await page.locator("button", { hasText: "Outfit her" }).first().click().catch(() => {});
  if (!(await text(page)).includes("RIGGING OUTFITTER")) {
    await page.locator("button", { hasText: /Sprit mast|mast/ }).first().click().catch(() => {});
  }
  await expect("03-outfitter", "RIGGING OUTFITTER");
  await page.locator("button", { hasText: /Back to the yard/ }).first().click();
  await page.locator("button", { hasText: "Boat Commission" }).first().click();
  await expect("04-commission", "BOAT COMMISSION");
  await page.goto(SITE, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.locator("button", { hasText: /Achievements & Tallies/ }).first().click();
  await expect("05-records", "ACHIEVEMENTS & TALLIES");
  await page.locator("button", { hasText: /^Achievements/ }).first().click();
  await expect("06-achievements", "ACHIEVEMENTS");
  if (page.errs.length) fail(`tour: ${page.errs.join(" | ")}`); else ok("tour: no runtime errors");
  await page.context().close();
}

/* ---- a round --------------------------------------------------------------------------------- */

async function round(modeTitle, key, drive) {
  const page = await open(`${key}-${drive ? "drive" : "idle"}`);
  await page.waitForTimeout(600);
  const before = (await hold(page)) || { coins: 0 };
  await page.locator("button", { hasText: modeTitle }).first().click();
  await page.waitForTimeout(800);
  await snap(page, "01-open");
  const t0 = Date.now();
  let ended = false;
  const cdp = drive ? await page.context().newCDPSession(page) : null;
  const joy = drive ? await page.locator("div[style*='touch-action: none'][style*='border-radius: 50%']").first().boundingBox() : null;
  const press = async () => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: joy.x + joy.width / 2, y: joy.y + joy.height / 2, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: joy.x + joy.width / 2 + 30, y: joy.y + joy.height / 2 - 30, id: 1 }] });
    let id = 2;
    for (const f of await page.locator("button", { hasText: /^(SIDE|FRONT|MUSKET)/ }).all()) {
      const b = await f.boundingBox();
      if (b) await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: id++ }] });
    }
  };
  const release = () => cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  let i = 0;
  while (!ended && Date.now() - t0 < ROUND_LIMIT * 1000) {
    if (drive) {
      try { await press(); await page.waitForTimeout(2500); await release(); await page.waitForTimeout(200); } catch { /* the screen has gone */ }
      for (const r of await page.locator("button", { hasText: /^(HULL|MAST)$/ }).all()) { try { await r.tap({ timeout: 300 }); } catch { /* dead or gone */ } }
    } else {
      await page.waitForTimeout(3000);
    }
    if (i++ % 8 === 0) await snap(page, `02-play-${String(i).padStart(3, "0")}`);
    ended = (await page.locator("button", { hasText: /^Rematch$/ }).count()) > 0;
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  await snap(page, "03-end");
  if (!ended) { fail(`${page.tag}: no end screen after ${secs} s`); await page.context().close(); return; }
  ok(`${page.tag}: ended after ${secs} s`);

  // the end screen's column has to add up, and what it says reached the hold has to have reached it
  const t = await text(page);
  const row = (label) => { const m = t.match(new RegExp(`${label}\\n([+-]?[\\d,]+)`)); return m ? coins(m[1]) : null; };
  const banked = row("Into the hold");
  const bounty = row("For achievements") || 0;
  const paid = ["From fighting", "For time at sea", "For a full round at sea", "For winning"].map(row).filter((v) => v != null).reduce((a, b) => a + b, 0);
  const carpenter = row("Paid to the carpenter") || 0;
  const after = await hold(page);
  if (banked == null || !after) fail(`${page.tag}: could not read the end screen or the hold`);
  else {
    if (Math.max(0, paid - carpenter) !== banked) fail(`${page.tag}: pay rows ${paid} less carpenter ${carpenter} do not make "Into the hold" ${banked}`);
    else ok(`${page.tag}: the column adds up (${banked} into the hold)`);
    const delta = after.coins - before.coins;
    if (delta !== banked + bounty) fail(`${page.tag}: the hold moved ${delta} but the screen says ${banked} plus ${bounty} in bounties`);
    else ok(`${page.tag}: the hold moved by what the screen says`);
  }
  // a rematch starts a clean round
  await page.locator("button", { hasText: /^Rematch$/ }).click();
  await page.waitForTimeout(2500);
  await snap(page, "04-rematch");
  if ((await page.locator("button", { hasText: /^Rematch$/ }).count()) > 0) fail(`${page.tag}: rematch did not start a new round`);
  if (page.errs.length) fail(`${page.tag}: ${page.errs.join(" | ")}`); else ok(`${page.tag}: no runtime errors`);
  await page.context().close();
}

/* ---- go -------------------------------------------------------------------------------------- */

try {
  await tour().catch((e) => fail(`tour: ${e.message.split("\n")[0]}`));
  await Promise.all([
    ...[["FREE-FOR-ALL", "ffa"], ["DEMOLITION DERBY", "derby"], ["ARENA", "arena"]].flatMap(([title, key]) =>
      [false, true].map((drive) => round(title, key, drive).catch((e) => fail(`${key}-${drive ? "drive" : "idle"}: ${e.message.split("\n")[0]}`))),
    ),
  ]);
} finally {
  await browser.close();
  server.kill();
}

console.log(`\nscreens and text in ${out}`);
if (failures.length) {
  console.log(`\n${failures.length} FAILURE${failures.length === 1 ? "" : "S"}`);
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
console.log("\nThe game runs.\n");

/**
 * THE ONLINE SMOKE TEST — `npm run online-smoke`
 *
 * Two friends sail together in two real browsers, against the real game server on a throwaway
 * Postgres, the built game served by vite preview with `/api` forwarded to the server the way Vercel
 * forwards it, and the online socket opened straight to the server as it is in production. One makes
 * a lobby, the other opens the invite link, the host starts, and both play the round through: one
 * with her hands off, one with the stick held and every gun firing. It fails if either never reaches
 * the end, if either browser parts company with the server, if the end screen never shows what was
 * banked, or if a screen throws. Screenshots go to a folder, printed at the end.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright-core";
import { testDatabase } from "../server/testdb.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "sternchase-online-"));
const dist = join(out, "dist");
const PORT = Number(process.env.SMOKE_PORT || 4181);
const SERVER_PORT = Number(process.env.SMOKE_SERVER_PORT || 8798);
// SMOKE_SITE plays against a deployed game instead, e.g. https://sternchase.vercel.app, starting nothing
const LIVE = process.env.SMOKE_SITE || null;
const SITE = LIVE || `http://127.0.0.1:${PORT}`;
const failures = [];
const fail = (what) => { failures.push(what); console.log("  FAIL  " + what); };
const ok = (what) => console.log("  ok    " + what);
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], ...opts });
  let text = "";
  p.stdout.on("data", (d) => (text += d));
  p.stderr.on("data", (d) => (text += d));
  p.on("exit", (code) => (code === 0 ? resolve(text) : reject(new Error(`${cmd} exited ${code}\n${text}`))));
});
const waitUp = async (url) => { for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 500)); } return false; };

const db = LIVE ? { stop: async () => {} } : await testDatabase();
const game = LIVE ? null : spawn("node", ["server/index.js"], {
  cwd: root, stdio: ["ignore", "inherit", "inherit"], detached: true,
  env: {
    ...process.env, DATABASE_URL: db.url, PORT: String(SERVER_PORT), API_PREFIX: "/api",
    BETTER_AUTH_SECRET: "online-smoke-secret-0123456789abcdef0123456789", BETTER_AUTH_URL: SITE,
    CLIENT_ORIGINS: SITE, GUESTS_PER_MINUTE: "1000", PUBLIC_WS_URL: `ws://127.0.0.1:${SERVER_PORT}/ws`,
  },
});
const env = { ...process.env, BASE_PATH: "/", API_TARGET: `http://127.0.0.1:${SERVER_PORT}` };
let preview = null, browser = null;
try {
  if (!LIVE) {
    if (!(await waitUp(`http://127.0.0.1:${SERVER_PORT}/health`))) throw new Error("the game server did not start");
    await run("npx", ["vite", "build", "--outDir", dist], { env });
    preview = spawn("npx", ["vite", "preview", "--outDir", dist, "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: root, stdio: "ignore", env, detached: true });
    if (!(await waitUp(SITE + "/"))) throw new Error("the preview did not start");
    say("serving", SITE, "with the game server on", SERVER_PORT);
  } else say("playing against", SITE);

  browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROME || undefined, headless: true, args: ["--no-sandbox"] });
  // the friend in Safari's engine when asked (SMOKE_FRIEND=webkit), since friends are as likely on an iPhone
  const friendBrowser = process.env.SMOKE_FRIEND === "webkit" ? await webkit.launch({ headless: true }) : browser;
  async function open(tag, path = "/") {
    const ctx = await (tag === "friend" ? friendBrowser : browser).newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await ctx.addInitScript(() => {
      window.__tcfapi = (cmd, v, cb) => { if (cmd === "addEventListener") cb({ gdprApplies: false, eventStatus: "tcloaded" }, true); };
      if (!localStorage.getItem("sternchase.consent")) localStorage.setItem("sternchase.consent", JSON.stringify({ status: "rejected", analytics: false, advertising: false, functionality: true }));
    });
    const page = await ctx.newPage();
    page.tag = tag;
    page.errs = [];
    page.on("pageerror", (e) => page.errs.push(e.message));
    await page.goto(SITE + path, { waitUntil: "networkidle" });
    return page;
  }
  const text = (page) => page.evaluate(() => document.body.innerText);
  const snap = async (page, name) => { await page.screenshot({ path: join(out, `${page.tag}-${name}.png`) }); writeFileSync(join(out, `${page.tag}-${name}.txt`), await text(page)); };
  const until = async (page, pred, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await pred(await text(page))) return true; await page.waitForTimeout(250); } return false; };

  // the host makes a lobby
  const host = await open("host");
  await page_wait(host);
  await host.locator("button", { hasText: "WITH FRIENDS" }).click();
  if (await until(host, (t) => /Make a lobby/i.test(t))) ok("host: the lobby screen opens"); else fail("host: no lobby screen");
  await host.locator("button", { hasText: /^Make a public lobby$/ }).click();
  let code = null;
  if (await until(host, (t) => { const m = t.match(/LOBBY CODE\n(?:(?:Public|Private)[^\n]*\n)?([A-Z2-9]{5})\n/); code = m && m[1]; return !!code; })) ok(`host: a lobby is made (${code})`);
  else fail("host: no lobby code");
  await snap(host, "01-lobby");

  // a friend finds the public lobby in the list and joins it
  const friend = await open("friend");
  await page_wait(friend);
  await friend.locator("button", { hasText: "WITH FRIENDS" }).click();
  if (await until(friend, (t) => /Open lobbies/i.test(t) && t.includes("1 of 8"))) ok("friend: the public lobby is listed");
  else fail("friend: the public lobby is not listed");
  await snap(friend, "00-list");
  await friend.locator("button", { hasText: /^Join$/ }).first().click();
  if (await until(friend, (t) => /Captains, 2 of 8/i.test(t) && /I'm ready/.test(t))) ok("friend: joins from the list");
  else fail("friend: did not join from the list");
  if (await until(host, (t) => /Captains, 2 of 8/i.test(t))) ok("host: sees the friend join"); else fail("host: never saw the friend");
  await snap(friend, "01-lobby");

  // fewer AI ships, so the round is quick; the host waits for the friend to be ready, then starts
  for (let i = 0; i < 8; i++) await host.locator("button", { hasText: /^Fewer$/ }).click();
  if (await until(host, (t) => /Waiting for 1 captain to be ready/.test(t))) ok("host: Start waits for the friend to be ready"); else fail("host: Start did not wait");
  await friend.locator("button", { hasText: /^I'm ready$/ }).click();
  if (await until(host, (t) => /Ready/.test(t) && !/Waiting for 1 captain/.test(t))) ok("host: sees the friend ready"); else fail("host: never saw the friend ready");
  await snap(host, "01b-ready");
  await host.locator("button", { hasText: /^Start the round$/ }).click();
  const sailing = (t) => /SIDE|FRONT|MUSKET/.test(t);
  if (await until(host, sailing) && await until(friend, sailing)) ok("both: the round starts in both browsers"); else fail("the round did not start in both");
  await snap(host, "02-sea");
  await snap(friend, "02-sea");

  // the friend drives hard; the host sits; both wait for their end screens
  const chromiumFriend = process.env.SMOKE_FRIEND !== "webkit";
  const cdp = chromiumFriend ? await friend.context().newCDPSession(friend) : null;
  const joy = await friend.locator("div[style*='touch-action: none'][style*='border-radius: 50%']").first().boundingBox();
  const ended = (t) => /Back to the lobby/.test(t);
  const t0 = Date.now();
  let hostEnd = false, friendEnd = false;
  while (!(hostEnd && friendEnd) && Date.now() - t0 < 360000) {
    if (!friendEnd && joy && !chromiumFriend) {
      // Safari's engine: the stick held and swung with the mouse, which the pad reads as a pointer,
      // and the side guns fired between holds
      try {
        await friend.mouse.move(joy.x + joy.width / 2, joy.y + joy.height / 2);
        await friend.mouse.down();
        await friend.mouse.move(joy.x + joy.width / 2 + 30, joy.y + joy.height / 2 - 30, { steps: 4 });
        await friend.waitForTimeout(2000);
        await friend.mouse.up();
        const side = friend.locator("button", { hasText: /^SIDE/ }).first();
        if (await side.count()) await side.click({ timeout: 500 });
      } catch { /* the screen moved on */ }
    } else if (!friendEnd && joy) {
      try {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: joy.x + joy.width / 2, y: joy.y + joy.height / 2, id: 1 }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: joy.x + joy.width / 2 + 30, y: joy.y + joy.height / 2 - 30, id: 1 }] });
        let id = 2;
        for (const f of await friend.locator("button", { hasText: /^(SIDE|FRONT|MUSKET)/ }).all()) { const b = await f.boundingBox(); if (b) await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: id++ }] }); }
        await friend.waitForTimeout(2000);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } catch { /* the screen moved on */ }
    } else await friend.waitForTimeout(1000);
    hostEnd = hostEnd || ended(await text(host));
    friendEnd = friendEnd || ended(await text(friend));
  }
  if (hostEnd && friendEnd) ok(`both: reach their end screens (${Math.round((Date.now() - t0) / 1000)} s)`); else fail(`end screens: host ${hostEnd}, friend ${friendEnd}`);
  for (const page of [host, friend]) {
    const banked = await until(page, (t) => /Into the hold\n\+[\d,]+/.test(t), 20000);
    if (banked) ok(`${page.tag}: the end screen shows what the server banked`); else fail(`${page.tag}: never shown what was banked`);
    await snap(page, "03-end");
    const desynced = await page.evaluate(() => !!(window.__sternchaseDesync));
    if (desynced) fail(`${page.tag}: parted company with the server`);
    if (page.errs.length) fail(`${page.tag}: ${page.errs.join(" | ")}`); else ok(`${page.tag}: no runtime errors`);
  }
  // back to the lobby, ready for another round
  await host.locator("button", { hasText: /^Back to the lobby$/ }).click();
  if (await until(host, (t) => /Start the round/.test(t), 60000)) ok("host: back in the lobby, ready to start again"); else fail("host: the lobby did not come back");
  await snap(host, "04-again");
} catch (e) {
  fail(`the test itself broke: ${e.message.split("\n")[0]}`);
} finally {
  if (browser) await browser.close();
  for (const p of [preview, game]) { if (!p) continue; try { process.kill(-p.pid); } catch { p.kill(); } }
  await db.stop();
}

async function page_wait(page) { await page.waitForTimeout(1500); }

console.log(`\nscreens and text in ${out}`);
if (failures.length) {
  console.log(`\n${failures.length} FAILURE${failures.length === 1 ? "" : "S"}`);
  process.exit(1);
}
console.log("\nTwo friends sailed one round.\n");
process.exit(0);

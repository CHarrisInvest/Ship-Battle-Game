/**
 * THE TRAILER — `npm run trailer`
 *
 * Cuts a 30-second trailer of the game from real frames and writes it to
 * `promo/trailer-1080x1920.mp4`, upright, for a store listing, Shorts, Reels or a feed. The cut:
 *
 *   1. a fight between 3rd rates, the sea and the ships alone with no HUD over them
 *   2. the title
 *   3. the menu, the mark (the Cutter light the icon is drawn from) turning on her plate
 *   4. a free-for-all between fully found 1st rates, with the whole HUD, as it is played
 *   5. a free-for-all in a fully found Baltimore Clipper, among the fast ships she meets
 *   6. the title again, "Play free in your browser" and the address
 *
 * EVERY FRAME IS THE GAME'S OWN. The game runs in a headless Chromium against the dev server, at a
 * phone's size and three device pixels to the CSS pixel, which is 1080 by 1920, and the frames are
 * screenshots of it: the 3D sea, the overlay and the DOM HUD exactly as a captain sees them. The
 * clock is the tool's rather than the browser's: `requestAnimationFrame` and `performance.now` are
 * replaced by a virtual clock advanced one sixtieth of a second per frame, so every frame is one
 * step of the round and the picture is smooth however slowly the machine draws (SwiftShader takes
 * most of a second a frame). The server is answered here: the hold is a record built with
 * `holdrules.js`, fully found through the shipyard's own `maximumLoadout`, and a voyage is started on
 * a seed this tool chose, so no Postgres and no game server are needed.
 *
 * THE CAPTAIN IS THE ENGINE'S OWN AI. `SternchaseIso.jsx` consults `window.__sternchaseHelm` before
 * reading her controls, and this tool defines it: a helm that steers her the way `stepAI` steers a
 * rival, written to touch nothing in the world and roll no dice, so the round is the same round when
 * sailed here in Node without a screen. That is how the shot is chosen: each round is sailed first
 * in Node under the same helm, scored for the guns that go off in view of her, and the best window
 * is the one the browser then sails up to and films. The tool says so if the two part company.
 *
 * Copy is player-facing and follows the rules in CLAUDE.md. Needs ffmpeg on the path, `playwright-core`
 * (a dev dependency) and a Chromium: point SMOKE_CHROME at an executable if Playwright has none.
 * About twenty minutes on a machine without a GPU; `--keep` leaves the frames behind for a look.
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { MARK } from "./mark.mjs";
import * as S from "../src/sim/index.js";
import * as Y from "../src/shipyard.js";
import { blank, applyAction, shipLoadout } from "../src/holdrules.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "promo", "trailer-1080x1920.mp4");
const PORT = Number(process.env.TRAILER_PORT || 4187);
const SITE = `http://127.0.0.1:${PORT}/`;
const KEEP = process.argv.includes("--keep");
const DRY = process.argv.includes("--dry"); // choose the shots in Node and say which, filming nothing
const QUICK = process.argv.includes("--quick"); // a sketch a few seconds long, to check the pipeline
const ME = "p1"; // the player id the screen sails under

// The picture: a phone held upright at three device pixels to the CSS pixel, so 1080 by 1920.
const VW = 360, VH = 640, DPR = 3;
const FPS = 60;
const FRAME_MS = 1000 / FPS + 1e-6; // a hair over a tick, so the bank never comes up a step short

// The cut, in seconds. Each shot runs into the next over `XFADE`, so the shots add up to the length
// plus the overlaps: 32 seconds of shots make the 30-second trailer.
const XFADE = 0.4;
const SHOTS = [
  { key: "open", kind: "play", hull: "thirdRate", secs: 4.4, clean: true, seeds: 10 },
  { key: "title", kind: "card", secs: 2.8 },
  { key: "menu", kind: "menu", secs: 4.4, caption: "Outfit the ship." },
  { key: "big", kind: "play", hull: "firstRate", secs: 9.4, seeds: 10, caption: "Start as an unrated ship, upgrade to a 1st rate." },
  { key: "fast", kind: "play", hull: "baltimoreClipper", secs: 7.4, seeds: 10, caption: "Battle rival captains." },
  { key: "end", kind: "card", secs: 3.6 },
];
if (QUICK) for (const shot of SHOTS) { shot.secs = Math.max(0.8, shot.secs * 0.12); shot.seeds = 2; }

// What a captain sees of the sea around her ship, held upright: the view is a square the width of
// the phone, a broadside's reach either side of her, and the screen above and below it shows more
// (`src/render/view.js`). A gun that goes off outside this is not in the shot.
const VIEW_X = S.WP.broadside.speed * S.WP.broadside.life + 10;
const VIEW_Y = (VH / (VW / (VIEW_X * 2))) / 0.6 / 2 - 30;

/* ---- the helm ---------------------------------------------------------------------------------- */

/**
 * A hand on her controls, built from the engine's own captains: she hunts the prey `pickTarget`
 * would, closes to a broadside's reach, turns beam-on and looses whatever bears, exactly as a rival
 * does. It is written as a function of the world alone: it writes nothing into the world (the AI's
 * island memory is kept here instead of on the ship), draws nothing off the round's dice, and times
 * itself by the tick, so the same seed sailed under it twice is the same round. That is what lets
 * the shot be chosen in Node and filmed in the browser. The stick is rounded here the way
 * `controls.read()` rounds it, so what the screen steps with is what was chosen.
 *
 * Runs in the page as well as here, so it takes the engine as `S` and must stay free of imports.
 */
function makeHelm(S, me) {
  const STEPS = 1024, ANGLE = (2 * Math.PI) / STEPS;
  let tgt = null, retargetAt = -1, avoidIsl = null, avoidSide = 1;
  // `avoidIslands`, with the island she is going round remembered here rather than on the ship
  function clearOfIslands(world, s, desired) {
    if (!world.islands) return desired;
    const clear = s.hullA * 0.76 + S.ISLAND_CLEAR;
    const look = S.ISLAND_LOOK + s.spdCur * S.ISLAND_LOOK_SECS;
    let isl = null, id = 1e9, iTo = 0, iRel = 0;
    for (const o of world.islands) {
      const dx = o.x - s.x, dy = o.y - s.y;
      const d = Math.hypot(dx, dy);
      const R = o.r + clear;
      if (d - R > look) continue;
      const toI = Math.atan2(dy, dx);
      const rel = S.norm(toI - desired);
      const off = Math.abs(rel) > Math.PI / 2 + (d > R ? 0 : S.ISLAND_LEAN);
      if (off || (d > R && Math.abs(Math.sin(rel)) * d > R)) continue;
      if (d < id) { isl = o; id = d; iTo = toI; iRel = rel; }
    }
    if (!isl) { avoidIsl = null; return desired; }
    const R = isl.r + clear;
    if (avoidIsl !== isl) { avoidIsl = isl; avoidSide = iRel > 0 ? -1 : 1; }
    if (id <= R) return iTo + avoidSide * (Math.PI / 2 + S.ISLAND_LEAN);
    return iTo + avoidSide * Math.asin(Math.min(1, R / id));
  }
  return (world) => {
    const inp = { ...S.NO_INPUT };
    const s = S.shipOf(world, me);
    if (!s || !s.alive || world.result.over) return inp;
    if (!tgt || !tgt.alive || world.tick >= retargetAt) { tgt = S.pickTarget(world, s); retargetAt = world.tick + 48; }
    const W = S.WORLD;
    const nearWall = s.x < 140 || s.x > W - 140 || s.y < 140 || s.y > W - 140;
    const toMid = Math.atan2(W / 2 - s.y, W / 2 - s.x);
    let desired, throttle;
    if (!tgt) { desired = toMid; throttle = 0.5; }
    else {
      const dx = tgt.x - s.x, dy = tgt.y - s.y;
      const dist = Math.hypot(dx, dy);
      const toT = Math.atan2(dy, dx);
      const bearing = S.norm(toT - s.heading);
      if (nearWall && dist > 260) { desired = toMid; throttle = 0.7; }
      else if ((tgt.hull < tgt.maxHull * 0.4 || tgt.crew < tgt.maxCrew * 0.4) && dist < 520) { desired = toT; throttle = 1; }
      else if (dist < 150 && Math.abs(bearing) < 0.35) { desired = toT; throttle = 1; }
      else if (dist > S.BEAM_ON) { desired = toT; throttle = 0.9; }
      else { desired = toT - (bearing >= 0 ? 1 : -1) * (Math.PI / 2); throttle = 0.5; }
    }
    ({ desired, throttle } = S.weatherCourse(world, s, desired, throttle));
    desired = clearOfIslands(world, s, desired);
    inp.joyAng = Math.round(S.norm(desired) / ANGLE) * ANGLE + 0;
    inp.joyMag = Math.round(Math.min(1, Math.max(0, throttle)) * STEPS) / STEPS + 0;
    if (world.rules.guns) {
      for (const wk of ["broadside", "bow", "musket"]) inp[wk] = s.cd[wk] <= 0 && S.canFire(s, wk) && !!S.linedUp(world, s, wk, tgt);
    }
    // the carpenter, when she is under half her hull and can pay him
    if (world.rules.repairs && s.hull < s.maxHull * 0.5 && world.tick % 90 === 0) {
      const q = S.repairQuote(world, me, "hull");
      if (q && !q.whole && q.afford >= q.cost) inp.repair = "hull";
    }
    return inp;
  };
}

/* ---- the hold ---------------------------------------------------------------------------------- */

/** A hold with one ship in it, built from a resolved loadout through the shop's own actions, and sailing her. */
function holdWith(loadout) {
  let rec = { ...blank(), coins: 10_000_000 };
  const act = (name, ...args) => {
    const out = applyAction(rec, name, args);
    if (!out) throw new Error(`the hold refused ${name} ${JSON.stringify(args)}`);
    rec = out.rec;
    return out;
  };
  const ship = act("buyShip", loadout.hull.id).ship;
  for (const [socketId, entry] of Object.entries(loadout.rig)) {
    if (!entry.mast) continue;
    act("fitMast", ship, socketId, act("buyPart", entry.mast.id).part);
    entry.sails.forEach((sail, berth) => { if (sail) act("fitSail", ship, socketId, berth, act("buyPart", sail.id).part); });
  }
  for (const mount of ["broadside", "bow", "swivel"]) for (const gun of loadout.guns[mount]) act("fitGun", ship, mount, act("buyPart", gun.id).part);
  act("setActiveShip", ship);
  // an ordinary purse on the menu, not the yard's
  return { ...rec, coins: 4820 };
}

/** The mark, rigged as the icon rigs her, through `resolve` like any ship in the yard. */
function markLoadout() {
  const hull = Y.HULLS[MARK.hull];
  if (!hull) throw new Error(`no hull ${MARK.hull}`);
  const rig = Object.fromEntries(hull.sockets.map((s, i) => [s.id, MARK.rig[i] || null]));
  return Y.resolve({ hull: hull.id, rig, guns: { broadside: Array(hull.guns.broadside).fill(MARK.gun), bow: [], swivel: [] } });
}

/* ---- the shot, chosen in Node ------------------------------------------------------------------ */

/**
 * Sail `secs` of a free-for-all on `seed` under the helm and score every window `len` seconds long
 * by what goes off in view of her: a ship firing counts once a tick while her guns go, so a first
 * rate's rolling broadside weighs what it should, a hit a little, a sinking a lot, and her own
 * fire double. A window she does not live through, with a second to spare, scores nothing.
 */
function sail(seed, loadout, secs, len) {
  const world = S.createWorld({ mode: "ffa", seed, players: [{ id: ME, loadout }] });
  const helm = makeHelm(S, ME);
  const ticks = Math.round(secs * FPS), span = Math.round(len * FPS), spare = FPS;
  const score = new Float64Array(ticks + 1);
  const alive = new Uint8Array(ticks + 1);
  const where = [];
  for (let t = 0; t < ticks; t++) {
    const events = S.step(world, { [ME]: helm(world) });
    const me = S.shipOf(world, ME);
    alive[t] = me.alive && !world.result.over ? 1 : 0;
    where.push({ x: me.x, y: me.y });
    if (!alive[t]) break;
    const inView = (x, y) => Math.abs(x - me.x) < VIEW_X && Math.abs(y - me.y) < VIEW_Y;
    const firing = new Set();
    let v = 0;
    for (const e of events) {
      if (e.type === "fired" && e.weapon === "broadside" && inView(e.x, e.y)) firing.add(e.shipId);
      else if (e.type === "hit" && inView(e.x ?? me.x, e.y ?? me.y)) v += 0.2;
      else if (e.type === "sunk") { const s = world.ships.find((o) => o.id === e.shipId); if (s && inView(s.x, s.y)) v += 40; }
      else if (e.type === "dismasted") v += 10;
    }
    for (const id of firing) v += id === me.id ? 2 : 1;
    score[t] = v;
  }
  // the best window: every tick of it, and the second after, with her afloat
  let best = null;
  let sum = 0;
  for (let t = 0; t < ticks; t++) {
    sum += score[t];
    if (t >= span) sum -= score[t - span];
    const start = t - span + 1;
    if (start < FPS) continue; // not off the drop
    if (t + spare >= ticks || !alive[t + spare]) continue;
    if (!best || sum > best.score) best = { score: sum, start };
  }
  return best ? { seed, start: best.start, score: best.score, at: where[best.start] } : null;
}

/** The seed and the window that make the best shot of this ship, out of `tries` seeds. */
function chooseShot(loadout, secs, tries, first) {
  let best = null;
  for (let i = 0; i < tries; i++) {
    const seed = first + i * 7919; // fixed, so the trailer re-cuts the same unless the game changes
    const shot = sail(seed, loadout, 110, secs);
    if (shot && (!best || shot.score > best.score)) best = shot;
  }
  if (!best) throw new Error("no round gave a shot she lived through");
  return best;
}

/* ---- the server, answered here ----------------------------------------------------------------- */

/**
 * `/api` as the game expects it, for one guest: a session, her hold, a voyage started on the seed the
 * shot wants, and the log taken and forgotten. `state.hold` and `state.seed` are set per shot.
 */
function mockApi(state) {
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  return async (route, req) => {
    const path = new URL(req.url()).pathname.replace(/^\/api/, "");
    const method = req.method();
    if (path === "/auth/get-session") return json(route, 200, { session: { id: "s", userId: "trailer" }, user: { id: "trailer", isAnonymous: true, name: "", email: null } });
    if (path === "/auth/sign-in/anonymous") return json(route, 200, { user: { id: "trailer" } });
    if (path === "/account") return json(route, 200, { guest: true, email: null, google: false, methods: { email: false, google: false } });
    if (path === "/hold") return json(route, 200, { hold: state.hold, version: state.version });
    if (path === "/hold/actions") {
      const body = req.postDataJSON();
      const out = applyAction(state.hold, body.action, body.args);
      if (out) { state.hold = out.rec; state.version++; const { rec, ...extras } = out; return json(route, 200, { ...extras, hold: rec, version: state.version }); }
      return json(route, 422, { hold: state.hold, version: state.version });
    }
    if (path === "/online/where") return json(route, 200, { code: null });
    if (path === "/rounds" && method === "POST") {
      const { mode } = req.postDataJSON();
      const loadout = JSON.parse(JSON.stringify(shipLoadout(state.hold)));
      return json(route, 200, { roundId: randomUUID(), seed: state.seed, loadout, mode });
    }
    if (/^\/rounds\/[0-9a-f-]+\/inputs$/.test(path)) return json(route, 200, { nextTick: 0 });
    if (/^\/rounds\/[0-9a-f-]+\/finish$/.test(path)) return json(route, 200, { hold: state.hold, version: state.version, banked: 0, bounty: 0, rungs: [], result: {} });
    return json(route, 404, { error: "not found" });
  };
}

/* ---- the browser ------------------------------------------------------------------------------- */

if (DRY) {
  for (const shot of SHOTS) {
    if (shot.kind !== "play") continue;
    const t0 = Date.now();
    const chosen = chooseShot(Y.maximumLoadout(shot.hull), shot.secs, shot.seeds, 1000 + SHOTS.indexOf(shot) * 101);
    console.log(`${shot.key}: ${shot.hull} on seed ${chosen.seed} from ${(chosen.start / FPS).toFixed(1)} s, scoring ${chosen.score.toFixed(0)}, chosen in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  process.exit(0);
}

const env = { ...process.env, BASE_PATH: "/" };
const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: root, stdio: "ignore", env, detached: true });
const up = async () => { try { return (await fetch(SITE)).ok; } catch { return false; } };
for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
if (!(await up())) { try { process.kill(-server.pid); } catch { server.kill(); } throw new Error(`nothing answered at ${SITE}`); }

const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const GPU = process.platform === "darwin" ? ["--enable-gpu", "--use-angle=metal"] : ["--enable-unsafe-swiftshader"];
const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROME || undefined, headless: true, args: ["--no-sandbox", ...GPU] });
const work = mkdtempSync(join(tmpdir(), "sternchase-trailer-"));
say("frames in", work);

/** A page of the game on the virtual clock, with the server answered from `state`. */
async function openGame(state) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR });
  await ctx.addInitScript(() => {
    // the clock is the tool's: frames come when `__sternchaseFrame` is called, and nothing else moves
    let now = 0, id = 0, queue = [];
    performance.now = () => now;
    window.requestAnimationFrame = (cb) => { queue.push({ id: ++id, cb }); return id; };
    window.cancelAnimationFrame = (n) => { queue = queue.filter((q) => q.id !== n); };
    window.__sternchaseFrame = (ms) => { now += ms; const run = queue; queue = []; for (const q of run) q.cb(now); return now; };
    // Google's consent tool answering that the GDPR does not apply, and the game's prompt answered
    window.__tcfapi = (cmd, v, cb) => { if (cmd === "addEventListener") cb({ gdprApplies: false, eventStatus: "tcloaded" }, true); };
    if (!localStorage.getItem("sternchase.consent")) localStorage.setItem("sternchase.consent", JSON.stringify({ status: "rejected", analytics: false, advertising: false, functionality: true }));
  });
  await ctx.route(/googlesyndication\.com|googletagmanager\.com|google-analytics\.com|fundingchoicesmessages\.google\.com/, (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
  await ctx.route("**/api/**", mockApi(state));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => say("page error:", e.message));
  await page.goto(SITE, { waitUntil: "networkidle" });
  // the menu, with the hold in and three.js here: a few frames let the plate and the sea settle
  await page.locator("button", { hasText: "FREE-FOR-ALL" }).first().waitFor();
  await page.waitForFunction(() => document.body.innerText.includes("GAME MODES"));
  await page.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(page);
  const frame = (ms = FRAME_MS) => page.evaluate((m) => window.__sternchaseFrame(m), ms);
  for (let i = 0; i < 20; i++) await frame();
  const shoot = async (file) => {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 93 });
    writeFileSync(file, Buffer.from(data, "base64"));
  };
  return { ctx, page, frame, shoot };
}

/** `n` frames of the page as it stands into `dir`, one tick apart. */
async function film(game, dir, n) {
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await game.frame();
    await game.shoot(join(dir, `f${String(i).padStart(5, "0")}.jpg`));
    if (i % 60 === 59) say(`  ${i + 1}/${n} frames, ${((Date.now() - t0) / (i + 1) / 1000).toFixed(2)} s each`);
  }
}

/** A round of free-for-all sailed up to the shot's first tick, under the helm, and filmed from there. */
async function filmRound(shot, state, dir, secs, clean) {
  const game = await openGame(state);
  const { page, frame } = game;
  await page.evaluate(`window.__makeHelm = ${makeHelm.toString()}`);
  await page.evaluate(async (me) => {
    const S = await import("/src/sim/index.js");
    const { TILT } = await import("/src/render/view.js");
    const helm = window.__makeHelm(S, me);
    window.__probe = { calls: 0 };
    window.__sternchaseHelm = (g, controls) => {
      const inp = helm(g);
      const c = controls.input;
      c.joyMag = inp.joyMag; c.joyAng = inp.joyAng; c.broadside = inp.broadside; c.bow = inp.bow; c.musket = inp.musket;
      if (inp.repair) controls.ask(inp.repair);
      // the knob follows the hand on it, the way a thumb would move it
      const knob = controls.knobRef.current;
      if (knob) {
        const R = (knob.parentElement ? knob.parentElement.getBoundingClientRect().width / 2 : 60) - 22;
        knob.style.transform = `translate(${Math.cos(inp.joyAng) * R * inp.joyMag}px, ${Math.sin(inp.joyAng) * TILT * R * inp.joyMag}px)`;
      }
      const s = S.shipOf(g, me);
      window.__probe = { calls: window.__probe.calls + 1, tick: g.tick, x: s.x, y: s.y, alive: s.alive, over: g.result.over };
    };
  }, ME);
  await page.locator("button", { hasText: "FREE-FOR-ALL" }).first().click();
  // the voyage is asked of the (answered) server, then the loop steps: frames until the helm is consulted
  for (let i = 0; i < 200 && !(await page.evaluate(() => window.__probe.calls > 0)); i++) { await page.waitForTimeout(50); await frame(); }
  if (!(await page.evaluate(() => window.__probe.calls > 0))) throw new Error("the round never started");
  if (clean) await page.addStyleTag({ content: "canvas ~ * { visibility: hidden !important; }" });
  // up to the shot, five steps a frame (the most the loop takes), then a step at a time to the tick
  const tick = () => page.evaluate(() => window.__probe.tick);
  while ((await tick()) < shot.start - 5) await frame(FRAME_MS * 5);
  while ((await tick()) < shot.start) await frame();
  const probe = await page.evaluate(() => window.__probe);
  const off = Math.hypot(probe.x - shot.at.x, probe.y - shot.at.y);
  if (probe.tick !== shot.start || off > 1e-6) say(`  WARNING: the browser's round parted from Node's at tick ${probe.tick} (${off.toFixed(3)} off)`);
  else say(`  the browser's round agrees with Node's at tick ${probe.tick}`);
  await film(game, dir, Math.round(secs * FPS));
  await game.ctx.close();
}

/* ---- the cards, drawn in the page -------------------------------------------------------------- */

/** The title card, the end card and a caption, drawn on a canvas the size of the picture, as PNG. */
async function card(page, kind, text) {
  const url = await page.evaluate(({ kind, text, W, H }) => {
    const DISPLAY = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
    const UI = '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
    const GOLD = "#e8c877", INK = "rgba(238,244,242,0.86)", DIM = "rgba(238,244,242,0.62)";
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    const fit = (str, x, y, size, font, color, maxW, spacing = 0) => {
      let px = size;
      const set = () => { ctx.font = `${px}px ${font}`; ctx.letterSpacing = `${spacing * px}px`; };
      set();
      while (ctx.measureText(str).width > maxW && px > 6) { px -= 1; set(); }
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = color;
      ctx.fillText(str, x, y);
      ctx.letterSpacing = "0px";
      return px;
    };
    if (kind === "caption") {
      // a line over a soft dark band, placed in the open water between the counters and the stick
      const size = W * 0.052;
      ctx.font = `600 ${size}px ${UI}`;
      const tw = Math.min(W * 0.9, ctx.measureText(text).width + size * 1.6);
      const y = H * 0.29;
      ctx.fillStyle = "rgba(6,30,29,0.62)";
      ctx.beginPath(); ctx.roundRect(W / 2 - tw / 2, y - size * 0.95, tw, size * 1.5, 20); ctx.fill();
      fit(text, W / 2, y + size * 0.12, size, `600 ${UI}`, "#f3efe2", W * 0.86);
      return c.toDataURL("image/png");
    }
    // the menu's ground, dark water lit in the middle, with the sea's wave marks over it
    const g = ctx.createRadialGradient(W / 2, H * 0.5, H * 0.05, W / 2, H * 0.5, H * 0.75);
    g.addColorStop(0, "#1b6560"); g.addColorStop(0.55, "#0f3f3c"); g.addColorStop(1, "#082826");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const k = W * 0.012;
    ctx.strokeStyle = "rgba(160,220,210,0.10)"; ctx.lineWidth = k * 0.28; ctx.lineCap = "round";
    for (let i = 0; i < 46; i++) {
      const x = rnd() * W, y = rnd() * H;
      ctx.beginPath(); ctx.moveTo(x - k, y); ctx.lineTo(x - k / 2, y - k * 0.45); ctx.lineTo(x, y); ctx.lineTo(x + k / 2, y - k * 0.45); ctx.lineTo(x + k, y); ctx.stroke();
    }
    const tw = W * 0.86;
    if (kind === "title") {
      const big = fit("STERNCHASE", W / 2, H * 0.47, W * 0.15, DISPLAY, GOLD, tw, 0.04);
      fit("HELM & HULL", W / 2, H * 0.47 + big * 0.78, big * 0.42, DISPLAY, INK, tw, 0.12);
    } else {
      const big = fit("STERNCHASE", W / 2, H * 0.36, W * 0.15, DISPLAY, GOLD, tw, 0.04);
      fit("HELM & HULL", W / 2, H * 0.36 + big * 0.78, big * 0.42, DISPLAY, INK, tw, 0.12);
      const unit = W * 0.05;
      fit("Outfit the ship. Battle rival captains.", W / 2, H * 0.36 + big * 1.9, unit, UI, INK, tw);
      // the button, as the art draws it
      const h = unit * 1.9, label = "Play free in your browser";
      ctx.font = `600 ${Math.round(h * 0.46)}px ${UI}`;
      const bw = Math.min(tw, ctx.measureText(label).width + h * 1.1);
      const by = H * 0.36 + big * 2.9;
      ctx.fillStyle = GOLD;
      ctx.beginPath(); ctx.roundRect(W / 2 - bw / 2, by - h / 2, bw, h, 20); ctx.fill();
      ctx.textBaseline = "middle";
      fit(label, W / 2, by + h * 0.03, Math.round(h * 0.46), `600 ${UI}`, "#10302e", bw - h * 0.6);
      ctx.textBaseline = "alphabetic";
      fit("sternchase.org", W / 2, by + h * 1.3, unit * 0.9, UI, DIM, tw);
    }
    return c.toDataURL("image/png");
  }, { kind, text, W: VW * DPR, H: VH * DPR });
  return Buffer.from(url.split(",")[1], "base64");
}

/* ---- the cut ----------------------------------------------------------------------------------- */

try {
  const dirs = {};
  const cards = {};
  // the cards and captions first, off any page of the game
  {
    const state = { hold: holdWith(markLoadout()), version: 1, seed: 1 };
    const game = await openGame(state);
    for (const shot of SHOTS) {
      if (shot.kind === "card") { cards[shot.key] = join(work, `${shot.key}.png`); writeFileSync(cards[shot.key], await card(game.page, shot.key)); }
      if (shot.caption) { cards[`${shot.key}-caption`] = join(work, `${shot.key}-caption.png`); writeFileSync(cards[`${shot.key}-caption`], await card(game.page, "caption", shot.caption)); }
    }
    // the menu: the mark on her plate, turning
    const menu = SHOTS.find((s) => s.kind === "menu");
    say("filming the menu");
    dirs.menu = join(work, "menu");
    await film(game, dirs.menu, Math.round(menu.secs * FPS));
    await game.ctx.close();
  }
  for (const shot of SHOTS) {
    if (shot.kind !== "play") continue;
    const loadout = Y.maximumLoadout(shot.hull);
    say(`choosing the ${shot.hull} shot over ${shot.seeds} seeds`);
    // each shot its own seeds, so no two are fought on the same sea
    const chosen = chooseShot(loadout, shot.secs, shot.seeds, 1000 + SHOTS.indexOf(shot) * 101);
    say(`  seed ${chosen.seed}, from ${(chosen.start / FPS).toFixed(1)} s, scoring ${chosen.score.toFixed(0)}`);
    const state = { hold: holdWith(loadout), version: 1, seed: chosen.seed };
    dirs[shot.key] = join(work, shot.key);
    say(`filming the ${shot.hull}`);
    await filmRound(chosen, state, dirs[shot.key], shot.secs, !!shot.clean);
  }

  // ffmpeg: each shot in turn, run into the next; the captions laid over the water with a fade
  say("encoding");
  const inputs = [], filters = [];
  let n = 0;
  const seq = (dir) => { inputs.push("-framerate", String(FPS), "-i", join(dir, "f%05d.jpg")); return n++; };
  const still = (file, secs) => { inputs.push("-loop", "1", "-framerate", String(FPS), "-t", String(secs), "-i", file); return n++; };
  const streams = SHOTS.map((shot) => (shot.kind === "card" ? still(cards[shot.key], shot.secs) : seq(dirs[shot.key])));
  let last = `[${streams[0]}:v]`, at = SHOTS[0].secs, startsAt = [0];
  for (let i = 1; i < SHOTS.length; i++) {
    const offset = at - XFADE;
    const out = i === SHOTS.length - 1 ? "[cut]" : `[x${i}]`;
    const kind = SHOTS[i].kind === "card" || SHOTS[i - 1].kind === "card" ? "fade" : "fadeblack";
    filters.push(`${last}[${streams[i]}:v]xfade=transition=${kind}:duration=${XFADE}:offset=${offset.toFixed(3)}${out}`);
    startsAt.push(offset);
    last = out;
    at = offset + SHOTS[i].secs;
  }
  const total = at;
  // each caption fades in after its shot has arrived and out before it goes
  let over = "[cut]";
  SHOTS.forEach((shot, i) => {
    if (!shot.caption) return;
    const from = startsAt[i] + XFADE + 0.5, to = startsAt[i] + shot.secs - XFADE - 0.5;
    const c = still(cards[`${shot.key}-caption`], total);
    filters.push(`[${c}:v]format=rgba,fade=t=in:st=${from.toFixed(2)}:d=0.35:alpha=1,fade=t=out:st=${(to - 0.35).toFixed(2)}:d=0.35:alpha=1[c${i}]`);
    filters.push(`${over}[c${i}]overlay=enable='between(t,${from.toFixed(2)},${to.toFixed(2)})'[o${i}]`);
    over = `[o${i}]`;
  });
  filters.push(`${over}format=yuv420p[v]`);
  const graph = filters.join(";");
  // a silent track, because some uploaders refuse a video with no audio stream at all
  const args = [
    "-y", ...inputs, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
    "-filter_complex", graph, "-map", "[v]", "-map", `${n}:a`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-r", String(FPS), "-t", total.toFixed(3),
    "-c:a", "aac", "-b:a", "48k", "-movflags", "+faststart", OUT,
  ];
  const ff = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (ff.status !== 0) throw new Error(`ffmpeg failed:\n${ff.stderr.slice(-3000)}`);
  say(`wrote promo/${OUT.split("/").pop()} (${total.toFixed(1)} s)`);
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { server.kill(); }
  if (!KEEP) rmSync(work, { recursive: true, force: true });
  else say(`frames kept in ${work}`);
}

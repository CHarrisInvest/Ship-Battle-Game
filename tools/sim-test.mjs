/**
 * THE HEADLESS ROUND TEST — `npm run sim-test`
 *
 * Plays every mode to its end in plain Node, through the engine's own interface and nothing else:
 * no browser, no canvas, no React. It is the proof that `src/sim/` is an engine a server could run,
 * and a regression net for the rules a round is played by. Each mode is sailed twice over, once
 * with her hands off everything and once with the stick held hard over, every gun firing and a
 * repair asked for every few seconds, in the starter's gundalow and again in the fully found first
 * rate at the top of the ladder, which is the heaviest broadside the fleet can put in the air.
 *
 * It fails if:
 *
 *   a round never ends;
 *   a ship's position, heading, speed or bars become anything but a number;
 *   the same seed and the same inputs, sailed twice, end in a different `world.result` or a
 *   different final world;
 *   the world stops being plain data, which is what `structuredClone` proves, since it refuses
 *   functions and anything from the page;
 *   an event carries anything but ids, numbers and words, which is what a JSON round trip proves;
 *   a voyage's figures do not add up, or the round's end is said other than exactly once;
 *   a repair asked for through the input record does not charge for what it puts back.
 *
 * * Under ten seconds.
 */

import { createWorld, step, voyageStats, repairQuote, shipOf, NO_INPUT, TICK } from "../src/sim/index.js";
import { STARTER, resolve, ladder } from "../src/shipyard.js";

// Seconds of round before a round that has not ended is a failure. An hour, because the ladder is
// the longest round in the game and a fully found first rate can take twenty minutes to climb
// part of it, and a round in Node costs about a second for every twenty minutes of it.
const LIMIT = 3600;
const MODES = ["ffa", "derby", "wave", "ladder"];
const failures = [];
const fail = (what) => { failures.push(what); console.log("  FAIL  " + what); };
const ok = (what) => console.log("  ok    " + what);

const SHIPS = {
  gundalow: resolve(STARTER),
  "first rate": ladder()[ladder().length - 1].loadout,
};

/** The scripted captain: hands off, or hard over with every gun going and a repair now and then. */
const idle = () => NO_INPUT;
const drive = (tick) => ({
  joyMag: 1, joyAng: -0.8, broadside: true, bow: true, musket: true,
  repair: tick % 160 === 0 ? (tick % 320 === 0 ? "hull" : "mast") : null,
});

/**
 * A world written out in full, the same way every time it is written: a ship or anything else met
 * a second time is written as a reference to where it was first met, and a Map as its entries. Two
 * worlds that write out the same are the same world down to the last bit of every float.
 */
function dump(value) {
  const seen = new Map();
  const walk = (v, path) => {
    if (v === null || typeof v !== "object") return typeof v === "number" && !Number.isFinite(v) ? String(v) : v;
    if (seen.has(v)) return { ref: seen.get(v) };
    seen.set(v, path);
    if (v instanceof Map) return { map: [...v.entries()].map(([k, x], i) => [walk(k, `${path}.k${i}`), walk(x, `${path}.v${i}`)]) };
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`));
    const out = {};
    for (const k of Object.keys(v)) out[k] = walk(v[k], `${path}.${k}`);
    return out;
  };
  return JSON.stringify(walk(value, "$"));
}

const FIGURES = ["x", "y", "heading", "spdCur", "hull", "mast", "crew", "px", "py"];

function sail(mode, seed, loadout, script) {
  const world = createWorld({ mode, seed, players: [{ id: "p1", loadout }] });
  const counts = {};
  let bad = null, plain = null, overs = 0;
  while (!world.result.over && world.time < LIMIT) {
    const events = step(world, { p1: script(world.tick) });
    for (const e of events) {
      counts[e.type] = (counts[e.type] || 0) + 1;
      if (e.type === "round_over") overs++;
      if (!plain && JSON.stringify(JSON.parse(JSON.stringify(e))) !== JSON.stringify(e)) plain = e.type;
    }
    if (!bad) {
      for (const s of world.ships) {
        const f = FIGURES.find((k) => !Number.isFinite(s[k]));
        if (f) { bad = `ship ${s.id} ${f} is ${s[f]} at ${world.time.toFixed(2)} s`; break; }
      }
    }
  }
  return { world, counts, bad, plain, overs };
}

function round(mode, shipName, script, scriptName) {
  const tag = `${mode} ${shipName} ${scriptName}`;
  const seed = 1 + MODES.indexOf(mode) * 101 + Object.keys(SHIPS).indexOf(shipName) * 7;
  const a = sail(mode, seed, SHIPS[shipName], script);
  const { world } = a;
  if (!world.result.over) { fail(`${tag}: no end after ${LIMIT} s`); return; }
  ok(`${tag}: over at ${world.time.toFixed(1)} s, ${world.result.winners.length ? "won" : `sunk by ${world.result.losers[0].cause}`}`);
  if (a.bad) fail(`${tag}: ${a.bad}`);
  if (a.plain) fail(`${tag}: a ${a.plain} event carries more than ids and numbers`);
  if (a.overs !== 1) fail(`${tag}: the round's end was said ${a.overs} times`);
  try { structuredClone(world); } catch (e) { fail(`${tag}: the world is not plain data (${e.message})`); }
  const v = voyageStats(world, "p1");
  if (v.total !== v.coins + v.timePay + v.winPay) fail(`${tag}: the voyage does not add up (${JSON.stringify(v)})`);
  // the same round again, from the same seed, under the same hands
  const b = sail(mode, seed, SHIPS[shipName], script);
  if (JSON.stringify(b.world.result) !== JSON.stringify(world.result)) fail(`${tag}: the same seed ended differently`);
  else if (dump(b.world) !== dump(world)) fail(`${tag}: the same seed left a different world`);
  else ok(`${tag}: the same seed gives the same round (${world.tick} steps)`);
}

/** A repair asked for through the input record charges for exactly what it puts back. */
function repairs() {
  const world = createWorld({ mode: "wave", seed: 9, players: [{ id: "p1", loadout: SHIPS.gundalow }] });
  const me = shipOf(world, "p1");
  me.hull = me.maxHull * 0.3;
  me.coins = 1000;
  const quote = repairQuote(world, "p1", "hull");
  const before = me.hull;
  const events = step(world, { p1: { ...NO_INPUT, repair: "hull" } });
  const done = events.find((e) => e.type === "repaired");
  if (!done) { fail("repairs: asking for one through the input record did nothing"); return; }
  if (done.coins !== quote.afford || me.coins !== 1000 - quote.afford) fail(`repairs: charged ${done.coins}, quoted ${quote.afford}`);
  else if (Math.abs(me.hull - (before + quote.points)) > 1e-9) fail(`repairs: put back ${me.hull - before}, quoted ${quote.points}`);
  else ok(`repairs: the hull was patched for ${done.coins} coins, as quoted`);
  const again = step(world, { p1: NO_INPUT });
  if (again.some((e) => e.type === "repaired")) fail("repairs: one ask repaired twice");
  // and the mast is all or nothing
  me.mast = 0;
  me.mastDown = true;
  me.coins = 0;
  if (step(world, { p1: { ...NO_INPUT, repair: "mast" } }).some((e) => e.type === "repaired")) fail("repairs: a mast was stepped with an empty purse");
  else ok("repairs: an empty purse buys no mast");
}

const t0 = Date.now();
console.log(`one step is ${(TICK * 1000).toFixed(2)} ms of round`);
for (const mode of MODES) {
  for (const shipName of Object.keys(SHIPS)) {
    round(mode, shipName, idle, "idle");
    round(mode, shipName, drive, "driven");
  }
}
repairs();
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (failures.length) {
  console.log(`\n${failures.length} FAILURE${failures.length === 1 ? "" : "S"}`);
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
console.log("\nThe engine runs without a browser.\n");

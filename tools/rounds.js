/**
 * THE RECORDED ROUNDS — what `npm run determinism` sails in every engine, and `sim-test` in Node.
 *
 * A round the server replays has to come out of the replay exactly as the captain sailed it, in
 * whichever browser she sailed it. This file is the set of rounds that proves it: every mode, in the
 * starter's gundalow and in the fully found first rate, under three pairs of hands (none, the stick
 * held hard over with every gun going, and a stick that wanders the whole compass), and one
 * free-for-all with four captains. Each is fingerprinted every ten seconds of round and once whole
 * at the end, so two engines that part company can say when they did.
 *
 * It runs unchanged in Node and in a browser page, so it imports only the engine, the catalogue and
 * the exact maths, and every file it reaches has to load as a plain ES module.
 */

import { createWorld, step, NO_INPUT, SIDES } from "../src/sim/index.js";
import { STARTER, resolve, ladder } from "../src/shipyard.js";
import * as exact from "../src/exact.js";

// Seconds of round before one that has not ended is given up on. An hour, because the ladder is
// the longest round in the game and a fully found first rate can take twenty minutes to climb
// part of it, and a round in Node costs about a second for every twenty minutes of it.
export const LIMIT = 3600;
export const MODES = ["ffa", "derby", "wave", "ladder", "teams"];
// Ticks between fingerprints: ten seconds of round.
const CHECK = 600;

export const SHIPS = {
  gundalow: resolve(STARTER),
  "first rate": ladder()[ladder().length - 1].loadout,
};

/** The scripted captains: hands off; hard over with every gun going and a repair now and then; adrift on a wandering stick. */
export const idle = () => NO_INPUT;
export const drive = (tick) => ({
  joyMag: 1, joyAng: -0.8, broadside: true, bow: true, musket: true,
  repair: tick % 160 === 0 ? (tick % 320 === 0 ? "hull" : "mast") : null,
});
export const wander = (tick) => ({
  joyMag: 0.5 + 0.5 * exact.cos(tick / 61),
  joyAng: 3 * exact.sin(tick / 97),
  broadside: tick % 240 < 30, bow: tick % 420 < 20, musket: tick % 90 < 10,
  repair: tick % 900 === 450 ? "hull" : null,
});
const HANDS = { idle, driven: drive, wandering: wander };

export const ROUNDS = [
  ...MODES.flatMap((mode) => Object.keys(SHIPS).flatMap((ship) => Object.keys(HANDS).map((hands) => ({ mode, ship, hands, captains: 1 })))),
  { mode: "ffa", ship: "gundalow", hands: "wandering", captains: 4 },
  // two sides, a captain on each, sailed on past the last of them by the AI
  { mode: "teams", ship: "gundalow", hands: "wandering", captains: 2 },
];

/**
 * A world written out in full, the same way every time it is written: a ship or anything else met
 * a second time is written as a reference to where it was first met, and a Map as its entries. Two
 * worlds that write out the same are the same world down to the last bit of every float, because
 * JavaScript writes a number as the shortest text that reads back as exactly that number, and a
 * negative zero, which JSON would write as 0, is written as "-0".
 */
export function dump(value) {
  const seen = new Map();
  const walk = (v, path) => {
    if (v === null || typeof v !== "object") return typeof v === "number" ? number(v) : v;
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

/** A number as `dump` keeps it: as itself, unless JSON would lose it (the infinities, NaN, and the sign of a zero). */
const number = (v) => (Object.is(v, -0) ? "-0" : Number.isFinite(v) ? v : String(v));

/** 32-bit FNV-1a of a string, as eight hex digits. Short enough to print, and any changed bit changes it. */
export function fingerprint(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** One recorded round, sailed to its end: its name, how long it ran, and its fingerprints. */
export function playRound(round, index) {
  // between sides the captains alternate sides, so a round with two has one on each
  const players = Array.from({ length: round.captains }, (_, i) => ({ id: `p${i + 1}`, loadout: SHIPS[round.ship], side: round.mode === "teams" ? SIDES[i % SIDES.length] : null }));
  const world = createWorld({ mode: round.mode, seed: 1000 + index * 37, players });
  const hands = HANDS[round.hands];
  const checkpoints = [];
  while (!world.result.over && world.time < LIMIT) {
    const inputs = {};
    players.forEach((p, i) => { inputs[p.id] = hands(world.tick + i * 211); });
    step(world, inputs);
    if (world.tick % CHECK === 0) checkpoints.push(fingerprint(dump(world.ships)));
  }
  const name = `${round.mode} ${round.ship} ${round.hands}${round.captains > 1 ? `, ${round.captains} captains` : ""}`;
  return { name, ticks: world.tick, checkpoints, final: fingerprint(dump(world)) };
}

/** The exact maths alone, over a fixed stream of inputs, as one fingerprint. */
export function vectors() {
  let s = 7;
  const next = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
  const out = [];
  for (let i = 0; i < 20000; i++) {
    const x = (next() - 0.5) * 2000, y = (next() - 0.5) * 2000, u = next();
    out.push(exact.sin(x), exact.cos(x), exact.atan2(y, x), exact.asin(u * 2 - 1), exact.exp(x / 3),
      exact.log(u * 1e4), exact.pow(u * 9, x / 400), exact.hypot(x, y));
  }
  return fingerprint(out.map(number).join(","));
}

/** Everything `npm run determinism` compares between engines. */
export function playAll() {
  return { vectors: vectors(), rounds: ROUNDS.map(playRound) };
}

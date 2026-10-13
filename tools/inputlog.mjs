/**
 * WHAT AN INPUT LOG WEIGHS — `npm run inputlog`
 *
 * The server will replay a voyage from the inputs the browser recorded, one entry for each tick the
 * input changed. This measures what a 20-minute round's log comes to, gzipped, under three captains:
 * one who holds a course and fires now and then, one who steers all the time, and the worst case,
 * a stick that moves every tick. The stick's angle and magnitude are rounded to 1/1024 of their
 * range first, which is the rounding the spec proposes for `controls.js`.
 */

import { gzipSync } from "node:zlib";

const TICKS = 20 * 60 * 60;
const STEPS = 1024;
const roundTo = (v, range) => Math.round((v / range) * STEPS) * (range / STEPS);

let s = 99;
const next = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;

// Each captain gives the stick and buttons at a tick; the log keeps only the ticks they change.
const CAPTAINS = {
  "holds a course": (t, prev) => ({ joyMag: t % 1800 < 1700 ? 1 : 0.6, joyAng: prev.joyAng + (t % 600 === 0 ? next() - 0.5 : 0), broadside: t % 300 < 6, bow: false, musket: false }),
  "steers all the time": (t, prev) => ({ joyMag: 1, joyAng: prev.joyAng + (t % 4 === 0 ? (next() - 0.5) * 0.05 : 0), broadside: t % 200 < 6, bow: t % 500 < 4, musket: t % 120 < 3 }),
  "moves every tick": (t, prev) => ({ joyMag: next(), joyAng: prev.joyAng + (next() - 0.5) * 0.1, broadside: next() < 0.05, bow: next() < 0.02, musket: next() < 0.05 }),
};

for (const [name, hands] of Object.entries(CAPTAINS)) {
  let prev = { joyMag: 0, joyAng: 0, broadside: false, bow: false, musket: false };
  let last = "";
  const log = [];
  for (let t = 0; t < TICKS; t++) {
    const raw = hands(t, prev);
    prev = raw;
    const input = { ...raw, joyMag: roundTo(Math.min(1, Math.max(0, raw.joyMag)), 1), joyAng: roundTo(raw.joyAng, 2 * Math.PI) };
    const key = JSON.stringify(input);
    if (key !== last) { log.push([t, input]); last = key; }
  }
  const json = JSON.stringify(log);
  const gz = gzipSync(json).length;
  console.log(`${name.padEnd(20)} ${String(log.length).padStart(6)} entries, ${(json.length / 1024).toFixed(0).padStart(5)} KB raw, ${(gz / 1024).toFixed(0).padStart(4)} KB gzipped`);
}

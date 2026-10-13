/**
 * THE CAPTAINS TEST, run by `npm run sim-test` after the single-captain test.
 *
 * Plays free-for-all rounds with several human captains aboard, in plain Node, through the engine's
 * own interface. It is Stage B's proof: a world takes more than one person, places each of them as
 * she sinks, and ends only when nobody is left to play it.
 *
 * It fails if:
 *
 *   captains spawn on top of each other, on an island, or (with a few of them) closer than the gap;
 *   the host's AI count is not the count of AI on the water;
 *   the same seed and the same hands give a different round;
 *   a round with several captains does not end, or a voyage does not add up.
 */

import { createWorld, step, voyageStats, shipOf, isHuman, HUMAN_SPAWN_GAP } from "../src/sim/index.js";
import { STARTER, resolve, ladder } from "../src/shipyard.js";

const LIMIT = 3600;
const failures = [];
const fail = (what) => { failures.push(what); console.log("  FAIL  " + what); };
const ok = (what) => console.log("  ok    " + what);

const GUNDALOW = resolve(STARTER);
const FIRST_RATE = ladder()[ladder().length - 1].loadout;
const captains = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, loadout: i % 2 ? FIRST_RATE : GUNDALOW }));

/** Hands off for everyone, or every other captain hard over with her guns going and the rest left with no input at all. */
const idle = () => ({});
const drive = (world, ids) => {
  const inputs = {};
  ids.forEach((id, i) => {
    if (i % 2 === 0) inputs[id] = { joyMag: 1, joyAng: -0.8 + i, broadside: true, bow: true, musket: true, repair: null };
  });
  return inputs;
};

function sailCaptains(n, seed, script, rivals) {
  const players = captains(n);
  const ids = players.map((p) => p.id);
  const world = createWorld({ mode: "ffa", seed, players, rivals });
  const events = [];
  while (!world.result.over && world.time < LIMIT) {
    for (const e of step(world, script(world, ids))) events.push(e);
  }
  return { world, ids, events };
}

function spawns() {
  if (!(HUMAN_SPAWN_GAP > 0)) fail("spawns: HUMAN_SPAWN_GAP is not exported from the engine");
  for (const n of [2, 4, 8]) {
    const world = createWorld({ mode: "ffa", seed: 40 + n, players: captains(n) });
    const humans = world.ships.filter(isHuman);
    if (humans.length !== n) { fail(`spawns ${n}: ${humans.length} captains on the water`); continue; }
    let closest = Infinity;
    for (let i = 0; i < humans.length; i++)
      for (let j = i + 1; j < humans.length; j++)
        closest = Math.min(closest, Math.hypot(humans[i].x - humans[j].x, humans[i].y - humans[j].y));
    // a few captains always get the whole gap; a full lobby gets the best the sea allows, never a pile-up
    const want = n <= 4 ? HUMAN_SPAWN_GAP : 250;
    if (closest < want) fail(`spawns ${n}: two captains ${closest.toFixed(0)} apart, wanted ${want}`);
    else ok(`spawns ${n}: closest two captains ${closest.toFixed(0)} apart`);
    const aground = humans.find((s) => world.islands.some((isl) => Math.hypot(s.x - isl.x, s.y - isl.y) < isl.r + 55));
    if (aground) fail(`spawns ${n}: ${aground.playerId} starts on an island`);
    for (const id of Object.keys(world.players)) if (!shipOf(world, id)) fail(`spawns ${n}: ${id} has no ship`);
  }
}

function aiCount() {
  for (const rivals of [0, 3, 9]) {
    const world = createWorld({ mode: "ffa", seed: 7, players: captains(2), rivals });
    const ai = world.ships.filter((s) => !isHuman(s)).length;
    if (ai !== rivals) fail(`ai count: asked for ${rivals}, got ${ai}`);
    else ok(`ai count: ${rivals} AI ships as asked`);
  }
  const world = createWorld({ mode: "ffa", seed: 7, players: captains(2) });
  const ai = world.ships.filter((s) => !isHuman(s)).length;
  if (ai !== world.rules.rivals) fail(`ai count: no setting gave ${ai}, the mode says ${world.rules.rivals}`);
  else ok(`ai count: no setting gives the mode's own ${ai}`);
}

function rounds() {
  for (const n of [2, 4, 8]) {
    for (const [scriptName, script] of [["idle", idle], ["driven", drive]]) {
      const tag = `${n} captains ${scriptName}`;
      const seed = 300 + n * 11 + (scriptName === "driven" ? 1 : 0);
      const a = sailCaptains(n, seed, script, 11 - n);
      if (!a.world.result.over) { fail(`${tag}: no end after ${LIMIT} s`); continue; }
      ok(`${tag}: over at ${a.world.time.toFixed(1)} s`);
      try { structuredClone(a.world); } catch (e) { fail(`${tag}: the world is not plain data (${e.message})`); }
      for (const id of a.ids) {
        const v = voyageStats(a.world, id);
        if (v.total !== v.coins + v.timePay + v.winPay) fail(`${tag}: ${id}'s voyage does not add up`);
      }
      const b = sailCaptains(n, seed, script, 11 - n);
      if (JSON.stringify(b.world.result) !== JSON.stringify(a.world.result) || b.world.tick !== a.world.tick)
        fail(`${tag}: the same seed ended differently`);
      else ok(`${tag}: the same seed gives the same round (${a.world.tick} steps)`);
    }
  }
}

const t0 = Date.now();
spawns();
aiCount();
rounds();
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (failures.length) {
  console.log(`\n${failures.length} FAILURE${failures.length === 1 ? "" : "S"}`);
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
console.log("\nA world takes several captains.\n");

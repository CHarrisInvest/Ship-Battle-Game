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

import { createWorld, step, voyageStats, shipOf, isHuman, applyHit, HUMAN_SPAWN_GAP } from "../src/sim/index.js";
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
      standings(tag, a);
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

/** Put a captain under at once, as if the last ball had just landed, with nobody credited. */
const sink = (world, id) => { const s = shipOf(world, id); applyHit(world, s, "hull", s.hull + 1, null, "broadside"); };

function placing() {
  // one captain out while two others fight on: the round goes on, and she is placed at once
  {
    const world = createWorld({ mode: "ffa", seed: 21, players: captains(3), rivals: 2 });
    sink(world, "p1");
    const events = step(world, {});
    const out = events.filter((e) => e.type === "player_out");
    if (world.result.over) fail("placing: one captain sinking ended a round with two still afloat");
    else if (out.length !== 1 || out[0].playerId !== "p1" || out[0].rank !== 5) fail(`placing: wanted p1 out in 5th, got ${JSON.stringify(out)}`);
    else ok("placing: one captain out, 5th of 5, and the round goes on");
    const again = step(world, {});
    if (again.some((e) => e.type === "player_out")) fail("placing: a captain was placed twice");
  }
  // two captains under on one step, and the last ship afloat an AI: they share 2nd and nobody wins
  {
    const world = createWorld({ mode: "ffa", seed: 22, players: captains(2), rivals: 1 });
    sink(world, "p1");
    sink(world, "p2");
    const events = step(world, {});
    const out = events.filter((e) => e.type === "player_out");
    const r = world.result;
    if (!r.over) fail("placing: every captain under and the round goes on");
    else if (out.length !== 2 || out.some((e) => e.rank !== 2)) fail(`placing: wanted both out in 2nd, got ${JSON.stringify(out)}`);
    else if (r.winners.length !== 0 || r.losers.length !== 2) fail(`placing: wanted no winners and two losers, got ${JSON.stringify(r)}`);
    else ok("placing: two under on one step share 2nd, and an AI afloat alone ends it");
    if (events.filter((e) => e.type === "round_over").length !== 1) fail("placing: the end was not said once");
  }
  // the last captain afloat, with every rival gone, wins at 1st
  {
    const world = createWorld({ mode: "ffa", seed: 23, players: captains(2), rivals: 0 });
    sink(world, "p2");
    step(world, {});
    const r = world.result;
    if (!r.over || r.winners.length !== 1 || r.winners[0].playerId !== "p1" || r.winners[0].rank !== 1) fail(`placing: wanted p1 to win, got ${JSON.stringify(r)}`);
    else if (r.losers.length !== 1 || r.losers[0].playerId !== "p2" || r.losers[0].rank !== 2) fail(`placing: wanted p2 2nd, got ${JSON.stringify(r.losers)}`);
    else ok("placing: the last captain afloat wins, the other is 2nd");
  }
}

/** Over a whole round: every captain placed exactly once, in range, and later sinkings never placed lower. */
function standings(tag, a) {
  const r = a.world.result;
  const placed = [...r.winners, ...r.losers].map((x) => x.playerId).sort();
  if (JSON.stringify(placed) !== JSON.stringify([...a.ids].sort())) fail(`${tag}: placed ${placed.join(",")}, aboard ${a.ids.join(",")}`);
  const ranks = [...r.winners, ...r.losers].map((x) => x.rank);
  if (ranks.some((k) => k < 1 || k > r.field)) fail(`${tag}: a rank out of 1..${r.field}: ${ranks.join(",")}`);
  const outs = a.events.filter((e) => e.type === "player_out");
  if (outs.length !== r.losers.length) fail(`${tag}: ${outs.length} player_out events for ${r.losers.length} losers`);
  for (let i = 1; i < outs.length; i++) if (outs[i].rank > outs[i - 1].rank) fail(`${tag}: ${outs[i].playerId} sank later and was placed lower`);
  const standing = a.world.ships.filter((s) => s.alive).length;
  if (r.winners.length && standing !== 1) fail(`${tag}: won with ${standing} ships still afloat`);
  for (const w of r.winners) if (!shipOf(a.world, w.playerId).alive) fail(`${tag}: ${w.playerId} won from the bottom`);
}

/**
 * "Worn down" is judged on what the captain who sank her did, not on what everyone did. Before
 * Stage B there was one human and one tally, so another captain's work counted as hers.
 */
function credit() {
  const wear = (world, t, who) => {
    for (const bar of ["hull", "mast", "crew"]) applyHit(world, t, bar, t["max" + bar[0].toUpperCase() + bar.slice(1)] * 0.6, who, "broadside");
  };
  {
    const world = createWorld({ mode: "ffa", seed: 31, players: captains(2), rivals: 1 });
    const t = world.ships.find((s) => !isHuman(s));
    const p1 = shipOf(world, "p1");
    wear(world, t, p1);
    applyHit(world, t, "hull", t.hull + 1, p1, "broadside");
    if (p1.wornDown !== 1) fail(`credit: p1 wore her down herself and was credited ${p1.wornDown}`);
    else ok("credit: a captain who wore her down herself is credited");
  }
  {
    const world = createWorld({ mode: "ffa", seed: 31, players: captains(2), rivals: 1 });
    const t = world.ships.find((s) => !isHuman(s));
    const p1 = shipOf(world, "p1"), p2 = shipOf(world, "p2");
    wear(world, t, p2);
    applyHit(world, t, "hull", t.hull + 1, p1, "broadside");
    if (p1.wornDown !== 0) fail("credit: p1 was credited with wearing her down on p2's work");
    else if (p2.wornDown !== 0) fail("credit: p2 was credited for a ship p1 sank");
    else ok("credit: one captain's work is not another's");
  }
}

/** The AI dropped around a full lobby keep off the captains and off the beaches, whatever the seed. */
function rivalSpawns() {
  let closest = Infinity, aground = 0;
  for (let seed = 1; seed <= 40; seed++) {
    for (const mode of ["ffa", "derby"]) {
      const world = createWorld({ mode, seed, players: captains(8), rivals: 3 });
      const humans = world.ships.filter(isHuman);
      for (const s of world.ships.filter((x) => !isHuman(x))) {
        for (const h of humans) closest = Math.min(closest, Math.hypot(s.x - h.x, s.y - h.y));
        if (world.islands.some((isl) => Math.hypot(s.x - isl.x, s.y - isl.y) < isl.r + 55)) aground++;
      }
    }
  }
  if (closest < 200) fail(`rival spawns: an AI dropped ${closest.toFixed(0)} from a captain in a full lobby`);
  else ok(`rival spawns: the nearest AI to a captain in a full lobby is ${closest.toFixed(0)} away`);
  if (aground) fail(`rival spawns: ${aground} AI dropped on an island`);
}

/** A captain who sinks early is paid for the time she was afloat, not for the round's. */
function timePay() {
  const world = createWorld({ mode: "derby", seed: 5, players: captains(3), rivals: 4 });
  for (let i = 0; i < 600; i++) step(world, {});
  sink(world, "p1");
  step(world, {});
  const at = voyageStats(world, "p1");
  while (!world.result.over && world.time < LIMIT) step(world, {});
  const end = voyageStats(world, "p1");
  if (end.time !== at.time || end.timePay !== at.timePay) fail(`time pay: p1 sank at ${at.time.toFixed(1)} s and was paid for ${end.time.toFixed(1)} s`);
  else ok(`time pay: p1 is paid for her ${at.time.toFixed(1)} s afloat, however long the round ran`);
}

const t0 = Date.now();
spawns();
aiCount();
placing();
credit();
rivalSpawns();
timePay();
rounds();
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (failures.length) {
  console.log(`\n${failures.length} FAILURE${failures.length === 1 ? "" : "S"}`);
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
console.log("\nA world takes several captains.\n");

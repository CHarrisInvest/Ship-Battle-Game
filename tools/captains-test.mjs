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

import { createWorld, step, voyageStats, shipOf, isHuman, applyHit, playOn, HUMAN_SPAWN_GAP, SIDES, SIDE_MAX, WORLD, BROADSIDE_REACH, stepRam, hostile, canHit } from "../src/sim/index.js";
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

/**
 * Watching on: a captain who has sunk can watch the rest of the round. Her own round is over and
 * banked as it stood; `playOn` hands back a copy that sails on without her until one ship or none
 * is left, and leaves the round she was banked on exactly as it was.
 */
function watching() {
  const world = createWorld({ mode: "ffa", seed: 8, players: captains(1) });
  for (let i = 0; i < 300; i++) step(world, {});
  sink(world, "p1");
  step(world, {});
  if (!world.result.over) return fail("watching: her sinking did not end her own round");
  const banked = JSON.stringify(world.result), tick = world.tick;
  const w = playOn(world);
  if (!w) return fail("watching: playOn gave nothing for a free-for-all with rivals still afloat");
  if (w.result.over) fail("watching: the round to watch starts over");
  let ends = 0, outs = 0;
  while (!w.result.over && w.time < LIMIT) {
    for (const e of step(w, {})) { if (e.type === "round_over") ends++; if (e.type === "player_out") outs++; }
  }
  const standing = w.ships.filter((s) => s.alive).length;
  if (!w.result.over) fail(`watching: the watched round ran past ${LIMIT} s`);
  else if (standing > 1) fail(`watching: the watched round ended with ${standing} ships afloat`);
  else if (ends !== 1) fail(`watching: round_over said ${ends} times`);
  else if (outs) fail("watching: she was placed again while being watched");
  else if (w.result.winners.length || JSON.stringify(w.result.losers) !== JSON.stringify(world.result.losers)) fail("watching: the watched round changed who won or lost");
  else if (standing === 1 && w.result.lastShip !== w.ships.find((s) => s.alive).id) fail("watching: the result does not name the last ship afloat");
  else ok(`watching: the round sailed on ${(w.time - world.time).toFixed(1)} s without her, to ${standing} afloat`);
  if (world.tick !== tick || JSON.stringify(world.result) !== banked) fail("watching: playOn changed the round she was banked on");
  // nothing to watch: an arena hunts only her, and a round already down to one ship is settled
  const arena = createWorld({ mode: "wave", seed: 3, players: captains(1) });
  sink(arena, "p1");
  step(arena, {});
  if (playOn(arena)) fail("watching: an arena with nobody left to hunt offered a round to watch");
  if (playOn(createWorld({ mode: "ffa", seed: 3, players: captains(1) }))) fail("watching: a round still being sailed offered a copy to watch");
  else ok("watching: offered only once she is out of a round others are still fighting");
}

/**
 * TWO SIDES: the lobby's captains each on a side, the AI filling each side to the host's figure,
 * the two lines drawn up on opposite flanks out of each other's reach, a side's guns unable to
 * touch her own ships while her bow still can (for nothing), the round going to the side with a
 * ship afloat once the other has none, every captain of it a winner, those afloat paid more than
 * those sunk, and the round sailed on by the AI past the last captain rather than ending with her.
 */
function sides() {
  const teams = (n) => captains(n).map((p, i) => ({ ...p, side: SIDES[i % 2] }));
  // the field: four a side asked for, two captains on the left and one on the right
  {
    const world = createWorld({ mode: "teams", seed: 51, players: [{ ...captains(3)[0], side: "left" }, { ...captains(3)[1], side: "left" }, { ...captains(3)[2], side: "right" }], rivals: 4 });
    const on = (side) => world.ships.filter((s) => s.side === side);
    if (on("left").length !== 4 || on("right").length !== 4) fail(`sides: asked for 4 a side, got ${on("left").length} and ${on("right").length}`);
    else if (on("left").filter(isHuman).length !== 2 || on("right").filter(isHuman).length !== 1) fail("sides: a captain is on the wrong side");
    else ok("sides: 4 a side, the captains on the sides they picked and the AI filling the rest");
    if (world.ships.some((s) => !SIDES.includes(s.side))) fail("sides: a ship with no side");
    // the lines: every ship of the left well left of the middle, every ship of the right well right,
    // and the nearest pair across the sea out of broadside reach
    const left = on("left"), right = on("right");
    if (left.some((s) => s.x > WORLD / 3) || right.some((s) => s.x < (2 * WORLD) / 3)) fail("sides: a ship is drawn up on the wrong flank");
    let gap = Infinity;
    for (const a of left) for (const b of right) gap = Math.min(gap, Math.hypot(a.x - b.x, a.y - b.y));
    if (gap < BROADSIDE_REACH * 3) fail(`sides: the lines open ${gap.toFixed(0)} apart, inside gun range`);
    else ok(`sides: the lines open ${gap.toFixed(0)} apart, bows to the enemy`);
    if (left.some((s) => Math.abs(s.heading) > 0.01) || right.some((s) => Math.abs(s.heading - Math.PI) > 0.01)) fail("sides: a ship does not face the enemy");
    const aground = world.ships.find((s) => world.islands.some((isl) => Math.hypot(s.x - isl.x, s.y - isl.y) < isl.r + 55));
    if (aground) fail("sides: a ship is drawn up on an island");
    // more captains on a side than the figure: they all sail, and the other side is filled to match
    const crowd = createWorld({ mode: "teams", seed: 52, players: Array.from({ length: 5 }, (_, i) => ({ ...captains(5)[i], side: "right" })), rivals: 3 });
    const cr = crowd.ships.filter((s) => s.side === "right"), cl = crowd.ships.filter((s) => s.side === "left");
    if (cr.length !== 5 || cr.filter(isHuman).length !== 5 || cl.length !== 5 || cl.some(isHuman)) fail(`sides: 5 captains on one side asking for 3 gave ${cr.length} and ${cl.length}`);
    else ok("sides: 5 captains on one side all sail, and the other side is 5 AI");
    // the sides' ceiling is the sea's: a full lobby at the most a side takes still fits
    const full = createWorld({ mode: "teams", seed: 53, players: teams(8), rivals: SIDE_MAX });
    if (full.ships.length !== 2 * SIDE_MAX) fail(`sides: ${SIDE_MAX} a side gave ${full.ships.length} ships`);
    else ok(`sides: ${SIDE_MAX} a side is ${full.ships.length} ships, 8 of them captains`);
    // a captain who names no side sails on the left
    const none = createWorld({ mode: "teams", seed: 54, players: captains(1), rivals: 3 });
    if (shipOf(none, "p1").side !== SIDES[0]) fail("sides: a captain with no side was not put on the left");
  }
  // who may hurt whom: an enemy's ball bites and a consort's passes through; a consort's bow lands
  // and pays nothing
  {
    const world = createWorld({ mode: "teams", seed: 55, players: teams(2), rivals: 3 });
    const p1 = shipOf(world, "p1"), p2 = shipOf(world, "p2");
    const friend = world.ships.find((s) => !isHuman(s) && s.side === p1.side);
    const foe = world.ships.find((s) => s.side !== p1.side);
    if (hostile(world, p1, friend) || !hostile(world, p1, foe) || !hostile(world, p1, p2)) fail("sides: hostile reads the sides wrong");
    if (canHit(world, p1, friend) || !canHit(world, p1, foe)) fail("sides: a captain's guns can touch her own side, or not the other");
    else ok("sides: her guns bear on the other side alone");
    // a ball laid straight through a consort at an enemy behind her: the consort is untouched
    world.shots.length = 0;
    friend.x = p1.x + 60; friend.y = p1.y; friend.heading = Math.PI / 2;
    foe.x = p1.x + 160; foe.y = p1.y; foe.heading = Math.PI / 2;
    world.shots.push({ x: p1.x + 20, y: p1.y, vx: 250, vy: 0, life: 0.88, r: 3.6, bar: "hull", dmg: 10, owner: p1, kind: "broadside" });
    const fh = friend.hull, eh = foe.hull;
    let hits = [];
    for (let i = 0; i < 60 && world.shots.length; i++) for (const e of step(world, {})) if (e.type === "hit") hits.push(e);
    if (friend.hull !== fh) fail("sides: a captain's ball struck her own consort");
    else if (!(foe.hull < eh)) fail("sides: the ball through her consort did not find the enemy behind");
    else ok("sides: a ball passes through a consort and finds the enemy behind her");
    // two consorts meeting bow to beam at speed: the blow lands, and nobody is paid or counted
    const w2 = createWorld({ mode: "teams", seed: 56, players: teams(2), rivals: 3 });
    const a = shipOf(w2, "p1"), b = w2.ships.find((s) => !isHuman(s) && s.side === a.side);
    b.x = a.x + 70; b.y = a.y; b.heading = Math.PI / 2;
    // her bow right on the consort's keel, driving in at a fresh ship's top speed
    a.heading = 0; a.spdCur = 90; a.way = 90; a.vx = 90; a.vy = 0; a.x = b.x - a.hullA + 2;
    const bh = b.hull, coins = a.coins, rams = a.rams;
    stepRam(w2, 1 / 60);
    if (!(b.hull < bh)) fail("sides: a ram on a consort did no damage");
    else if (a.coins !== coins || a.earned !== 0 || a.rams !== rams || a.dmgDealt) fail(`sides: a ram on a consort paid (${a.coins - coins} coins, ${a.rams - rams} rams, ${a.dmgDealt} dealt)`);
    else ok(`sides: a ram on a consort takes ${(bh - b.hull).toFixed(0)} of her hull and pays nothing`);
  }
  // the end: a side wiped ends it for the other, sunk captains of the winning side win too, the
  // afloat are paid more, and nothing ends while both sides have a ship
  {
    const world = createWorld({ mode: "teams", seed: 57, players: [...teams(2), { ...captains(3)[2], side: "left" }], rivals: 3 });
    // p1 (left) sinks: the round goes on, and she is not placed
    sink(world, "p1");
    let events = step(world, {});
    const out = events.find((e) => e.type === "player_out");
    if (world.result.over) fail("sides: one captain sinking ended the round");
    else if (!out || out.playerId !== "p1" || out.rank !== 0) fail(`sides: wanted p1 out unplaced, got ${JSON.stringify(out)}`);
    else ok("sides: a captain out of a side is told, unplaced, and the round goes on");
    // every captain under, both sides still with AI afloat: the round goes on without them
    sink(world, "p2"); sink(world, "p3");
    step(world, {});
    if (world.result.over) fail("sides: the round ended with the last captain while both sides still had ships");
    else ok("sides: the round sails on past the last captain while both sides have ships");
    // the right side wiped: the left wins, p1 and p3 both, p3 sunk later than p1, nobody afloat
    for (const s of world.ships.filter((x) => x.side === "right" && x.alive)) applyHit(world, s, "hull", s.hull + 1, null, "broadside");
    events = step(world, {});
    const r = world.result;
    const ids = (xs) => xs.map((x) => x.playerId).sort().join(",");
    if (!r.over || r.side !== "left") fail(`sides: wanted the left to win, got ${JSON.stringify(r)}`);
    else if (ids(r.winners) !== "p1,p3" || ids(r.losers) !== "p2") fail(`sides: wanted p1 and p3 winning and p2 losing, got ${JSON.stringify(r)}`);
    else if (r.winners.some((w) => !w.cause)) fail("sides: a sunk winner does not carry how she went down");
    else ok("sides: the side with a ship afloat wins, and every captain of it with her, sunk or not");
    if (events.filter((e) => e.type === "round_over").length !== 1) fail("sides: the end was not said once");
    const v1 = voyageStats(world, "p1"), v2 = voyageStats(world, "p2");
    if (!(v1.winPay > 0) || v2.winPay !== 0) fail(`sides: a sunk winner paid ${v1.winPay}, a loser ${v2.winPay}`);
    // ...and a winner still afloat is paid more than one who went under
    const w2 = createWorld({ mode: "teams", seed: 58, players: teams(2), rivals: 3 });
    for (const s of w2.ships.filter((x) => x.side === "right")) applyHit(w2, s, "hull", s.hull + 1, null, "broadside");
    step(w2, {});
    const afloat = voyageStats(w2, "p1");
    if (!w2.result.over || w2.result.side !== "left") fail("sides: wiping the right did not give the left the round");
    else if (!(afloat.winPay > v1.winPay)) fail(`sides: a winner afloat is paid ${afloat.winPay}, one sunk ${v1.winPay}`);
    else ok(`sides: a winner afloat is paid ${afloat.winPay}, one who went under ${v1.winPay}`);
    // both sides wiped on one step: nobody wins
    const w3 = createWorld({ mode: "teams", seed: 59, players: teams(2), rivals: 3 });
    for (const s of [...w3.ships]) applyHit(w3, s, "hull", s.hull + 1, null, "broadside");
    step(w3, {});
    if (!w3.result.over || w3.result.side !== null || w3.result.winners.length) fail(`sides: both sides under together should win nobody the round, got ${JSON.stringify(w3.result)}`);
    else ok("sides: both sides under together is a round nobody won");
  }
  // whole rounds: they end, the same seed gives the same round, and nobody is placed
  for (const n of [2, 5]) {
    const players = teams(n);
    const sail = () => {
      const world = createWorld({ mode: "teams", seed: 400 + n, players, rivals: 4 });
      const events = [];
      while (!world.result.over && world.time < LIMIT) for (const e of step(world, drive(world, players.map((p) => p.id)))) events.push(e);
      return { world, events };
    };
    const a = sail(), b = sail();
    const tag = `${n} captains on sides`;
    if (!a.world.result.over) { fail(`${tag}: no end after ${LIMIT} s`); continue; }
    const standing = SIDES.map((s) => a.world.ships.filter((x) => x.alive && x.side === s).length);
    if (standing.every((k) => k > 0)) fail(`${tag}: ended with ships afloat on both sides`);
    if ([...a.world.result.winners, ...a.world.result.losers].some((x) => x.rank !== 0)) fail(`${tag}: somebody was placed`);
    if ([...a.world.result.winners, ...a.world.result.losers].length !== n) fail(`${tag}: ${n} captains, ${a.world.result.winners.length + a.world.result.losers.length} in the result`);
    try { structuredClone(a.world); } catch (e) { fail(`${tag}: the world is not plain data (${e.message})`); }
    if (JSON.stringify(b.world.result) !== JSON.stringify(a.world.result) || b.world.tick !== a.world.tick) fail(`${tag}: the same seed ended differently`);
    else ok(`${tag}: over at ${a.world.time.toFixed(1)} s, the ${a.world.result.side || "no"} side winning, the same both sailings`);
  }
}

const t0 = Date.now();
spawns();
aiCount();
placing();
credit();
rivalSpawns();
timePay();
watching();
sides();
rounds();
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (failures.length) {
  console.log(`\n${failures.length} FAILURE${failures.length === 1 ? "" : "S"}`);
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
console.log("\nA world takes several captains.\n");

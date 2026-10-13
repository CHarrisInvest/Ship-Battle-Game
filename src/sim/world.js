/**
 * THE SEA A ROUND IS FOUGHT ON: a fresh world for a round, its islands, the rivals it opens with,
 * and the reinforcements that keep an arena's fleet topped up.
 */

import { STARTER, ladder, measure, peers, rate, rateOf, stockOfHull, stockOfRate } from "../shipyard.js";
import { random, seedOf } from "./rng.js";
import { WORLD, ARENA_SPAWN_CLEAR, ARENA_SPAWN_GAP, STORM_R0 } from "./tables.js";
import { hunterOf, modeOf } from "./modes.js";
import { isHuman, humanRange, makeShip } from "./ships.js";
import { computeMeta } from "./round.js";

/**
 * A FRESH ROUND: the sea, its islands, each captain's ship and the rivals her mode opens with.
 *
 * `players` lists the humans aboard, each with the loadout she sails, as `[{ id: "p1", loadout }]`.
 * A round has one today; it is a list so a second can come aboard without the call changing. The
 * field is matched against the first. `seed` decides everything else that is left to chance, so
 * the same seed and the same players give the same round.
 *
 * The world is plain data, with no functions in it and nothing from the page, so a copy of it is a
 * copy of the round. What the engine looks up rather than carries, the rules a mode's row names and
 * a class's hull, comes out of tables that never change.
 */
export function createWorld({ mode, seed, players }) {
  const rules = modeOf(mode);
  const world = {
    mode, rules,
    players: {}, // player id to the id of the ship she sails
    ships: [], shots: [], volleys: [], islands: [],
    time: 0, tick: 0,
    rng: seedOf(seed), // the round's dice: every random number the round uses comes off these
    sunk: 0, fieldSize: 0, aliveCount: 0, leader: null, avgEarned: 0,
    spawnT: 0, spawnQueue: 0, stormR: STORM_R0,
    events: [], // what happened during the step under way, handed back by `step`
    nextId: 0,
    banked: false, // set by whoever banks the voyage, so it is banked once
    result: { over: false, winners: [], losers: [], field: 0 }, // how the round ended, once it has
  };
  // The field is matched against the first captain's ship: who she meets, and on the ladder which
  // rung is next.
  world.playerLoadout = players[0].loadout;
  world.playerStrength = measure(rate(world.playerLoadout));
  // Each captain's own ship, in the middle of the sea with her bow to the north. A second would lie
  // a little way off the first.
  players.forEach((pl, i) => {
    const ship = makeShip(world, WORLD / 2 + i * 90, WORLD / 2, -Math.PI / 2, { playerId: pl.id, loadout: pl.loadout });
    world.players[pl.id] = ship.id;
    world.ships.push(ship);
  });
  genIslands(world);
  for (let i = 0; i < rules.rivals; i++) {
    // where a mode replaces its losses, rivals sail in from the horizon the same way the
    // reinforcements will; where the field is fixed, they are scattered across the whole sea
    if (rules.reinforcements) world.ships.push(spawnArenaEnemy(world));
    else {
      const pos = farPos(world, 440);
      world.ships.push(makeShip(world, pos.x, pos.y, random(world) * Math.PI * 2, { livery: i, loadout: rivalLoadout(world, 0) }));
    }
  }
  world.fieldSize = world.ships.length;
  computeMeta(world);
  return world;
}

export const ISLAND_COUNT = 4;
export const MIDDLE_CLEAR = 320; // no island closer than this to the middle, in any mode
export const RING_CLEAR = 130; // ...and none within this of a closing ring's working size

export function farPos(world, minFromPlayer) {
  let x, y, ok, tries = 0;
  do {
    x = 180 + random(world) * (WORLD - 360);
    y = 180 + random(world) * (WORLD - 360);
    ok = true;
    if (humanRange(world, x, y) < minFromPlayer) ok = false;
    if (ok && world.islands) for (const isl of world.islands) if (Math.hypot(x - isl.x, y - isl.y) < isl.r + 55) { ok = false; break; }
    tries++;
  } while (!ok && tries < 40);
  return { x, y };
}

// The middle of the sea is left open, and a mode with weather has it left open out to the whole
// of its working ring: the end of such a round is fought in there, and a headland in the eye of
// the storm would be a place to hide from the one thing that stops anyone hiding. `MIDDLE_CLEAR`
// is what the derby's ring already asked for, kept as the floor so a mode without weather drops
// its fleet into the same open water it always did.
export function genIslands(world) {
  const isl = [];
  const clear = Math.max(MIDDLE_CLEAR, (world.rules.storm ? world.rules.storm.ring : 0) + RING_CLEAR);
  let tries = 0;
  while (isl.length < ISLAND_COUNT && tries < 400) {
    tries++;
    const r = 58 + random(world) * 66;
    const x = r + 90 + random(world) * (WORLD - 2 * (r + 90));
    const y = r + 90 + random(world) * (WORLD - 2 * (r + 90));
    if (Math.hypot(x - WORLD / 2, y - WORLD / 2) < clear) continue;
    if (isl.some((o) => Math.hypot(x - o.x, y - o.y) < r + o.r + 170)) continue;
    const n = 12;
    const verts = [];
    for (let k = 0; k < n; k++) verts.push(0.78 + random(world) * 0.3);
    // its planting is the screen's, which grows it from where the island stands, so the palms
    // are the same on every screen and never move the round's dice on
    isl.push({ x, y, r, verts });
  }
  world.islands = isl;
}

// A point on the map edge, as far from the player as we can manage and clear of islands.
export function edgePos(world, minFromPlayer) {
  const inset = 70;
  let best = null, bestD = -1;
  for (let t = 0; t < 60; t++) {
    const side = t % 4;
    const u = 120 + random(world) * (WORLD - 240);
    const x = side === 0 ? u : side === 1 ? u : side === 2 ? inset : WORLD - inset;
    const y = side === 0 ? inset : side === 1 ? WORLD - inset : u;
    let blocked = false;
    if (world.islands) for (const isl of world.islands) if (Math.hypot(x - isl.x, y - isl.y) < isl.r + 55) { blocked = true; break; }
    if (blocked) continue;
    const d = humanRange(world, x, y);
    if (d >= minFromPlayer) return { x, y };
    if (d > bestD) { bestD = d; best = { x, y }; }
  }
  return best || { x: inset, y: inset };
}

export function spawnArenaEnemy(world) {
  const p = edgePos(world, ARENA_SPAWN_CLEAR);
  // bow pointed inland so a fresh hunter sails into the fight, not into the boundary
  const heading = Math.atan2(WORLD / 2 - p.y, WORLD / 2 - p.x) + (random(world) - 0.5) * 0.8;
  // Every hull she has put under moves the next one out of the horizon up its mode's ladder.
  return makeShip(world, p.x, p.y, heading, {
    livery: world.ships.length,
    loadout: rivalLoadout(world, world.sunk),
  });
}

/**
 * WHO SHE MEETS, matched on what her own ship measures rather than on what class it is.
 *
 * A fully found cutter genuinely outclasses a plain brig, so matching on the shelf would call
 * that an even fight. Every mode issues from `STOCK` and every mode picks on a measure:
 *
 *   wave arena   climbs the ladder a rung at a time: the first hunter is a shade under her, and
 *                every second sinking brings the next rung out of the horizon until the rungs
 *                have caught her up, and the numbers do the rest. `arenaHunter` in the
 *                catalogue is the rule, and the bench prints it.
 *   ladder arena is the one mode not matched to her at all: the stock ladder from the bottom,
 *                by strength, and her `kills` say which rung is next. `ladderRung` is the rule.
 *                Both arenas carry theirs on the mode row as `hunter`.
 *   free-for-all fields her own rate: ships of her own class of ship, at every standard of
 *                fitting out, which is equal without being identical. In the first ship it
 *                fields her own class instead: the lowest rate holds four classes, and a
 *                gundalow with two guns a side against cutters with five is not an even fight.
 *   derby        matches on `ram` rather than on rate, because a rate is a count of guns and
 *                nobody in that mode has one aboard.
 *
 * Falls back to the nearest rung by the same measure when a band comes up empty, so a captain in
 * something the fleet has no answer to still gets a fight.
 */
export function rivalLoadout(world, step) {
  const rules = world.rules, strength = world.playerStrength, hull = world.playerLoadout.hull;
  const key = rules.guns ? "overall" : "ram";
  const rungs = ladder();
  if (rules.hunter) return hunterOf(rules, strength, step).loadout;
  if (rules.guns) {
    const band = hull.id === STARTER.hull ? stockOfHull(hull.id) : stockOfRate(rateOf(hull).rung);
    if (band.length) return band[Math.floor(random(world) * band.length)].loadout;
  } else {
    const band = peers(strength.ram, 0.15, "ram");
    if (band.length) return band[Math.floor(random(world) * band.length)].loadout;
  }
  return nearestRung(rungs, key, strength[key]).loadout;
}

const nearestRung = (rungs, key, want) =>
  rungs.reduce((a, b) => (Math.abs(b.measure[key] - want) < Math.abs(a.measure[key] - want) ? b : a));

export function maintain(world, dt) {
  if (!world.rules.reinforcements) return;
  // nothing left to send: the ladder is climbed, and `judge` ends the round on this frame
  if (!hunterOf(world.rules, world.playerStrength, world.sunk)) return;
  world.spawnT -= dt;
  const enemies = world.ships.filter((s) => !isHuman(s)).length;
  if (enemies === 0 && world.spawnQueue <= 0) world.spawnQueue = 1; // never leave the sea empty
  if (world.spawnQueue > 0 && enemies < world.rules.fleetCap && world.spawnT <= 0) {
    world.ships.push(spawnArenaEnemy(world));
    world.spawnQueue -= 1;
    world.spawnT = ARENA_SPAWN_GAP;
  }
}

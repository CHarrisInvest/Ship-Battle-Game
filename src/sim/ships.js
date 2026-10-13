/**
 * THE SHIPS: a ship as the engine holds her, what she can do with the way and the rudder she has,
 * read off her `rating`, and how a human captain's input record sails her.
 */

import { STARTER, measure, resolve, rate } from "../shipyard.js";
import { hullForm } from "../hullform.js";
import { clamp, norm } from "./math.js";
import { random } from "./rng.js";
import { WORLD } from "./tables.js";
import { repair } from "./repairs.js";
import { canFire, fire, reloadOf } from "./weapons.js";
import * as exact from "../exact.js";

// A hull with way on her does not answer her rudder as she does at a crawl. The loss is weighted to
// the top of the range: handling in and out of a fight is left where it was, and only a ship running
// flat out finds she cannot turn inside her own wake. It keys off the way she actually carries rather
// than the stick, so easing off the throttle hands the rudder back as she slows: coming round hard
// means spending some of her way to do it, and a charge at full sail is a commitment.
export const BASE_SPEED = 94; // top speed of a whole ship, and the yardstick for a heavy rudder
export const RUDDER_HEAVY = 0.22; // rudder lost at that speed
export const RUDDER_CURVE = 2.2; // how late in the range it starts to bite

/**
 * WHAT A SHIP CAN DO, which is now what she was built to do.
 *
 * Every one of these opened with a level she had bought in that track, then with a plain constant
 * once nothing bought levels any more. They took the ship rather than being constants throughout,
 * against the day the shipyard fed them, and this is that day: a ship carries a `rating` from
 * `rate()`, and these read it.
 *
 * Two things still vary at sea and both are damage. How much of her rig is standing, which is what
 * `mast` measures, and how badly she is holed, which thins her volleys. Nothing else about her moves
 * once she has sailed.
 *
 * The rudder goes heavy against HER OWN top speed rather than the fleet's fastest, or a slow hull
 * would never find the end of her range and a clipper would live in it.
 */
export const topSpeed = (s) => BASE_SPEED * s.rating.speed;
export const rudder = (s) => 1 - RUDDER_HEAVY * exact.pow(clamp(s.spdCur / topSpeed(s), 0, 1), RUDDER_CURVE);
export const speedCap = (s) => topSpeed(s) * (0.5 + 0.5 * (s.mast / s.maxMast));
export const turnCap = (s) => 2.4 * s.rating.turn * (0.22 + 0.78 * (s.mast / s.maxMast)) * rudder(s);

export const STOCK_LOADOUT = resolve(STARTER);
// Her three bars at full, off a loadout: what the HUD opens on and what the fight fills in.
export const barsOf = (loadout) => { const r = rate(loadout); return { hull: r.hull, mast: r.mast, crew: r.crew }; };

/** Whether a person sails her, rather than the engine. */
export const isHuman = (s) => s.controller === "human";
/** The ship a player sails in this world, afloat or sunk, or nothing if she has none. */
export const shipOf = (world, playerId) => world.ships.find((s) => s.id === world.players[playerId]) || null;
/** How far the nearest human ship lies from a point, or a very long way when there is none afloat. */
export const humanRange = (world, x, y) =>
  world.ships.reduce((d, s) => (isHuman(s) && s.alive ? Math.min(d, exact.hypot(x - s.x, y - s.y)) : d), 1e9);

export function makeShip(world, x, y, heading, opts) {
  // She sails as what she was built: her loadout comes aboard with her captain if she is a
  // player's, and from the stock fleet if she is not. `rate()` is asked once, here, because nothing about
  // a ship changes at sea except her damage.
  const loadout = opts.loadout || STOCK_LOADOUT;
  const rating = rate(loadout);
  // What she measures, on the scale the mode fights on: overall under gunfire, ram without it.
  // A captain picking prey reads it against her own, so a plain sloop no longer charges a fully
  // found one three times her strength as if the two were the same hull.
  const measured = measure(rating);
  const strength = !world.rules.guns ? measured.ram : measured.overall;
  // Her hull's own size, from the class's form: what she draws as, and also what she collides
  // as, because a first rate really is a bigger target than a yawl. It is carried as `hullA` and
  // `hullB`, her semi-length and semi-beam; the galleon anchors the scale at the 36 by 13 every
  // hull at sea used to share.
  const sea = hullForm(loadout.hull.id).sea;
  const s = {
    // who she is, for the events that name her, and which colours she flies, which every
    // viewer of the round has to agree on
    id: world.nextId++, livery: opts.livery || 0,
    x, y, heading, spdCur: 0, alive: true,
    // a person or the engine, and which person: the input record she answers to
    controller: opts.playerId ? "human" : "ai", playerId: opts.playerId || null,
    loadout, rating, strength,
    hullA: sea.L / 2, hullB: sea.W / 2,
    coins: 0, earned: 0, repaired: 0, patches: 0, rank: 0, placed: false, sankAt: 0, kills: 0, dmgDealt: 0, rams: 0, exposure: 0,
    // What the record wants to know beyond the count of sinkings: how each one was done, and
    // what the carpenter gave back. `sunkBy` is keyed by the cause `applyHit` is told.
    dismasted: 0, healed: 0, sunkBy: { ram: 0, broadside: 0, musket: 0 }, rammedWhole: 0, wornDown: 0,
    // What each PLAYER has done to this ship, bar by bar, and how much of her hull went to that
    // player's bow, keyed by player id and opened on her first blow. Rivals hit each other in a
    // melee, the storm takes crew, and in an online round other captains fire too, so "you wore
    // her down" and "you sank her by the bow alone" are judged on this and never on her bars.
    byPlayers: {},
    maxHull: rating.hull, maxMast: rating.mast, maxCrew: rating.crew,
    hull: rating.hull, mast: rating.mast, crew: rating.crew,
    // every gun aboard is loaded at the drop, the player's and a rival's alike. A rival's used
    // to start on a random reload of up to half a second so ten of them would not fire as one;
    // the trigger discipline in `serveGuns` and their own spread of positions do that now.
    cd: { broadside: 0, bow: 0, musket: 0 },
    mastDown: false, ramCd: 0, locked: new Map(), turnVel: 0, kx: 0, ky: 0,
    px: x, py: y, pHeading: heading, // where she was, and which way she pointed, when the step began
    vx: 0, vy: 0, way: 0, baulkT: 0, foul: false, // the ground she truly made
  };
  if (!opts.playerId) {
    s.wander = random(world) * Math.PI * 2;
    s.wanderT = 0;
    s.oppT = 0;
    s.oppHold = 1.8 + random(world) * 2.6; // trigger discipline: some captains waste less powder
    s.nerve = random(world); // how late she leaves it before turning to face a charge
    s.baffled = 0; // how long she has been getting nowhere with the hull she is engaged with
    s.sheerT = 0; // time left on a deliberate break-off
    s.sheerHeading = 0; // and the course out of the heap she picked when she began it
    s.avoidIsl = null; // the island she is sailing round, and which side she chose to pass it
    s.avoidSide = 0;
    s.retargetT = 0;
    s.target = null;
  }
  return s;
}

export function moveShip(world, s, dt, desired, throttle) {
  let dH = 0;
  if (throttle > 0.03) {
    const d = norm(desired - s.heading);
    const step = turnCap(s) * dt;
    dH = clamp(d, -step, step);
    s.heading += dH;
  }
  s.turnVel = dt > 0 ? dH / dt : 0;
  const tgt = throttle * speedCap(s);
  s.spdCur += (tgt - s.spdCur) * Math.min(1, dt * 3);
  s.x += exact.cos(s.heading) * s.spdCur * dt;
  s.y += exact.sin(s.heading) * s.spdCur * dt;
  s.x += s.kx * dt;
  s.y += s.ky * dt;
  const kf = exact.exp(-dt * 3.5);
  s.kx *= kf;
  s.ky *= kf;
  s.x = clamp(s.x, 28, WORLD - 28);
  s.y = clamp(s.y, 28, WORLD - 28);
  if (world.islands)
    for (const isl of world.islands) {
      const dx = s.x - isl.x, dy = s.y - isl.y;
      const d = exact.hypot(dx, dy) || 1;
      // her own half-length, so a first rate grounds where her bow reaches the shallows and a
      // launch can work right in under the beach
      const minD = isl.r + s.hullA * 0.76;
      if (d < minD) { s.x = isl.x + (dx / d) * minD; s.y = isl.y + (dy / d) * minD; s.spdCur *= 0.5; }
    }
}

/**
 * One human captain's step, off her input record: a repair she asked for since the last step,
 * then the stick, then any fire button held over a loaded mount. A repair comes the same road as
 * the wheel, so that it reaches the engine the same way wherever the engine is.
 */
export function stepHuman(world, p, inp, dt) {
  if (!p.alive) return;
  if (inp.repair && world.rules.repairs) {
    const paid = repair(p, inp.repair);
    if (paid > 0) world.events.push({ type: "repaired", shipId: p.id, system: inp.repair, coins: paid });
  }
  const desired = inp.joyMag > 0.08 ? inp.joyAng : p.heading;
  moveShip(world, p, dt, desired, inp.joyMag);
  p.ramCd = Math.max(0, p.ramCd - dt);
  if (!world.rules.guns) return; // ram-only: nothing aboard to reload
  for (const wk of ["broadside", "bow", "musket"]) {
    p.cd[wk] = Math.max(0, p.cd[wk] - dt);
    if (inp[wk] && p.cd[wk] <= 0 && canFire(p, wk)) { fire(world, p, wk); p.cd[wk] = reloadOf(p, wk); }
  }
}

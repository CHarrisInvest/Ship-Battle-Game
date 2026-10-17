/**
 * THE AI CAPTAINS: how a rival picks her quarry, sails round an island, breaks out of a heap and
 * comes back for a proper run.
 */

import { clamp, norm } from "./math.js";
import { random } from "./rng.js";
import { WORLD, WP } from "./tables.js";
import { isHuman, moveShip, speedCap } from "./ships.js";
import { canFire, fire, reloadOf } from "./weapons.js";
import { BAULK_GRACE } from "./ram.js";
import { canHit } from "./round.js";
import { weatherCourse, runFromWeather } from "./storm.js";
import * as exact from "../exact.js";

// How an AI captain sails round an island. She keeps this much water between her beach and the
// point `moveShip` grounds her at, looks this far ahead for one plus what she will cover in
// ISLAND_LOOK_SECS at her present speed, and once on a beach runs along it leaning off by this
// much, which is what takes her off it. Two islands are never closer than 170 to each other, so
// a first rate clearing each by the margin still has a channel between them.
export const ISLAND_CLEAR = 22;
export const ISLAND_LOOK = 90;
export const ISLAND_LOOK_SECS = 1.6;
export const ISLAND_LEAN = 0.35;
export const OPENING_WINDOW = 30; // seconds the ffa AI weights range over reputation when picking prey
// How much a rival's strength against her own weighs when an AI captain picks prey, at full weight
// for a ship a factor of e weaker or stronger. Set beside the other terms: a runaway leader is worth
// 130, a hull under half health up to 60, and a thousand paces of range 20 to 120.
export const PREY_STRENGTH = 60;

// Two hulls with the same top speed can fall into a mutual tail chase and orbit one another for as
// long as they both keep the throttle down — lead pursuit holds the circle rather than closing it.
// A captain who has gone this long without gaining takes the way off her instead: a slow hull turns
// far inside a fast one, so easing the throttle is what lets her cut the corner and force the meeting.
export const STALL_PATIENCE = 5; // seconds of getting nowhere before she tries something else
export const STALL_CUT = 4.5; // and how long she holds the tighter, slower turn
export const STALL_THROTTLE = 0.5;

// A captain gets out of a heap rather than grinding away in it. Being jammed against another hull is
// not a fight — she is going nowhere and neither is anyone else — so once she has been stuck like
// that a moment she peels out, gathers way in clear water, and comes back for a proper run, usually
// at somebody other than whoever she was jammed against. What times it is `baulkT`, the plain fact of
// being foul of a hull and making no ground: in a pile any reckoning of closing speed reads high one
// frame and nothing the next, while being stuck is simply true or not. Her nerve scales how long she
// will put up with it, so no two blink together — a pile that broke as one would only re-form.
export const SHEER_ANGLE = 1.35; // about 77 degrees off her bearing, when there is no heap to steer out of
export const SHEER_LOOK = 190; // hulls this close are what she counts as the heap she is peeling out of
export const SHEER_TIME = 2.4; // how long she holds the break before working back in
export const SHEER_THROTTLE = 0.7; // and she takes some way off to get the bow across

/**
 * Bend an AI captain's course round any island it would run her onto.
 *
 * The rule this replaced looked at the nearest island only, within a fixed 130 paces, and when
 * the course pointed at it pushed the course sideways by a fixed amount. That is what left a
 * rival pinned on a beach for so long. The push for a course dead at the island was less than
 * the quarter turn that runs along a shore, so a ship already touching was steered back into
 * the sand every frame and lost half her way for it every frame; and the push changed sides as
 * her bearing on the island crossed nought, so a captain with her quarry straight across an
 * island dithered between going round one way and the other and went round neither.
 *
 * This one steers for the tangent. Of the islands she can see, the nearest whose beach the
 * course would pass within `clear` of has the course swung onto the tangent to the circle
 * `clear` off her beach, on whichever side the course was already nearer to. She remembers the
 * side she picked for that island until she is past it, so having chosen to go round to port
 * she goes round to port. A ship already inside that circle, on the beach or nearly, runs along
 * the shore leaning outward, which is the one course that takes her off it however she came to
 * be there; and a course that already points off the island is left alone.
 */
export function avoidIslands(world, s, desired) {
  if (!world.islands) return desired;
  const clear = s.hullA * 0.76 + ISLAND_CLEAR; // moveShip grounds her at the first term
  const look = ISLAND_LOOK + s.spdCur * ISLAND_LOOK_SECS;
  let isl = null, id = 1e9, iTo = 0, iRel = 0;
  for (const o of world.islands) {
    const dx = o.x - s.x, dy = o.y - s.y;
    const d = exact.hypot(dx, dy);
    const R = o.r + clear;
    if (d - R > look) continue; // beyond where she looks
    const toI = exact.atan2(dy, dx);
    const rel = norm(toI - desired);
    // Clear of her if the course points off the island, or passes her wider than R at its
    // nearest. A ship inside R is only clear on a course that already leans off the shore.
    const off = Math.abs(rel) > Math.PI / 2 + (d > R ? 0 : ISLAND_LEAN);
    if (off || (d > R && Math.abs(exact.sin(rel)) * d > R)) continue;
    if (d < id) { isl = o; id = d; iTo = toI; iRel = rel; }
  }
  if (!isl) { s.avoidIsl = null; return desired; }
  const R = isl.r + clear;
  if (s.avoidIsl !== isl) { s.avoidIsl = isl; s.avoidSide = iRel > 0 ? -1 : 1; }
  const side = s.avoidSide;
  if (id <= R) return iTo + side * (Math.PI / 2 + ISLAND_LEAN); // along the shore, leaning off it
  return iTo + side * exact.asin(Math.min(1, R / id)); // the tangent
}

export function pickTarget(world, s) {
  if (!world.rules.melee && !world.rules.sides) {
    // one quarry, whoever is sailing against the fleet: the nearest of them afloat
    let near = null;
    for (const c of world.ships) if (isHuman(c) && c.alive && (!near || exact.hypot(c.x - s.x, c.y - s.y) < exact.hypot(near.x - s.x, near.y - s.y))) near = c;
    return near;
  }
  // a melee, or two sides: prey is whoever `canHit` says is an enemy, scored below
  const leaderSnow = world.leader && world.leader !== s && world.leader.earned > world.avgEarned * 1.6 && world.aliveCount > 2;
  // at the drop nobody has a reputation yet, so range is what matters: take the nearest hull
  // and only start shopping for weak or wealthy prey once the melee has had time to sort itself
  const opening = clamp(1 - world.time / OPENING_WINDOW, 0, 1);
  const distW = 0.02 + 0.1 * opening; // range matters most while the fleet is still sorting out
  const shop = 1 - 0.75 * opening; // ...and reputation barely at all
  let best = null, bestScore = -1e9, nearest = null, nd = 1e9;
  for (const c of world.ships) {
    // an enemy afloat: in a melee that is everyone else, between sides the other fleet
    if (!canHit(world, s, c)) continue;
    const dist = exact.hypot(c.x - s.x, c.y - s.y);
    if (dist < nd) { nd = dist; nearest = c; }
    if (dist > 1500) continue;
    let score = -dist * distW;
    const isLead = leaderSnow && c === world.leader;
    if (isLead) score += 130 * shop;
    // Weaker prey is better prey. The two ships' measures are read against each other on a log
    // scale, so a hull half her strength is worth as much as one twice her strength costs, and
    // the term is held to a factor of e either way so a first rate in a field of boats is not
    // the only thing anyone ever hunts. A term like it sat here once, comparing levels bought at
    // sea, and went when every hull became the same hull; the fleet varies again, off the
    // shipyard, so it is back off the loadouts. It weighs prey only: nobody runs from a stronger
    // ship on account of it, since a captain who fled every heavier hull would never fight.
    if (s.strength > 0 && c.strength > 0) score += PREY_STRENGTH * shop * clamp(exact.log(s.strength / c.strength), -1, 1);
    const hpR = Math.min(c.hull / c.maxHull, c.crew / c.maxCrew);
    if (hpR < 0.5) score += (0.5 - hpR) * 120 * shop;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best || nearest;
}

// How far a broadside carries, which is the ball's speed for its life, and how close an AI
// captain gets before she turns beam-on to use it. The second sits well inside the first on
// purpose: it was 225 against a reach of 220, so a hunter who turned beam-on at the edge of it
// could lie there with her guns five paces short, and where she was pinned on the boundary
// beam-on she could neither close nor fire, and a round with one hunter in it never ended.
export const BROADSIDE_REACH = WP.broadside.speed * WP.broadside.life;

export const BEAM_ON = BROADSIDE_REACH - 25;

// Is anything in this weapon's arc? Prefers the ship we are hunting, but reports a bystander
// that has drifted into the line of fire so the AI can decide whether to loose a volley at it.
export const ARCS = {
  broadside: (d, ab) => d < BROADSIDE_REACH && Math.abs(ab - Math.PI / 2) < 0.4,
  bow: (d, ab) => d < 360 && ab < 0.28,
  // half the volley's arc plus a little, so an AI captain looses when a hull is somewhere in her
  // fire rather than when it is merely off the bow
  musket: (d, ab) => d < 130 && ab < 0.3,
};

export function linedUp(world, s, weapon, primary) {
  const arc = ARCS[weapon];
  let bystander = null;
  for (const c of world.ships) {
    if (!canHit(world, s, c)) continue;
    const d = exact.hypot(c.x - s.x, c.y - s.y);
    const ab = Math.abs(norm(exact.atan2(c.y - s.y, c.x - s.x) - s.heading));
    if (!arc(d, ab)) continue;
    if (c === primary) return { ship: c, primary: true };
    if (!bystander || d < bystander.d) bystander = { ship: c, primary: false, d };
  }
  return bystander;
}

// ---- ram-only captains -------------------------------------------------------------------
// With nothing to shoot, a captain's whole trade is where her bow is pointed and how much way she
// has behind it. She wants a rival's beam, because that is where a hull is staved in; she wants to
// meet a charge with her own bow, because that turns a beam blow into a glance the other ship has
// to share; and she has to spend speed to come round at all, now that a rudder goes heavy at a run.

// Whose beam is worth crossing the sea for. Weighs how side-on she lies to us, how badly she is
// already holed, whether she is looking the other way, and how far off she is.
export function pickRamTarget(world, s, shyOf) {
  let best = null, bestScore = -1e9;
  for (const c of world.ships) {
    if (c === s || !c.alive) continue;
    const toC = exact.atan2(c.y - s.y, c.x - s.x);
    const dist = exact.hypot(c.x - s.x, c.y - s.y);
    const aspect = Math.abs(exact.sin(c.heading - toC)); // 1 when her beam is square to us
    const facing = Math.abs(norm(toC + Math.PI - c.heading)); // 0 when her bow is on us
    // ...and whether we are gaining on her at all. Every hull holds the same top speed in a mode
    // with no gunnery to bring a mast down, so a stern chase is one nobody ever
    // wins: without this a captain will happily follow a fleeing rival across the whole sea while
    // the beam of a ship crossing her bow goes begging.
    const closing =
      (exact.cos(s.heading) * s.spdCur - exact.cos(c.heading) * c.spdCur) * exact.cos(toC) +
      (exact.sin(s.heading) * s.spdCur - exact.sin(c.heading) * c.spdCur) * exact.sin(toC);
    let score = -dist * 0.06 + aspect * 46 + facing * 8 + (1 - c.hull / c.maxHull) * 55 + clamp(closing, -70, 70) * 0.55;
    if (isHuman(c)) score += 8; // captains would rather have the notorious hull
    // the hull she has just spent a while jammed against is the one she is least likely to get
    // anything out of, so she shops elsewhere — though she will come back to her if she is all
    // there is, which is why this leans against her rather than ruling her out
    if (c === shyOf) score -= 55;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

// Steer for where she will be by the time we get there, not where she is now.
export function ramIntercept(s, t) {
  const dist = exact.hypot(t.x - s.x, t.y - s.y);
  const lead = clamp(dist / Math.max(40, speedCap(s)), 0, 2.4);
  return exact.atan2(t.y + exact.sin(t.heading) * t.spdCur * lead - s.y, t.x + exact.cos(t.heading) * t.spdCur * lead - s.x);
}

// Anyone bow-on to us, close, and carrying way is about to ram. Nearest one wins our attention.
export function incomingRam(world, s) {
  let threat = null, td = 1e9;
  for (const c of world.ships) {
    if (c === s || !c.alive) continue;
    const dist = exact.hypot(c.x - s.x, c.y - s.y);
    if (dist > 250 || dist > td) continue;
    if (c.spdCur < 46) continue;
    if (Math.abs(norm(exact.atan2(s.y - c.y, s.x - c.x) - c.heading)) > 0.42) continue;
    threat = c; td = dist;
  }
  return threat;
}

// Which way is out of the heap: away from the mean bearing of every hull near enough to be in the
// road, with a touch of sheer either side so a whole pile does not peel off along the same line.
export function clearWater(world, s) {
  let cx = 0, cy = 0, n = 0;
  for (const c of world.ships) {
    if (c === s || !c.alive) continue;
    const dx = c.x - s.x, dy = c.y - s.y;
    const d = exact.hypot(dx, dy);
    if (d > SHEER_LOOK || d < 1) continue;
    cx += dx / d; cy += dy / d; n++;
  }
  const away = n > 0 ? exact.atan2(-cy, -cx) : s.heading + (random(world) < 0.5 ? 1 : -1) * SHEER_ANGLE;
  return away + (random(world) - 0.5) * 0.7;
}

export function stepRamAI(world, s, dt) {
  s.ramCd = Math.max(0, s.ramCd - dt);
  s.retargetT -= dt;
  if (!s.target || !s.target.alive || s.retargetT <= 0) {
    s.target = pickRamTarget(world, s);
    s.retargetT = 0.6 + random(world) * 0.7;
  }
  const tgt = s.target;
  const threat = incomingRam(world, s);
  const facing = threat && exact.hypot(threat.x - s.x, threat.y - s.y) < 150 + s.nerve * 90 ? threat : null;
  const engaged = facing || tgt; // the hull this is about, whether she picked it or it picked her
  let desired, throttle = 1;
  s.sheerT = Math.max(0, s.sheerT - dt);

  // Is she getting anywhere with it? The clock runs against whoever she is engaged with, the hull
  // she is chasing and the one charging her alike. It used to run only inside the chase, so the
  // one case that never resolves itself — a pair locked bow to bow — was the one case never timed.
  if (engaged) {
    const toE = exact.atan2(engaged.y - s.y, engaged.x - s.x);
    const closing =
      (exact.cos(s.heading) * s.spdCur - exact.cos(engaged.heading) * engaged.spdCur) * exact.cos(toE) +
      (exact.sin(s.heading) * s.spdCur - exact.sin(engaged.heading) * engaged.spdCur) * exact.sin(toE);
    s.baffled = closing > 18 ? Math.max(0, s.baffled - dt * 2) : s.baffled + dt;
  } else s.baffled = Math.max(0, s.baffled - dt);

  const patience = (secs) => secs * (0.7 + 0.6 * s.nerve); // no two captains blink together

  // Bunched up. `baulkT` is the plain fact of it — she is foul of another hull and going nowhere —
  // and it is a far better signal than any reckoning of closing speed, which in a pile is high one
  // frame and nothing the next. Once she has been stuck like that a moment she peels out of the
  // heap, gathers way in clear water, and comes back at whoever looks best from out there. That
  // is usually somebody else: the hull she was jammed against is the one she has just proved she
  // cannot get a run at.
  if (s.sheerT <= 0 && s.baulkT > patience(BAULK_GRACE)) {
    s.sheerT = SHEER_TIME;
    s.sheerHeading = clearWater(world, s);
    s.baulkT = 0;
    s.baffled = 0;
    s.target = pickRamTarget(world, s, engaged);
    s.retargetT = SHEER_TIME + random(world) * 0.5; // let the new choice stand while she pulls out
  }

  if (s.sheerT > 0) {
    // out of the heap: sea room first, a fresh run at her second
    desired = s.sheerHeading;
    throttle = SHEER_THROTTLE;
  } else if (facing) {
    // meet her bow to bow rather than let her have the beam — a glance both of us share
    desired = exact.atan2(facing.y - s.y, facing.x - s.x);
  } else if (!tgt) {
    s.wanderT -= dt;
    if (s.wanderT <= 0) { s.wander += (random(world) - 0.5) * 1.2; s.wanderT = 1.5 + random(world); }
    desired = s.wander;
    throttle = 0.5;
  } else if (s.baffled > patience(STALL_PATIENCE)) {
    // a chase she is not winning: come round inside her instead of following her wake
    desired = exact.atan2(tgt.y - s.y, tgt.x - s.x); // straight at her, not at where she is going
    throttle = STALL_THROTTLE;
    if (s.baffled > patience(STALL_PATIENCE + STALL_CUT)) s.baffled = 0; // then have another go
  } else {
    desired = ramIntercept(s, tgt);
  }

  ({ desired, throttle } = weatherCourse(world, s, desired, throttle));

  // A hull carrying way will not come round. Ease off to swing the bow across, then pile it on —
  // which is what makes an AI charge something a captain can watch coming and step aside from.
  const err = Math.abs(norm(desired - s.heading));
  if (err > 1.15) throttle = Math.min(throttle, 0.4);
  else if (err > 0.55) throttle = Math.min(throttle, 0.72);

  moveShip(world, s, dt, avoidIslands(world, s, desired), throttle);
}

export function stepAI(world, s, dt) {
  if (!s.alive) return;
  if (!world.rules.guns) { stepRamAI(world, s, dt); return; }
  s.retargetT -= dt;
  if (!s.target || !s.target.alive || s.retargetT <= 0) {
    s.target = pickTarget(world, s);
    s.retargetT = 0.7 + random(world) * 0.6;
  }
  const tgt = s.target;
  for (const wk of ["broadside", "bow", "musket"]) s.cd[wk] = Math.max(0, s.cd[wk] - dt);
  s.ramCd = Math.max(0, s.ramCd - dt);
  s.oppT = Math.max(0, s.oppT - dt);
  const nearWall = s.x < 140 || s.x > WORLD - 140 || s.y < 140 || s.y > WORLD - 140;

  if (!tgt) {
    s.wanderT -= dt;
    if (s.wanderT <= 0) { s.wander += (random(world) - 0.5) * 1.2; s.wanderT = 1.5 + random(world); }
    const idle = weatherCourse(world, s, nearWall ? exact.atan2(WORLD / 2 - s.y, WORLD / 2 - s.x) : s.wander, 0.4);
    moveShip(world, s, dt, avoidIslands(world, s, idle.desired), idle.throttle);
    return;
  }

  const dx = tgt.x - s.x, dy = tgt.y - s.y;
  const dist = exact.hypot(dx, dy);
  const toT = exact.atan2(dy, dx);
  const bearing = norm(toT - s.heading);
  const hpR = Math.min(s.hull / s.maxHull, s.crew / s.maxCrew);
  // She used to run from a ship carrying more levels than her as well as from her own wounds.
  // Levels are gone and every hull is equal, so what is left is the wound, which was always the
  // better half of it: a captain runs because of the state of her own ship.
  const fleeing = world.rules.flees && hpR < 0.34;

  if (fleeing) {
    let away = exact.atan2(s.y - tgt.y, s.x - tgt.x);
    if (nearWall) away = exact.atan2(WORLD / 2 - s.y, WORLD / 2 - s.x);
    // ...and the weather has a say in where "away" is. A wounded captain running from the ship
    // that wounded her is exactly who sails out of the ring and dies of the sea, so near the rail
    // she runs round the ring rather than out of it, and the run is bent home the same way
    // everyone else's course is.
    const run = weatherCourse(world, s, runFromWeather(world, s, away), 0.95);
    moveShip(world, s, dt, avoidIslands(world, s, run.desired), run.throttle);
    // A captain running is still a captain with guns. She used to return here without firing
    // a shot, so a pursuer who came up on her beam, which is the one place a running ship can
    // hit without turning, was handed the whole exchange. She looses whatever bears and keeps
    // running; she never alters course to bring a gun on.
    serveGuns(world, s, tgt);
    return;
  }

  let desired, throttle;
  if (nearWall && dist > 260) { desired = exact.atan2(WORLD / 2 - s.y, WORLD / 2 - s.x); throttle = 0.7; }
  else if (dist > 900) {
    s.wanderT -= dt;
    if (s.wanderT <= 0) { s.wander = toT + (random(world) - 0.5) * 0.8; s.wanderT = 1.2 + random(world); }
    desired = s.wander; throttle = 0.6;
  } else if ((tgt.hull < tgt.maxHull * 0.4 || tgt.crew < tgt.maxCrew * 0.4) && dist < 520) {
    desired = toT; throttle = 1; // line up and charge a wounded ship to ram it down
  } else if (dist < 150 && Math.abs(bearing) < 0.35) {
    desired = toT; throttle = 1; // opportunistic ram when already bow-on and close
  } else if (dist > BEAM_ON) { desired = toT; throttle = 0.9; }
  else { const sign = bearing >= 0 ? 1 : -1; desired = toT - (sign * Math.PI) / 2; throttle = 0.5; }
  ({ desired, throttle } = weatherCourse(world, s, desired, throttle));
  moveShip(world, s, dt, avoidIslands(world, s, desired), throttle);
  serveGuns(world, s, tgt);
}

// Every mount that is loaded and has a hull in its arc fires, at the ship she is hunting for
// choice. Fighting or running, this is the whole of an AI captain's gunnery.
export function serveGuns(world, s, tgt) {
  for (const wk of ["broadside", "bow", "musket"]) {
    if (s.cd[wk] > 0 || !canFire(s, wk)) continue;
    const shot = linedUp(world, s, wk, tgt);
    if (!shot) continue;
    if (!shot.primary) {
      // a hull that wandered into the arc is not who we came for: take the shot sometimes,
      // then hold fire a beat so nobody spends the whole match blasting bystanders
      if (s.oppT > 0) continue;
      s.oppT = s.oppHold * (0.7 + random(world) * 0.6);
    }
    fire(world, s, wk);
    s.cd[wk] = reloadOf(s, wk); // AI reloads at the pace of its own battery, every mode
  }
}

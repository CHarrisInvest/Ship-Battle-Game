/**
 * THE RAM: two hulls meeting, measured keel to keel, and what the blow is worth.
 */

import { clamp } from "./math.js";
import { applyHit, hostile } from "./round.js";
import * as exact from "../exact.js";

export const HULL_PAD = 3; // rigging and oars, so hulls never touch pixels
export const RAM_MIN_CLOSE = 25; // closing speed at which a collision starts to count as a ram
export const RAM_FULL_CLOSE = 94; // closing speed for a full-weight ram: a fresh ship's top speed
export const RAM_CURVE = 1.5; // how sharply the blow grows with closing speed, for every angle alike
export const RAM_MAX_FORCE = 2.4; // ceiling on it, so a head-on cannot run away with the match
export const RAM_BEAM = 1.25; // weight of a blow square on the beam...
export const RAM_FINE = 0.6; // ...and of one that glances off her bow or stern
export const RAM_GRAZE = 1; // below this a touch is not a ram at all: no damage, no cooldown, no lock
export const RAM_MUTUAL_CAP = 0.8; // most of a bow-to-bow blow one ship's speed can shove onto the other
export const RAM_KNOCK = 150; // impulse thrown apart on a ram (scaled by closing speed)
export const RAM_RECOIL = 0.3; // floor on the bounce for whoever drove into the blow
export const RAM_DRIVE_LOSS = 0.88; // share of her way a ship spends into the impact, bow-on
export const RAM_REARM_GAP = 26; // hulls must break this far clear before the pair can ram again
export const RAM_CD = 0.9; // seconds before a ship can ram again
// Hulls touching without a charge behind them are eased apart with this much push a second. It is a
// force a second rather than a knock a frame: it was 32 a frame, which at sixty frames is this figure
// and at a hundred and twenty was twice it, so a ship nudged along by another crossed the sea at a
// different pace depending on the phone she was on.
export const HULL_NUDGE = 1920;
// Breaking clear was the only way out of that lock, which two ships circling each other never manage:
// they can hold station inside the gap indefinitely and the pair stays barred from ever trading
// another blow. The lock is meant to stop damage being ground out of hulls already touching, and a
// few seconds does that, so it lapses on its own as well.
export const RAM_LOCK_MAX = 3;
// A ram is worked out from the way a ship has actually made, not from the way her helmsman wanted.
// The two part company whenever something is in the road: hulls pressed against one another are
// de-overlapped every frame, so they stand still in the water while `spdCur` — the throttle's idea of
// her speed — reads full ahead. Resolving a blow from that gives a stationary ship the weight of a
// flying one: a pair jammed bow to bow could sink a third that came to attack them, and the moment
// one of them turned away the other took her beam at full force without ever having moved. So each
// ship measures the ground she truly covered last frame, and a hull that cannot go forward loses her
// way like any other.
// The measurement is smoothed. Hulls in contact are driven together and pushed apart again frame by
// frame, so a single frame's difference swings wildly either side of nothing, and taking the positive
// half of that swing at face value hands a standing ship the weight of a charging one every other
// frame. Not too smooth, though: force climbs as the 1.5 power of closing speed, so under-reading a
// ship working up to a charge by a fifth costs nearly half her blow.
export const WAY_SMOOTH = 14; // the measurement follows her within about a fifteenth of a second

// And a hull held on another's timbers loses her way, so she has to gather it again before she is
// worth anything — which is what stops her taking the beam of the ship that breaks off first as
// though she had been charging all along. Only being foul of another hull counts: a ship knocked off
// her stride is still free to sail, and treating that as held empties the melee of blows altogether.
export const BAULK_TOL = 0.35; // foul of a hull and making less than this share of her asking: she is baulked
export const BAULK_GRACE = 0.35; // ...and only held once it has gone on this long. A knock in passing is not
export const BAULK_RATE = 6; // once held, her way falls away, halving in about an eighth of a second

// For hull against hull a ship is her keel — a line down her length — swelled by her beam. Measuring
// between the two keels finds where they truly foul, which the distance between two centres cannot:
// hulls this long can cross well off the line joining them, and would slide through one another.
// Both figures are each ship's own now: a first rate's keel is half again a cutter's, and the two
// are alongside when the gap closes to the sum of their own beams.
export const keelHalf = (s) => s.hullA - s.hullB;
export const hullTouch = (a, b) => a.hullB + b.hullB + 2 * HULL_PAD;

// closest approach of the two keels: distance, and the unit vector from a's keel to b's
export function keelGap(a, b) {
  const aK = keelHalf(a), bK = keelHalf(b);
  const ux = exact.cos(a.heading) * aK, uy = exact.sin(a.heading) * aK;
  const vx = exact.cos(b.heading) * bK, vy = exact.sin(b.heading) * bK;
  // segments a.x±u and b.x±v, walked as p0 + s*(2u) and q0 + t*(2v)
  const wx = a.x - ux - (b.x - vx), wy = a.y - uy - (b.y - vy);
  const A2 = 4 * (ux * ux + uy * uy), B2 = 4 * (ux * vx + uy * vy), C2 = 4 * (vx * vx + vy * vy);
  const D2 = 2 * (ux * wx + uy * wy), E2 = 2 * (vx * wx + vy * wy);
  const den = A2 * C2 - B2 * B2;
  let s = den > 1e-9 ? clamp((B2 * E2 - C2 * D2) / den, 0, 1) : 0;
  let t = C2 > 1e-9 ? clamp((B2 * s + E2) / C2, 0, 1) : 0;
  s = A2 > 1e-9 ? clamp((B2 * t - D2) / A2, 0, 1) : 0; // settle it after the clamps
  const px = a.x - ux + 2 * ux * s, py = a.y - uy + 2 * uy * s;
  const qx = b.x - vx + 2 * vx * t, qy = b.y - vy + 2 * vy * t;
  let gx = qx - px, gy = qy - py;
  let d = exact.hypot(gx, gy);
  if (d < 1e-6) { gx = b.x - a.x; gy = b.y - a.y; d = exact.hypot(gx, gy) || 1; } // dead aboard her
  return { d, nx: gx / d, ny: gy / d };
}

/**
 * A ram is worth a quarter of the hull BEHIND it, so what she does with her bow scales with the ship
 * she is driving. A flat 26 was right when every hull afloat had a hundred points; against a first
 * rate's three thousand it would be a knock on the door, and the derby is decided by ramming alone.
 */
export const RAM_SHARE = 0.26;
export const ramDmg = (s) => RAM_SHARE * s.maxHull;

export function stepRam(world, dt) {
  const ships = world.ships;
  for (let i = 0; i < ships.length; i++) {
    for (let j = i + 1; j < ships.length; j++) {
      const a = ships[i], b = ships[j];
      if (!a.alive || !b.alive) continue;
      // Consorts cannot ram each other, but no two hulls may ever share the same water. Between
      // sides the blow lands on a consort as it would on anyone, because two hulls meeting at
      // speed is a fact of the sea rather than a choice of target, and nobody is paid or counted
      // for it: `credit` is what `applyHit` is told about the attacker.
      const foes = hostile(world, a, b);
      const hurts = foes || !!world.rules.sides;
      const heldSince = a.locked.get(b);
      if (heldSince !== undefined && world.time - heldSince > RAM_LOCK_MAX) { a.locked.delete(b); b.locked.delete(a); }
      const touch = hullTouch(a, b);
      const { d, nx, ny } = keelGap(a, b); // where the two hulls come nearest to fouling
      // pressed hulls sit right on the touch line and cross it every other frame as they drive
      // together and are pushed apart, so the margin is what keeps this from flickering
      if (d < touch + 4) a.foul = b.foul = true;
      if (d >= touch) {
        // a pair has to break properly clear of each other before it can ram again
        if (d >= touch + RAM_REARM_GAP) { a.locked.delete(b); b.locked.delete(a); }
        continue;
      }
      const toB = exact.atan2(ny, nx); // the line of the impact, from her side to theirs
      // always de-overlap so hulls never sit inside each other
      const ov = touch - d;
      a.x -= nx * ov * 0.5; a.y -= ny * ov * 0.5;
      b.x += nx * ov * 0.5; b.y += ny * ov * 0.5;

      // closing speed along the line of impact, counting how both ships are actually moving:
      // a head-on doubles it, and running from a chaser bleeds it away
      const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      // ...and how much of each ship's own way is driving into the other. That is the ram:
      // a ship crossing or running has none of it, however hard the hulls meet
      const bowA = exact.cos(a.heading - toB), bowB = -exact.cos(b.heading - toB);
      // A hull that has been held on someone's timbers for a while is not ramming anybody: whatever
      // her helmsman is asking for, she is not going anywhere, and the ground she covers between
      // one frame and the next is the shoving rather than any way of her own. Two ships jammed bow
      // to bow are a target, not a threat — including to whoever comes to take advantage of them.
      const driveA = Math.max(0, bowA * a.way), driveB = Math.max(0, bowB * b.way);
      // One curve for every angle: how hard the hulls met. Harder is always worse, whoever you
      // are and wherever it lands, which is what makes a ram something a captain can judge
      const t = clamp((closing - RAM_MIN_CLOSE) / (RAM_FULL_CLOSE - RAM_MIN_CLOSE), 0, 99);
      const force = Math.min(exact.pow(t, RAM_CURVE), RAM_MAX_FORCE);
      // ...and then where it lands only sets its weight: square on the beam a hull is staved in,
      // caught on her fine ends the blow glances along her
      const weigh = (aspect) => RAM_FINE + (RAM_BEAM - RAM_FINE) * aspect;

      let hurtB = 0, hurtA = 0;
      if (hurts && force > 0 && !a.locked.has(b)) {
        if (driveA > 0 && a.ramCd <= 0) hurtB = ramDmg(a) * force * bowA * bowA * weigh(Math.abs(exact.sin(b.heading - toB)));
        if (driveB > 0 && b.ramCd <= 0) hurtA = ramDmg(b) * force * bowB * bowB * weigh(Math.abs(exact.sin(a.heading - toB)));
      }
      if (hurtB > 0 && hurtA > 0) {
        // both bows in it: the one with less way behind her comes off worse, because the ship
        // with more weight behind her drives through what the other has to absorb
        const lead = clamp(driveA / (driveA + driveB), 1 - RAM_MUTUAL_CAP, RAM_MUTUAL_CAP);
        hurtB *= 2 * lead;
        hurtA *= 2 * (1 - lead);
      }
      // hulls kissing at walking pace are not a ram: no damage, no cooldown spent, and the pair
      // stays free to ram properly, so a light touch can never rob a captain of her charge
      if (Math.max(hurtA, hurtB) < RAM_GRAZE) { hurtA = 0; hurtB = 0; }
      let rammed = false;
      // Both blows land, whatever the first one did. They used to resolve in list order with the
      // second skipped if the first had sunk its target, which made every simultaneous kill a
      // survival for the lower-numbered hull, and the player is always hull number one. Two bows
      // meeting at speed can now put both ships under, and each is credited for her blow even
      // when the other's has just sunk her, because she was afloat when she struck.
      const aStanding = a.alive && foes, bStanding = b.alive && foes;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; // where the blow lands, for the screen
      if (hurtB > 0) { applyHit(world, b, "hull", hurtB, a, "ram", aStanding, mx, my); a.ramCd = RAM_CD; a.baffled = 0; if (foes && hurtB >= RAM_GRAZE) a.rams++; rammed = true; }
      if (hurtA > 0) { applyHit(world, a, "hull", hurtA, b, "ram", bStanding, mx, my); b.ramCd = RAM_CD; b.baffled = 0; if (foes && hurtA >= RAM_GRAZE) b.rams++; rammed = true; }
      if (rammed) {
        a.locked.set(b, world.time); b.locked.set(a, world.time);
        // each ship spends the part of her way that went into the impact, so one driving
        // straight in stops dead while one caught across her course carries on. whoever put
        // the least drive into it is the one thrown clear
        const impulse = RAM_KNOCK * clamp(closing / RAM_FULL_CLOSE, 0.3, 1.2);
        const share = driveA / Math.max(1, driveA + driveB);
        const aKnock = impulse * (RAM_RECOIL + (1 - RAM_RECOIL) * (1 - share));
        const bKnock = impulse * (RAM_RECOIL + (1 - RAM_RECOIL) * share);
        a.kx -= nx * aKnock; a.ky -= ny * aKnock;
        b.kx += nx * bKnock; b.ky += ny * bKnock;
        // the share is held to one whole: her measured way can run past her own speed for a
        // moment after a knock, and an unclamped share threw her astern at a fraction of top
        // speed, which is not what spending her way into a blow means
        a.spdCur *= 1 - RAM_DRIVE_LOSS * clamp(driveA / Math.max(1, a.spdCur), 0, 1);
        b.spdCur *= 1 - RAM_DRIVE_LOSS * clamp(driveB / Math.max(1, b.spdCur), 0, 1);
      } else {
        // hulls touching without a charge behind them: gentle nudge, no damage, by the second
        const nudge = HULL_NUDGE * dt;
        a.kx -= nx * nudge; a.ky -= ny * nudge;
        b.kx += nx * nudge; b.ky += ny * nudge;
      }
    }
  }
}

// What each ship actually did with the step, measured once the hulls have been pushed out of one
// another: her velocity over the ground, and how much of it carried her bow forward. A hull that
// could not go forward — jammed against another, shouldered off an island, pinned on the boundary,
// or thrown back by a blow — loses her way to match, and has to gather it again like anyone else.
// The next step's ram is resolved from these.
//
// It is her plain velocity along her heading, with nothing taken back out of it for the shoving.
// An earlier turn of this subtracted the knock, meaning to leave only what she made under her own
// power; but a ship held back by a knock has that knock subtracted the other way, and two hulls
// pressed bow to bow — dead in the water, covering 0.2px/s between them — came out reading 118.
//
// It is smoothed, too. Hulls in contact are driven together and pushed apart again frame by frame,
// so a single frame's difference swings wildly either side of nothing; taking the positive half of
// that swing at face value handed a standing ship the weight of a charging one every other frame.
export function measureWay(world, dt) {
  if (dt <= 0) return;
  for (const s of world.ships) {
    if (!s.alive) continue;
    const ch = exact.cos(s.heading), sh = exact.sin(s.heading);
    const k = Math.min(1, dt * WAY_SMOOTH);
    s.vx += ((s.x - s.px) / dt - s.vx) * k;
    s.vy += ((s.y - s.py) / dt - s.vy) * k;
    s.way = Math.max(0, s.vx * ch + s.vy * sh);
    // and a hull foul of another and going nowhere is baulked, so she loses her way and must gather
    // it again. Only another hull counts: an island or the boundary already checks her by other
    // means, and a ship merely knocked off her stride is still free to sail
    if (s.foul && s.spdCur > 5 && s.way < s.spdCur * BAULK_TOL) s.baulkT += dt;
    else s.baulkT = Math.max(0, s.baulkT - dt * 2);
    if (s.baulkT > BAULK_GRACE) s.spdCur *= exact.exp(-dt * BAULK_RATE);
  }
}

/**
 * THE RAM: two hulls meeting, measured keel to keel, and what the blow is worth.
 */

import { clamp } from "./math.js";

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
  const ux = Math.cos(a.heading) * aK, uy = Math.sin(a.heading) * aK;
  const vx = Math.cos(b.heading) * bK, vy = Math.sin(b.heading) * bK;
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
  let d = Math.hypot(gx, gy);
  if (d < 1e-6) { gx = b.x - a.x; gy = b.y - a.y; d = Math.hypot(gx, gy) || 1; } // dead aboard her
  return { d, nx: gx / d, ny: gy / d };
}

/**
 * A ram is worth a quarter of the hull BEHIND it, so what she does with her bow scales with the ship
 * she is driving. A flat 26 was right when every hull afloat had a hundred points; against a first
 * rate's three thousand it would be a knock on the door, and the derby is decided by ramming alone.
 */
export const RAM_SHARE = 0.26;
export const ramDmg = (s) => RAM_SHARE * s.maxHull;

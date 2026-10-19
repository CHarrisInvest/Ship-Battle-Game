/**
 * THE WEATHER: the ring closing on the middle of the sea, what it does to a crew caught outside it,
 * and how it bends an AI captain's course. The rings themselves are in `tables.js`, beside the
 * modes that carry them.
 */

import { clamp, norm } from "./math.js";
import { STORM_R0, STORM_R2, WORLD } from "./tables.js";
import { killShip } from "./round.js";
import * as exact from "../exact.js";

// The weather takes this share of her FULL crew a second, every second she is out in it, whatever
// class she is and however many hands she has left: ten seconds of exposure is the ship, for a
// gundalow and a first rate alike. It was an absolute figure of hands a second that ramped up over
// STORM_RAMP, which cost a boat of thirty her whole crew in five seconds and a three-decker of eight
// hundred nothing she would miss for most of a minute, so the same weather was a death sentence in
// one hull and an inconvenience in another.
export const STORM_BITE = 0.1;
// Exposure still builds and sheds, because it is what turns an AI captain's course home urgent and
// what deepens the tint on the player's screen; it no longer sets how hard the weather bites.
export const STORM_RAMP = 12; // seconds out in it before her exposure is at its worst
export const STORM_RECOVER = 2.2; // exposure shed a second once she is back inside
// An AI captain is drawn toward the middle rather than fenced away from the edge. Inside STORM_HOME
// of the ring she fights as she pleases; past it the middle bends her course, hardest at the rail.
// It is a preference, not an override, which is what leaves room to shoulder a rival out into the
// weather and hold her there — and once she is out, her own exposure is what turns the pull urgent.
export const STORM_HOME = 0.45; // share of the ring she is content to fight anywhere within
export const STORM_PULL = 0.8; // how hard the middle bends her course at the very rail
// Out in the weather the pull starts where the rail left it and is the whole of her course within
// this many seconds of exposure. It used to start at 0.55, weaker than at the rail she had just
// crossed, and take the full STORM_RAMP of twelve seconds to reach one, which is longer than the
// weather takes to kill a ship: a wounded captain running from a rival ran straight out of the ring
// and was dead before the pull had turned her round.
export const STORM_URGENT = 2;

/** Where the ring stands at `t` seconds, for one mode's weather. */
export const stormRadius = (t, w) => {
  const closed = w.grace + w.close;
  if (t <= closed) return STORM_R0 + (w.ring - STORM_R0) * clamp((t - w.grace) / w.close, 0, 1);
  return w.ring + (STORM_R2 - w.ring) * clamp((t - closed - w.hold) / w.squeeze, 0, 1);
};
/**
 * What the weather is doing at `t`, in the word the HUD prints: `waiting` through the grace,
 * `closing` while the ring comes in, `holding` while it stands at the ring, `closing` again through
 * the squeeze, and `closed` once the eye has shut. Read off the clock rather than off the radius,
 * because the radius is below the ring for the whole of the squeeze, which is when the weather is
 * closing fastest and the pill used to say it had stopped.
 */
export const stormPhase = (t, w) => {
  if (t < w.grace) return "waiting";
  if (t < w.grace + w.close) return "closing";
  if (t < w.grace + w.close + w.hold) return "holding";
  if (t < w.grace + w.close + w.hold + w.squeeze) return "closing";
  return "closed";
};

/** Whether she is out in the weather: afloat, in a mode that has some, and outside the ring. */
export const outInWeather = (world, s) =>
  !!world.rules.storm && s.alive && exact.hypot(s.x - WORLD / 2, s.y - WORLD / 2) > world.stormR;

/**
 * The weather bends whatever a captain meant to do, whichever mode she is sailing in.
 *
 * Well inside the ring it asks nothing; nearer the rail it leans on her course; once she is
 * actually out in it her own exposure decides how hard, so a shove into the weather is something
 * she rides out and a pinning is something she fights her way out of — or does not.
 *
 * Both AIs go through here, and they have to. A gun captain runs from a wound rather than from
 * the ring, and a rival who has driven her to a third of her health is behind her, so the course
 * she picks to save herself is the course that takes her out of the ring: without this she sails
 * out of the round having beaten nobody. It is a lean, not a fence, so shouldering a wounded ship
 * out into the weather and holding her there is still a way of finishing her.
 */
export function weatherCourse(world, s, desired, throttle) {
  if (!world.rules.storm) return { desired, throttle };
  const dc = exact.hypot(s.x - WORLD / 2, s.y - WORLD / 2);
  const out = dc > world.stormR;
  const lean = out
    ? 1 - (1 - STORM_PULL) * clamp(1 - s.exposure / STORM_URGENT, 0, 1)
    : STORM_PULL * clamp((dc / Math.max(1, world.stormR) - STORM_HOME) / (1 - STORM_HOME), 0, 1);
  if (lean <= 0.01) return { desired, throttle };
  const toMid = exact.atan2(WORLD / 2 - s.y, WORLD / 2 - s.x);
  return {
    desired: desired + norm(toMid - desired) * lean, // swing part of the way onto the course home
    throttle: out ? Math.max(throttle, 0.9) : throttle,
  };
}

/**
 * Where a captain running from a rival runs, when the weather has a say: her flight as it was, unless
 * it would carry her out of the ring, in which case she runs round the ring instead, whichever way
 * round lies nearer her flight. A wounded captain's whole reason to run is to live, and the weather
 * kills a ship at a third of her crew in about three seconds, so a flight that opens the range by
 * sailing into it was never a flight. Well inside the ring (`STORM_HOME`) she runs as she pleases.
 */
export function runFromWeather(world, s, away) {
  if (!world.rules.storm) return away;
  const dc = exact.hypot(s.x - WORLD / 2, s.y - WORLD / 2);
  if (dc < world.stormR * STORM_HOME) return away;
  const toMid = exact.atan2(WORLD / 2 - s.y, WORLD / 2 - s.x);
  if (exact.cos(away - toMid) >= 0) return away; // her flight already leads inward
  const a = toMid + Math.PI / 2, b = toMid - Math.PI / 2;
  return exact.cos(a - away) >= exact.cos(b - away) ? a : b;
}

// The squall is weather, not an attack: no captain is paid for it, so it does not run through
// applyHit. It works on the crew, exposed on deck, and the longer they are out in it the harder
// it works — a dash across the weather costs a few hands, living out there costs the ship.
export function stepStorm(world, dt) {
  const w = world.rules.storm;
  if (!w) return;
  world.stormR = stormRadius(world.time, w);
  const cx = WORLD / 2, cy = WORLD / 2;
  // walked backwards because a ship the weather finishes is spliced out from under us
  for (let i = world.ships.length - 1; i >= 0; i--) {
    const s = world.ships[i];
    if (!s.alive) continue;
    const out = exact.hypot(s.x - cx, s.y - cy) > world.stormR;
    if (!out) { s.exposure = Math.max(0, s.exposure - dt * STORM_RECOVER); continue; }
    s.exposure = Math.min(STORM_RAMP, s.exposure + dt);
    // a share of her full complement, not of what is left, so the last hands go as fast as the first
    const bite = STORM_BITE * s.maxCrew;
    s.crew = Math.max(0, s.crew - bite * dt);
    if (s.crew <= 0 && s.alive) { s._deathBar = "storm"; killShip(world, s, null, "storm"); }
  }
}

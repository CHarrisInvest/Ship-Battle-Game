/**
 * THE WEATHER: the ring closing on the middle of the sea, what it does to a crew caught outside it,
 * and how it bends an AI captain's course. The rings themselves are in `tables.js`, beside the
 * modes that carry them.
 */

import { clamp } from "./math.js";
import { STORM_R0, STORM_R2, WORLD } from "./tables.js";

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
  !!world.rules.storm && s.alive && Math.hypot(s.x - WORLD / 2, s.y - WORLD / 2) > world.stormR;

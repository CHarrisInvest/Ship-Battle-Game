/**
 * ACHIEVEMENTS — what a captain has done, worked out rather than remembered.
 *
 * Every achievement here is a *question asked of the hold*, not a flag written when it happens. It
 * has a `count`, which reads the record, and a `goal`, and it is done when the first reaches the
 * second. Nothing about an achievement is stored.
 *
 * That is the whole design, and it buys three things. A captain who sank her first ship long before
 * this file existed has the achievement the moment she opens the screen, because the answer was
 * always in her record. Nothing can drift out of step with the tallies she is looking at on the same
 * screen, because they are the same numbers. And adding one is a row here rather than a row here plus
 * a write in `bankVoyage` plus a migration for everybody who already played.
 *
 * The cost is real and worth stating: an achievement can only ask what the hold actually keeps. The
 * hold keeps totals and bests, so "sink fifty ships" is a row and "sink three in one voyage without
 * touching the carpenter" is not, because nothing counts that. Wanting one of those means adding what
 * it counts to the record first, the way the per-mode tallies were added, and then it too is a row.
 *
 * This file holds no state, touches no storage and imports nothing, for the same reason `shipyard.js`
 * does not: it should be readable as a table and testable as a function.
 */

/**
 * `count(hold)` returns how far along she is, in whatever the achievement counts. `goal` is where it
 * lands. `blurb` is one line a captain reads on the achievements screen, and it says what to *do*,
 * not what she has done, so it reads the same whether or not it is earned.
 *
 * `mode` names a game mode when the achievement belongs to one, which shows as a tag on the card. Most
 * do not: sinking a ship counts wherever it happens.
 */
export const ACHIEVEMENTS = [
  {
    id: "firstSunk",
    name: "First Sunk Ship",
    blurb: "Send one to the bottom.",
    goal: 1,
    count: (h) => h.lifetime.sunk,
  },
];

export const achievementOf = (id) => ACHIEVEMENTS.find((a) => a.id === id) || null;

/** One achievement against one hold: how far, how far to go, and whether it is done. */
export function progressOf(a, hold) {
  const count = Math.max(0, Math.floor(a.count(hold) || 0));
  return { id: a.id, count: Math.min(count, a.goal), goal: a.goal, done: count >= a.goal };
}

/** Every achievement against one hold, earned first, so a captain sees what she has before what she has not. */
export function roll(hold) {
  return ACHIEVEMENTS.map((a) => ({ ...a, ...progressOf(a, hold) })).sort((x, y) => Number(y.done) - Number(x.done));
}

/** The count for the overview: `{ done, total }`. */
export function tally(hold) {
  return { done: ACHIEVEMENTS.filter((a) => progressOf(a, hold).done).length, total: ACHIEVEMENTS.length };
}

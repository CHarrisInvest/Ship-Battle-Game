/**
 * ACHIEVEMENTS — what a captain has done, worked out rather than remembered.
 *
 * Every achievement here is a *question asked of the hold*, not a flag written when it happens. It
 * has a `count`, which reads the record, and a goal, and it is done when the first reaches the
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
 * A LADDER is one achievement with several goals, climbed in order. "Ships sunk" is one card that
 * reads 1, then 10, then 25, and so on up to 500, rather than twelve cards asking the same question
 * with a bigger number in it. Each goal is a rung, a rung is what the overview counts, and the card
 * shows the rung she is on. A single goal is a ladder of one and is written `goal` for short.
 *
 * This file holds no state, touches no storage and imports nothing, for the same reason `shipyard.js`
 * does not: it should be readable as a table and testable as a function.
 */

/**
 * `count(hold)` returns how far along she is, in whatever the achievement counts. `goals` is where
 * the rungs land, lowest first, or `goal` for a single one. `blurb` is one line a captain reads on the
 * achievements screen, and it says what to *do*, not what she has done, so it reads the same whether
 * or not it is earned; on a ladder it is a function of the rung's goal, so it says what to do next.
 *
 * `unit` says how the figure prints: a plain count unless it says `time`, which is seconds in the
 * record and minutes or hours on the card, or `coins`.
 *
 * `mode` names a game mode when the achievement belongs to one, which shows as a tag on the card. Most
 * do not: sinking a ship counts wherever it happens.
 *
 * `rewards` is what each rung pays into the hold, in coins, one figure a rung, or `reward` for a
 * single goal. The figures are a table rather than a formula so a card can be read against them. They
 * are a sweetener and not an economy: the whole list pays out less than a first rate costs, and a rung
 * pays about what a voyage does. The paying is the hold's business (`settle` in `hold.js`), which
 * keeps a ledger of rungs paid; this file only says what a rung is worth.
 */

// The rolling count most deeds climb. Long on purpose: the top of it is a career, not a season.
const COUNT_RUNGS = [1, 10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500];
const COUNT_PAY = [10, 25, 50, 100, 150, 200, 300, 400, 500, 600, 800, 1000];
// What a single card pays: a first done one way, a first win, a name given.
const FIRST_PAY = 50;
const WIN_PAY = 100;

const modeCount = (h, mode, key) => (h.modes[mode] ? h.modes[mode][key] || 0 : 0);
const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
// "a ship" for one rather than "1 ship", which reads as a number dropped into a slot
const ships = (n) => (n === 1 ? "a ship" : plural(n, "ship", "ships"));

/** A span of seconds as a captain reads it on a card: whole minutes under an hour as `10 min`, hours above as `3 hr`. */
export function spanOf(sec) {
  if (sec < 3600) return `${Math.floor(sec / 60)} min`;
  return `${Math.floor(sec / 3600).toLocaleString()} hr`;
}

export const ACHIEVEMENTS = [
  {
    id: "sunk",
    name: "Ships sunk",
    blurb: (g) => (g === 1 ? "Sink one ship." : `Sink ${g} ships.`),
    goals: COUNT_RUNGS,
    rewards: COUNT_PAY,
    count: (h) => h.lifetime.sunk,
  },
  {
    id: "dismasted",
    name: "Masts brought down",
    blurb: (g) => (g === 1 ? "Bring down a mast with the bow gun." : `Bring down ${g} masts.`),
    goals: COUNT_RUNGS,
    rewards: COUNT_PAY,
    count: (h) => h.lifetime.dismasted,
  },
  {
    id: "rams",
    name: "Rams landed",
    blurb: (g) => (g === 1 ? "Drive your bow into a rival's beam." : `Land ${g} rams into a ship's beam.`),
    goals: COUNT_RUNGS,
    rewards: COUNT_PAY,
    count: (h) => h.lifetime.rams,
  },
  {
    id: "dmg",
    name: "Damage dealt",
    blurb: (g) => `Deal ${g.toLocaleString()} hull damage.`,
    goals: [1000, 10000, 50000, 250000],
    rewards: [25, 100, 250, 500],
    count: (h) => h.lifetime.dmg,
  },
  {
    id: "patches",
    name: "Repairs bought",
    blurb: (g) => (g === 1 ? "Buy a repair from the carpenter." : `Buy ${g} repairs from the carpenter.`),
    goals: [1, 10, 25, 50, 100, 250],
    rewards: [10, 25, 50, 100, 200, 500],
    count: (h) => h.lifetime.patches,
  },
  {
    id: "healed",
    name: "Damage repaired",
    blurb: (g) => `Repair ${g.toLocaleString()} points of hull damage.`,
    goals: [500, 5000, 25000, 100000],
    rewards: [25, 100, 250, 500],
    count: (h) => h.lifetime.healed,
  },
  {
    id: "afloat",
    name: "Time afloat",
    blurb: (g) => `Spend ${spanOf(g)} at sea.`,
    goals: [600, 1800, 3600, 10800, 36000, 86400],
    rewards: [25, 50, 100, 250, 500, 1000],
    unit: "time",
    count: (h) => h.lifetime.afloat,
  },
  {
    id: "earned",
    name: "Into the hold",
    blurb: (g) => `Bank ${g.toLocaleString()} coins from voyages.`,
    goals: [100, 1000, 10000, 100000],
    rewards: [10, 50, 250, 1000],
    unit: "coins",
    count: (h) => h.lifetime.earned,
  },
  {
    id: "arenaVoyage",
    name: "Arena streak",
    blurb: (g) => `Sink ${ships(g)} in a single arena voyage.`,
    goals: [1, 3, 5, 10, 15, 20, 30],
    rewards: [10, 25, 50, 100, 200, 300, 500],
    mode: "arena",
    count: (h) => modeCount(h, "arena", "bestSunk"),
  },
  {
    id: "arenaSunk",
    name: "Arena total",
    blurb: (g) => `Sink ${ships(g)} in the arena, across all voyages.`,
    goals: [5, 25, 50, 100, 250, 500],
    rewards: [25, 50, 100, 200, 500, 1000],
    mode: "arena",
    count: (h) => modeCount(h, "arena", "sunk"),
  },
  {
    id: "sunkByRam",
    name: "Sunk by the bow",
    blurb: "Sink a ship by ramming her.",
    goal: 1,
    reward: FIRST_PAY,
    count: (h) => h.lifetime.sunkByRam,
  },
  {
    id: "sunkByGuns",
    name: "Sunk by the guns",
    blurb: "Sink a ship with side cannons.",
    goal: 1,
    reward: FIRST_PAY,
    count: (h) => h.lifetime.sunkByGuns,
  },
  {
    id: "sunkByMuskets",
    name: "Crew routed",
    blurb: "Clear a ship's crew with muskets.",
    goal: 1,
    reward: FIRST_PAY,
    count: (h) => h.lifetime.sunkByMuskets,
  },
  {
    id: "rammedWhole",
    name: "By ramming alone",
    blurb: "Sink a ship from ramming only.",
    goal: 1,
    reward: FIRST_PAY,
    // the derby is left out because it would be true of every sinking there: there are no guns in it
    count: (h) => modeCount(h, "arena", "rammedWhole") + modeCount(h, "ffa", "rammedWhole"),
  },
  {
    id: "wornDown",
    name: "Worn down",
    blurb: "Sink a ship after taking half hull, mast and crew health.",
    goal: 1,
    reward: FIRST_PAY,
    count: (h) => h.lifetime.wornDown,
  },
  {
    id: "ffaWin",
    name: "Last of eleven",
    blurb: "Win a free-for-all.",
    goal: 1,
    reward: WIN_PAY,
    mode: "ffa",
    count: (h) => modeCount(h, "ffa", "wins"),
  },
  {
    id: "derbyWin",
    name: "Derby won",
    blurb: "Win a demolition derby.",
    goal: 1,
    reward: WIN_PAY,
    mode: "derby",
    count: (h) => modeCount(h, "derby", "wins"),
  },
  {
    id: "christened",
    name: "Christened",
    blurb: "Give a ship a name in the yard.",
    goal: 1,
    reward: 25,
    // asked of the yard rather than the tallies: a named ship is one whose record carries a name
    count: (h) => Object.values(h.yard.ships).filter((s) => s.name).length,
  },
];

export const achievementOf = (id) => ACHIEVEMENTS.find((a) => a.id === id) || null;

/** The rungs of one achievement, lowest first. A single `goal` is a ladder of one. */
export const goalsOf = (a) => a.goals || [a.goal];

/** What each rung pays, in step with `goalsOf`. A rung with no figure against it pays nothing. */
export const rewardsOf = (a) => a.rewards || [a.reward || 0];

/** What rung `i` (from 0) of one achievement pays. */
export const rewardOf = (a, i) => rewardsOf(a)[i] || 0;

/**
 * One achievement against one hold: how far she is, the rung she is climbing and where it lands,
 * how many rungs there are and how many she holds, and whether the whole ladder is done.
 *
 * `goal` is the next rung while there is one and the top rung after, so `count of goal` always reads
 * against something; `count` is held to it for the same reason. `blurb` is resolved to the line for
 * that rung, so the card says what to do next rather than what the ladder is, and `reward` is what
 * that rung pays, or nothing once the ladder is climbed.
 */
export function progressOf(a, hold) {
  const goals = goalsOf(a);
  const raw = Math.max(0, Math.floor(a.count(hold) || 0));
  const rung = goals.filter((g) => raw >= g).length;
  const done = rung >= goals.length;
  const goal = done ? goals[goals.length - 1] : goals[rung];
  const blurb = typeof a.blurb === "function" ? a.blurb(goal) : a.blurb;
  const reward = done ? 0 : rewardOf(a, rung);
  return { id: a.id, count: Math.min(raw, goal), goal, rung, rungs: goals.length, done, blurb, reward };
}

/**
 * Every achievement against one hold, in list order. The screen splits them, the ladders into one
 * table and the single goals into cards, and orders each its own way, so nothing is sorted here.
 */
export function roll(hold) {
  return ACHIEVEMENTS.map((a) => ({ ...a, ...progressOf(a, hold) }));
}

/** The count for the overview: `{ done, total }`, in rungs, so a ladder half climbed counts for half. */
export function tally(hold) {
  return ACHIEVEMENTS.reduce(
    (t, a) => {
      const p = progressOf(a, hold);
      return { done: t.done + p.rung, total: t.total + p.rungs };
    },
    { done: 0, total: 0 },
  );
}

/**
 * The figure on a card: `count/goal` in the achievement's unit. The count is always the whole
 * figure, grouped, because it is the one that moves and a captain reads it against the tally on the
 * screen before; the goal is fixed and reads in thousands from a thousand up, `999/1k`, `12,000/50k`,
 * so the k is said once and on the number that never changes. Time is minutes under an hour and
 * hours above, to a tenth on the count so an hour and a half does not read as one.
 */
export function fmtProgress(a, p) {
  return progressParts(a, p).join("/");
}

/** A goal in thousands to one place, the place dropped when it is a nought: 1,500 is 1.5k and 15,000 is 15k. */
export const inK = (n) => `${Math.round(n / 100) / 10}k`;

/** The same figure in two parts, the count and the goal, for a cell that sets them either side of the slash. */
export function progressParts(a, p) {
  if (a.unit === "time") {
    if (p.goal < 3600) return [String(Math.floor(p.count / 60)), spanOf(p.goal)];
    const h = Math.floor((p.count / 3600) * 10) / 10;
    return [h.toLocaleString(), spanOf(p.goal)];
  }
  return [p.count.toLocaleString(), p.goal >= 1000 ? inK(p.goal) : p.goal.toLocaleString()];
}

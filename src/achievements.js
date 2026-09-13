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

/** A span of seconds as a captain reads it on a card: whole minutes under an hour, hours above. */
export function spanOf(sec, precise = false) {
  if (sec < 3600) return plural(Math.floor(sec / 60), "minute", "minutes");
  const h = sec / 3600;
  const shown = precise ? Math.round(h * 10) / 10 : Math.floor(h);
  return `${shown.toLocaleString()} ${h === 1 ? "hour" : "hours"}`;
}

export const ACHIEVEMENTS = [
  {
    id: "sunk",
    name: "Ships sunk",
    blurb: (g) => (g === 1 ? "Send one to the bottom." : `Send ${g} to the bottom.`),
    goals: COUNT_RUNGS,
    rewards: COUNT_PAY,
    count: (h) => h.lifetime.sunk,
  },
  {
    id: "dismasted",
    name: "Masts brought down",
    blurb: (g) => (g === 1 ? "Bring down a mast with the bow gun." : `Bring down ${g} masts with the bow gun.`),
    goals: COUNT_RUNGS,
    rewards: COUNT_PAY,
    count: (h) => h.lifetime.dismasted,
  },
  {
    id: "rams",
    name: "Rams landed",
    blurb: (g) => (g === 1 ? "Drive your bow into a rival's beam." : `Land ${g} rams. Her beam, not her bow.`),
    goals: COUNT_RUNGS,
    rewards: COUNT_PAY,
    count: (h) => h.lifetime.rams,
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
    blurb: "Sink a ship with your side guns.",
    goal: 1,
    reward: FIRST_PAY,
    count: (h) => h.lifetime.sunkByGuns,
  },
  {
    id: "sunkByMuskets",
    name: "Crew routed",
    blurb: "Clear a ship's crew with muskets until she strikes.",
    goal: 1,
    reward: FIRST_PAY,
    count: (h) => h.lifetime.sunkByMuskets,
  },
  {
    id: "rammedWhole",
    name: "By the bow alone",
    blurb: (g) => `In the arena or the free-for-all, sink ${ships(g)} with your ram and not one ball into her hull.`,
    goals: [1, 5, 25],
    rewards: [50, 150, 500],
    // the derby is left out because it would be true of every sinking there: there are no guns in it
    count: (h) => modeCount(h, "arena", "rammedWhole") + modeCount(h, "ffa", "rammedWhole"),
  },
  {
    id: "wornDown",
    name: "Worn down",
    blurb: (g) => `Sink ${ships(g)} after taking half her hull, half her mast and half her crew yourself.`,
    goals: [1, 10, 50],
    rewards: [50, 200, 750],
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
    id: "arenaVoyage",
    name: "In one arena voyage",
    blurb: (g) => `Sink ${ships(g)} in a single arena voyage.`,
    goals: [1, 3, 5, 10, 15, 20, 30],
    rewards: [10, 25, 50, 100, 200, 300, 500],
    mode: "arena",
    count: (h) => modeCount(h, "arena", "bestSunk"),
  },
  {
    id: "arenaSunk",
    name: "Arena, all told",
    blurb: (g) => `Sink ${ships(g)} in the arena, over every voyage.`,
    goals: [5, 25, 50, 100, 250, 500],
    rewards: [25, 50, 100, 200, 500, 1000],
    mode: "arena",
    count: (h) => modeCount(h, "arena", "sunk"),
  },
  {
    id: "patches",
    name: "Repairs bought",
    blurb: (g) => (g === 1 ? "Buy a repair from the carpenter at sea." : `Buy ${g} repairs from the carpenter at sea.`),
    goals: [1, 10, 25, 50, 100, 250],
    rewards: [10, 25, 50, 100, 200, 500],
    count: (h) => h.lifetime.patches,
  },
  {
    id: "healed",
    name: "Damage repaired",
    blurb: (g) => `Have the carpenter put back ${g.toLocaleString()} points of damage.`,
    goals: [500, 5000, 25000, 100000],
    rewards: [25, 100, 250, 500],
    count: (h) => h.lifetime.healed,
  },
  {
    id: "dmg",
    name: "Damage dealt",
    blurb: (g) => `Deal ${g.toLocaleString()} points of damage, by gun and by bow.`,
    goals: [1000, 10000, 50000, 250000],
    rewards: [25, 100, 250, 500],
    count: (h) => h.lifetime.dmg,
  },
  {
    id: "afloat",
    name: "Time afloat",
    blurb: (g) => `Spend ${spanOf(g)} at sea, across every voyage.`,
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
    id: "repaired",
    name: "Paid to the carpenter",
    blurb: (g) => `Spend ${g.toLocaleString()} coins on repairs at sea.`,
    goals: [100, 1000, 10000, 100000],
    rewards: [10, 50, 250, 1000],
    unit: "coins",
    count: (h) => h.lifetime.repaired,
  },
  {
    id: "christened",
    name: "Christened",
    blurb: "Give a ship a name of her own, in the yard.",
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

/** Every achievement against one hold, earned first, so a captain sees what she has before what she has not. */
export function roll(hold) {
  return ACHIEVEMENTS.map((a) => ({ ...a, ...progressOf(a, hold) })).sort((x, y) => Number(y.done) - Number(x.done));
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
 * The figure on a card, `count of goal` in the achievement's unit. Time is minutes under an hour and
 * hours above, to a tenth on the count so an hour and a half does not read as one; coins and counts
 * are grouped numerals.
 */
export function fmtProgress(a, p) {
  if (a.unit === "time") {
    if (p.goal < 3600) return `${Math.floor(p.count / 60)} of ${spanOf(p.goal)}`;
    const h = Math.floor((p.count / 3600) * 10) / 10;
    return `${h.toLocaleString()} of ${spanOf(p.goal)}`;
  }
  return `${p.count.toLocaleString()} of ${p.goal.toLocaleString()}`;
}

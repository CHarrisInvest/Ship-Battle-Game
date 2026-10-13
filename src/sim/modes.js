/**
 * THE MODES, as rules the engine reads. What a mode is called, its colour and the card that sells
 * it belong to the menu and sit beside it in `SternchaseIso.jsx`.
 */

import { arenaHunter, ladderRung } from "../shipyard.js";
import { ARENA_START, ARENA_MAX_ENEMIES, FFA_AI, DERBY_AI, DERBY_WEATHER, FFA_WEATHER, arenaReinforcements } from "./tables.js";

/**
 * A mode is a set of rules, not a name to compare against. Everything that used to ask "are we in
 * free-for-all?" now asks what it actually wants to know — are guns aboard, is every hull hostile to
 * every other, does anyone keep a placement — so each rule is stated once, here, where the modes can
 * be read side by side. Adding a mode is filling in a row rather than hunting down the checks that
 * would otherwise have to be taught about it.
 *
 * A row is plain data, which is what lets a world carry its rules and still be copied whole: the two
 * rules that are worked out rather than read, how many hunters a sinking brings and which stock ship
 * each one is, name a rule in `REINFORCE` and `HUNTERS` instead of carrying it as a function.
 */
export const MODES = {
  wave: {
    key: "wave",
    rivals: ARENA_START, // hulls on the water at the drop, besides the player
    guns: true, // cannons and muskets aboard
    repairs: true, // the repair rail, paid for out of the voyage's own earnings
    melee: false, // every hull hostile to every other, rather than only to the player
    ranked: false, // placements, a leader, and the rank badge
    lastAfloatWins: false,
    reinforcements: true, // a sinking brings fresh hunters in from the horizon
    reinforce: "arena", // ...how many, by her nth sinking (`REINFORCE` below)
    fleetCap: ARENA_MAX_ENEMIES, // ...and how many may be on the water at once
    hunter: "arena", // ...and which stock ship each is (`HUNTERS` below)
    ladder: false, // the round is won at the top of the stock fleet, one ship at a time
    flees: false, // a beaten captain runs rather than fights on
    storm: null, // the shape of her closing ring of foul weather, or nothing for open sea
    timeCoins: 0, // coins a second afloat, on top of what her guns and bow earn
    fullRound: 0, // ...and the span a winner is paid for whatever the clock said
    winBonus: 0,
  },
  ladder: {
    key: "ladder",
    rivals: ARENA_START,
    guns: true,
    repairs: true,
    melee: false,
    ranked: false,
    lastAfloatWins: false,
    reinforcements: true,
    reinforce: "ladder", // one for one: the next rung sails in as the last goes under
    fleetCap: 1,
    hunter: "ladder", // the fleet in order, whatever she sails
    ladder: true,
    flees: false,
    storm: null,
    timeCoins: 0,
    fullRound: 0,
    // Sinking the whole fleet in one voyage is paid on top of the forty-odd bounties it took, and
    // the achievement for it pays besides. Bigger than a free-for-all's purse because it is the
    // longest round in the game and there is only one way to end it well.
    winBonus: 200,
  },
  ffa: {
    key: "ffa",
    rivals: FFA_AI,
    guns: true,
    repairs: true,
    melee: true,
    ranked: true,
    lastAfloatWins: true,
    reinforcements: false,
    reinforce: null,
    fleetCap: 0,
    hunter: null,
    ladder: false,
    flees: true,
    // Weather came late to this mode and it came for the same reason it came to the derby: three
    // wounded captains keeping their distance is not a fight, and a hull that runs at a third of her
    // health can run for a very long time on a sea two thousand paces across. Her ring is wider and
    // slower than the derby's, so the gunnery half of the round happens in open water and only the
    // end of it is fought where the weather says.
    storm: FFA_WEATHER,
    // Time afloat is NOT paid here. It was, a coin a second as in the derby, and a captain who sat
    // in the middle of the ring and fired nothing was the last afloat at three minutes with 230
    // coins for it, against a tenth of that for a round of fighting: the best wage in the game was
    // for staying out of the game. Her guns pay her, by the point, and the weather is what makes
    // sure a round ends; the derby keeps its purse because it has no guns to pay anybody with.
    timeCoins: 0,
    fullRound: 0,
    // ...and a purse for outlasting ten rivals. Smaller than the derby's, because a free-for-all
    // captain has been paid all round for the fighting that got her there and a derby captain has
    // not: there are no guns in that mode, so the win is most of what it pays.
    winBonus: 25,
  },
  derby: {
    key: "derby",
    rivals: DERBY_AI,
    guns: false,
    repairs: false,
    melee: true,
    ranked: true,
    lastAfloatWins: true,
    reinforcements: false,
    reinforce: null,
    fleetCap: 0,
    hunter: null,
    ladder: false,
    flees: false, // there is nowhere to run to, and the weather is coming anyway
    storm: DERBY_WEATHER,
    // Staying afloat is most of the work here, so it is paid by the second — and a winner is paid for
    // a whole round however early she ended it. Settling the thing in forty seconds is worth the same
    // purse as outlasting the weather for the full span, which is to say it is worth far more an hour:
    // the time she saves is hers to spend on the next one. A round left alone runs
    // the whole of DERBY_WEATHER, 168 seconds as it is tuned; the winner's is a set purse a shade
    // above that, so a win comes to 250 whatever else she took.
    timeCoins: 1,
    fullRound: 175,
    winBonus: 75,
  },
};
// Menu order, and the order the hold's per-mode bests are listed in. The two arenas sit last and
// together: the wave arena is the hardest opening a new captain can pick, since the sea keeps
// filling up behind every ship she sinks, and the ladder is the longest round in the game. The
// first card is the one most players will take.
export const MODE_LIST = ["ffa", "derby", "wave", "ladder"];
export const modeOf = (m) => MODES[m] || MODES.wave;

// The worked-out rules a row names. `reinforce` takes her nth sinking and says how many sail in;
// `hunter` takes what her ship measures and how many she has sunk, and says which stock ship comes
// next, or nothing once the ladder has no rung left.
const REINFORCE = {
  arena: arenaReinforcements,
  ladder: () => 1,
};
const HUNTERS = {
  arena: (strength, kills) => arenaHunter(strength.overall, kills),
  ladder: (strength, kills) => ladderRung(kills),
};
/** How many hunters her nth sinking brings in, under a mode that sends any. */
export const reinforcementsOf = (rules, n) => REINFORCE[rules.reinforce](n);
/** Which stock ship sails in next, or nothing when there is none left to send. */
export const hunterOf = (rules, strength, kills) => HUNTERS[rules.hunter](strength, kills);

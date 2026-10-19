/**
 * THE TABLES THE WHOLE ENGINE SHARES: the size of the sea, the field each mode puts on it, the
 * weather's rings, and the three weapons.
 *
 * Every other tuning figure lives beside the system it tunes, in `storm.js`, `ram.js`, `ai.js` and
 * the rest. These are here because more than one module reads them as it loads, and a figure two
 * modules need at load time has to sit in one that imports nothing, or the order the modules happen
 * to load in decides whether it exists yet.
 */

export const WORLD = 2000;
// How far apart captains are dropped when a round has more than one of them: about a quarter of
// the sea, so nobody opens the round inside another captain's broadside. A full lobby may not fit
// at this gap, and then each takes the clearest water left.
export const HUMAN_SPAWN_GAP = 450;
export const FFA_AI = 10;

// TWO SIDES: a round with friends fought as two fleets rather than as a melee. The sides are named
// for where they open, the left flank of the sea and the right, and every ship carries one. A side
// holds `SIDE_MIN` to `SIDE_MAX` ships, captains and AI together, and the host picks the figure; the
// AI fill whatever places the captains leave, so a side can be captains alone or AI alone. Twelve
// ships at most, which is a shade over the melee's eleven and well under what the wave arena draws.
export const SIDES = ["left", "right"];
export const SIDE_MIN = 3;
export const SIDE_MAX = 6;
export const TEAMS_SIDE = 4; // ships a side when the host has not said
// How far in from the sea's edge a side is drawn up, and how far apart along it her ships lie. A
// broadside carries 220, so two lines 1480 apart open well out of each other's reach, and a line of
// six at this spacing spans 1100 of the sea's 2000, inside the water the islands are planted in.
export const FLANK = 260;
export const LINE_GAP = 220;

// THE ARENAS: two modes that replace what she sinks from the horizon, and differ in what they send.
// The wave arena grows the swarm rather than the ships: reinforcements sail in from the map edge,
// and the hunters climb the stock ladder only until they have caught her up. The ladder arena sends
// exactly one ship at a time, the whole stock fleet in order, and the ships are the whole of the
// escalation. Both open with one hunter on the water.
export const ARENA_START = 1; // hunters afloat when the round opens
export const ARENA_RAMP = [1, 2, 1, 2]; // wave: reinforcements for the first four kills, then 2 every kill
export const ARENA_SPAWN_CLEAR = 620; // keep a respawn at least this far from the player
export const ARENA_MAX_ENEMIES = 14; // wave: ceiling so the fleet stays drawable
export const ARENA_SPAWN_GAP = 5; // the second ship of a wave holds off this long

// nth kill (1-indexed) -> how many ships sail in to replace the one that sank
export const arenaReinforcements = (n) => ARENA_RAMP[n - 1] ?? 2;

// DERBY: ten bows, no guns, nothing to buy, and a squall closing on the middle of the sea. Without
// cannon nobody's mast can be brought down, so every hull holds the same top speed all match and a
// runner could never be caught — the ring is what makes the fight happen.
export const DERBY_AI = 9; // rivals, so ten captains start

/**
 * THE WEATHER: a ring closing on the middle of the sea, and why the two modes that carry one want
 * different rings.
 *
 * A ring opens wider than the map's own corners, so the grace period really is open water, and closes
 * onto the middle, which the island generator leaves clear to whatever size that mode's ring works at.
 * Outside it the crew works the deck in a gale: survivable for a dash across the weather, ruinous for
 * anyone who tries to live out there.
 *
 * ...and then, if the last of them are still circling one another, the eye itself shuts. A working
 * ring is not enough on its own: a ram needs closing speed to count for anything, and two ships penned
 * in a pool a hundred paces across can mill about forever without ever getting the run at each other
 * that would settle it — measured at better than two minutes of it. Weather asks nobody for a run-up,
 * so the ring goes to nothing instead, and the last hull afloat is the one with crew enough to outlast
 * the sea. However cagey the sailing, a round has an end.
 *
 * **The shape of it belongs to the mode, because what the ring has to leave room for is not the same
 * thing in both.** The derby is settled at the length of a bowsprit and its ring is the size of the
 * fight it is forcing. A free-for-all is settled by gunfire, and a broadside carries better than two
 * hundred: pen that fight into the derby's ring and every ship inside it lies under every other
 * ship's guns from the moment it closes, which is not a fight either, only a bonfire. So the
 * free-for-all works at a wider ring, and takes longer to get there, because ten captains with guns
 * thin themselves out long before the weather is what settles anything.
 */
export const STORM_R0 = 1400; // opening radius — just past the far corners of the map, so closing bites at once
export const STORM_R2 = 0; // ...and the eye shuts to nothing
// The four times add up to how long a round runs when nobody settles it sooner: 168 seconds in the
// derby, 200 in the free-for-all. The derby's `fullRound` purse sits a shade above its figure.
export const DERBY_WEATHER = { grace: 18, close: 95, ring: 190, hold: 20, squeeze: 35 };
export const FFA_WEATHER = { grace: 40, close: 100, ring: 300, hold: 25, squeeze: 35 };

export const WP = {
  // `draw` overrides SHOT_DRAW for one weapon. Round shot off the side is drawn at exactly the size
  // it bites now: there are fifty of them coming off a first rate and a ball that looked smaller
  // than its own reach would be reading the volley wrong at the moment it matters most. Each `r` is
  // 1.5 times what it was before the hulls grew, the same `SEA_SIZE` they were grown by.
  broadside: { cd: 1.6, speed: 250, life: 0.88, r: 2.7, draw: 1, bar: "hull" },
  bow: { cd: 1.1, speed: 270, life: 1.4, r: 3.9, bar: "mast" },
  musket: { cd: 0.75, speed: 320, life: 0.4, r: 2.4, bar: "crew" },
};

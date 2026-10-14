/**
 * THE ENGINE: what happens in a round, and nothing about how it looks.
 *
 * Everything under `src/sim/` runs the same in a browser and in plain Node. It imports only itself
 * and the catalogue modules that are already pure (`shipyard.js`, `shipref.js` and `hullform.js`),
 * and it never touches the page, the hold, a canvas, the clock or `Math.random`. `npm run purity`
 * holds it to that, and runs before every build; `npm run sim-test` plays every mode through here
 * in plain Node.
 *
 * The whole of the interface is five functions and one constant:
 *
 *   createWorld({ mode, seed, players })   a fresh round, as plain data
 *   step(world, inputs)                    one TICK of it, and the events that happened in it
 *   voyageStats(world, playerId)           what a player has earned so far
 *   repairQuote(world, playerId, system)   what a repair would cost her, without making it
 *   playOn(world)                          the rest of a round she has sunk out of, to watch
 *
 * Everything a round needs goes in through those arguments and everything it produces comes back
 * as data: the world itself, the events `step` returns, and `world.result` once it is over. The
 * screen draws the one, turns the second into smoke and numbers, and banks the third; the engine
 * never draws, saves or reports anything itself. The rest of what is exported here is the engine's
 * own figures and readers, for a screen that needs to show them.
 */

import { isHuman, shipOf, stepHuman } from "./ships.js";
import { stepAI } from "./ai.js";
import { stepRam, measureWay } from "./ram.js";
import { stepStorm } from "./storm.js";
import { stepVolley, stepShots } from "./weapons.js";
import { maintain } from "./world.js";
import { computeMeta, judge } from "./round.js";
import { repairQuote as quoteRepair } from "./repairs.js";

export * from "./math.js";
export * from "./rng.js";
export * from "./tables.js";
export * from "./modes.js";
export * from "./storm.js";
export * from "./ships.js";
export * from "./weapons.js";
export * from "./ram.js";
export * from "./repairs.js";
export * from "./round.js";
export * from "./ai.js";
export * from "./world.js";

/** Seconds per step. */
export const TICK = 1 / 60;

/**
 * One captain's controls for a step: the stick's reach and bearing (a world heading), the three
 * fire buttons held or not, and a repair asked for since the last step, "hull" or "mast", which is
 * spent by the step that reads it. A human with no record this step sails as though her hands
 * were off everything.
 */
export const NO_INPUT = { joyMag: 0, joyAng: 0, broadside: false, bow: false, musket: false, repair: null };

const INPUT_KEYS = Object.keys(NO_INPUT);

/**
 * Whether `x` is a record the controls could have produced: exactly `NO_INPUT`'s keys, the stick's
 * reach a number from 0 to 1 and its bearing a finite number, the fire buttons true or false, and no
 * repair or one of the two there are. The server replays a round from what the browser says it
 * stepped with, so anything else is refused rather than read in some way the browser did not.
 */
export function isInput(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const keys = Object.keys(x);
  if (keys.length !== INPUT_KEYS.length || !INPUT_KEYS.every((k) => Object.prototype.hasOwnProperty.call(x, k))) return false;
  if (typeof x.joyMag !== "number" || !(x.joyMag >= 0 && x.joyMag <= 1)) return false;
  if (typeof x.joyAng !== "number" || !Number.isFinite(x.joyAng)) return false;
  if (typeof x.broadside !== "boolean" || typeof x.bow !== "boolean" || typeof x.musket !== "boolean") return false;
  return x.repair === null || x.repair === "hull" || x.repair === "mast";
}

/**
 * One step of the round, exactly one `TICK` long. `inputs` is keyed by player id, one record per
 * human. Returns what
 * happened during it, as events that carry ids and numbers and never a reference into the world,
 * so they can be drawn, counted or sent anywhere. A round that is over stays over: stepping it
 * again does nothing and says nothing.
 *
 * The order is the order a frame always ran in. Her own ship first, off her controls, then every
 * rival; then the hulls that met are rammed apart, each ship's way is measured, the weather bites,
 * the guns still to go off in a rolling broadside fire, every ball in the air flies, an arena tops
 * its fleet up, and last of all the round is judged on what the step left.
 */
export function step(world, inputs = {}) {
  const dt = TICK;
  if (world.result.over) return [];
  world.events = [];
  world.tick += 1;
  world.time += dt;
  computeMeta(world);
  // where she started the step and which way she pointed, which is what the screen draws her
  // between; and whether she is foul of anyone, which the step finds out afresh
  for (const s of world.ships) { s.px = s.x; s.py = s.y; s.pHeading = s.heading; s.foul = false; }
  for (const s of world.ships) if (isHuman(s)) stepHuman(world, s, inputs[s.playerId] || NO_INPUT, dt);
  for (const s of world.ships) if (!isHuman(s)) stepAI(world, s, dt);
  stepRam(world, dt);
  measureWay(world, dt);
  stepStorm(world, dt);
  stepVolley(world);
  stepShots(world, dt);
  maintain(world, dt);
  judge(world);
  const events = world.events;
  world.events = [];
  return events;
}

/** What one repair would put back on a player's ship and what it would cost her, as the rail shows it. */
export function repairQuote(world, playerId, system) {
  return quoteRepair(shipOf(world, playerId), system);
}

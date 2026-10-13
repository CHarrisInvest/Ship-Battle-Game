/**
 * A voyage replayed: the world built again from the round's seed, mode and loadout, stepped through
 * the input log, the input in force at each step being the last entry at or before its tick and
 * `NO_INPUT` before the first. The same engine the browser ran, so the same round, to the bit.
 *
 * Plain function, so the tests can call it; `replay-worker.js` runs it off the request loop.
 */

import { createWorld, step, voyageRun, NO_INPUT } from "../src/sim/index.js";

/** The captain's id in a single-player round, as the browser's `ME`. */
export const PLAYER = "p1";

/**
 * `{ over, ticks, run, result }` for the round `{ mode, seed, loadout }` sailed through `entries`
 * (`[tick, input]`, in order) for at most `maxTicks` steps. `over` is whether the round ended by then.
 */
export function replay({ mode, seed, loadout }, entries, maxTicks) {
  const world = createWorld({ mode, seed, players: [{ id: PLAYER, loadout }] });
  let input = NO_INPUT, k = 0;
  while (!world.result.over && world.tick < maxTicks) {
    while (k < entries.length && entries[k][0] <= world.tick) input = entries[k++][1];
    step(world, { [PLAYER]: input });
  }
  return {
    over: world.result.over,
    ticks: world.tick,
    unread: entries.length - k, // entries the round never reached
    run: world.result.over ? voyageRun(world, PLAYER) : null,
    result: world.result.over ? world.result : null,
  };
}

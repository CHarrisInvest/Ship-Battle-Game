/**
 * THE ENGINE: what happens in a round, and nothing about how it looks.
 *
 * Everything under `src/sim/` runs the same in a browser and in plain Node. It imports only itself
 * and the catalogue modules that are already pure (`shipyard.js`, `shipref.js` and `hullform.js`),
 * and it never touches the page, the hold, a canvas, the clock or `Math.random`. `npm run purity`
 * holds it to that, and runs before every build.
 */

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

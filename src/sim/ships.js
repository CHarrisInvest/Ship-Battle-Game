/**
 * THE SHIPS: what a hull can do with the way and the rudder she has, read off her `rating`.
 */

import { STARTER, resolve, rate } from "../shipyard.js";
import { clamp } from "./math.js";

// A ship's length, beam and collision ellipse are her own now, set per class by `hullform.js` and
// carried on the ship as `hullA` and `hullB` (semi-length and semi-beam). The galleon anchors the
// scale at the 36 by 13 every hull at sea used to share.

// A hull with way on her does not answer her rudder as she does at a crawl. The loss is weighted to
// the top of the range: handling in and out of a fight is left where it was, and only a ship running
// flat out finds she cannot turn inside her own wake. It keys off the way she actually carries rather
// than the stick, so easing off the throttle hands the rudder back as she slows: coming round hard
// means spending some of her way to do it, and a charge at full sail is a commitment.
export const BASE_SPEED = 94; // top speed of a whole ship, and the yardstick for a heavy rudder
export const RUDDER_HEAVY = 0.22; // rudder lost at that speed
export const RUDDER_CURVE = 2.2; // how late in the range it starts to bite

/**
 * WHAT A SHIP CAN DO, which is now what she was built to do.
 *
 * Every one of these opened with a level she had bought in that track, then with a plain constant
 * once nothing bought levels any more. They took the ship rather than being constants throughout,
 * against the day the shipyard fed them, and this is that day: a ship carries a `rating` from
 * `rate()`, and these read it.
 *
 * Two things still vary at sea and both are damage. How much of her rig is standing, which is what
 * `mast` measures, and how badly she is holed, which thins her volleys. Nothing else about her moves
 * once she has sailed.
 *
 * The rudder goes heavy against HER OWN top speed rather than the fleet's fastest, or a slow hull
 * would never find the end of her range and a clipper would live in it.
 */
export const topSpeed = (s) => BASE_SPEED * s.rating.speed;
export const rudder = (s) => 1 - RUDDER_HEAVY * Math.pow(clamp(s.spdCur / topSpeed(s), 0, 1), RUDDER_CURVE);
export const speedCap = (s) => topSpeed(s) * (0.5 + 0.5 * (s.mast / s.maxMast));
export const turnCap = (s) => 2.4 * s.rating.turn * (0.22 + 0.78 * (s.mast / s.maxMast)) * rudder(s);

export const STOCK_LOADOUT = resolve(STARTER);
// Her three bars at full, off a loadout: what the HUD opens on and what the fight fills in.
export const barsOf = (loadout) => { const r = rate(loadout); return { hull: r.hull, mast: r.mast, crew: r.crew }; };

/** Whether a person sails her, rather than the engine. */
export const isHuman = (s) => s.controller === "human";
/** The ship a player sails in this world, afloat or sunk, or nothing if she has none. */
export const shipOf = (world, playerId) => world.ships.find((s) => s.id === world.players[playerId]) || null;
/** How far the nearest human ship lies from a point, or a very long way when there is none afloat. */
export const humanRange = (world, x, y) =>
  world.ships.reduce((d, s) => (isHuman(s) && s.alive ? Math.min(d, Math.hypot(x - s.x, y - s.y)) : d), 1e9);

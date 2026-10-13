/**
 * THE AI CAPTAINS: how a rival picks her quarry, sails round an island, breaks out of a heap and
 * comes back for a proper run.
 */

// How an AI captain sails round an island. She keeps this much water between her beach and the
// point `moveShip` grounds her at, looks this far ahead for one plus what she will cover in
// ISLAND_LOOK_SECS at her present speed, and once on a beach runs along it leaning off by this
// much, which is what takes her off it. Two islands are never closer than 170 to each other, so
// a first rate clearing each by the margin still has a channel between them.
export const ISLAND_CLEAR = 22;
export const ISLAND_LOOK = 90;
export const ISLAND_LOOK_SECS = 1.6;
export const ISLAND_LEAN = 0.35;
export const OPENING_WINDOW = 30; // seconds the ffa AI weights range over reputation when picking prey
// How much a rival's strength against her own weighs when an AI captain picks prey, at full weight
// for a ship a factor of e weaker or stronger. Set beside the other terms: a runaway leader is worth
// 130, a hull under half health up to 60, and a thousand paces of range 20 to 120.
export const PREY_STRENGTH = 60;

// Two hulls with the same top speed can fall into a mutual tail chase and orbit one another for as
// long as they both keep the throttle down — lead pursuit holds the circle rather than closing it.
// A captain who has gone this long without gaining takes the way off her instead: a slow hull turns
// far inside a fast one, so easing the throttle is what lets her cut the corner and force the meeting.
export const STALL_PATIENCE = 5; // seconds of getting nowhere before she tries something else
export const STALL_CUT = 4.5; // and how long she holds the tighter, slower turn
export const STALL_THROTTLE = 0.5;

// A captain gets out of a heap rather than grinding away in it. Being jammed against another hull is
// not a fight — she is going nowhere and neither is anyone else — so once she has been stuck like
// that a moment she peels out, gathers way in clear water, and comes back for a proper run, usually
// at somebody other than whoever she was jammed against. What times it is `baulkT`, the plain fact of
// being foul of a hull and making no ground: in a pile any reckoning of closing speed reads high one
// frame and nothing the next, while being stuck is simply true or not. Her nerve scales how long she
// will put up with it, so no two blink together — a pile that broke as one would only re-form.
export const SHEER_ANGLE = 1.35; // about 77 degrees off her bearing, when there is no heap to steer out of
export const SHEER_LOOK = 190; // hulls this close are what she counts as the heap she is peeling out of
export const SHEER_TIME = 2.4; // how long she holds the break before working back in
export const SHEER_THROTTLE = 0.7; // and she takes some way off to get the bow across

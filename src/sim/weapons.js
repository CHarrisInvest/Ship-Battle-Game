/**
 * THE GUNS: what a ball carries, how long a broadside takes to get away, and whether a flight
 * touches a hull or a shoal on its way.
 */

import { clamp } from "./math.js";
import { WP } from "./tables.js";

// THE VOLLEY: how long her whole side takes to go off, and why it is not one order.
//
// She fires every gun she has, and fifty balls leaving in the same instant cannot be told apart:
// down the length of a first rate they would sit two thirds of a pace from each other and read as
// one bar of iron however small they were drawn. What separates them is a moment, not a size.
//
// EVERY GUN TAKES HER OWN MOMENT, drawn at random inside the window. That is a gun crew rather than
// a machine: several ports along her side go off together, then a few more somewhere else, and the
// whole side is away inside `VOLLEY_MAX`. It replaced a strict roll from one end to the other, which
// was the same length of time and read as a mechanism running down her side. A ship firing is not a
// zip fastener.
//
// The window is per gun up to a ceiling, so a cutter's five go off in a twentieth of a second and
// still look simultaneous, and a first rate's fifty spread over a third of one. Nothing is lost by
// the spread: her guns are laid as they bear, so a wider window is neither more nor less accurate.
export const GUN_STAGGER = 0.012; // her side takes about this per gun...
export const VOLLEY_MIN = 0.05;
export const VOLLEY_MAX = 0.32; // ...up to this, however many she carries
/** How long a battery of `n` takes to get away, which the yard prints and the fight fires on. */
export const volleyWindow = (n) => clamp(n * GUN_STAGGER, VOLLEY_MIN, VOLLEY_MAX);
// THE RANGE HER GUNS ARE LAID FOR, and the reason a rolling broadside is not a worse broadside.
//
// A ship at speed crosses better than a hull length while her side rolls through, so a gun fired at
// the end of the roll goes off from a long way ahead of where the first one did. Left alone, that
// walks the whole volley off the front of anything she was pointed at: a first rate at full speed
// put a third of her iron on a target she had laid dead, against six tenths lying still. Gun crews
// answered this by laying each gun as it bears rather than all of them abeam, and so does she: the
// ground she has made since the order comes off the lay, at the range a fight is actually fought at.
// The correction is exact at this range and honestly wrong at any other, which is what laying a gun
// for a range you have guessed has always been worth.
export const LAY_RANGE = 150;

// How far along this frame's flight does a shot bite? Works on the whole step from where the ball
// was to where it is, so a fast ball cannot skip through a hull only thirteen paces across. `pad`
// widens the hull by the radius of what is arriving: a heavy round shot bites where a musket ball
// would whistle past her rail. Scaling the hull's ellipse to a unit circle makes it one quadratic.
// It answers with the share of the step at which the ball first touches her, so the shots can tell
// which of two hulls on one step is the nearer, and -1 for a clean miss.
//
// The flight is measured against the hull as the hull herself sees it, which means carrying the
// ball's starting point forward by the ground the ship made this frame. Testing it against where
// the frame left her was near enough for a ship under sail, but a ship in a melee does not move
// like one: a ram throws her aside at better than her own top speed, and hulls foul of each other
// are shoved apart bodily every frame, all of it done before the shots are stepped. A hull moved
// half her own beam in one frame slid out from under a ball that had gone through her amidships,
// and the ball sailed on. That is why it happened to ships in company and rarely anywhere else.
//
// Her turn within the frame is not counted, only her passage. A hull under helm sweeps her bow
// through about a pace at the worst of it, against the ten or more the shoving throws her.
export const shotHitsHull = (s, x0, y0, x1, y1, pad) => {
  const c = Math.cos(s.heading), sn = Math.sin(s.heading);
  const A = s.hullA + pad, B = s.hullB + pad;
  const wx = s.x - (s.px ?? s.x), wy = s.y - (s.py ?? s.y); // the ground she made this frame
  const px = ((x0 + wx - s.x) * c + (y0 + wy - s.y) * sn) / A;
  const py = ((y0 + wy - s.y) * c - (x0 + wx - s.x) * sn) / B;
  const qx = ((x1 - s.x) * c + (y1 - s.y) * sn) / A, qy = ((y1 - s.y) * c - (x1 - s.x) * sn) / B;
  const dx = qx - px, dy = qy - py;
  const out = px * px + py * py - 1;
  if (out < 0) return 0; // the ball began the step already inside her timbers
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-12) return -1;
  const half = px * dx + py * dy;
  const disc = half * half - len2 * out;
  if (disc < 0) return -1; // the flight passes her by
  const t = (-half - Math.sqrt(disc)) / len2;
  return t >= 0 && t <= 1 ? t : -1; // she is touched within this step, or not this frame
};

// The same question for an island, which is a plain circle and never moves. Asked of the whole
// step for the same reason: a ball tested only where the frame left it can step over a shoal.
export const shotHitsCircle = (cx, cy, r, x0, y0, x1, y1) => {
  const px = x0 - cx, py = y0 - cy, dx = x1 - x0, dy = y1 - y0;
  const out = px * px + py * py - r * r;
  if (out < 0) return 0;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-12) return -1;
  const half = px * dx + py * dy;
  const disc = half * half - len2 * out;
  if (disc < 0) return -1;
  const t = (-half - Math.sqrt(disc)) / len2;
  return t >= 0 && t <= 1 ? t : -1;
};

// What one ball carries, which is one gun's worth: every gun aboard throws its own.
export const sideDmg = (s) => s.rating.broadside.perBall;
export const frontDmg = (s) => s.rating.bow.perBall;
// One ball of the small-arms volley. A plain rail is the old flat 3.2; swivels aboard pull it up,
// because a swivel ball outweighs a musket's, and better swivels pull harder.
export const musketDmg = (s) => s.rating.musketDamage;
// The arc that volley scatters over. Quality iron on the rail tightens it; the AI's own aiming
// error is added separately in `fire()` and must stay separate, or better swivels aboard the player
// would quietly make every rival captain a better shot.
export const musketArc = (s) => s.rating.musketSpread;
// An AI captain's own aim, in radians of error either side, added to whatever scatter her guns
// carry of their own. Both are nought: a rival lays her guns as well as the player does. Every
// mount used to carry 0.14 the player's never did, so the same battery threw a straight bank of
// iron for the player and a ragged fan for a rival, and the one thing that made a rival's fire
// worse was a rule nobody could see. Put a figure in either if rivals ever need handicapping.
export const AI_CANNON_AIM = 0;
export const AI_MUSKET_AIM = 0;
/** How long that mount takes to serve. A battery reloads at the pace of its slowest piece. */
export const reloadOf = (s, wk) => (wk === "musket" ? WP.musket.cd : s.rating[wk].reload || WP[wk].cd);
/** Whether she has anything on that mount at all. A ship with no broadside must not fire one. */
export const canFire = (s, wk) => (wk === "musket" ? s.rating.muskets > 0 : s.rating[wk].count > 0);

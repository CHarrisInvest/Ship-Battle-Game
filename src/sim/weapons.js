/**
 * THE GUNS: what a ball carries, how long a broadside takes to get away, and whether a flight
 * touches a hull or a shoal on its way.
 */

import { clamp } from "./math.js";
import { random } from "./rng.js";
import { WORLD, WP } from "./tables.js";
import { isHuman } from "./ships.js";
import { applyHit, canHit } from "./round.js";

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

// How far along this step's flight does a shot bite? Works on the whole step from where the ball
// was to where it is, so a fast ball cannot skip through a hull only thirteen paces across. `pad`
// widens the hull by the radius of what is arriving: a heavy round shot bites where a musket ball
// would whistle past her rail. Scaling the hull's ellipse to a unit circle makes it one quadratic.
// It answers with the share of the step at which the ball first touches her, so the shots can tell
// which of two hulls on one step is the nearer, and -1 for a clean miss.
//
// The flight is measured against the hull as the hull herself sees it, which means carrying the
// ball's starting point forward by the ground the ship made this step. Testing it against where
// the step left her was near enough for a ship under sail, but a ship in a melee does not move
// like one: a ram throws her aside at better than her own top speed, and hulls foul of each other
// are shoved apart bodily every step, all of it done before the shots are stepped. A hull moved
// half her own beam in one step slid out from under a ball that had gone through her amidships,
// and the ball sailed on. That is why it happened to ships in company and rarely anywhere else.
//
// Her turn within the step is not counted, only her passage. A hull under helm sweeps her bow
// through about a pace at the worst of it, against the ten or more the shoving throws her.
export const shotHitsHull = (s, x0, y0, x1, y1, pad) => {
  const c = Math.cos(s.heading), sn = Math.sin(s.heading);
  const A = s.hullA + pad, B = s.hullB + pad;
  const wx = s.x - (s.px ?? s.x), wy = s.y - (s.py ?? s.y); // the ground she made this step
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
  return t >= 0 && t <= 1 ? t : -1; // she is touched within this step, or not this one
};

// The same question for an island, which is a plain circle and never moves. Asked of the whole
// step for the same reason: a ball tested only where the step left it can step over a shoal.
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

/**
 * How many guns of a mount are served, and where they sit.
 *
 * `balls` is her gun count, less a share of it once she is holed below half: guns go silent as
 * the hands serving them are wanted elsewhere. It used to be exactly one gun fewer, which was a
 * tenth of the biggest battery in the game when nothing threw more than ten balls and is a
 * fiftieth of one now. A share falls the same way at every size, and the floor of one keeps a
 * boat with a single gun a side from being disarmed by the first hit that finds her.
 *
 * `spread` lays that many evenly across a span, centred: one ball goes down the middle, two sit
 * at the ends, and the old hand-written offsets fall out of it for the counts they covered.
 */
export const SILENCED = 0.15; // of her battery, once she is holed below half
export const balls = (s, wk) =>
  Math.max(1, Math.round(s.rating[wk].balls * (s.hull < s.maxHull * 0.5 ? 1 - SILENCED : 1)));
export const spread = (n, half) =>
  n <= 1 ? [0] : Array.from({ length: n }, (_, i) => -half + (2 * half * i) / (n - 1));

export function fire(world, s, weapon) {
  const w = WP[weapon];
  const h = s.heading;
  const dmg = weapon === "broadside" ? sideDmg(s) : weapon === "bow" ? frontDmg(s) : musketDmg(s);
  const bx = s.x + Math.cos(h) * s.hullA;
  const by = s.y + Math.sin(h) * s.hullA;
  const noise = isHuman(s) ? 0 : weapon === "musket" ? AI_MUSKET_AIM : AI_CANNON_AIM;
  const push = (px, py, ang) =>
    world.shots.push({ x: px, y: py, vx: Math.cos(ang) * w.speed, vy: Math.sin(ang) * w.speed, life: w.life, r: w.r, bar: w.bar, dmg, owner: s, kind: weapon });
  if (weapon === "broadside") {
    // She does not throw her broadside, she gives the order. Every port down her side takes her
    // own moment inside the window, in the order they happen to come, so several go off together
    // and the rest follow in ones and twos; `stepVolley` fires each as her moment arrives, off
    // wherever the ship is by then. Nothing else about the volley is decided now, because a ship
    // a third of a second into a turn is not the ship that gave the order.
    const offs = spread(balls(s, "broadside"), 0.72 * s.hullA);
    const win = volleyWindow(offs.length);
    world.volleys.push({
      s, dmg, noise, n: 0,
      guns: offs
        .map((off) => ({ off, at: world.time + random(world) * win }))
        .sort((a, b) => a.at - b.at),
      // where she lay when the order was given, which is what the guns are laid against
      x0: s.x, y0: s.y, h0: h,
    });
  } else if (weapon === "bow") {
    // Her chasers, opened out by half what they were: they are round shot too, and a chase gun
    // that sprays is no use to anybody.
    const angs = spread(balls(s, "bow"), 0.045);
    for (const o of angs) push(bx, by, h + o + (random(world) - 0.5) * noise);
    world.events.push({ type: "fired", shipId: s.id, weapon, x: bx, y: by, dir: h });
  } else {
    // The hands at the rail and the swivels on it, firing together. The count, the weight of
    // one ball and the scatter all come off the loadout now; only `noise`, an AI captain's own
    // aim, is the fight's to add.
    for (let i = 0; i < s.rating.muskets; i++) push(bx, by, h + (random(world) - 0.5) * (musketArc(s) + noise));
    world.events.push({ type: "fired", shipId: s.id, weapon, x: bx, y: by, dir: h });
  }
}

/**
 * ONE GUN OF A BROADSIDE, both sides at once.
 *
 * Fired from where she is at this instant rather than from where she was when the order was
 * given, which is the whole point of spreading the volley at all: a ship holding her course lays
 * a straight bank of iron, and a ship swinging her helm mid-volley walks it across the water,
 * exactly as she would have. It says it fired at the port it came out of, which is where the
 * screen puts its flash and its smoke.
 */
export function fireGun(world, v, off) {
  const s = v.s;
  const w = WP.broadside;
  const h = s.heading;
  // The volley opens out along the hull as it travels, but it used to open out a long way:
  // at the range these fights are actually fought, about 150 paces, the four balls arrived
  // spread across 76 of them, more than two hull lengths, so a broadside laid dead on a ship
  // still had most of itself pass either side of her. Tightened to this the same volley
  // covers 51, near enough one hull and a half, and a shot lined up properly lands more of
  // itself. It is deliberately not nothing: a broadside is a wall of iron, not a rifle.
  const FAN = 0.0045;
  const px = s.x + Math.cos(h) * off, py = s.y + Math.sin(h) * off;
  // the ground she has made along her own heading since the order, which every gun still to fire
  // takes off its lay
  const made = (s.x - v.x0) * Math.cos(v.h0) + (s.y - v.y0) * Math.sin(v.h0);
  const lay = made / LAY_RANGE;
  for (const sd of [-1, 1]) {
    const dir = h + (sd * Math.PI) / 2;
    const ang = dir + sd * lay - sd * FAN * off + (random(world) - 0.5) * (0.05 + v.noise);
    world.shots.push({
      x: px, y: py, vx: Math.cos(ang) * w.speed, vy: Math.sin(ang) * w.speed,
      life: w.life, r: w.r, bar: w.bar, dmg: v.dmg, owner: s, kind: "broadside",
    });
    // A GUN FIRES OUT OF A PORT IN HER SIDE, so its flash and its smoke both stand at the rail
    // it fired over rather than on her keel. The flash was amidships on her centreline, where a
    // gun deck is stores rather than gunports, and with fifty of them going off in half a second
    // that is the difference between a ship firing her broadside and a ship on fire.
    const rx = px + Math.cos(dir) * s.hullB, ry = py + Math.sin(dir) * s.hullB;
    world.events.push({ type: "fired", shipId: s.id, weapon: "broadside", x: rx, y: ry, dir });
  }
}

/**
 * The guns still to go off, on every ship with a volley in the air.
 *
 * A ship sunk mid-broadside stops firing, which is the difference between a gun crew and a
 * timer. Everything else is arithmetic: a gun goes off when her moment comes, however many that
 * is in one step, and the entry is done when her last one has.
 */
export function stepVolley(world) {
  for (let i = world.volleys.length - 1; i >= 0; i--) {
    const v = world.volleys[i];
    if (!v.s.alive) { world.volleys.splice(i, 1); continue; }
    while (v.n < v.guns.length && world.time >= v.guns[v.n].at) fireGun(world, v, v.guns[v.n++].off);
    if (v.n >= v.guns.length) world.volleys.splice(i, 1);
  }
}

export function stepShots(world, dt) {
  const s = world.shots;
  for (let i = s.length - 1; i >= 0; i--) {
    const b = s[i];
    const fromX = b.x, fromY = b.y;
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    // A ball takes the first thing in its road, which is the nearest along the flight and not
    // whichever hull the ships happen to be listed in first. Hulls are held far enough apart
    // that a single step rarely reaches across two of them, so this is a rare case rather than
    // a common one, but when it did come up the near ship, the one the ball plainly went
    // through, was as likely as not the one that felt nothing.
    let struck = null, shoal = false, when = 2;
    for (const isl of world.islands) {
      const t = shotHitsCircle(isl.x, isl.y, isl.r, fromX, fromY, b.x, b.y);
      if (t >= 0 && t < when) { when = t; shoal = true; }
    }
    for (const target of world.ships) {
      if (!canHit(world, b.owner, target)) continue;
      const t = shotHitsHull(target, fromX, fromY, b.x, b.y, b.r);
      if (t >= 0 && t < when) { when = t; struck = target; shoal = false; }
    }
    const hit = struck !== null || shoal;
    if (hit) {
      // and it breaks where it bit her, not at the end of a step it never finished
      const hx = fromX + (b.x - fromX) * when, hy = fromY + (b.y - fromY) * when;
      if (struck) applyHit(world, struck, b.bar, b.dmg, b.owner, b.kind, undefined, hx, hy);
      else world.events.push({ type: "splash", x: hx, y: hy });
    }
    if (hit || b.life <= 0 || b.x < 0 || b.x > WORLD || b.y < 0 || b.y > WORLD) s.splice(i, 1);
  }
}

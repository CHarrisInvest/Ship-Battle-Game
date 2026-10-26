/**
 * WHAT THE PLAYER'S VIEW IS: how the sea is tilted onto the screen, how much of it a captain sees,
 * and how a ball is drawn against the bite it takes.
 */

import { WP, WORLD, clamp, norm } from "../sim/index.js";

export const TILT = 0.6; // vertical squash -> high-angle / isometric feel
export const ZUP = Math.sqrt(1 - TILT * TILT); // how world-height maps to screen-up

// A shot's `r` is how wide a bite it takes: it is what widens the hull when the flight is tested,
// so a round shot holes a ship where a musket ball whistles past her rail. What gets drawn is
// smaller than that. Shrinking the drawn ball is a matter of how the sea looks; shrinking the bite
// would quietly make every gun in the game worse, and those are two different decisions. Set this
// to 1 to put them back together.
export const SHOT_DRAW = 0.7;
// The light on the ball is the half of it that carries on dark water, so it is not allowed to
// shrink away to nothing: under about a pixel canvas renders it as part-covered and it goes grey,
// which is the one thing that mass was there to prevent.
export const SHOT_LIT_MIN = 0.85;

// ---- the player's view ----
//
// What a captain sees is a square laid on the middle of the screen: its side is the shorter side of
// the phone — the width held upright, the height held sideways — and whatever screen is left over
// beyond it simply shows more sea, behind the buttons. Sizing the water to the screen instead left
// her sight of it lopsided and different in each orientation: an upright phone gave barely a
// broadside's width across and three times that up and down, so a ship a little abeam was off the
// side of the screen while empty water ran away above and below her.
//
// The square holds a full broadside either side of her, because that is the range a fight is decided
// at: whatever can reach her lies inside the square, whichever way it lies from her.
export const BROADSIDE_R = WP.broadside.speed * WP.broadside.life;
export const VIEW = BROADSIDE_R * 2; // world units across the square
// A screen much bigger than a phone's would otherwise magnify everything to fill its shorter side.
// Past this the square only ever shows more water than it promises, which costs the captain nothing.
export const MAX_ZOOM = 1.5;
// How far the map's boundary is let inside the edge of the screen: enough to read the rope, its
// buoys, and a strip of the water beyond, and no more. It is the whole of the camera's give on a
// side, so it is also how far off centre a ship ends up when she runs right up on that boundary.
export const EDGE_PEEK = 40; // screen pixels
// The most the boundary is let in on a side where the screen runs longer than the square. Held
// upright that is the top and bottom, where the strip past the square is the buttons' and the
// panels', and the boundary may come as far as the square's edge. Sideways the strips are the
// left and right, and the square's edge there is a third of the screen: the boundary sat halfway
// across the sea with the ship pinned beside it. This caps it at the joystick's own strip, so a ship
// on the map's edge still sits clear of the stick and the rope still reads, and no more than that.
export const SIDE_PEEK = 150; // screen pixels

// ---- the camera, as figures ----
//
// Both renderers place the sea by these, the Canvas 2D one and the three.js one, so where a ship
// lands on the glass is one piece of arithmetic and not two that have to be kept in step. A `view`
// is the screen's own state and nothing of the round's: the canvas in CSS pixels (`Wd` by `Hd`),
// the device pixel ratio the 2D canvas is drawn at, `zoom` (CSS pixels per world unit across),
// the same canvas in view space (`Vw` by `Vh`, world units across and foreshortened world units
// down), the side of the square (`Vsq`), the phone's notch and home bar as insets (`safe`), and
// `cam`, the world point at the top left of the screen.
//
// View space is world space seen from the camera: across is one to one, and down is squashed by
// TILT, while a height rises by ZUP of itself. So a point at world (x, y) standing z high lands at
// ((x - cam.x) * zoom, ((y - cam.y) * TILT - z * ZUP) * zoom) in CSS pixels from the top left.


export function createView() {
  return { Wd: 0, Hd: 0, dpr: 1, zoom: 1, zoomK: 1, Vw: 0, Vh: 0, Vsq: 0, safe: { l: 0, t: 0, r: 0, b: 0 }, cam: { x: 0, y: 0 } };
}

/**
 * The view's zoom scaled by `k` over the square's own, which is how the instant replay draws the
 * sea closer in its window: a window a fraction of the screen wide at play zoom shows a ship a few
 * pixels long. Everything across and down follows the zoom, so the figures that hang off it are
 * worked out again; the canvas is untouched. 1 is the square's zoom, the figure play runs at.
 */
export function setZoom(v, k) {
  v.zoomK = k;
  v.zoom = Math.min(Math.min(v.Wd, v.Hd) / VIEW, MAX_ZOOM) * k;
  v.Vw = v.Wd / v.zoom;
  v.Vh = v.Hd / v.zoom;
  v.Vsq = Math.min(v.Vw, v.Vh);
  return v;
}

/**
 * The view sized to a canvas `Wd` by `Hd` CSS pixels. `rect` is the canvas's own page box and `hud`
 * the HUD's safe-area box, whose insets from it are the notch, corners and home bar; leave `hud` out
 * and the insets stay as they were.
 */
export function sizeView(v, rect, hud, dpr) {
  v.dpr = dpr;
  v.Wd = rect.width;
  v.Hd = rect.height;
  if (hud) v.safe = { l: Math.max(0, hud.left - rect.left), t: Math.max(0, hud.top - rect.top), r: Math.max(0, rect.right - hud.right), b: Math.max(0, rect.bottom - hud.bottom) };
  return setZoom(v, v.zoomK || 1);
}

// Where a ship is drawn, `alpha` of the way through the last step: her position and her heading,
// the heading blended the short way round.
export const blend = (s, alpha) => ({
  x: s.px + (s.x - s.px) * alpha,
  y: s.py + (s.y - s.py) * alpha,
  h: s.pHeading + norm(s.heading - s.pHeading) * alpha,
});

// View space from world space, for a point on the water.
export const SX = (x, v) => x - v.cam.x;
export const SY = (y, v) => (y - v.cam.y) * TILT;

/** Where world (x, y), standing `z` high, lands on the canvas, in CSS pixels from its top left. */
export const toScreen = (v, x, y, z = 0) => [SX(x, v) * v.zoom, (SY(y, v) - z * ZUP) * v.zoom];

// The camera holds her in the middle and fills the rest of the view with sea, which puts the
// boundary off the edge of the screen until she is close to it. Coming in on a side, it is let
// `peek` inside the screen — a strip of open water, the rope, and its buoys, no more — and she
// comes off centre by exactly as much: the edge slides into view and she slides toward it, which
// is what tells a captain how much sea she has left on that hand.
//
// The peek is a strip of screen, so it comes to the same band whichever way the map is squashed:
// across it is that many pixels of world, and up and down it is that many pixels of a world
// foreshortened by TILT, which takes more world to cover.
//
// Where the screen runs longer than the square — up and down, held upright — the boundary is let
// in as far as the edge of the square instead, since that strip of screen is the one the buttons
// and the panels sit on and it is hers to spend. That is what keeps her out from under them at
// the top and bottom of the map, where she used to end up pinned against the glass.
export function camHold(centred, span, peek) {
  const lo = -peek; // the far side of the map, let this far into the view
  return clamp(centred, lo, Math.max(lo, WORLD - span + peek));
}

/**
 * The camera brought round onto `ship`, where she is drawn `alpha` of the way through the last step.
 * `hold` is whether the map's boundary holds the camera off its edge, which play wants and the
 * instant replay does not: its window is aimed at a point, and a ship sunk against the rope would
 * otherwise drift out of it.
 */
export function followView(v, ship, alpha = 1, hold = true) {
  if (!ship) return;
  const me = blend(ship, alpha);
  const spanX = v.Vw, spanY = v.Vh / TILT; // sea on the screen, in world units
  if (!hold) {
    v.cam.x = me.x - spanX / 2;
    v.cam.y = me.y - spanY / 2;
    return;
  }
  // across, the give past the square is capped at SIDE_PEEK; up and down it is not, because
  // that strip is the one the buttons and panels sit on and it is hers to spend
  const peekX = Math.max(Math.min((spanX - v.Vsq) / 2, SIDE_PEEK / v.zoom), EDGE_PEEK / v.zoom);
  const peekY = Math.max((spanY - v.Vsq / TILT) / 2, EDGE_PEEK / (v.zoom * TILT));
  v.cam.x = camHold(me.x - spanX / 2, spanX, peekX);
  v.cam.y = camHold(me.y - spanY / 2, spanY, peekY);
}

/** Whether a point in view space (`gx, gy`, as the overlay places a ship's bars) lands inside `box`, a rectangle in CSS pixels. */
export const inBox = (v, gx, gy, box) => !box || (gx * v.zoom >= box.x0 && gx * v.zoom <= box.x1 && gy * v.zoom >= box.y0 && gy * v.zoom <= box.y1);

/**
 * Whether any ship afloat lies under a box on the page, `rect` as `getBoundingClientRect` gives
 * it. Each ship counts as a circle of her own half length and a little of her rig, on the screen.
 */
export function shipUnder(v, rect, w) {
  for (const s of w.ships) {
    if (!s.alive) continue;
    const sx = SX(s.x, v) * v.zoom, sy = SY(s.y, v) * v.zoom;
    const rad = (s.hullA + 16) * v.zoom; // her half length, and a little of her rig
    const nx = clamp(sx, rect.left, rect.right), ny = clamp(sy, rect.top, rect.bottom);
    if ((nx - sx) ** 2 + (ny - sy) ** 2 < rad * rad) return true;
  }
  return false;
}

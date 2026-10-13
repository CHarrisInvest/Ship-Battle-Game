/**
 * WHAT THE PLAYER'S VIEW IS: how the sea is tilted onto the screen, how much of it a captain sees,
 * and how a ball is drawn against the bite it takes.
 */

import { WP } from "../sim/index.js";

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

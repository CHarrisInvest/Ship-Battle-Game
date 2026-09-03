import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { drawGalleon } from "./galleon.js";
import { hullForm, tintTimber } from "./hullform.js";
import {
  getHold, bankVoyage, resetHold, subscribeHold, modeRecord, shipLoadout, shortfall,
  buyShip, buyPart, fitMast, fitSail, fitStud, fitGun, unfitGun, setActiveShip, loosePartIds, ownedShips, partOf,
} from "./hold.js";
import {
  STARTER, kindOf, mastRebuildCost, measure, rate, rateOf, resolve, rigSpec,
  ladder, peers, stockOfRate,
  HULLS, HULL_LIST, statBand, maximumLoadout, outfitCost,
  mastsForSocket, sailsForBerth, studsForBerth, gunsForMount,
} from "./shipyard.js";
import { roll, tally } from "./achievements.js";

/**
 * STERNCHASE: HELM & HULL — pirate battles at sea, on a tilted (isometric-ish) sea with tall wooden
 * ships. "Broadside" survives below as the name of the side guns, which is the job it was always
 * doing in the simulation; the game's own name is Sternchase.
 * ARENA: endless survival. One hunter to start, matched to the player gun for gun; kills bring
 * reinforcements in from the edge of the map, well clear of your bow, 1-2-1-2 and then two a kill.
 * They never get stronger, there just get to be more of them.
 * FREE-FOR-ALL: up to 10 rival captains, equal start, opening on the nearest hull before they start
 * shopping for weak prey, loosing the odd volley at whatever drifts into the arc, and turning on a
 * runaway leader. Last afloat wins.
 * Every AI reloads on the same clock as the player, in both modes.
 *
 * NOBODY UPGRADES AT SEA. A ship is what she was when she sailed, and what she is comes from the
 * shipyard between voyages (`shipyard.js`), which is where a captain's money now goes. What a purse
 * buys during a round is repairs and nothing else, and it buys them out of the voyage's own takings:
 * every coin spent patching her is a coin that does not reach the hold. Every mode opens her purse at
 * nothing, so the first patch of a round is always paid for by something she did in it. So the stat
 * functions below read only her damage, not any notion of a level, and their shape is the seam the
 * shipyard's `rate()` plugs into when the modes are reworked.
 */

const WORLD = 2000;
const TILT = 0.6; // vertical squash -> high-angle / isometric feel
const ZUP = Math.sqrt(1 - TILT * TILT); // how world-height maps to screen-up
const FFA_AI = 10;
const ISLAND_COUNT = 4;
const OPENING_WINDOW = 30; // seconds the ffa AI weights range over reputation when picking prey

// ARENA: the swarm grows instead of the ships. Reinforcements sail in from the map edge.
const ARENA_START = 1; // hunters afloat when the round opens
const ARENA_RAMP = [1, 2, 1, 2]; // reinforcements for the first four kills, then 2 every kill
const ARENA_SPAWN_CLEAR = 620; // keep a respawn at least this far from the player
const ARENA_MAX_ENEMIES = 14; // ceiling so the fleet stays drawable
const ARENA_SPAWN_GAP = 5; // the second ship of a wave holds off this long

// nth kill (1-indexed) -> how many ships sail in to replace the one that sank
const arenaReinforcements = (n) => ARENA_RAMP[n - 1] ?? 2;

// DERBY: ten bows, no guns, nothing to buy, and a squall closing on the middle of the sea. Without
// cannon nobody's mast can be brought down, so every hull holds the same top speed all match and a
// runner could never be caught — the ring is what makes the fight happen. It opens wider than the
// map's own corners, so the grace period really is open water, and closes onto the middle, which the
// island generator always leaves clear. Outside it the crew works the deck in a gale: survivable for
// a dash across the weather, ruinous for anyone who tries to live out there.
const DERBY_AI = 9; // rivals, so ten captains start
const STORM_GRACE = 18; // seconds of open water before the ring starts to close
const STORM_CLOSE = 95; // and how long it takes to close all the way
const STORM_R0 = 1400; // opening radius — just past the far corners of the map, so closing bites at once
const STORM_R1 = 190; // working radius: room for two ships to work, not to hide
// ...and then, if the last of them are still circling one another, the eye itself shuts. A small ring
// is not enough on its own: a ram needs closing speed to count for anything, and two ships penned in a
// pool a hundred paces across can mill about forever without ever getting the run at each other that
// would settle it — measured at better than two minutes of it. Weather asks nobody for a run-up, so
// the ring goes to nothing instead, and the last hull afloat is the one with crew enough to outlast
// the sea. However cagey the sailing, a round has an end.
const STORM_HOLD = 20; // seconds the ring sits at its working size first
const STORM_SQUEEZE = 35; // and how long the eye takes to shut completely
const STORM_R2 = 0;
const STORM_DPS_MIN = 3.5; // crew lost a second the moment she is caught out
const STORM_DPS_MAX = 17; // ...and once she has been out there STORM_RAMP seconds
const STORM_RAMP = 12; // how long the weather takes to work up to its worst
const STORM_RECOVER = 2.2; // exposure shed a second once she is back inside
// An AI captain is drawn toward the middle rather than fenced away from the edge. Inside STORM_HOME
// of the ring she fights as she pleases; past it the middle bends her course, hardest at the rail.
// It is a preference, not an override, which is what leaves room to shoulder a rival out into the
// weather and hold her there — and once she is out, her own exposure is what turns the pull urgent.
const STORM_HOME = 0.45; // share of the ring she is content to fight anywhere within
const STORM_PULL = 0.8; // how hard the middle bends her course at the very rail

// Two hulls with the same top speed can fall into a mutual tail chase and orbit one another for as
// long as they both keep the throttle down — lead pursuit holds the circle rather than closing it.
// A captain who has gone this long without gaining takes the way off her instead: a slow hull turns
// far inside a fast one, so easing the throttle is what lets her cut the corner and force the meeting.
const STALL_PATIENCE = 5; // seconds of getting nowhere before she tries something else
const STALL_CUT = 4.5; // and how long she holds the tighter, slower turn
const STALL_THROTTLE = 0.5;

// A captain gets out of a heap rather than grinding away in it. Being jammed against another hull is
// not a fight — she is going nowhere and neither is anyone else — so once she has been stuck like
// that a moment she peels out, gathers way in clear water, and comes back for a proper run, usually
// at somebody other than whoever she was jammed against. What times it is `baulkT`, the plain fact of
// being foul of a hull and making no ground: in a pile any reckoning of closing speed reads high one
// frame and nothing the next, while being stuck is simply true or not. Her nerve scales how long she
// will put up with it, so no two blink together — a pile that broke as one would only re-form.
const SHEER_ANGLE = 1.35; // about 77 degrees off her bearing, when there is no heap to steer out of
const SHEER_LOOK = 190; // hulls this close are what she counts as the heap she is peeling out of
const SHEER_TIME = 2.4; // how long she holds the break before working back in
const SHEER_THROTTLE = 0.7; // and she takes some way off to get the bow across

const stormRadius = (t) => {
  const closed = STORM_GRACE + STORM_CLOSE;
  if (t <= closed) return STORM_R0 + (STORM_R1 - STORM_R0) * clamp((t - STORM_GRACE) / STORM_CLOSE, 0, 1);
  return STORM_R1 + (STORM_R2 - STORM_R1) * clamp((t - closed - STORM_HOLD) / STORM_SQUEEZE, 0, 1);
};

// The sea is three tones of one hue, laid down by depth: open water everywhere, the shallows banked
// around each island, and a thin beach rim where the bottom comes up to meet the sand. Everything the
// UI paints on top of the water — panels, scrims, the grid — is the same hue run down to near black,
// so the chrome reads as the sea in shadow rather than as a second, unrelated colour scheme.
const C = {
  water: "#2a8f8b",      // open water — the main sea, and the page background behind it
  shallows: "#45b39d",   // the bank of shallow water an island sits in
  beachRim: "#7fd0bd",   // the thin band right where the water meets the sand
  foam: "#f4fffc",       // a cap catching the light as it breaks
  waterEdge: "#1c6663",  // outside the buoys: open water run deep, so the arena reads as the bright part
  deep: "#0b3331",       // the sea at its darkest — panel grounds, and ink on a gold field
  grid: "rgba(9,52,50,0.10)",
  player: "#ece2cc",
  playerStroke: "#b3a684",
  // Round shot is cast iron, and going dark reads better than the gold it replaces almost
  // everywhere, because every ground it crosses but one is lighter than it. Against the gold, by
  // ground: open water 2.93 to 2.32, the shallows 4.44 to 1.53, grass 4.27 to 1.59, sand 5.88 to
  // 1.15, the rim where the water meets the sand 6.32 to 1.07. A gold ball crossing an island was
  // very nearly not there at all.
  //
  // The exception is dark water: 1.70 out past the buoys, and as little as 1.08 where the weather
  // has the sea darkened outside the ring, which is a ball nobody can see. So the ball is not one
  // mass but two, and the second is the answer to the first. The light off the top of it scores
  // 2.96 to 5.45 on exactly those dark grounds, where the body has nothing, and falls to 1.55 on
  // open water, where the body has 2.93. Whichever ground it crosses, one of the two is holding it.
  // The trail does the same job again from further out, 5.73 to 11.66 on the dark grounds, and a
  // round shot is only ever on screen while it is flying, so the trail is always there.
  ball: "#333b42",
  ballLit: "#9aa5af",   // the light off the top of it, which is what makes it a sphere and not a hole
  smoke: "#e6efec",     // powder smoke: what a gun leaves behind and what a ball drags after it
  pellet: "#dfefff",
  hull: "#d99a3c",
  // Mast reads on three grounds: the enemy bar's 50%-black backing, the player's HUD bar, and the
  // FRONT gun button — the bow gun brings masts down, so it carries this colour too. It was a teal
  // barely a shade off open water (1.41 contrast) and vanished against the sea. Pale rather than
  // navy on purpose: a dark blue scores 1.01 against the bar's own dark backing, which would make a
  // full mast bar look exactly like an empty one.
  mast: "#a8c4ff",
  crew: "#d15b5b",
  side: "#e8c877",
  front: "#7a9cc6",
  splinter: "#b98a4a",
  gold: "#e8c877",
  panel: "rgba(11,51,49,0.80)",
  hair: "rgba(160,224,210,0.20)",
  ink: "#eef4f2",
  sand: "#cbb98a",
  sandDark: "#a8935f",
  grass: "#6fae5c",
  frond: "#4f9a3f",
  frondDk: "#2f6634",
  coconut: "#b58a4a",
  sail: "#f4ecd8",
  wood: "#6b4a2b",
  woodLit: "#8d6740",
  hullWood: "#7c5a37",
  hullDeck: "#8c6a44",
  hullDark: "#48331f",
  boundary: "#e8c877",
  buoyA: "#d15b5b",
  buoyB: "#eef4f2",
};

// ---------------- island foliage ----------------
// Two species built from one blade primitive. Every fraction below is of the plant's canopy radius,
// and that radius is itself a fraction of the island radius — so a plant scales with the island it
// stands on, and an island is never a scaled-up version of a smaller one only because of its plants.
//
// These values are tuned, not derived. Keep them here rather than inline in the draw code.
const PLANT = {
  // Canopy radius in screen px, the same on every island. It used to be a fraction of the island
  // radius, which made a palm on the biggest island four times the size of one on the smallest —
  // islands differed in the size of their trees rather than in how many they had. A fixed size says
  // a tree is a tree; the island is what changes.
  canopy: 9,
  scaleMin: 0.75,      // so an individual plant still varies: 6.75 to 12.15 px
  scaleMax: 1.35,

  fronds: 7,           // blades per crown
  frondLen: 1.06,
  frondWidth: 0.20,    // at the blade's widest
  arch: 0.20,          // rise at mid-blade, x blade length
  droop: 0.26,         // tip drop below the crown, x blade length
  wind: 0.20,          // bend amplitude

  trunkH: 1.85,
  trunkW: 0.30,        // base width; floored at 1.1 device px so it survives the small end
  taper: 0.58,         // top width / base width
  bow: 0.50,           // lean and curve, signed per plant

  palmRatio: 0.85,     // the rest are bushes
  minGap: 0.75,        // spacing, as a fraction of the two footprints summed
  scatter: 0.67,       // x island r

  // Count goes as the square of the radius, i.e. with island area, which is what holds the planting
  // at one density now that a plant is a fixed size. Linear count was right only while plants grew
  // with the island; against a fixed size it would leave a small island twice as densely planted as
  // a large one. countRef is the count at countRefR: 12 plants at r=58, 40 at r=105, 55 at r=124.
  countRef: 36,
  countRefR: 100,

  shadowSize: 0.42,
  shadowLean: 0.55,    // how far the shadow tracks the crown's offset from the base
  shadowOpa: 0.10,     // the soft outer pass is 0.40 of this
};

// quadratic bezier point and tangent
function qp(t, a, b, c) {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]];
}
function qd(t, a, b, c) {
  const u = 1 - t;
  return [2 * u * (b[0] - a[0]) + 2 * t * (c[0] - b[0]), 2 * u * (b[1] - a[1]) + 2 * t * (c[1] - b[1])];
}

// One tapered blade swept along a bezier that rises out of the crown and droops at the tip. `a` is
// the plan bearing; its y component is squashed by TILT so the crown foreshortens like everything
// else. bx/by bend the blade downwind and scale along t, so the root stays pinned at the crown and
// only the outer half travels — the trunk and the crown point never move.
function frond(ctx, cx, cy, a, L, wMax, arch, droop, notch, steps, bx = 0, by = 0) {
  const dx = Math.cos(a) * L, dy = Math.sin(a) * L * TILT;
  const p0 = [cx, cy];
  const p1 = [cx + dx * 0.5 + bx * 0.30, cy + dy * 0.5 - arch * L + by * 0.30];
  const p2 = [cx + dx + bx, cy + dy + droop * L + by];
  const side = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = qp(t, p0, p1, p2), d = qd(t, p0, p1, p2);
    const m = Math.hypot(d[0], d[1]) || 1;
    let w = wMax * Math.sin(Math.PI * Math.pow(t, 0.8));
    if (notch && i % 2) w *= 0.52; // leaflet notches
    side.push([p, [-d[1] / m * w, d[0] / m * w]]);
  }
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  for (let i = 0; i <= steps; i++) ctx.lineTo(side[i][0][0] + side[i][1][0], side[i][0][1] + side[i][1][1]);
  for (let i = steps; i >= 0; i--) ctx.lineTo(side[i][0][0] - side[i][1][0], side[i][0][1] - side[i][1][1]);
  ctx.closePath();
  ctx.fill();
}

// tapered, bowed trunk outline
function trunkPath(ctx, bx, by, tx, ty, wb, wt, bow) {
  const p0 = [bx, by], p2 = [tx, ty];
  const p1 = [(bx + tx) / 2 + bow, (by + ty) / 2];
  const N = 9, L = [], R = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = qp(t, p0, p1, p2), d = qd(t, p0, p1, p2);
    const m = Math.hypot(d[0], d[1]) || 1;
    const w = (wb + (wt - wb) * t) / 2;
    L.push([p[0] - d[1] / m * w, p[1] + d[0] / m * w]);
    R.push([p[0] + d[1] / m * w, p[1] - d[0] / m * w]);
  }
  ctx.beginPath();
  ctx.moveTo(L[0][0], L[0][1]);
  for (let i = 1; i <= N; i++) ctx.lineTo(L[i][0], L[i][1]);
  for (let i = N; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
  ctx.closePath();
}

// Plan-space radius a plant's crown covers on the ground, before TILT. Spacing is tested in plan
// rather than on screen so the vertical squash is handled for free and front-to-back gaps match
// side-to-side ones.
function footprint(s, isPalm) {
  const tr = PLANT.canopy * s;
  return isPalm ? tr * PLANT.frondLen : tr * 0.62 * 1.05;
}

// A palm. The trunk carries the silhouette: the crown sits at trunkH x the canopy radius rather
// than one radius up, so at a 5px canopy the plant still reads as a leaning stick with a splayed
// head. Detail switches itself off by size below — those gates are what stop small plants
// turning to mush.
function drawPalm(ctx, f, clock) {
  const fx = f.x, fy = f.y * TILT;
  const tr = PLANT.canopy * f.s;
  const lean = f.k * PLANT.bow * tr;      // static: wind never moves the trunk
  const cx = fx + lean, cy = fy - tr * PLANT.trunkH;
  const L = tr * PLANT.frondLen;

  const wb = Math.max(1.1, tr * PLANT.trunkW), wt = wb * PLANT.taper;
  ctx.fillStyle = C.wood;
  trunkPath(ctx, fx, fy, cx, cy, wb, wt, lean * 0.9);
  ctx.fill();
  if (wb > 2.2) {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = C.woodLit;
    trunkPath(ctx, fx - wb * 0.28, fy, cx - wt * 0.28, cy, wb * 0.34, wt * 0.34, lean * 0.9);
    ctx.fill();
    ctx.restore();
  }

  const n = tr < 6 ? Math.max(4, PLANT.fronds - 2) : PLANT.fronds;
  const step = Math.PI * 2 / n;
  const notch = tr > 7;
  const steps = notch ? (tr > 13 ? 14 : 10) : 8;
  const order = [];
  for (let i = 0; i < n; i++) {
    const a = f.a + i * step + Math.sin(f.ph + i * 2.4) * step * 0.18;
    order.push({ a, i, back: Math.sin(a) < -0.1 });
  }
  order.sort((u, v) => Math.sin(u.a) - Math.sin(v.a)); // back to front
  for (const o of order) {
    const jitter = 1 + Math.sin(f.ph * 3 + o.a * 2) * 0.14;

    // depth: 0 pointing straight away from the camera, 1 straight toward it. TILT squashes a back
    // frond to about a third of its drawn length, so it must also travel less, droop less and sit
    // narrower — otherwise its tip swings further than the blade is visibly long and smears across
    // its neighbours and the crown.
    const depth = (Math.sin(o.a) + 1) / 2;
    const seen = 0.55 + 0.45 * depth;
    const len = L * jitter * (0.80 + 0.20 * depth);
    const wid = tr * PLANT.frondWidth * (0.74 + 0.26 * depth);
    const arch = PLANT.arch * (1.26 - 0.26 * depth);   // back blades arc up behind the crown
    const droop = PLANT.droop * (0.30 + 0.70 * depth); // instead of drooping down onto it

    // Amplitude stays positive, so blades stream downwind and gust rather than swinging
    // symmetrically through vertical. -cos(bearing) presses upwind blades down and lifts downwind
    // ones, so the crown flexes instead of turning like a rigid fan.
    const gust = Math.sin(clock * 1.5 + f.ph + o.i * 0.9);
    const amp = PLANT.wind * tr * (0.55 + 0.45 * gust) * seen;
    const press = -Math.cos(o.a) * amp * 0.20;

    ctx.fillStyle = o.back ? C.frondDk : C.frond;
    frond(ctx, cx, cy, o.a, len, wid, arch, droop, notch, steps, amp, amp * 0.18 + press);
  }
  ctx.fillStyle = C.frondDk; // crown core hides the seam where every frond meets
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1, tr * 0.15), 0, Math.PI * 2);
  ctx.fill();

  if (tr > 9 && f.nuts > 0.45) {
    ctx.fillStyle = C.coconut;
    const rN = Math.max(1, tr * 0.085);
    for (let i = 0; i < 3; i++) {
      const a = f.ph + i * 2.1;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * tr * 0.17, cy + tr * 0.14 + Math.sin(a) * tr * 0.06, rN, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// A low shrub, so an island is not a row of identical palms. Same frond() — short, wide, steeply
// arched blades springing from just above the ground — so the two species share a drawing language
// instead of one being circles and the other geometry. Below ~4px it collapses to two lobes,
// because at that size blades are indistinguishable from noise.
function drawBush(ctx, f, clock) {
  const fx = f.x, fy = f.y * TILT;
  const tr = PLANT.canopy * f.s * 0.62;

  if (tr < 4) {
    ctx.fillStyle = C.frondDk;
    ctx.beginPath(); ctx.arc(fx, fy - tr * 0.30, tr * 0.86, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.frond;
    ctx.beginPath(); ctx.arc(fx - tr * 0.16, fy - tr * 0.55, tr * 0.62, 0, Math.PI * 2); ctx.fill();
    return;
  }

  const oy = fy - tr * 0.28;
  ctx.fillStyle = C.frondDk; // dark mass at the base, so the blades read as growing out of something
  ctx.beginPath();
  ctx.ellipse(fx, fy - tr * 0.20, tr * 0.66, tr * 0.50, 0, 0, Math.PI * 2);
  ctx.fill();

  const n = tr < 8 ? 5 : 7, step = Math.PI * 2 / n;
  const order = [];
  for (let i = 0; i < n; i++) order.push({ a: f.a + i * step + Math.sin(f.ph + i * 1.7) * step * 0.22, i });
  order.sort((u, v) => Math.sin(u.a) - Math.sin(v.a));
  for (const o of order) {
    const depth = (Math.sin(o.a) + 1) / 2;
    const seen = 0.55 + 0.45 * depth;
    const gust = Math.sin(clock * 1.9 + f.ph + o.i * 1.1);
    const amp = PLANT.wind * tr * 0.75 * (0.5 + 0.5 * gust) * seen;
    const jitter = 1 + Math.sin(f.ph * 2 + o.a * 3) * 0.18;
    ctx.fillStyle = Math.sin(o.a) < -0.1 ? C.frondDk : C.frond;
    frond(ctx, fx, oy, o.a, tr * 0.98 * jitter * (0.82 + 0.18 * depth), tr * 0.30 * (0.78 + 0.22 * depth),
      0.44 * (1.20 - 0.20 * depth), 0.06, false, 8, amp, amp * 0.16);
  }
  if (tr > 9 && f.nuts > 0.62) {
    ctx.fillStyle = C.coconut;
    for (let i = 0; i < 3; i++) {
      const a = f.ph + i * 2.4;
      ctx.beginPath();
      ctx.arc(fx + Math.cos(a) * tr * 0.30, oy + Math.sin(a) * tr * 0.18, Math.max(1, tr * 0.10), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// A small patch at the base, not a cast shadow: at this camera angle a long projected shadow reads
// as a separate object, where a tight one just says "this touches the ground here". It leans toward
// wherever the crown actually is — the trunk bows, so the mass overhead is off-centre from the base,
// and tracking that is what makes a leaning palm look like it is leaning rather than drawn crooked.
function shadowShape(ctx, f, clock, grow) {
  const fx = f.x, fy = f.y * TILT;
  const tr = PLANT.canopy * f.s * (f.isPalm ? 1 : 0.62);
  const lean = f.isPalm ? f.k * PLANT.bow * tr : 0;
  const drift = Math.sin(clock * 1.5 + f.ph) * PLANT.wind * tr * 0.30;
  const r = tr * PLANT.shadowSize * grow;
  const ox = fx + (lean + drift) * PLANT.shadowLean;
  const oy = fy + tr * 0.08; // a touch forward of the base, so it sits under the plant
  ctx.moveTo(ox + r, oy);
  ctx.ellipse(ox, oy, r, r * TILT, 0, 0, Math.PI * 2);
}

// Every shadow on the island goes into ONE path and gets ONE fill. With a fill per plant, two
// overlapping shadows composite twice and the intersection goes darker — wrong, since a crown
// cannot block light that is already blocked. Nonzero winding unions them, and it is cheaper than
// the per-plant ellipse it replaces.
const SHADOW_SOFT = `rgba(0,0,0,${(PLANT.shadowOpa * 0.40).toFixed(3)})`;
const SHADOW_CORE = `rgba(0,0,0,${PLANT.shadowOpa})`;
function drawShadows(ctx, list, clock) {
  ctx.fillStyle = SHADOW_SOFT;
  ctx.beginPath();
  for (const f of list) shadowShape(ctx, f, clock, 1.45); // wider, fainter: a penumbra
  ctx.fill();
  ctx.fillStyle = SHADOW_CORE;
  ctx.beginPath();
  for (const f of list) shadowShape(ctx, f, clock, 1);
  ctx.fill();
}

// The drawn shoreline is a spline through the midpoints of the vertex polygon, not the polygon
// itself — it cuts the corners, so a plain point-in-polygon test would call a corner land when the
// sand has already curved away from it. Sample the same curve ring() draws and test against that.
function islandOutline(r, verts, scale, steps = 4) {
  const n = verts.length, pts = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2, rr = r * verts[k] * scale;
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr * TILT]);
  }
  const out = [];
  for (let k = 0; k < n; k++) {
    const p = pts[k], q = pts[(k + 1) % n], prev = pts[(k + n - 1) % n];
    const m0 = [(prev[0] + p[0]) / 2, (prev[1] + p[1]) / 2];
    const m1 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    for (let i = 0; i < steps; i++) out.push(qp(i / steps, m0, p, m1));
  }
  return out;
}

function inOutline(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > py) !== (b[1] > py) && px < (b[0] - a[0]) * (py - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// Plants for one island. Positions are rejection-sampled so crowns cannot pile up: a candidate is
// kept only if it clears every plant already placed by minGap x the two footprints summed. The
// requirement relaxes every ten tries so a crowded island always terminates rather than hanging.
function genFoliage(r, verts) {
  const k = r / PLANT.countRefR;
  const count = Math.max(1, Math.round(PLANT.countRef * k * k));
  const Rs = r * PLANT.scatter;
  const span = PLANT.scaleMax - PLANT.scaleMin;
  const plants = [];

  for (let f = 0; f < count; f++) {
    let placed = null, relax = 1;
    for (let t = 0; t < 60; t++) {
      // sqrt spreads plants evenly over the disc. Uniform radius crowds the middle, which nothing
      // noticed at the old two-to-four plants but is obvious at twenty.
      const a = Math.random() * Math.PI * 2, rr = Rs * Math.sqrt(Math.random());
      const s = PLANT.scaleMin + Math.random() * span;
      const isPalm = Math.random() < PLANT.palmRatio;
      const c = { x: Math.cos(a) * rr, y: Math.sin(a) * rr, s, isPalm };
      const fc = footprint(s, isPalm);
      let ok = true;
      for (const o of plants) {
        const need = (fc + footprint(o.s, o.isPalm)) * PLANT.minGap * relax;
        if (Math.hypot(c.x - o.x, c.y - o.y) < need) { ok = false; break; }
      }
      if (ok) { placed = c; break; }
      if (t % 10 === 9) relax *= 0.86;
    }
    if (!placed) {
      const a = Math.random() * Math.PI * 2, rr = Rs * Math.sqrt(Math.random());
      placed = { x: Math.cos(a) * rr, y: Math.sin(a) * rr,
                 s: PLANT.scaleMin + Math.random() * span, isPalm: Math.random() < PLANT.palmRatio };
    }
    plants.push({
      ...placed,
      a: Math.random() * Math.PI * 2,   // crown rotation
      k: Math.random() * 2 - 1,         // lean / bow direction
      ph: Math.random() * Math.PI * 2,  // wind phase
      nuts: Math.random(),
    });
  }

  // Height is added in unsquashed screen px, so a tall plant near the back of the disc can push its
  // crown out over the water. Walk those south until the crown clears the shoreline and bake the
  // offset back into the plan position, so nothing downstream has to know it happened. Doing this
  // here rather than per frame is the whole point — the alternative is isPointInPath every frame.
  const shore = islandOutline(r, verts, 0.94);
  for (const p of plants) {
    const tr = PLANT.canopy * p.s;
    const top = p.isPalm ? tr * (PLANT.trunkH + PLANT.arch * PLANT.frondLen + PLANT.frondWidth)
                         : tr * 0.62 * 1.5;
    const px = p.x + (p.isPalm ? p.k * PLANT.bow * tr : 0);
    for (let i = 0; i < 30 && !inOutline(px, p.y * TILT - top, shore); i++) {
      p.y += Math.max(0.6, tr * 0.10) / TILT;
    }
  }

  // Sorted once, here: plants never move — wind only bends blades — so the draw loop has no reason
  // to re-sort them every frame.
  plants.sort((a, b) => a.y - b.y);
  return plants;
}

const AI_COLORS = [
  { fill: "#c15236", stroke: "#8a3722" },
  { fill: "#c98a3b", stroke: "#8f5f22" },
  { fill: "#a6584f", stroke: "#743833" },
  { fill: "#7a9c8f", stroke: "#4d6a5f" },
  { fill: "#9c7ab0", stroke: "#5f4d6a" },
  { fill: "#b0a24f", stroke: "#6a5f2a" },
  { fill: "#6f93b4", stroke: "#425a70" },
  { fill: "#c76b8e", stroke: "#7f3f57" },
  { fill: "#5fa27f", stroke: "#356050" },
  { fill: "#b8794f", stroke: "#7a4b2c" },
];

const DISPLAY = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
const UI = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const WP = {
  broadside: { cd: 1.6, speed: 250, life: 0.88, r: 3, bar: "hull" },
  bow: { cd: 1.1, speed: 270, life: 1.4, r: 2.6, bar: "mast" },
  musket: { cd: 0.75, speed: 320, life: 0.4, r: 1.6, bar: "crew" },
};

// A shot's `r` is how wide a bite it takes: it is what widens the hull when the flight is tested,
// so a round shot holes a ship where a musket ball whistles past her rail. What gets drawn is
// smaller than that. Shrinking the drawn ball is a matter of how the sea looks; shrinking the bite
// would quietly make every gun in the game worse, and those are two different decisions. Set this
// to 1 to put them back together.
const SHOT_DRAW = 0.7;
// The light on the ball is the half of it that carries on dark water, so it is not allowed to
// shrink away to nothing: under about a pixel canvas renders it as part-covered and it goes grey,
// which is the one thing that mass was there to prevent.
const SHOT_LIT_MIN = 0.85;

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
const BROADSIDE_R = WP.broadside.speed * WP.broadside.life;
const VIEW = BROADSIDE_R * 2; // world units across the square
// A screen much bigger than a phone's would otherwise magnify everything to fill its shorter side.
// Past this the square only ever shows more water than it promises, which costs the captain nothing.
const MAX_ZOOM = 1.5;
// How far the map's boundary is let inside the edge of the screen: enough to read the rope, its
// buoys, and a strip of the water beyond, and no more. It is the whole of the camera's give on a
// side, so it is also how far off centre a ship ends up when she runs right up on that boundary.
const EDGE_PEEK = 40; // screen pixels

// A ship's length, beam and collision ellipse are her own now, set per class by `hullform.js` and
// carried on the ship as `hullA` and `hullB` (semi-length and semi-beam). The galleon anchors the
// scale at the 36 by 13 every hull at sea used to share.

/**
 * THE RIG SHE CARRIES, AT SEA. Every ship afloat used to draw the same three hard-coded masts, so a
 * launch and a first rate were told apart only by their health bars. The masts and sails drawn on the
 * water now come off the ship's own loadout, through the same `rigSpec()` the menu ship reads:
 * a mast stands where its station is on HER hull, as tall as the mast bought for it, and carries one
 * band of canvas per sail actually bent on, in the shape of its category. Square canvas is the
 * bellied band the fight has always drawn; triangular, gaff and lug canvas are fore-and-aft panels;
 * headsails run from the bowsprit up toward the foremost masthead.
 *
 * Worked out once per ship at `makeShip`, because nothing about her rig changes at sea short of the
 * whole thing coming down.
 */
const SEA_FOREAFT = new Set(["TRI", "LAT", "GAF", "LUG"]);
function buildSeaRig(loadout, sea) {
  const spec = rigSpec(loadout);
  const masts = [];
  for (const m of spec.masts) {
    const u = sea.masts[m.station];
    if (u === undefined) continue;
    const top = Math.max(8, sea.tops[m.station] * (m.height || 1));
    const wB = sea.wBase[m.station];
    const n = m.sails.length;
    // bands from the deck up: each sail keeps about three quarters of the height of the one below
    // it and narrows the same way, with a little air between bands
    const zb0 = 0.18 * top, gap = 1.6;
    const room = Math.max(4, top - 3 - zb0 - gap * (n - 1));
    const weights = Array.from({ length: n }, (_, i) => Math.pow(0.74, i));
    const wsum = weights.reduce((a, b) => a + b, 0) || 1;
    let z = zb0;
    const sails = m.sails.map((sail, i) => {
      const h = room * (weights[i] / wsum);
      // a studdingsail is the band run out sideways, so the band just carries the extra beam
      const band = { kind: sail.kind, sb: z, st: z + h, w: wB * Math.pow(0.82, i) * (sail.stud ? 1.45 : 1) };
      z += h + gap;
      return band;
    });
    masts.push({ u, h: top, sails });
  }
  // what the bowsprit carries: headsails run up toward the foremost masthead, and square canvas
  // under the spar is a spritsail
  const fore = masts.reduce((a, m) => (!a || m.u > a.u ? m : a), null);
  const heads = [];
  const sprits = [];
  const bowTip = 0.61 * sea.L;
  for (const m of spec.masts) {
    if (m.station !== "bowsprit") continue;
    m.sails.forEach((sail, i) => {
      if (SEA_FOREAFT.has(sail.kind)) {
        if (fore) heads.push({ tack: bowTip * (0.72 + 0.11 * i), mastU: fore.u, mastZ: fore.h * (0.55 + 0.14 * i) });
      } else {
        // slung further out along the spar per sail, the way the menu spreads them, so a second
        // spritsail is a sail and not a repaint of the first
        sprits.push({ kind: sail.kind, sb: -1.5, st: 3, w: 0.54 * sea.W * (1 - 0.18 * i), u: sea.L * (0.46 + 0.12 * i) });
      }
    });
  }
  const topmost = masts.reduce((a, m) => Math.max(a, m.h), 0);
  return { masts, heads, sprits, top: Math.max(topmost, 14) };
}
const HULL_PAD = 3; // rigging and oars, so hulls never touch pixels
const RAM_MIN_CLOSE = 25; // closing speed at which a collision starts to count as a ram
const RAM_FULL_CLOSE = 94; // closing speed for a full-weight ram: a fresh ship's top speed
const RAM_CURVE = 1.5; // how sharply the blow grows with closing speed, for every angle alike
const RAM_MAX_FORCE = 2.4; // ceiling on it, so a head-on cannot run away with the match
const RAM_BEAM = 1.25; // weight of a blow square on the beam...
const RAM_FINE = 0.6; // ...and of one that glances off her bow or stern
const RAM_GRAZE = 1; // below this a touch is not a ram at all: no damage, no cooldown, no lock
const RAM_MUTUAL_CAP = 0.8; // most of a bow-to-bow blow one ship's speed can shove onto the other
const RAM_KNOCK = 150; // impulse thrown apart on a ram (scaled by closing speed)
const RAM_RECOIL = 0.3; // floor on the bounce for whoever drove into the blow
const RAM_DRIVE_LOSS = 0.88; // share of her way a ship spends into the impact, bow-on
const RAM_REARM_GAP = 26; // hulls must break this far clear before the pair can ram again
const RAM_CD = 0.9; // seconds before a ship can ram again
// Breaking clear was the only way out of that lock, which two ships circling each other never manage:
// they can hold station inside the gap indefinitely and the pair stays barred from ever trading
// another blow. The lock is meant to stop damage being ground out of hulls already touching, and a
// few seconds does that, so it lapses on its own as well.
const RAM_LOCK_MAX = 3;
// A ram is worked out from the way a ship has actually made, not from the way her helmsman wanted.
// The two part company whenever something is in the road: hulls pressed against one another are
// de-overlapped every frame, so they stand still in the water while `spdCur` — the throttle's idea of
// her speed — reads full ahead. Resolving a blow from that gives a stationary ship the weight of a
// flying one: a pair jammed bow to bow could sink a third that came to attack them, and the moment
// one of them turned away the other took her beam at full force without ever having moved. So each
// ship measures the ground she truly covered last frame, and a hull that cannot go forward loses her
// way like any other.
// The measurement is smoothed. Hulls in contact are driven together and pushed apart again frame by
// frame, so a single frame's difference swings wildly either side of nothing, and taking the positive
// half of that swing at face value hands a standing ship the weight of a charging one every other
// frame. Not too smooth, though: force climbs as the 1.5 power of closing speed, so under-reading a
// ship working up to a charge by a fifth costs nearly half her blow.
const WAY_SMOOTH = 14; // the measurement follows her within about a fifteenth of a second

// And a hull held on another's timbers loses her way, so she has to gather it again before she is
// worth anything — which is what stops her taking the beam of the ship that breaks off first as
// though she had been charging all along. Only being foul of another hull counts: a ship knocked off
// her stride is still free to sail, and treating that as held empties the melee of blows altogether.
const BAULK_TOL = 0.35; // foul of a hull and making less than this share of her asking: she is baulked
const BAULK_GRACE = 0.35; // ...and only held once it has gone on this long. A knock in passing is not
const BAULK_RATE = 6; // once held, her way falls away, halving in about an eighth of a second

// For hull against hull a ship is her keel — a line down her length — swelled by her beam. Measuring
// between the two keels finds where they truly foul, which the distance between two centres cannot:
// hulls this long can cross well off the line joining them, and would slide through one another.
// Both figures are each ship's own now: a first rate's keel is half again a cutter's, and the two
// are alongside when the gap closes to the sum of their own beams.
const keelHalf = (s) => s.hullA - s.hullB;
const hullTouch = (a, b) => a.hullB + b.hullB + 2 * HULL_PAD;

// closest approach of the two keels: distance, and the unit vector from a's keel to b's
function keelGap(a, b) {
  const aK = keelHalf(a), bK = keelHalf(b);
  const ux = Math.cos(a.heading) * aK, uy = Math.sin(a.heading) * aK;
  const vx = Math.cos(b.heading) * bK, vy = Math.sin(b.heading) * bK;
  // segments a.x±u and b.x±v, walked as p0 + s*(2u) and q0 + t*(2v)
  const wx = a.x - ux - (b.x - vx), wy = a.y - uy - (b.y - vy);
  const A2 = 4 * (ux * ux + uy * uy), B2 = 4 * (ux * vx + uy * vy), C2 = 4 * (vx * vx + vy * vy);
  const D2 = 2 * (ux * wx + uy * wy), E2 = 2 * (vx * wx + vy * wy);
  const den = A2 * C2 - B2 * B2;
  let s = den > 1e-9 ? clamp((B2 * E2 - C2 * D2) / den, 0, 1) : 0;
  let t = C2 > 1e-9 ? clamp((B2 * s + E2) / C2, 0, 1) : 0;
  s = A2 > 1e-9 ? clamp((B2 * t - D2) / A2, 0, 1) : 0; // settle it after the clamps
  const px = a.x - ux + 2 * ux * s, py = a.y - uy + 2 * uy * s;
  const qx = b.x - vx + 2 * vx * t, qy = b.y - vy + 2 * vy * t;
  let gx = qx - px, gy = qy - py;
  let d = Math.hypot(gx, gy);
  if (d < 1e-6) { gx = b.x - a.x; gy = b.y - a.y; d = Math.hypot(gx, gy) || 1; } // dead aboard her
  return { d, nx: gx / d, ny: gy / d };
}

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
const shotHitsHull = (s, x0, y0, x1, y1, pad) => {
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
const shotHitsCircle = (cx, cy, r, x0, y0, x1, y1) => {
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

/**
 * REPAIRS — the one thing a purse buys at sea, and the only reason to carry coins into a fight.
 *
 * Two buttons, and they are priced on opposite principles because they are opposite jobs.
 *
 * HULL is bought by the point, and by nothing else. A coin buys back a point of damage: no base, no
 * rate, no share of anything, and no ceiling short of whole. What she pays is exactly what the damage
 * she is undoing was worth to the ship that dealt it, which puts both halves of a round's economy in
 * the same currency and means a captain can read her own hull bar as a price.
 *
 * Because the bill is her damage and nothing else, it scales with the class she is sailing without a
 * scaling term anywhere: a hull with two hundred and fifty points to lose can run up a bill of two
 * hundred and fifty, and the cutter that has ninety can never be charged more than ninety. Bigger
 * ships cost more to keep afloat because there is more of them to hole.
 *
 * Two things follow and both are the point: a ship barely scratched pays almost nothing, so there is
 * no wrong moment to repair, and a captain who cannot cover the whole bill buys as much of it as her
 * purse reaches rather than being refused, which matters most in the round where she is down to her
 * last coins and still taking fire.
 *
 * MAST is flat, and it puts the rig back whole. A mast is stepped or it is not: there is no half a
 * mast, so there is no half price and no part payment, and the charge is the same whether she lost
 * the whole thing or sprung it. What sets the price is the rig she carries rather than the damage she
 * took, at `RIG_REBUILD_SHARE` of what her whole rigging is worth, which is the shipyard's figure and
 * not the fight's. Because speed and helm both read how much of her rig is standing, a rebuilt mast
 * hands her back full sail at once, and that is what makes it worth the money: losing a mast is the
 * one hit that takes a ship out of a fight while leaving her afloat.
 *
 * CREW cannot be bought back at all. Hands lost over the rail are lost, and no coin brings them
 * back, so the crew bar is a clock that only runs one way for the length of a round. It is why
 * musket fire and a spell in the weather are worth avoiding rather than paying off afterwards.
 *
 * What makes any of it a decision rather than a tax is where the money comes from. Repairs are paid
 * out of the voyage's own takings, so every coin spent staying afloat is a coin that does not reach
 * the hold and does not buy a ship. Fighting carefully is worth money.
 */
const HULL_RATE = 1; // a coin a point. Deliberately 1, and the one place to change it if it ever moves

/**
 * What a new mast costs at sea: a share of the rig she is actually carrying.
 *
 * Every ship afloat brings her own loadout now, so a captain who has spent thousands getting a
 * skysail mast aloft pays to put it back, and one under a free pole and a single sail pays almost
 * nothing. The starter's rig is the fallback for a hull that somehow reaches the water without one,
 * which nothing should do.
 */
const STOCK_LOADOUT = resolve(STARTER);
// Her three bars at full, off a loadout: what the HUD opens on and what the fight fills in.
const barsOf = (loadout) => { const r = rate(loadout); return { hull: r.hull, mast: r.mast, crew: r.crew }; };
const mastRebuild = (s) => mastRebuildCost(s.loadout || STOCK_LOADOUT);

const REPAIRS = [
  { key: "hull", label: "HULL", sub: "planks and pitch, back to whole", color: C.hull, whole: "Sound" },
  { key: "mast", label: "MAST", sub: "a new mast, and full sail again", color: C.mast, whole: "Sound" },
];

/**
 * What one repair would put back and what it would cost. Everything the rail needs to draw itself and
 * everything `repair()` needs to charge for, worked out in one place so the button cannot promise
 * something different from what the purchase does.
 *
 * `afford` is what her purse actually reaches. For the hull that can be part of the bill; for the
 * mast it is the whole price or nothing, because half a mast is not a thing.
 */
function repairQuote(s, sys) {
  if (sys === "hull") {
    const points = Math.max(0, s.maxHull - s.hull);
    const cost = Math.ceil(points * HULL_RATE);
    return { points, cost, afford: Math.min(cost, Math.floor(s.coins)), whole: points <= 0.001, part: true };
  }
  const cost = mastRebuild(s);
  const points = s.maxMast - s.mast;
  const whole = points <= 0.001;
  return { points, cost, afford: Math.floor(s.coins) >= cost ? cost : 0, whole, part: false };
}

/**
 * A mode is a set of rules, not a name to compare against. Everything that used to ask "are we in
 * free-for-all?" now asks what it actually wants to know — are guns aboard, is every hull hostile to
 * every other, does anyone keep a placement — so each rule is stated once, here, where the modes can
 * be read side by side. Adding a mode is filling in a row rather than hunting down the checks that
 * would otherwise have to be taught about it.
 */
const MODES = {
  arena: {
    key: "arena",
    title: "ARENA",
    short: "arena",
    color: C.side,
    desc: "Endless survival. One hunter to start, matched to your ship. Sink ships and reinforcements sail in from the horizon. Patch her up between waves, out of what you have taken. Score by ships sunk.",
    unsailed: "No wave has come for you here yet.", // the log, where a mode has no voyages in it
    rivals: ARENA_START, // hulls on the water at the drop, besides the player
    guns: true, // cannons and muskets aboard
    repairs: true, // the repair rail, paid for out of the voyage's own earnings
    melee: false, // every hull hostile to every other, rather than only to the player
    ranked: false, // placements, a leader, and the rank badge
    lastAfloatWins: false,
    reinforcements: true, // a sinking brings fresh hunters in from the horizon
    flees: false, // a beaten captain runs rather than fights on
    storm: false, // a closing ring of foul weather
    timeCoins: 0, // coins a second afloat, on top of what her guns and bow earn
    fullRound: 0, // ...and the span a winner is paid for whatever the clock said
    winBonus: 0,
  },
  ffa: {
    key: "ffa",
    title: "FREE-FOR-ALL",
    short: "free-for-all",
    color: C.mast,
    desc: "Last afloat wins. 10 rival captains, every one of them matched to the ship you sail, hunting for weak prey and turning on whoever pulls ahead. Spend what you take on repairs, or keep it.",
    unsailed: "You have not taken on the ten.",
    rivals: FFA_AI,
    guns: true,
    repairs: true,
    melee: true,
    ranked: true,
    lastAfloatWins: true,
    reinforcements: false,
    flees: true,
    storm: false,
    timeCoins: 0, // she is paid for what she sinks, not for the time it takes
    fullRound: 0,
    // ...and a purse for outlasting ten rivals. Smaller than the derby's, because a free-for-all
    // captain has been paid all round for the fighting that got her there and a derby captain has
    // not: there are no guns in that mode, so the win is most of what it pays.
    winBonus: 25,
  },
  derby: {
    key: "derby",
    title: "DEMOLITION DERBY",
    short: "derby",
    color: C.crew,
    desc: "Only one hand needed. Last afloat wins. 10 captains in ships a match for yours, no guns, nothing to buy. Sink rivals by ramming. Drive your bow into her beam, and turn to face anyone charging yours. A storm closes in and takes the crew of any ship caught.",
    unsailed: "Untried. Nothing in there but iron and weather.",
    rivals: DERBY_AI,
    guns: false,
    repairs: false,
    melee: true,
    ranked: true,
    lastAfloatWins: true,
    reinforcements: false,
    flees: false, // there is nowhere to run to, and the weather is coming anyway
    storm: true,
    // Staying afloat is most of the work here, so it is paid by the second — and a winner is paid for
    // a whole round however early she ended it. Settling the thing in forty seconds is worth the same
    // purse as outlasting the weather for the full span, which is to say it is worth far more an hour:
    // the time she saves is hers to spend on the next one. A round left alone runs
    // STORM_GRACE + STORM_CLOSE + STORM_HOLD + STORM_SQUEEZE, 168 seconds as the weather is tuned;
    // the winner's is a set purse a shade above that, so a win comes to 250 whatever else she took.
    timeCoins: 1,
    fullRound: 175,
    winBonus: 75,
  },
};
// Menu order, and the order the hold's per-mode bests are listed in. Arena sits last for now: it is
// the hardest opening a new captain can pick, since it is the one mode where the sea keeps filling
// up behind every ship she sinks. The first card is the one most players will take.
const MODE_LIST = ["ffa", "derby", "arena"];
const modeOf = (m) => MODES[m] || MODES.arena;

function norm(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
// Grouped, because a lifetime tally runs to five figures and 41203 is a number nobody reads at a
// glance. `fmtCoins` is the same thing under the name the purse uses.
const fmtNum = (n) => Math.round(n || 0).toLocaleString();
const fmtCoins = fmtNum;

// A hull with way on her does not answer her rudder as she does at a crawl. The loss is weighted to
// the top of the range: handling in and out of a fight is left where it was, and only a ship running
// flat out finds she cannot turn inside her own wake. It keys off the way she actually carries rather
// than the stick, so easing off the throttle hands the rudder back as she slows: coming round hard
// means spending some of her way to do it, and a charge at full sail is a commitment.
const BASE_SPEED = 94; // top speed of a whole ship, and the yardstick for a heavy rudder
const RUDDER_HEAVY = 0.22; // rudder lost at that speed
const RUDDER_CURVE = 2.2; // how late in the range it starts to bite

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
const topSpeed = (s) => BASE_SPEED * s.rating.speed;
const rudder = (s) => 1 - RUDDER_HEAVY * Math.pow(clamp(s.spdCur / topSpeed(s), 0, 1), RUDDER_CURVE);
const speedCap = (s) => topSpeed(s) * (0.5 + 0.5 * (s.mast / s.maxMast));
const turnCap = (s) => 2.4 * s.rating.turn * (0.22 + 0.78 * (s.mast / s.maxMast)) * rudder(s);
// What one ball carries. Past ten guns a side the battery fires in stacked columns, so a heavy ship
// throws the same number of balls as a middling one and each of hers is worth more.
const sideDmg = (s) => s.rating.broadside.perBall;
const frontDmg = (s) => s.rating.bow.perBall;
// One ball of the small-arms volley. A plain rail is the old flat 3.2; swivels aboard pull it up,
// because a swivel ball outweighs a musket's, and better swivels pull harder.
const musketDmg = (s) => s.rating.musketDamage;
// The arc that volley scatters over. Quality iron on the rail tightens it; the AI's own aiming
// error is added separately in `fire()` and must stay separate, or better swivels aboard the player
// would quietly make every rival captain a better shot.
const musketArc = (s) => s.rating.musketSpread;
/**
 * A ram is worth a quarter of the hull BEHIND it, so what she does with her bow scales with the ship
 * she is driving. A flat 26 was right when every hull afloat had a hundred points; against a first
 * rate's three thousand it would be a knock on the door, and the derby is decided by ramming alone.
 */
const RAM_SHARE = 0.26;
const ramDmg = (s) => RAM_SHARE * s.maxHull;
// What a sinking pays her killer, as a share of the hull that went down. A quarter of a ship's
// launch is the flat 25 the game paid when every hull afloat was worth a hundred points.
const KILL_SHARE = 0.25;
/** How long that mount takes to serve. A battery reloads at the pace of its slowest piece. */
const reloadOf = (s, wk) => (wk === "musket" ? WP.musket.cd : s.rating[wk].reload || WP[wk].cd);
/** Whether she has anything on that mount at all. A ship with no broadside must not fire one. */
const canFire = (s, wk) => (wk === "musket" ? s.rating.muskets > 0 : s.rating[wk].count > 0);

/**
 * Carry out one repair and charge her purse for it.
 *
 * The hull takes as much of the bill as she can pay and rises by that share of the work. The mast is
 * all or nothing and comes back whole, which hands her back full sail in the same instant, because
 * `speedCap` and `turnCap` both read how much of her rig is standing.
 *
 * `repaired` is banked apart from `coins` because the two answer different questions at the end of a
 * round: what she has left, and what she spent staying afloat. Only the second comes off her
 * earnings.
 */
function repair(s, sys) {
  const q = repairQuote(s, sys);
  if (q.whole || q.afford <= 0) return 0;
  if (sys === "hull") {
    s.hull = Math.min(s.maxHull, s.hull + q.points * (q.afford / q.cost));
  } else {
    s.mast = s.maxMast;
    // A rig re-stepped is a rig again. Without this a mast shot away stayed away however much canvas
    // she bent on, and the one repair worth buying most was the one that did nothing.
    s.mastDown = false;
  }
  s.coins -= q.afford;
  s.repaired += q.afford;
  s.patches += 1;
  return q.afford;
}

export default function App() {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const startRef = useRef(() => {});
  const syncRef = useRef(() => {});
  const inputRef = useRef({ joyMag: 0, joyAng: 0, broadside: false, bow: false, musket: false });

  const knobRef = useRef(null);
  const joyState = useRef({ id: null, cx: 0, cy: 0, R: 34 });
  const btnRefs = { broadside: useRef(null), bow: useRef(null), musket: useRef(null) };

  const [phase, setPhase] = useState("start");
  const [mode, setMode] = useState("arena");
  const [result, setResult] = useState("");
  const [place, setPlace] = useState({ rank: 0, total: 0 });
  const [stats, setStats] = useState({ time: 0, kills: 0, dmg: 0, coins: 0, patches: 0, repaired: 0, kept: 0 });
  const [coins, setCoins] = useState(0);
  const [sunk, setSunk] = useState(0);
  const [left, setLeft] = useState(0);
  const [rank, setRank] = useState({ rank: 1, total: 1 });
  // What each repair would cost and put back, recomputed with the rest of the HUD so the rail prices
  // the patch she would get right now rather than the one she could have afforded a second ago.
  const [mend, setMend] = useState({});
  // The three bars, and what they are full at. Seeded from the ship the captain actually owns rather
  // than from a constant, so the HUD opens on her figures instead of flicking from a stock hull's to
  // hers on the first frame.
  const [ph, setPh] = useState(() => barsOf(shipLoadout(getHold())));
  const [phMax, setPhMax] = useState(() => barsOf(shipLoadout(getHold())));
  const [storm, setStorm] = useState({ closes: 0, out: false, closing: false });
  const [hold, setHold] = useState(getHold);
  const [banked, setBanked] = useState(0); // what the voyage on the end screen put in the hold

  useEffect(() => subscribeHold(setHold), []);

  const syncHUD = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    const p = g.player;
    setCoins(Math.floor(p.coins));
    setSunk(g.sunk);
    const aliveCount = g.ships.filter((s) => s.alive).length;
    setLeft(aliveCount);
    setRank({ rank: p.rank || 1, total: g.aliveCount || aliveCount });
    if (g.rules.repairs) {
      const q = {};
      for (const r of REPAIRS) q[r.key] = repairQuote(p, r.key);
      setMend(q);
    }
    setPh({ hull: p.hull, mast: p.mast, crew: p.crew });
    setPhMax({ hull: p.maxHull, mast: p.maxMast, crew: p.maxCrew });
    if (g.rules.storm) setStorm({ closes: Math.max(0, STORM_GRACE - g.time), out: g.playerOut, closing: g.stormR > STORM_R1 });
  }, []);
  syncRef.current = syncHUD;

  const mendNow = useCallback(
    (sys) => {
      const g = gameRef.current;
      if (!g || !g.running || !g.rules.repairs) return;
      if (repair(g.player, sys) > 0) syncHUD();
    },
    [syncHUD]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let Wd = 0, // the canvas, in screen pixels: what the buttons and the radar are placed against
      Hd = 0,
      dpr = 1,
      zoom = 1, // screen pixels per unit of view space
      Vw = 0, // and the same canvas in view space, which is where the sea is drawn
      Vh = 0,
      Vsq = 0, // the side of the square, in view space
      raf = 0,
      last = 0,
      clock = 0;

    // View space is world space seen from the camera: across is one to one, and down is squashed by
    // TILT. `zoom` is the only thing between it and the screen, so every distance the sea is drawn
    // with — a hull, a range, a whitecap — stays in world units and the square decides how big they
    // come out. Screen pixels are wanted for two things only, the radar and the vignette.
    const worldSpace = () => ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
    const screenSpace = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      Wd = rect.width;
      Hd = rect.height;
      canvas.width = Math.round(Wd * dpr);
      canvas.height = Math.round(Hd * dpr);
      zoom = Math.min(Math.min(Wd, Hd) / VIEW, MAX_ZOOM);
      Vw = Wd / zoom;
      Vh = Hd / zoom;
      Vsq = Math.min(Vw, Vh);
      screenSpace();
      camUpdate();
    }

    const SX = (x, cam) => x - cam.x;
    const SY = (y, cam) => (y - cam.y) * TILT;

    function makeShip(x, y, heading, opts) {
      const pal = AI_COLORS[opts.ci % AI_COLORS.length];
      // She sails as what she was built: her loadout comes in from the hold if she is the player's,
      // and from the stock fleet if she is not. `rate()` is asked once, here, because nothing about
      // a ship changes at sea except her damage.
      const loadout = opts.loadout || STOCK_LOADOUT;
      const rating = rate(loadout);
      // Her hull's own size, from the class's form: what she draws as, and also what she collides
      // as, because a first rate really is a bigger target than a yawl. Her timber comes with it,
      // so a pine boat sits pale on the water beside an oak brig.
      const form = hullForm(loadout.hull.id);
      const sea = form.sea;
      const s = {
        x, y, heading, spdCur: 0, alive: true,
        isPlayer: !!opts.isPlayer,
        loadout, rating, sea, seaRig: buildSeaRig(loadout, sea),
        hullA: sea.L / 2, hullB: sea.W / 2,
        cols: {
          dark: tintTimber(C.hullDark, form.timber),
          deck: tintTimber(C.hullDeck, form.timber),
          wood: tintTimber(C.hullWood, form.timber),
          spar: tintTimber(C.wood, form.timber),
        },
        coins: 0, earned: 0, repaired: 0, patches: 0, rank: 0, kills: 0, dmgDealt: 0, rams: 0, exposure: 0,
        maxHull: rating.hull, maxMast: rating.mast, maxCrew: rating.crew,
        hull: rating.hull, mast: rating.mast, crew: rating.crew,
        cd: { broadside: Math.random() * 0.5, bow: Math.random() * 0.5, musket: Math.random() * 0.5 },
        mastDown: false, flash: 0, ramCd: 0, locked: new Map(), wakeT: 0, sprayT: 0,
        roll: 0, rollPhase: Math.random() * Math.PI * 2, turnVel: 0, kx: 0, ky: 0,
        px: x, py: y, vx: 0, vy: 0, way: 0, baulkT: 0, foul: false, // where she was, and the ground she truly made
        fill: opts.isPlayer ? C.player : pal.fill,
        stroke: opts.isPlayer ? C.playerStroke : pal.stroke,
      };
      if (!opts.isPlayer) {
        s.wander = Math.random() * Math.PI * 2;
        s.wanderT = 0;
        s.oppT = 0;
        s.oppHold = 1.8 + Math.random() * 2.6; // trigger discipline: some captains waste less powder
        s.nerve = Math.random(); // how late she leaves it before turning to face a charge
        s.baffled = 0; // how long she has been getting nowhere with the hull she is engaged with
        s.sheerT = 0; // time left on a deliberate break-off
        s.sheerHeading = 0; // and the course out of the heap she picked when she began it
        s.retargetT = 0;
        s.target = null;
      }
      return s;
    }

    function farPos(g, minFromPlayer) {
      let x, y, ok, tries = 0;
      do {
        x = 180 + Math.random() * (WORLD - 360);
        y = 180 + Math.random() * (WORLD - 360);
        ok = true;
        if (g.player && Math.hypot(x - g.player.x, y - g.player.y) < minFromPlayer) ok = false;
        if (ok && g.islands) for (const isl of g.islands) if (Math.hypot(x - isl.x, y - isl.y) < isl.r + 55) { ok = false; break; }
        tries++;
      } while (!ok && tries < 40);
      return { x, y };
    }

    function hash(i, j) {
      const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
      return v - Math.floor(v);
    }

    function genIslands(g) {
      const isl = [];
      let tries = 0;
      while (isl.length < ISLAND_COUNT && tries < 400) {
        tries++;
        const r = 58 + Math.random() * 66;
        const x = r + 90 + Math.random() * (WORLD - 2 * (r + 90));
        const y = r + 90 + Math.random() * (WORLD - 2 * (r + 90));
        if (Math.hypot(x - WORLD / 2, y - WORLD / 2) < 320) continue;
        if (isl.some((o) => Math.hypot(x - o.x, y - o.y) < r + o.r + 170)) continue;
        const n = 12;
        const verts = [];
        for (let k = 0; k < n; k++) verts.push(0.78 + Math.random() * 0.3);
        isl.push({ x, y, r, verts, foliage: genFoliage(r, verts) });
      }
      g.islands = isl;
    }

    function avoidIslands(s, desired) {
      const g = gameRef.current;
      if (!g.islands) return desired;
      let near = null, nd = 1e9;
      for (const isl of g.islands) {
        const d = Math.hypot(isl.x - s.x, isl.y - s.y) - isl.r;
        if (d < nd) { nd = d; near = isl; }
      }
      if (near && nd < 130) {
        const toI = Math.atan2(near.y - s.y, near.x - s.x);
        const rel = norm(toI - desired);
        if (Math.abs(rel) < 1.0) desired += (rel > 0 ? -1 : 1) * (1.0 - Math.abs(rel) + 0.3);
      }
      return desired;
    }

    function splash(x, y) {
      const parts = gameRef.current.parts;
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 60;
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.3, max: 0.4, col: "rgba(240,252,249,0.9)", kind: "spark" });
      }
    }

    // A point on the map edge, as far from the player as we can manage and clear of islands.
    function edgePos(g, minFromPlayer) {
      const inset = 70;
      let best = null, bestD = -1;
      for (let t = 0; t < 60; t++) {
        const side = t % 4;
        const u = 120 + Math.random() * (WORLD - 240);
        const x = side === 0 ? u : side === 1 ? u : side === 2 ? inset : WORLD - inset;
        const y = side === 0 ? inset : side === 1 ? WORLD - inset : u;
        let blocked = false;
        if (g.islands) for (const isl of g.islands) if (Math.hypot(x - isl.x, y - isl.y) < isl.r + 55) { blocked = true; break; }
        if (blocked) continue;
        const d = g.player ? Math.hypot(x - g.player.x, y - g.player.y) : 1e9;
        if (d >= minFromPlayer) return { x, y };
        if (d > bestD) { bestD = d; best = { x, y }; }
      }
      return best || { x: inset, y: inset };
    }

    function spawnArenaEnemy() {
      const g = gameRef.current;
      const p = edgePos(g, ARENA_SPAWN_CLEAR);
      // bow pointed inland so a fresh hunter sails into the fight, not into the boundary
      const heading = Math.atan2(WORLD / 2 - p.y, WORLD / 2 - p.x) + (Math.random() - 0.5) * 0.8;
      // Every hull she has put under raises the bar for the next one out of the horizon.
      return makeShip(p.x, p.y, heading, {
        ci: g.ships.length,
        loadout: rivalLoadout(g.rules, g.playerStrength, g.sunk, g.playerLoadout.hull),
      });
    }

    /**
     * WHO SHE MEETS, matched on what her own ship measures rather than on what class it is.
     *
     * A fully found cutter genuinely outclasses a plain brig, so matching on the shelf would call
     * that an even fight. Every mode issues from `STOCK` and every mode picks on a measure:
     *
     *   arena        climbs. The first hunter is a shade under her, and every sinking raises the
     *                bar, so the mode escalates by putting harder ships on the water rather than
     *                more of the same one.
     *   free-for-all fields her own rate: ships of her own class of ship, at every standard of
     *                fitting out, which is equal without being identical.
     *   derby        matches on `ram` rather than on rate, because a rate is a count of guns and
     *                nobody in that mode has one aboard.
     *
     * Falls back to the nearest rung by the same measure when a band comes up empty, so a captain in
     * something the fleet has no answer to still gets a fight.
     */
    function rivalLoadout(rules, strength, step, hull) {
      const key = rules.guns ? "overall" : "ram";
      const rungs = ladder();
      if (rules.reinforcements) {
        // arena: aim a little under her at the drop and climb from there
        const want = strength[key] * (0.75 + 0.07 * step);
        return nearestRung(rungs, key, want).loadout;
      }
      if (rules.guns) {
        const band = stockOfRate(rateOf(hull).rung);
        if (band.length) return band[Math.floor(Math.random() * band.length)].loadout;
      } else {
        const band = peers(strength.ram, 0.15, "ram");
        if (band.length) return band[Math.floor(Math.random() * band.length)].loadout;
      }
      return nearestRung(rungs, key, strength[key]).loadout;
    }
    const nearestRung = (rungs, key, want) =>
      rungs.reduce((a, b) => (Math.abs(b.measure[key] - want) < Math.abs(a.measure[key] - want) ? b : a));

    function reset(m) {
      const rules = modeOf(m);
      gameRef.current = {
        mode: m, rules, player: null, ships: [], shots: [], parts: [], wakes: [], islands: [], texts: [],
        cam: { x: 0, y: 0 }, sunk: 0, fieldSize: 0, aliveCount: 0, leader: null, avgEarned: 0,
        _lastRank: 0, spawnT: 0, spawnQueue: 0, vign: 0, running: false, hudDirty: false, hudAcc: 0, time: 0,
        banked: false, stormR: STORM_R0, stormTick: -1, playerOut: false,
      };
      const g = gameRef.current;
      // Her own ship, read fresh out of the hold rather than off a closure, so a mast bought between
      // rounds is aboard for the next one.
      g.playerLoadout = shipLoadout(getHold());
      g.playerStrength = measure(rate(g.playerLoadout));
      const player = makeShip(WORLD / 2, WORLD / 2, -Math.PI / 2, { isPlayer: true, loadout: g.playerLoadout });
      g.player = player;
      g.ships.push(player);
      genIslands(g);
      for (let i = 0; i < rules.rivals; i++) {
        // where a mode replaces its losses, rivals sail in from the horizon the same way the
        // reinforcements will; where the field is fixed, they are scattered across the whole sea
        if (rules.reinforcements) g.ships.push(spawnArenaEnemy());
        else {
          const pos = farPos(g, 440);
          g.ships.push(makeShip(pos.x, pos.y, Math.random() * Math.PI * 2, { ci: i, loadout: rivalLoadout(rules, g.playerStrength, 0, g.playerLoadout.hull) }));
        }
      }
      g.fieldSize = g.ships.length;
    }

    function pushText(x, y, t) {
      gameRef.current.texts.push({ x, y: y - 26, t, life: 1.3 });
    }
    function muzzle(x, y, ang) {
      gameRef.current.parts.push({ x, y, ang, life: 0.12, max: 0.12, kind: "muzzle" });
    }
    // A gun going off leaves a bank of smoke hanging where it fired. It is thrown out along the
    // barrel, slows almost at once, and then swells and thins where it stands, which is why the
    // puffs carry heavy drag rather than a short life: what says "a gun fired here" is the smoke
    // still sitting there a second later, well after the flash has gone.
    //
    // It has to stay on her rail to read as her smoke. Thrown any harder than this the puffs end up
    // a full beam off the hull, where they stop looking like gunsmoke and start looking like the
    // foam on a shoal. Drag being what it is, a puff settles about a third of its starting speed
    // away from the gun, so these numbers put the bank within a few paces of her side.
    function smoke(x, y, ang, n, power) {
      const parts = gameRef.current.parts;
      for (let i = 0; i < n; i++) {
        const a = ang + (Math.random() - 0.5) * 1.1;
        const sp = (11 + Math.random() * 15) * power;
        const life = (0.55 + Math.random() * 0.45) * power;
        parts.push({
          x: x + (Math.random() - 0.5) * 2.5, y: y + (Math.random() - 0.5) * 2.5,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 3.4,
          life, max: life, r0: 1.2 * power, r1: (5.6 + Math.random() * 3) * power, kind: "puff",
        });
      }
    }
    function burst(x, y, bar) {
      const col = bar === "hull" ? C.splinter : bar === "mast" ? "#d8e6e0" : C.crew;
      const parts = gameRef.current.parts;
      for (let i = 0; i < 7; i++) {
        const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 90;
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4, max: 0.6, col, kind: "spark" });
      }
      parts.push({ x, y, life: 0.3, max: 0.3, col, kind: "ring" });
    }
    function sinkFx(x, y, col) {
      const parts = gameRef.current.parts;
      for (let i = 0; i < 16; i++) {
        const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 120;
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.6, max: 0.9, col: C.splinter, kind: "spark" });
      }
      parts.push({ x, y, life: 0.5, max: 0.5, col, kind: "ring" });
    }

    function finalStats(won) {
      const g = gameRef.current, p = g.player, r = g.rules;
      const time = g.time || 0;
      const paidInFull = !!(won && r.fullRound); // she ended it early; she is paid as though she had not
      const timePay = Math.round((paidInFull ? r.fullRound : time) * r.timeCoins);
      const winPay = won ? r.winBonus : 0;
      const fought = Math.round(p.earned || 0);
      const repaired = Math.round(p.repaired || 0);
      const total = fought + timePay + winPay;
      return {
        time,
        kills: p.kills || 0,
        dmg: Math.round(p.dmgDealt || 0),
        coins: fought, // what her bow and her guns took
        patches: p.patches || 0,
        repaired, // ...and what she handed straight back to the carpenter, all of it her own money
        rams: p.rams || 0,
        timePay, winPay,
        total,
        // What the hold will actually see. A voyage that spent everything it took on staying afloat
        // banks nothing, and never less than nothing: a round cannot cost a captain her savings.
        kept: Math.max(0, total - repaired),
      };
    }

    // A voyage banks once, at the end screen, whichever end it was. The flag matters because both ends
    // can fire for one round: a mutual ram that sinks the last rival and you resolves hit by hit, so
    // the win and the sinking arrive one after the other.
    function bankRun(won, rank) {
      const g = gameRef.current;
      if (g.banked) return;
      g.banked = true;
      const s = finalStats(won);
      const { banked: got } = bankVoyage({
        mode: g.mode, earned: s.total, repaired: s.repaired, kills: s.kills, dmg: s.dmg,
        time: s.time, rams: s.rams, patches: s.patches, won, rank,
      });
      setBanked(got);
    }

    function endWin() {
      const g = gameRef.current;
      g.running = false;
      if (g.rules.ranked) setPlace({ rank: 1, total: g.fieldSize });
      setStats(finalStats(true));
      bankRun(true, g.rules.ranked ? 1 : 0);
      setResult("You are the last hull afloat.");
      setPhase("won");
      syncRef.current();
    }
    function playerDied(bar) {
      const g = gameRef.current;
      g.running = false;
      g.vign = 1;
      g.player.alive = false;
      const rank = g.rules.ranked ? g.ships.filter((s) => s.alive).length + 1 : 0;
      if (g.rules.ranked) setPlace({ rank, total: g.fieldSize });
      setStats(finalStats(false));
      bankRun(false, rank);
      setResult(
        // Three different shapes on purpose. Written to one template they read as filled-in slots,
        // however good the words are.
        bar === "storm" ? "The squall has your crew, and she founders in the weather."
          : bar === "hull" ? "Your hull is breached. She goes under."
          : "Crew routed. You strike your colors."
      );
      setPhase("dead");
      syncRef.current();
    }

    /**
     * The bounty on a sinking: a quarter of what she was, so it scales with the fleet the way the
     * rest of the economy already does.
     *
     * A coin is earned a point of damage and a coin is charged a point of damage, so putting a first
     * rate under pays thirty-three times what a launch pays and costs thirty-three times as much to
     * undo, with no scaling term anywhere in either. The bounty was the one flat term left, and
     * against a class worth three thousand points of hull a flat 25 was a rounding error rather than
     * the reward for finishing her. A quarter of her hull comes to exactly 25 on the smallest ship
     * in the fleet, so nothing moved at the bottom of it.
     */
    function killShip(s, attacker) {
      const g = gameRef.current;
      if (attacker && attacker.alive) {
        const bounty = Math.round(KILL_SHARE * s.maxHull);
        attacker.coins += bounty;
        attacker.earned += bounty;
        attacker.kills = (attacker.kills || 0) + 1;
        if (attacker.isPlayer) g.hudDirty = true;
      }
      sinkFx(s.x, s.y, s.fill);
      if (s.isPlayer) { playerDied(s._deathBar || "hull"); return; }
      const i = g.ships.indexOf(s);
      if (i >= 0) g.ships.splice(i, 1);
      for (const o of g.ships) o.locked.delete(s); // she is on the bottom; nobody is fouled on her
      pushText(s.x, s.y, s._deathBar === "storm" ? "LOST" : "SUNK");
      if (g.rules.reinforcements) {
        g.sunk += 1;
        g.spawnQueue = Math.min(g.spawnQueue + arenaReinforcements(g.sunk), ARENA_MAX_ENEMIES);
        g.spawnT = 0; // lead ship of the wave sails in at once, the next one waits out the gap
      }
      g.hudDirty = true;
      if (g.rules.lastAfloatWins && g.player.alive && g.ships.filter((x) => x.alive).length === 1) endWin();
    }

    function canHit(owner, target) {
      if (!target.alive || target === owner) return false;
      if (gameRef.current.rules.melee) return true;
      return owner.isPlayer !== target.isPlayer;
    }

    function applyHit(target, bar, amt, attacker) {
      const g = gameRef.current;
      const before = target[bar];
      target[bar] = Math.max(0, before - amt);
      if (bar !== "mast") target.flash = 0.35;
      if (attacker && attacker.alive) {
        attacker.coins += amt;
        attacker.earned += amt;
        attacker.dmgDealt = (attacker.dmgDealt || 0) + amt;
        if (attacker.isPlayer) g.hudDirty = true;
      }
      if (target.isPlayer) {
        g.hudDirty = true;
        if (bar !== "mast") g.vign = Math.min(1, g.vign + 0.45);
      }
      if (bar === "mast" && before > 0 && target[bar] <= 0 && !target.mastDown) {
        target.mastDown = true;
        pushText(target.x, target.y, target.isPlayer ? "OUR MAST!" : "MAST DOWN");
      }
      if ((bar === "hull" || bar === "crew") && target[bar] <= 0 && target.alive) {
        target._deathBar = bar;
        killShip(target, attacker);
      }
    }

    /**
     * How many balls go out of one mount, and where they sit.
     *
     * `balls` is her columns less one once she is holed below half, floored at one: a ship losing
     * guns as she is beaten about is worth keeping, and a boat with a single gun a side must not be
     * disarmed by the first hit that finds her.
     *
     * `spread` lays that many evenly across a span, centred: one ball goes down the middle, two sit
     * at the ends, and the old hand-written offsets fall out of it for the counts they covered.
     */
    const balls = (s, wk) => Math.max(1, s.rating[wk].columns - (s.hull < s.maxHull * 0.5 ? 1 : 0));
    const spread = (n, half) =>
      n <= 1 ? [0] : Array.from({ length: n }, (_, i) => -half + (2 * half * i) / (n - 1));

    function fire(s, weapon) {
      const g = gameRef.current;
      const w = WP[weapon];
      const h = s.heading;
      const dmg = weapon === "broadside" ? sideDmg(s) : weapon === "bow" ? frontDmg(s) : musketDmg(s);
      const bx = s.x + Math.cos(h) * s.hullA;
      const by = s.y + Math.sin(h) * s.hullA;
      const noise = s.isPlayer ? 0 : 0.14;
      const push = (px, py, ang) =>
        g.shots.push({ x: px, y: py, vx: Math.cos(ang) * w.speed, vy: Math.sin(ang) * w.speed, life: w.life, r: w.r, bar: w.bar, dmg, owner: s, kind: weapon });
      if (weapon === "broadside") {
        // As many balls as she has columns, spaced down her side, and one fewer once she is holed
        // below half: guns go silent as the crew serving them are wanted elsewhere. A boat with one
        // gun a side keeps it, or being hurt would disarm her outright.
        // spaced down her own side, so a long hull's volley rolls off the length of her
        const offs = spread(balls(s, "broadside"), 0.72 * s.hullA);
        // The volley opens out along the hull as it travels, but it used to open out a long way:
        // at the range these fights are actually fought, about 150 paces, the four balls arrived
        // spread across 76 of them, more than two hull lengths, so a broadside laid dead on a ship
        // still had most of itself pass either side of her. Tightened to this the same volley
        // covers 51, near enough one hull and a half, and a shot lined up properly lands more of
        // itself. It is deliberately not nothing: a broadside is a wall of iron, not a rifle.
        const FAN = 0.0045;
        for (const sd of [-1, 1]) {
          const dir = h + (sd * Math.PI) / 2;
          for (const off of offs) push(s.x + Math.cos(h) * off, s.y + Math.sin(h) * off, dir - sd * FAN * off + (Math.random() - 0.5) * (0.05 + noise));
        }
        // and every gun that fired leaves its own smoke, spaced down her side, so a broadside
        // reads as a bank rolling off the whole length of her rather than one puff amidships.
        // It starts at the rail she fired over, not on her keel, or the bank comes up through
        // the middle of the deck.
        for (const sd of [-1, 1]) {
          const dir = h + (sd * Math.PI) / 2;
          const rx = Math.cos(dir) * s.hullB, ry = Math.sin(dir) * s.hullB;
          for (const off of offs) smoke(s.x + Math.cos(h) * off + rx, s.y + Math.sin(h) * off + ry, dir, 2, 1);
          muzzle(s.x, s.y, dir);
        }
      } else if (weapon === "bow") {
        // Her chasers, opened out by half what they were: they are round shot too, and a chase gun
        // that sprays is no use to anybody.
        const angs = spread(balls(s, "bow"), 0.045);
        for (const o of angs) push(bx, by, h + o + (Math.random() - 0.5) * noise);
        muzzle(bx, by, h);
        smoke(bx, by, h, 4, 0.92);
      } else {
        // The hands at the rail and the swivels on it, firing together. The count, the weight of
        // one ball and the scatter all come off the loadout now; only `noise`, an AI captain's own
        // aim, is the fight's to add.
        for (let i = 0; i < s.rating.muskets; i++) push(bx, by, h + (Math.random() - 0.5) * (musketArc(s) + noise));
        muzzle(bx, by, h);
        smoke(bx, by, h, 2, 0.45); // muskets make little enough of it, and fire often
      }
    }

    function moveShip(s, dt, desired, throttle) {
      let dH = 0;
      if (throttle > 0.03) {
        const d = norm(desired - s.heading);
        const step = turnCap(s) * dt;
        dH = clamp(d, -step, step);
        s.heading += dH;
      }
      s.turnVel = dt > 0 ? dH / dt : 0;
      const tgt = throttle * speedCap(s);
      s.spdCur += (tgt - s.spdCur) * Math.min(1, dt * 3);
      s.x += Math.cos(s.heading) * s.spdCur * dt;
      s.y += Math.sin(s.heading) * s.spdCur * dt;
      s.x += s.kx * dt;
      s.y += s.ky * dt;
      const kf = Math.exp(-dt * 3.5);
      s.kx *= kf;
      s.ky *= kf;
      s.x = clamp(s.x, 28, WORLD - 28);
      s.y = clamp(s.y, 28, WORLD - 28);
      const g = gameRef.current;
      if (g.islands)
        for (const isl of g.islands) {
          const dx = s.x - isl.x, dy = s.y - isl.y;
          const d = Math.hypot(dx, dy) || 1;
          // her own half-length, so a first rate grounds where her bow reaches the shallows and a
          // launch can work right in under the beach
          const minD = isl.r + s.hullA * 0.76;
          if (d < minD) { s.x = isl.x + (dx / d) * minD; s.y = isl.y + (dy / d) * minD; s.spdCur *= 0.5; }
        }
    }

    function stepPlayer(dt) {
      const g = gameRef.current;
      const p = g.player;
      if (!p.alive) return;
      const inp = inputRef.current;
      const desired = inp.joyMag > 0.08 ? inp.joyAng : p.heading;
      moveShip(p, dt, desired, inp.joyMag);
      p.ramCd = Math.max(0, p.ramCd - dt);
      if (!g.rules.guns) return; // ram-only: nothing aboard to reload
      for (const wk of ["broadside", "bow", "musket"]) {
        p.cd[wk] = Math.max(0, p.cd[wk] - dt);
        if (inp[wk] && p.cd[wk] <= 0 && canFire(p, wk)) { fire(p, wk); p.cd[wk] = reloadOf(p, wk); }
      }
    }

    function pickTarget(s) {
      const g = gameRef.current;
      if (!g.rules.melee) return g.player.alive ? g.player : null; // one quarry: the player
      const leaderSnow = g.leader && g.leader !== s && g.leader.earned > g.avgEarned * 1.6 && g.aliveCount > 2;
      // at the drop nobody has a reputation yet, so range is what matters: take the nearest hull
      // and only start shopping for weak or wealthy prey once the melee has had time to sort itself
      const opening = clamp(1 - g.time / OPENING_WINDOW, 0, 1);
      const distW = 0.02 + 0.1 * opening; // range matters most while the fleet is still sorting out
      const shop = 1 - 0.75 * opening; // ...and reputation barely at all
      let best = null, bestScore = -1e9, nearest = null, nd = 1e9;
      for (const c of g.ships) {
        if (c === s || !c.alive) continue;
        const dist = Math.hypot(c.x - s.x, c.y - s.y);
        if (dist < nd) { nd = dist; nearest = c; }
        if (dist > 1500) continue;
        let score = -dist * distW;
        const isLead = leaderSnow && c === g.leader;
        if (isLead) score += 130 * shop;
        // A term weighing her guns against theirs used to sit here, and it measured levels bought.
        // With nothing bought at sea every hull in the water is the same hull, so it weighed nothing
        // and reads as a comparison the game no longer makes. What is left is range, reputation and
        // blood in the water, all of which are still true. It comes back off the ship she sailed in
        // when the shipyard reaches the fight, and that is a better comparison than levels were.
        const hpR = Math.min(c.hull / c.maxHull, c.crew / c.maxCrew);
        if (hpR < 0.5) score += (0.5 - hpR) * 120 * shop;
        if (score > bestScore) { bestScore = score; best = c; }
      }
      return best || nearest;
    }

    // Is anything in this weapon's arc? Prefers the ship we are hunting, but reports a bystander
    // that has drifted into the line of fire so the AI can decide whether to loose a volley at it.
    const ARCS = {
      broadside: (d, ab) => d < 220 && Math.abs(ab - Math.PI / 2) < 0.4,
      bow: (d, ab) => d < 360 && ab < 0.28,
      musket: (d, ab) => d < 130 && ab < 0.45,
    };
    function linedUp(s, weapon, primary) {
      const g = gameRef.current;
      const arc = ARCS[weapon];
      let bystander = null;
      for (const c of g.ships) {
        if (!canHit(s, c)) continue;
        const d = Math.hypot(c.x - s.x, c.y - s.y);
        const ab = Math.abs(norm(Math.atan2(c.y - s.y, c.x - s.x) - s.heading));
        if (!arc(d, ab)) continue;
        if (c === primary) return { ship: c, primary: true };
        if (!bystander || d < bystander.d) bystander = { ship: c, primary: false, d };
      }
      return bystander;
    }

    // ---- ram-only captains -------------------------------------------------------------------
    // With nothing to shoot, a captain's whole trade is where her bow is pointed and how much way she
    // has behind it. She wants a rival's beam, because that is where a hull is staved in; she wants to
    // meet a charge with her own bow, because that turns a beam blow into a glance the other ship has
    // to share; and she has to spend speed to come round at all, now that a rudder goes heavy at a run.

    // Whose beam is worth crossing the sea for. Weighs how side-on she lies to us, how badly she is
    // already holed, whether she is looking the other way, and how far off she is.
    function pickRamTarget(s, shyOf) {
      const g = gameRef.current;
      let best = null, bestScore = -1e9;
      for (const c of g.ships) {
        if (c === s || !c.alive) continue;
        const toC = Math.atan2(c.y - s.y, c.x - s.x);
        const dist = Math.hypot(c.x - s.x, c.y - s.y);
        const aspect = Math.abs(Math.sin(c.heading - toC)); // 1 when her beam is square to us
        const facing = Math.abs(norm(toC + Math.PI - c.heading)); // 0 when her bow is on us
        // ...and whether we are gaining on her at all. Every hull holds the same top speed in a mode
        // with no gunnery to bring a mast down, so a stern chase is one nobody ever
        // wins: without this a captain will happily follow a fleeing rival across the whole sea while
        // the beam of a ship crossing her bow goes begging.
        const closing =
          (Math.cos(s.heading) * s.spdCur - Math.cos(c.heading) * c.spdCur) * Math.cos(toC) +
          (Math.sin(s.heading) * s.spdCur - Math.sin(c.heading) * c.spdCur) * Math.sin(toC);
        let score = -dist * 0.06 + aspect * 46 + facing * 8 + (1 - c.hull / c.maxHull) * 55 + clamp(closing, -70, 70) * 0.55;
        if (c.isPlayer) score += 8; // captains would rather have the notorious hull
        // the hull she has just spent a while jammed against is the one she is least likely to get
        // anything out of, so she shops elsewhere — though she will come back to her if she is all
        // there is, which is why this leans against her rather than ruling her out
        if (c === shyOf) score -= 55;
        if (score > bestScore) { bestScore = score; best = c; }
      }
      return best;
    }

    // Steer for where she will be by the time we get there, not where she is now.
    function ramIntercept(s, t) {
      const dist = Math.hypot(t.x - s.x, t.y - s.y);
      const lead = clamp(dist / Math.max(40, speedCap(s)), 0, 2.4);
      return Math.atan2(t.y + Math.sin(t.heading) * t.spdCur * lead - s.y, t.x + Math.cos(t.heading) * t.spdCur * lead - s.x);
    }

    // Anyone bow-on to us, close, and carrying way is about to ram. Nearest one wins our attention.
    function incomingRam(s) {
      const g = gameRef.current;
      let threat = null, td = 1e9;
      for (const c of g.ships) {
        if (c === s || !c.alive) continue;
        const dist = Math.hypot(c.x - s.x, c.y - s.y);
        if (dist > 250 || dist > td) continue;
        if (c.spdCur < 46) continue;
        if (Math.abs(norm(Math.atan2(s.y - c.y, s.x - c.x) - c.heading)) > 0.42) continue;
        threat = c; td = dist;
      }
      return threat;
    }

    // Which way is out of the heap: away from the mean bearing of every hull near enough to be in the
    // road, with a touch of sheer either side so a whole pile does not peel off along the same line.
    function clearWater(s) {
      const g = gameRef.current;
      let cx = 0, cy = 0, n = 0;
      for (const c of g.ships) {
        if (c === s || !c.alive) continue;
        const dx = c.x - s.x, dy = c.y - s.y;
        const d = Math.hypot(dx, dy);
        if (d > SHEER_LOOK || d < 1) continue;
        cx += dx / d; cy += dy / d; n++;
      }
      const away = n > 0 ? Math.atan2(-cy, -cx) : s.heading + (Math.random() < 0.5 ? 1 : -1) * SHEER_ANGLE;
      return away + (Math.random() - 0.5) * 0.7;
    }

    function stepRamAI(s, dt) {
      const g = gameRef.current;
      s.ramCd = Math.max(0, s.ramCd - dt);
      s.retargetT -= dt;
      if (!s.target || !s.target.alive || s.retargetT <= 0) {
        s.target = pickRamTarget(s);
        s.retargetT = 0.6 + Math.random() * 0.7;
      }
      const tgt = s.target;
      const threat = incomingRam(s);
      const facing = threat && Math.hypot(threat.x - s.x, threat.y - s.y) < 150 + s.nerve * 90 ? threat : null;
      const engaged = facing || tgt; // the hull this is about, whether she picked it or it picked her
      let desired, throttle = 1;
      s.sheerT = Math.max(0, s.sheerT - dt);

      // Is she getting anywhere with it? The clock runs against whoever she is engaged with, the hull
      // she is chasing and the one charging her alike. It used to run only inside the chase, so the
      // one case that never resolves itself — a pair locked bow to bow — was the one case never timed.
      if (engaged) {
        const toE = Math.atan2(engaged.y - s.y, engaged.x - s.x);
        const closing =
          (Math.cos(s.heading) * s.spdCur - Math.cos(engaged.heading) * engaged.spdCur) * Math.cos(toE) +
          (Math.sin(s.heading) * s.spdCur - Math.sin(engaged.heading) * engaged.spdCur) * Math.sin(toE);
        s.baffled = closing > 18 ? Math.max(0, s.baffled - dt * 2) : s.baffled + dt;
      } else s.baffled = Math.max(0, s.baffled - dt);

      const patience = (secs) => secs * (0.7 + 0.6 * s.nerve); // no two captains blink together

      // Bunched up. `baulkT` is the plain fact of it — she is foul of another hull and going nowhere —
      // and it is a far better signal than any reckoning of closing speed, which in a pile is high one
      // frame and nothing the next. Once she has been stuck like that a moment she peels out of the
      // heap, gathers way in clear water, and comes back at whoever looks best from out there. That
      // is usually somebody else: the hull she was jammed against is the one she has just proved she
      // cannot get a run at.
      if (s.sheerT <= 0 && s.baulkT > patience(BAULK_GRACE)) {
        s.sheerT = SHEER_TIME;
        s.sheerHeading = clearWater(s);
        s.baulkT = 0;
        s.baffled = 0;
        s.target = pickRamTarget(s, engaged);
        s.retargetT = SHEER_TIME + Math.random() * 0.5; // let the new choice stand while she pulls out
      }

      if (s.sheerT > 0) {
        // out of the heap: sea room first, a fresh run at her second
        desired = s.sheerHeading;
        throttle = SHEER_THROTTLE;
      } else if (facing) {
        // meet her bow to bow rather than let her have the beam — a glance both of us share
        desired = Math.atan2(facing.y - s.y, facing.x - s.x);
      } else if (!tgt) {
        s.wanderT -= dt;
        if (s.wanderT <= 0) { s.wander += (Math.random() - 0.5) * 1.2; s.wanderT = 1.5 + Math.random(); }
        desired = s.wander;
        throttle = 0.5;
      } else if (s.baffled > patience(STALL_PATIENCE)) {
        // a chase she is not winning: come round inside her instead of following her wake
        desired = Math.atan2(tgt.y - s.y, tgt.x - s.x); // straight at her, not at where she is going
        throttle = STALL_THROTTLE;
        if (s.baffled > patience(STALL_PATIENCE + STALL_CUT)) s.baffled = 0; // then have another go
      } else {
        desired = ramIntercept(s, tgt);
      }

      // Now the weather bends whatever she meant to do. Well inside the ring it asks nothing; nearer
      // the rail it leans on her course; once she is actually out in it her own exposure decides how
      // hard, so a shove into the weather is something she rides out and a pinning is something she
      // fights her way out of — or does not.
      const dc = Math.hypot(s.x - WORLD / 2, s.y - WORLD / 2);
      const out = dc > g.stormR;
      const lean = out
        ? clamp(0.55 + 0.45 * (s.exposure / STORM_RAMP), 0, 1)
        : STORM_PULL * clamp((dc / Math.max(1, g.stormR) - STORM_HOME) / (1 - STORM_HOME), 0, 1);
      if (lean > 0.01) {
        const toMid = Math.atan2(WORLD / 2 - s.y, WORLD / 2 - s.x);
        desired += norm(toMid - desired) * lean; // swing part of the way onto the course home
        if (out) throttle = Math.max(throttle, 0.9);
      }

      // A hull carrying way will not come round. Ease off to swing the bow across, then pile it on —
      // which is what makes an AI charge something a captain can watch coming and step aside from.
      const err = Math.abs(norm(desired - s.heading));
      if (err > 1.15) throttle = Math.min(throttle, 0.4);
      else if (err > 0.55) throttle = Math.min(throttle, 0.72);

      moveShip(s, dt, avoidIslands(s, desired), throttle);
    }

    function stepAI(s, dt) {
      const g = gameRef.current;
      if (!s.alive) return;
      if (!g.rules.guns) { stepRamAI(s, dt); return; }
      s.retargetT -= dt;
      if (!s.target || !s.target.alive || s.retargetT <= 0) {
        s.target = pickTarget(s);
        s.retargetT = 0.7 + Math.random() * 0.6;
      }
      const tgt = s.target;
      for (const wk of ["broadside", "bow", "musket"]) s.cd[wk] = Math.max(0, s.cd[wk] - dt);
      s.ramCd = Math.max(0, s.ramCd - dt);
      s.oppT = Math.max(0, s.oppT - dt);
      const nearWall = s.x < 140 || s.x > WORLD - 140 || s.y < 140 || s.y > WORLD - 140;

      if (!tgt) {
        s.wanderT -= dt;
        if (s.wanderT <= 0) { s.wander += (Math.random() - 0.5) * 1.2; s.wanderT = 1.5 + Math.random(); }
        moveShip(s, dt, avoidIslands(s, nearWall ? Math.atan2(WORLD / 2 - s.y, WORLD / 2 - s.x) : s.wander), 0.4);
        return;
      }

      const dx = tgt.x - s.x, dy = tgt.y - s.y;
      const dist = Math.hypot(dx, dy);
      const toT = Math.atan2(dy, dx);
      const bearing = norm(toT - s.heading);
      const hpR = Math.min(s.hull / s.maxHull, s.crew / s.maxCrew);
      // She used to run from a ship carrying more levels than her as well as from her own wounds.
      // Levels are gone and every hull is equal, so what is left is the wound, which was always the
      // better half of it: a captain runs because of the state of her own ship.
      const fleeing = g.rules.flees && hpR < 0.34;

      if (fleeing) {
        let away = Math.atan2(s.y - tgt.y, s.x - tgt.x);
        if (nearWall) away = Math.atan2(WORLD / 2 - s.y, WORLD / 2 - s.x);
        moveShip(s, dt, avoidIslands(s, away), 0.95);
        return;
      }

      let desired, throttle;
      if (nearWall && dist > 260) { desired = Math.atan2(WORLD / 2 - s.y, WORLD / 2 - s.x); throttle = 0.7; }
      else if (dist > 900) {
        s.wanderT -= dt;
        if (s.wanderT <= 0) { s.wander = toT + (Math.random() - 0.5) * 0.8; s.wanderT = 1.2 + Math.random(); }
        desired = s.wander; throttle = 0.6;
      } else if ((tgt.hull < tgt.maxHull * 0.4 || tgt.crew < tgt.maxCrew * 0.4) && dist < 520) {
        desired = toT; throttle = 1; // line up and charge a wounded ship to ram it down
      } else if (dist < 150 && Math.abs(bearing) < 0.35) {
        desired = toT; throttle = 1; // opportunistic ram when already bow-on and close
      } else if (dist > 225) { desired = toT; throttle = 0.9; }
      else { const sign = bearing >= 0 ? 1 : -1; desired = toT - (sign * Math.PI) / 2; throttle = 0.5; }
      moveShip(s, dt, avoidIslands(s, desired), throttle);

      if (g.rules.guns) for (const wk of ["broadside", "bow", "musket"]) {
        if (s.cd[wk] > 0 || !canFire(s, wk)) continue;
        const shot = linedUp(s, wk, tgt);
        if (!shot) continue;
        if (!shot.primary) {
          // a hull that wandered into the arc is not who we came for: take the shot sometimes,
          // then hold fire a beat so nobody spends the whole match blasting bystanders
          if (s.oppT > 0) continue;
          s.oppT = s.oppHold * (0.7 + Math.random() * 0.6);
        }
        fire(s, wk);
        s.cd[wk] = reloadOf(s, wk); // AI reloads at the pace of its own battery, every mode
      }
    }

    function stepRam() {
      const g = gameRef.current;
      const ships = g.ships;
      for (let i = 0; i < ships.length; i++) {
        for (let j = i + 1; j < ships.length; j++) {
          const a = ships[i], b = ships[j];
          if (!a.alive || !b.alive) continue;
          // consorts cannot ram each other, but no two hulls may ever share the same water
          const hostile = g.rules.melee || a.isPlayer !== b.isPlayer;
          const heldSince = a.locked.get(b);
          if (heldSince !== undefined && g.time - heldSince > RAM_LOCK_MAX) { a.locked.delete(b); b.locked.delete(a); }
          const touch = hullTouch(a, b);
          const { d, nx, ny } = keelGap(a, b); // where the two hulls come nearest to fouling
          // pressed hulls sit right on the touch line and cross it every other frame as they drive
          // together and are pushed apart, so the margin is what keeps this from flickering
          if (d < touch + 4) a.foul = b.foul = true;
          if (d >= touch) {
            // a pair has to break properly clear of each other before it can ram again
            if (d >= touch + RAM_REARM_GAP) { a.locked.delete(b); b.locked.delete(a); }
            continue;
          }
          const toB = Math.atan2(ny, nx); // the line of the impact, from her side to theirs
          // always de-overlap so hulls never sit inside each other
          const ov = touch - d;
          a.x -= nx * ov * 0.5; a.y -= ny * ov * 0.5;
          b.x += nx * ov * 0.5; b.y += ny * ov * 0.5;

          // closing speed along the line of impact, counting how both ships are actually moving:
          // a head-on doubles it, and running from a chaser bleeds it away
          const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
          // ...and how much of each ship's own way is driving into the other. That is the ram:
          // a ship crossing or running has none of it, however hard the hulls meet
          const bowA = Math.cos(a.heading - toB), bowB = -Math.cos(b.heading - toB);
          // A hull that has been held on someone's timbers for a while is not ramming anybody: whatever
          // her helmsman is asking for, she is not going anywhere, and the ground she covers between
          // one frame and the next is the shoving rather than any way of her own. Two ships jammed bow
          // to bow are a target, not a threat — including to whoever comes to take advantage of them.
          const driveA = Math.max(0, bowA * a.way), driveB = Math.max(0, bowB * b.way);
          // One curve for every angle: how hard the hulls met. Harder is always worse, whoever you
          // are and wherever it lands, which is what makes a ram something a captain can judge
          const t = clamp((closing - RAM_MIN_CLOSE) / (RAM_FULL_CLOSE - RAM_MIN_CLOSE), 0, 99);
          const force = Math.min(Math.pow(t, RAM_CURVE), RAM_MAX_FORCE);
          // ...and then where it lands only sets its weight: square on the beam a hull is staved in,
          // caught on her fine ends the blow glances along her
          const weigh = (aspect) => RAM_FINE + (RAM_BEAM - RAM_FINE) * aspect;

          let hurtB = 0, hurtA = 0;
          if (hostile && force > 0 && !a.locked.has(b)) {
            if (driveA > 0 && a.ramCd <= 0) hurtB = ramDmg(a) * force * bowA * bowA * weigh(Math.abs(Math.sin(b.heading - toB)));
            if (driveB > 0 && b.ramCd <= 0) hurtA = ramDmg(b) * force * bowB * bowB * weigh(Math.abs(Math.sin(a.heading - toB)));
          }
          if (hurtB > 0 && hurtA > 0) {
            // both bows in it: the one with less way behind her comes off worse, because the ship
            // with more weight behind her drives through what the other has to absorb
            const lead = clamp(driveA / (driveA + driveB), 1 - RAM_MUTUAL_CAP, RAM_MUTUAL_CAP);
            hurtB *= 2 * lead;
            hurtA *= 2 * (1 - lead);
          }
          // hulls kissing at walking pace are not a ram: no damage, no cooldown spent, and the pair
          // stays free to ram properly, so a light touch can never rob a captain of her charge
          if (Math.max(hurtA, hurtB) < RAM_GRAZE) { hurtA = 0; hurtB = 0; }
          let rammed = false;
          if (hurtB > 0) { applyHit(b, "hull", hurtB, a); a.ramCd = RAM_CD; a.baffled = 0; if (hurtB >= RAM_GRAZE) a.rams++; rammed = true; }
          if (hurtA > 0 && b.alive) { applyHit(a, "hull", hurtA, b); b.ramCd = RAM_CD; b.baffled = 0; if (hurtA >= RAM_GRAZE) b.rams++; rammed = true; }
          if (rammed) {
            a.locked.set(b, g.time); b.locked.set(a, g.time);
            // each ship spends the part of her way that went into the impact, so one driving
            // straight in stops dead while one caught across her course carries on. whoever put
            // the least drive into it is the one thrown clear
            const impulse = RAM_KNOCK * clamp(closing / RAM_FULL_CLOSE, 0.3, 1.2);
            const share = driveA / Math.max(1, driveA + driveB);
            const aKnock = impulse * (RAM_RECOIL + (1 - RAM_RECOIL) * (1 - share));
            const bKnock = impulse * (RAM_RECOIL + (1 - RAM_RECOIL) * share);
            a.kx -= nx * aKnock; a.ky -= ny * aKnock;
            b.kx += nx * bKnock; b.ky += ny * bKnock;
            a.spdCur *= 1 - RAM_DRIVE_LOSS * (driveA / Math.max(1, a.spdCur));
            b.spdCur *= 1 - RAM_DRIVE_LOSS * (driveB / Math.max(1, b.spdCur));
            burst((a.x + b.x) / 2, (a.y + b.y) / 2, "hull");
          } else {
            // hulls touching without a charge behind them: gentle nudge, no damage
            a.kx -= nx * 32; a.ky -= ny * 32;
            b.kx += nx * 32; b.ky += ny * 32;
          }
        }
      }
    }

    // The squall is weather, not an attack: no captain is paid for it, so it does not run through
    // applyHit. It works on the crew, exposed on deck, and the longer they are out in it the harder
    // it works — a dash across the weather costs a few hands, living out there costs the ship.
    function stepStorm(dt) {
      const g = gameRef.current;
      if (!g.rules.storm) return;
      g.stormR = stormRadius(g.time);
      const cx = WORLD / 2, cy = WORLD / 2;
      // walked backwards because a ship the weather finishes is spliced out from under us
      for (let i = g.ships.length - 1; i >= 0; i--) {
        const s = g.ships[i];
        if (!s.alive) continue;
        const out = Math.hypot(s.x - cx, s.y - cy) > g.stormR;
        if (!out) { s.exposure = Math.max(0, s.exposure - dt * STORM_RECOVER); continue; }
        s.exposure = Math.min(STORM_RAMP, s.exposure + dt);
        const bite = STORM_DPS_MIN + (STORM_DPS_MAX - STORM_DPS_MIN) * (s.exposure / STORM_RAMP);
        s.crew = Math.max(0, s.crew - bite * dt);
        if (s.isPlayer) {
          // a steady tint that deepens with the exposure, rather than the jolt a hit gives
          g.vign = Math.max(g.vign, 0.2 + 0.55 * (s.exposure / STORM_RAMP));
          g.hudDirty = true;
        }
        if (s.crew <= 0 && s.alive) { s._deathBar = "storm"; killShip(s, null); }
      }
      // the countdown ticks in whole seconds, and going in or out of the weather is worth a redraw
      const tick = Math.max(0, Math.ceil(STORM_GRACE - g.time));
      const playerOut = g.player.alive && Math.hypot(g.player.x - cx, g.player.y - cy) > g.stormR;
      if (tick !== g.stormTick || playerOut !== g.playerOut) {
        g.stormTick = tick;
        g.playerOut = playerOut;
        g.hudDirty = true;
      }
    }

    // What each ship actually did with the frame, measured once the hulls have been pushed out of one
    // another: her velocity over the ground, and how much of it carried her bow forward. A hull that
    // could not go forward — jammed against another, shouldered off an island, pinned on the boundary,
    // or thrown back by a blow — loses her way to match, and has to gather it again like anyone else.
    // Next frame's ram is resolved from these.
    //
    // It is her plain velocity along her heading, with nothing taken back out of it for the shoving.
    // An earlier turn of this subtracted the knock, meaning to leave only what she made under her own
    // power; but a ship held back by a knock has that knock subtracted the other way, and two hulls
    // pressed bow to bow — dead in the water, covering 0.2px/s between them — came out reading 118.
    //
    // It is smoothed, too. Hulls in contact are driven together and pushed apart again frame by frame,
    // so a single frame's difference swings wildly either side of nothing; taking the positive half of
    // that swing at face value handed a standing ship the weight of a charging one every other frame.
    function measureWay(dt) {
      const g = gameRef.current;
      if (dt <= 0) return;
      for (const s of g.ships) {
        if (!s.alive) continue;
        const ch = Math.cos(s.heading), sh = Math.sin(s.heading);
        const k = Math.min(1, dt * WAY_SMOOTH);
        s.vx += ((s.x - s.px) / dt - s.vx) * k;
        s.vy += ((s.y - s.py) / dt - s.vy) * k;
        s.way = Math.max(0, s.vx * ch + s.vy * sh);
        // and a hull foul of another and going nowhere is baulked, so she loses her way and must gather
        // it again. Only another hull counts: an island or the boundary already checks her by other
        // means, and a ship merely knocked off her stride is still free to sail
        if (s.foul && s.spdCur > 5 && s.way < s.spdCur * BAULK_TOL) s.baulkT += dt;
        else s.baulkT = Math.max(0, s.baulkT - dt * 2);
        if (s.baulkT > BAULK_GRACE) s.spdCur *= Math.exp(-dt * BAULK_RATE);
      }
    }

    function stepShots(dt) {
      const g = gameRef.current;
      const s = g.shots;
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
        for (const isl of g.islands) {
          const t = shotHitsCircle(isl.x, isl.y, isl.r, fromX, fromY, b.x, b.y);
          if (t >= 0 && t < when) { when = t; shoal = true; }
        }
        for (const target of g.ships) {
          if (!canHit(b.owner, target)) continue;
          const t = shotHitsHull(target, fromX, fromY, b.x, b.y, b.r);
          if (t >= 0 && t < when) { when = t; struck = target; shoal = false; }
        }
        const hit = struck !== null || shoal;
        if (hit) {
          // and it breaks where it bit her, not at the end of a step it never finished
          const hx = fromX + (b.x - fromX) * when, hy = fromY + (b.y - fromY) * when;
          if (struck) { applyHit(struck, b.bar, b.dmg, b.owner); burst(hx, hy, b.bar); }
          else splash(hx, hy);
        }
        if (hit || b.life <= 0 || b.x < 0 || b.x > WORLD || b.y < 0 || b.y > WORLD) s.splice(i, 1);
      }
    }

    function stepParts(dt) {
      const g = gameRef.current;
      for (let i = g.parts.length - 1; i >= 0; i--) {
        const p = g.parts[i];
        p.life -= dt;
        // Smoke says how fast it slows in its own terms, so a bank of it stands the same on a phone
        // dropping frames as on a screen holding sixty. The sparks keep the old per-frame damping,
        // which is brief enough that nobody was ever going to catch it drifting.
        if (p.vx !== undefined) {
          p.x += p.vx * dt; p.y += p.vy * dt;
          const k = p.drag !== undefined ? Math.exp(-dt * p.drag) : 0.9;
          p.vx *= k; p.vy *= k;
        }
        if (p.life <= 0) g.parts.splice(i, 1);
      }
      for (let i = g.texts.length - 1; i >= 0; i--) {
        const t = g.texts[i]; t.life -= dt; t.y -= 14 * dt; if (t.life <= 0) g.texts.splice(i, 1);
      }
      for (let i = g.wakes.length - 1; i >= 0; i--) { g.wakes[i].life -= dt; if (g.wakes[i].life <= 0) g.wakes.splice(i, 1); }
      for (const s of g.ships) s.flash = Math.max(0, s.flash - dt);
      g.vign = Math.max(0, g.vign - dt * 1.6);
    }

    function maintain(dt) {
      const g = gameRef.current;
      if (!g.rules.reinforcements) return;
      g.spawnT -= dt;
      const enemies = g.ships.filter((s) => !s.isPlayer).length;
      if (enemies === 0 && g.spawnQueue <= 0) g.spawnQueue = 1; // never leave the sea empty
      if (g.spawnQueue > 0 && enemies < ARENA_MAX_ENEMIES && g.spawnT <= 0) {
        g.ships.push(spawnArenaEnemy());
        g.spawnQueue -= 1;
        g.spawnT = ARENA_SPAWN_GAP;
      }
    }

    function computeMeta() {
      const g = gameRef.current;
      if (!g.rules.ranked) return;
      const alive = g.ships.filter((s) => s.alive);
      alive.sort((a, b) => b.earned - a.earned || b.coins - a.coins);
      alive.forEach((s, i) => (s.rank = i + 1));
      g.leader = alive[0] || null;
      g.aliveCount = alive.length;
      g.avgEarned = alive.reduce((t, s) => t + s.earned, 0) / Math.max(1, alive.length);
      if (g.player.alive && g.player.rank !== g._lastRank) { g._lastRank = g.player.rank; g.hudDirty = true; }
    }

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
    function camHold(centred, span, peek) {
      const lo = -peek; // the far side of the map, let this far into the view
      return clamp(centred, lo, Math.max(lo, WORLD - span + peek));
    }

    function camUpdate() {
      const g = gameRef.current;
      if (!g || !g.player) return;
      const spanX = Vw, spanY = Vh / TILT; // sea on the screen, in world units
      const peekX = Math.max((spanX - Vsq) / 2, EDGE_PEEK / zoom);
      const peekY = Math.max((spanY - Vsq / TILT) / 2, EDGE_PEEK / (zoom * TILT));
      g.cam.x = camHold(g.player.x - spanX / 2, spanX, peekX);
      g.cam.y = camHold(g.player.y - spanY / 2, spanY, peekY);
    }

    function update(dt) {
      const g = gameRef.current;
      g.time += dt;
      computeMeta();
      for (const s of g.ships) { s.px = s.x; s.py = s.y; s.foul = false; } // where she started the frame
      stepPlayer(dt);
      for (const s of g.ships) if (!s.isPlayer) stepAI(s, dt);
      stepRam();
      measureWay(dt);
      stepStorm(dt);
      stepShots(dt);
      stepParts(dt);
      maintain(dt);
      for (const s of g.ships) {
        if (!s.alive || s.spdCur < 22) continue;
        s.wakeT -= dt;
        if (s.wakeT <= 0) {
          s.wakeT = 0.05;
          const sf = clamp(s.spdCur / 130, 0, 1); // longer trail only when she's really moving
          const wlife = 0.24 + 0.42 * sf;
          const h = s.heading;
          const bx = s.x - Math.cos(h) * s.hullA, by = s.y - Math.sin(h) * s.hullA;
          const px = Math.cos(h + Math.PI / 2), py = Math.sin(h + Math.PI / 2);
          for (const sd of [-1, 1]) g.wakes.push({ x: bx + px * sd * 4, y: by + py * sd * 4, life: wlife, max: wlife });
        }
        if (s.spdCur > speedCap(s) * 0.82) {
          s.sprayT -= dt;
          if (s.sprayT <= 0) {
            s.sprayT = 0.05;
            const h = s.heading;
            const fx = s.x + Math.cos(h) * (s.hullA + 2), fy = s.y + Math.sin(h) * (s.hullA + 2);
            for (const sd of [-1, 1]) {
              const a = h + sd * 0.28 + (Math.random() - 0.5) * 0.18, sp = 35 + Math.random() * 45;
              g.parts.push({ x: fx, y: fy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.28, max: 0.38, col: "rgba(232,246,244,0.9)", kind: "spark" });
            }
          }
        }
      }
      for (const s of g.ships) {
        if (!s.alive) continue;
        s.rollPhase += dt;
        const target = clamp(-s.turnVel * 0.16, -0.4, 0.4);
        s.roll += (target - s.roll) * Math.min(1, dt * 6);
      }
      camUpdate();
      updateButtons();
      g.hudAcc += dt;
      if (g.hudDirty && g.hudAcc > 0.09) { syncRef.current(); g.hudDirty = false; g.hudAcc = 0; }
    }

    function updateButtons() {
      const p = gameRef.current.player;
      for (const wk of ["broadside", "bow", "musket"]) {
        const el = btnRefs[wk].current;
        if (!el) continue;
        // A mount she has nothing on is held at a quarter: the button is there because the hull
        // bears the ports, and a captain who has not bought the guns should see that rather than tap
        // a live-looking control that does nothing.
        const armed = canFire(p, wk);
        const ratio = 1 - p.cd[wk] / reloadOf(p, wk);
        const fill = el.querySelector(".cd-fill");
        if (fill) fill.style.transform = `scaleX(${armed ? clamp(ratio, 0, 1) : 0})`;
        el.style.opacity = !armed ? "0.28" : p.cd[wk] > 0 ? "0.55" : "1";
      }
    }

    // ---------------- rendering ----------------

    // One breaking crest: two peaked humps with the outer legs rolling away from the shape, the way
    // foam spills off either shoulder of a cap. Drawn wide and low, because a cap lies flat on the
    // water and the water is seen at a tilt.
    //
    // The troughs are rounded but the crests are not, and that asymmetry is the whole shape. On each
    // descent the control on the crest side sits on the crest itself, so the curve leaves it steeply
    // and the peak stays sharp; the control on the trough side sits out to the side at trough height,
    // which flattens the tangent there and rolls the bottom out. Round both ends and it stops reading
    // as a breaking wave and starts reading as a sine squiggle.
    //
    // The notch between the two crests rides HIGHER than the troughs the tails fall into, so the low
    // points of the shape are its two outside ends and the water only dips a little in the middle.
    // Each tail is a quadratic from (-w, -0.1h) through (-0.8w, 0.6h) to the crest, which puts its y
    // at -0.1 + 1.4t - 2t² and bottoms out at t = 0.35, i.e. 0.145h below the baseline. CAP_MID has
    // to stay clear of that figure — push it past 0.145 and the middle becomes the lowest point of the
    // cap again; drop it much below about -0.05 and the notch flattens until the two crests read as
    // one broad hump.
    //
    // Path only: the caller owns beginPath/stroke, so each cap can carry its own alpha.
    const CAP_W = 5.5, CAP_H = 4, CAP_LW = 1.4;
    const CAP_MID = 0; // centre notch, as a fraction of CAP_H below the baseline
    const CAP_TROUGH = 0.3; // how far the trough controls sit to the side — 0 would cusp the bottom

    // A cap breaking: it whitens fast, then falls back to its own colour over about a second. Every
    // cap runs its own cycle, so a few are always going off somewhere in view and no two are in step.
    //
    // This is a function of the cap's cell and the clock and nothing else — there is no list of live
    // flares, nothing is spawned, and nothing is stored per cap. That is what makes it free at the
    // edges of the screen: caps keep their rhythm whether or not they are being drawn, so one that
    // scrolls into view arrives already mid-cycle instead of starting over or popping.
    const CAP_CYCLE_MIN = 9, CAP_CYCLE_MAX = 19; // seconds between one cap's breaks
    const CAP_FLARE_LEN = 0.9;   // how long a break lasts
    const CAP_FLARE_RISE = 0.18; // fraction of that spent whitening — small, so it snaps and then fades
    const CAP_FLARE_ALPHA = 0.55;
    function capFlare(cell, phase) {
      const period = CAP_CYCLE_MIN + cell * (CAP_CYCLE_MAX - CAP_CYCLE_MIN);
      const u = (clock / period + phase) % 1;      // where this cap is in its own cycle
      const win = CAP_FLARE_LEN / period;
      if (u >= win) return 0;
      const s = u / win;
      if (s < CAP_FLARE_RISE) return s / CAP_FLARE_RISE;
      const fall = (1 - s) / (1 - CAP_FLARE_RISE); // squared, so it drops away and then lingers
      return fall * fall;
    }
    function whitecap(x, y) {
      const w = CAP_W, h = CAP_H, d = CAP_TROUGH;
      const px = 0.45 * w, py = y - 0.7 * h, ty = y + CAP_MID * h;
      ctx.moveTo(x - w, y - 0.1 * h);
      ctx.quadraticCurveTo(x - 0.8 * w, y + 0.6 * h, x - px, py);        // tail rolls out, up into the crest
      ctx.bezierCurveTo(x - px, py, x - d * w, ty, x, ty);               // down into the shallow notch
      ctx.bezierCurveTo(x + d * w, ty, x + px, py, x + px, py);          // and back up to the far crest
      ctx.quadraticCurveTo(x + 0.8 * w, y + 0.6 * h, x + w, y - 0.1 * h); // then rolls out again
    }

    function drawWater(cam) {
      ctx.fillStyle = C.water;
      ctx.fillRect(0, 0, Vw, Vh);
      const x0 = SX(0, cam), x1 = SX(WORLD, cam), y0 = SY(0, cam), y1 = SY(WORLD, cam);
      ctx.fillStyle = C.waterEdge;
      if (y0 > 0) ctx.fillRect(0, 0, Vw, y0);
      if (y1 < Vh) ctx.fillRect(0, y1, Vw, Vh - y1);
      if (x0 > 0) ctx.fillRect(0, 0, x0, Vh);
      if (x1 < Vw) ctx.fillRect(x1, 0, Vw - x1, Vh);
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const step = 80;
      const gy0 = Math.max(0, y0), gy1 = Math.min(Vh, y1), gx0 = Math.max(0, x0), gx1 = Math.min(Vw, x1);
      for (let X = Math.ceil(cam.x / step) * step; X <= WORLD; X += step) { const sx = SX(X, cam); if (sx > Vw) break; if (sx < 0) continue; ctx.moveTo(sx, gy0); ctx.lineTo(sx, gy1); }
      for (let Y = Math.ceil(cam.y / step) * step; Y <= WORLD; Y += step) { const sy = SY(Y, cam); if (sy > Vh) break; if (sy < 0) continue; ctx.moveTo(gx0, sy); ctx.lineTo(gx1, sy); }
      ctx.stroke();
      const cs = 130;
      const ci0 = Math.floor(cam.x / cs) - 1, ci1 = Math.floor((cam.x + Vw) / cs) + 1;
      const cj0 = Math.floor(cam.y / cs) - 1, cj1 = Math.floor((cam.y + Vh / TILT) / cs) + 1;
      ctx.strokeStyle = C.beachRim;
      ctx.lineWidth = CAP_LW;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let ci = ci0; ci <= ci1; ci++) {
        for (let cj = cj0; cj <= cj1; cj++) {
          const h1 = hash(ci, cj), h2 = hash(ci + 9, cj + 4);
          const wx = (ci + h1) * cs, wy = (cj + h2) * cs;
          if (wx < 6 || wx > WORLD - 6 || wy < 6 || wy > WORLD - 6) continue;
          const sx = SX(wx, cam), sy = SY(wy, cam) + Math.sin(clock * 1.3 + h1 * 6.283) * 1.4;
          // beach-rim tone on open water: a lighter hue than the old caps, and a shape with detail in
          // it rather than a bare tick, so it needs more of itself showing through to read as a cap
          ctx.globalAlpha = 0.2 + 0.12 * (0.5 + 0.5 * Math.sin(clock + h2 * 6.283));
          ctx.beginPath();
          whitecap(sx, sy);
          ctx.stroke();
          // A break is painted over the top rather than swapped in, so the cap keeps its own colour
          // underneath and the white simply fades off it. Same path, so there is nothing to rebuild.
          const flare = capFlare(hash(ci + 5, cj + 17), h1);
          if (flare > 0.01) {
            ctx.strokeStyle = C.foam;
            ctx.globalAlpha = flare * CAP_FLARE_ALPHA;
            ctx.stroke();
            ctx.strokeStyle = C.beachRim;
          }
        }
      }
      ctx.globalAlpha = 1;
      ctx.lineCap = "butt";
      ctx.lineJoin = "miter";
      drawBoundary(cam, x0, y0, x1, y1);
    }

    function drawBoundary(cam, x0, y0, x1, y1) {
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 7;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeStyle = C.boundary;
      ctx.lineWidth = 4;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeStyle = "rgba(232,200,119,0.5)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([9, 8]);
      ctx.strokeRect(x0 + 8, y0 + 8 * TILT, x1 - x0 - 16, y1 - y0 - 16 * TILT);
      ctx.setLineDash([]);
      const step = 400;
      let n = 0;
      const buoy = (wx, wy) => {
        const sx = SX(wx, cam), sy = SY(wy, cam) + Math.sin(clock * 2 + wx * 0.01 + wy * 0.01) * 1.5;
        n++;
        if (sx < -10 || sx > Vw + 10 || sy < -10 || sy > Vh + 10) return;
        ctx.beginPath();
        ctx.arc(sx, sy, 4, 0, Math.PI * 2);
        ctx.fillStyle = n % 2 ? C.buoyB : C.buoyA;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(0,0,0,0.4)";
        ctx.stroke();
      };
      for (let X = 0; X <= WORLD; X += step) { buoy(X, 0); buoy(X, WORLD); }
      for (let Y = step; Y < WORLD; Y += step) { buoy(0, Y); buoy(WORLD, Y); }
    }

    // The weather is painted in two passes so it never costs readability: the sea outside the ring
    // darkens under the ships, and the edge itself is drawn over the top of everything, because the
    // one thing a captain must always be able to find is the line between fair water and foul.
    function stormEllipse(cam) {
      const g = gameRef.current;
      return { cx: SX(WORLD / 2, cam), cy: SY(WORLD / 2, cam), r: g.stormR };
    }

    function drawStormWater(cam) {
      const g = gameRef.current;
      if (!g.rules.storm) return;
      const { cx, cy, r } = stormEllipse(cam);
      const outside = () => {
        ctx.beginPath();
        ctx.rect(0, 0, Vw, Vh);
        ctx.ellipse(cx, cy, r, r * TILT, 0, 0, Math.PI * 2);
      };
      outside();
      ctx.fillStyle = "rgba(7,34,33,0.5)";
      ctx.fill("evenodd");
      // rain, drawn only where the weather is
      ctx.save();
      outside();
      ctx.clip("evenodd");
      ctx.strokeStyle = "rgba(190,215,225,0.5)";
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      const cell = 46;
      for (let i = 0; i < Math.ceil(Vw / cell) + 1; i++) {
        for (let j = 0; j < Math.ceil(Vh / cell) + 1; j++) {
          const h1 = hash(i + Math.floor(cam.x / cell), j + Math.floor(cam.y / cell));
          const px = i * cell + h1 * cell;
          const py = ((j * cell + h1 * 900 + clock * 340) % (Vh + cell)) - cell / 2;
          ctx.moveTo(px, py);
          ctx.lineTo(px - 3, py + 11);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    function drawStormEdge(cam) {
      const g = gameRef.current;
      if (!g.rules.storm) return;
      const { cx, cy, r } = stormEllipse(cam);
      const ring = (w, style, dash, off) => {
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * TILT, 0, 0, Math.PI * 2);
        ctx.lineWidth = w;
        ctx.strokeStyle = style;
        ctx.setLineDash(dash);
        ctx.lineDashOffset = off;
        ctx.stroke();
        ctx.setLineDash([]);
      };
      ring(6, "rgba(0,0,0,0.35)", [], 0);
      // it pulses harder once it is actually closing in
      const closing = g.time > STORM_GRACE ? 1 : 0.45;
      ring(2.4, `rgba(209,91,91,${0.45 + 0.35 * closing * (0.5 + 0.5 * Math.sin(clock * 3))})`, [16, 12], -clock * 26);
    }

    function drawWakes(cam) {
      const g = gameRef.current;
      for (const w of g.wakes) {
        const k = w.life / w.max;
        ctx.globalAlpha = k * 0.55;
        ctx.fillStyle = "#eefaf6";
        const rr = 1.6 + (1 - k) * 4.5;
        ctx.beginPath();
        ctx.ellipse(SX(w.x, cam), SY(w.y, cam), rr, rr * TILT, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function drawIslands(cam) {
      const g = gameRef.current;
      for (const isl of g.islands) {
        const cx = SX(isl.x, cam), cy = SY(isl.y, cam);
        // cull on the shallows, not the sand: the bank reaches well outside isl.r, and culling on the
        // land radius would pop a whole ring of shallow water in and out at the edge of the screen
        const vr = isl.r * 1.45 + 8;
        if (cx < -vr || cx > Vw + vr || cy < -vr * TILT - 60 || cy > Vh + vr * TILT + 60) continue;
        const n = isl.verts.length;
        ctx.save();
        ctx.translate(cx, cy);
        // One closed ring of the island's outline at `scale`, optionally rolling on the swell.
        //
        // The roll has to close on itself, which is why it is given as a whole number of `waves` round
        // the ring rather than as a phase that advances per vertex. An advancing phase leaves the last
        // vertex and the first at different radii even though they are neighbours, and the ring then
        // shuts with a straight chord across the gap — a hard step that reads as a notch bitten out of
        // the band. Taking the phase from the vertex angle makes that unrepresentable.
        //
        // The vertices are joined by a closed quadratic spline through the midpoint of each edge: the
        // curve passes through every midpoint and is tangent to the outline there, so the facets round
        // off and the bands roll instead of stepping. It cuts the corners slightly, so the drawn shape
        // sits a touch inside the polygon — far less than the 0.78-1.08 spread of verts already puts
        // between the drawn sand and the isl.r circle that shots and hulls actually test against.
        const ring = (scale, waves = 0, amp = 0, speed = 0) => {
          const pts = [];
          for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2;
            const rr = isl.r * isl.verts[k] * scale + (amp ? Math.sin(clock * speed + a * waves) * amp : 0);
            pts.push([Math.cos(a) * rr, Math.sin(a) * rr * TILT]);
          }
          ctx.beginPath();
          ctx.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
          for (let k = 0; k < n; k++) {
            const p = pts[k], q = pts[(k + 1) % n];
            ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
          }
          ctx.closePath();
        };
        // The bottom comes up in two steps before it breaks the surface: a broad bank of shallows, then
        // a thin beach rim right at the sand. Both roll on the swell — the outer one wider and slower,
        // over fewer crests — so the two edges never march in step and the island keeps a moving
        // waterline.
        ring(1.30, 2, 3, 1.6);
        ctx.fillStyle = C.shallows;
        ctx.fill();
        ring(1.08, 3, 2, 2);
        ctx.fillStyle = C.beachRim;
        ctx.fill();
        // just a hairline of shade under the sand edge — any wider and it eats the beach rim
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = "#000";
        ring(1.015);
        ctx.fill();
        ctx.globalAlpha = 1;
        ring(1);
        ctx.fillStyle = C.sand;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = C.sandDark;
        ctx.stroke();
        // One flat green, not two: the interior stays a single colour and the only darker green on the
        // island is the foliage, which reads as canopy rather than as another contour line inland.
        ring(0.72);
        ctx.fillStyle = C.grass;
        ctx.fill();
        // Shadows first, as one batched pass under every plant. The list is already sorted back to
        // front from generation, so near plants overdraw far ones without sorting again here.
        drawShadows(ctx, isl.foliage, clock);
        for (const f of isl.foliage) (f.isPalm ? drawPalm : drawBush)(ctx, f, clock);
        ctx.restore();
      }
    }

    function drawArcGuides(p, cam) {
      if (!p.alive) return;
      const inp = inputRef.current;
      ctx.save();
      ctx.translate(SX(p.x, cam), SY(p.y, cam));
      ctx.scale(1, TILT);
      ctx.rotate(p.heading);
      ctx.lineWidth = 1.4;
      if (inp.broadside) {
        ctx.strokeStyle = "rgba(217,154,60,0.28)";
        const R = WP.broadside.speed * WP.broadside.life;
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, s * 6); ctx.lineTo(0, s * R); ctx.stroke(); }
      }
      if (inp.bow) {
        ctx.strokeStyle = "rgba(122,156,198,0.32)";
        const R = WP.bow.speed * WP.bow.life;
        ctx.beginPath(); ctx.moveTo(p.hullA, 0); ctx.lineTo(R, -R * 0.09); ctx.moveTo(p.hullA, 0); ctx.lineTo(R, R * 0.09); ctx.stroke();
      }
      if (inp.musket) {
        ctx.strokeStyle = "rgba(223,239,255,0.28)";
        const R = WP.musket.speed * WP.musket.life;
        // the guide cone follows the volley's own scatter, so better swivels visibly narrow it
        const arc = 0.875 * musketArc(p);
        ctx.beginPath(); ctx.moveTo(p.hullA, 0); ctx.lineTo(Math.cos(arc) * R, Math.sin(arc) * R); ctx.moveTo(p.hullA, 0); ctx.lineTo(Math.cos(-arc) * R, Math.sin(-arc) * R); ctx.stroke();
      }
      ctx.restore();
    }

    function drawShip(s, cam) {
      const g = gameRef.current;
      const H = s.heading, cH = Math.cos(H), sH = Math.sin(H);
      const roll = s.roll + Math.sin(s.rollPhase * 1.2) * 0.05; // bank into turns + gentle idle heel
      const cR = Math.cos(roll), sR = Math.sin(roll);
      const gx = SX(s.x, cam), gy = SY(s.y, cam);
      const sea = s.sea;
      const deckH = sea.deckH;
      // local (u=fore, v=starboard, z=up) -> screen, via roll about keel, yaw, then iso projection
      const P3 = (u, v, z) => {
        const v2 = v * cR - z * sR;
        const z2 = v * sR + z * cR;
        const ox = u * cH - v2 * sH;
        const oy = u * sH + v2 * cH;
        return [gx + ox, gy + oy * TILT - z2 * ZUP];
      };
      const line = (a, b, col, wLine) => { ctx.strokeStyle = col; ctx.lineWidth = wLine; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };

      // shadow on the water
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.ellipse(gx, gy + 2, s.hullA, s.hullB * TILT + 2, s.heading, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // V-shaped bow wave — subtle at cruise, pronounced on a charge
      const sf = clamp((s.spdCur - 28) / 110, 0, 1);
      if (sf > 0.03) {
        const apex = P3(s.hullA + 2 * sf, 0, 0);
        const spread = (6 + 6 * sf) * (s.hullB / 6.5), len = (10 + 10 * sf) * (s.hullA / 18);
        const lft = P3(s.hullA + 2 - len, -spread, 0), rgt = P3(s.hullA + 2 - len, spread, 0);
        ctx.strokeStyle = `rgba(232,246,244,${0.18 + 0.4 * sf})`;
        ctx.lineWidth = 1.3 + 1.4 * sf;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(lft[0], lft[1]);
        ctx.quadraticCurveTo(apex[0], apex[1], rgt[0], rgt[1]);
        ctx.stroke();
        ctx.globalAlpha = 0.22 + 0.35 * sf;
        ctx.fillStyle = "#eaf6f4";
        const cap = 2 + 1.5 * sf;
        ctx.beginPath();
        ctx.ellipse(apex[0], apex[1], cap, cap * TILT, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // ship colour reads as TRIM; the hull itself is brown wood
      const trim = s.isPlayer ? C.gold : s.fill;

      // hull: dark waterline body + brown deck, trimmed in the ship's colour. The outline is the
      // class's own: her length, her beam, her entry and her stern.
      const hull = sea.outline;
      const tracePoly = (z) => {
        ctx.beginPath();
        hull.forEach(([u, v], i) => { const [X, Y] = P3(u, v, z); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); });
        ctx.closePath();
      };
      tracePoly(0); ctx.fillStyle = s.cols.dark; ctx.fill();
      tracePoly(deckH);
      ctx.fillStyle = s.cols.deck; ctx.fill();
      if (s.flash > 0) { ctx.globalAlpha = s.flash; ctx.fillStyle = "#fff"; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.lineWidth = s.isPlayer ? 2 : 1.6; ctx.strokeStyle = trim; ctx.stroke(); // gunwale trim
      // painted trim stripe around the hull side
      tracePoly(deckH * 0.5); ctx.lineWidth = 1.6; ctx.strokeStyle = trim; ctx.globalAlpha = 0.85; ctx.stroke(); ctx.globalAlpha = 1;
      // bowsprit, on the hulls that have one
      if (s.loadout.hull.bowsprit) line(P3(-0.11 * sea.L, 0, deckH + 1), P3(0.61 * sea.L, 0, deckH + 2), s.cols.spar, 1.4);

      // raised stern castle (quarterdeck cabin) on the back quarter, on the classes built up
      // enough to carry one: an open boat has no cabin at all
      if (sea.castle) {
        const { fx, bx, hw, h } = sea.castle;
        const cf = [[fx, -hw], [fx, hw], [bx - 1, hw * 0.76], [bx - 1, -hw * 0.76]]; // FL, FR, BR, BL — overhangs the stern slightly
        const baseC = cf.map(([u, v]) => P3(u, v, deckH));
        const topC = cf.map(([u, v]) => P3(u, v, deckH + h));
        const walls = [];
        for (let k = 0; k < 4; k++) {
          const a = k, b = (k + 1) % 4;
          walls.push({ q: [baseC[a], baseC[b], topC[b], topC[a]], d: (baseC[a][1] + baseC[b][1]) / 2, edge: k });
        }
        walls.sort((x, y) => x.d - y.d); // far walls first
        for (const w of walls) {
          ctx.beginPath();
          w.q.forEach((p, i) => { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
          ctx.closePath();
          ctx.fillStyle = s.cols.wood; ctx.fill();
          ctx.globalAlpha = 0.2; ctx.fillStyle = "#000"; ctx.fill(); ctx.globalAlpha = 1;
          ctx.lineWidth = 1; ctx.strokeStyle = s.cols.dark; ctx.stroke();
          if (w.edge === 2) { // cabin windows on the aft wall (BR -> BL)
            for (const t of [0.32, 0.68]) {
              const bx2 = baseC[2][0] + (baseC[3][0] - baseC[2][0]) * t, by2 = baseC[2][1] + (baseC[3][1] - baseC[2][1]) * t;
              const tx2 = topC[2][0] + (topC[3][0] - topC[2][0]) * t, ty2 = topC[2][1] + (topC[3][1] - topC[2][1]) * t;
              ctx.fillStyle = "#2a1c10";
              ctx.fillRect(bx2 + (tx2 - bx2) * 0.5 - 1.4, by2 + (ty2 - by2) * 0.5 - 1.4, 2.8, 2.8);
            }
          }
        }
        ctx.beginPath();
        topC.forEach((p, i) => { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
        ctx.closePath();
        ctx.fillStyle = s.cols.deck; ctx.fill();
        ctx.lineWidth = 1.2; ctx.strokeStyle = trim; ctx.stroke();
      }

      // masts and canvas, off her own loadout: each mast at its station, each band of sail in the
      // shape of its category. Square canvas bellies on the BOW side of the pole as it always has;
      // fore-and-aft canvas stands along the keel line.
      const rig = s.seaRig;
      const masts = s.mastDown ? [] : rig.masts;
      const fwd = 1.5, belly = 3, MINW = 4, N = 6;
      // a mast stands on the quarterdeck only if she has one and it's aft of its front wall
      const mz = (u) => (sea.castle && u <= sea.castle.fx ? deckH + sea.castle.h : deckH);
      const drawSail = (u, m) => {
        const bz = mz(u);
        const topZ = bz + m.st, botZ = bz + m.sb;
        // sample the bellied cloth across the beam into columns
        const cols = [];
        for (let k = 0; k <= N; k++) {
          const t = k / N, v = -m.w / 2 + m.w * t, nrm = v / (m.w / 2);
          const uu = u + fwd + belly * (1 - nrm * nrm); // bellies forward toward the bow
          cols.push({ top: P3(uu, v, topZ), bot: P3(uu, v, botZ), nrm });
        }
        // keep a small minimum on-screen width so she never vanishes edge-on
        let minX = Infinity, maxX = -Infinity;
        for (const c of cols) for (const p of [c.top, c.bot]) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; }
        const wpx = maxX - minX;
        if (wpx > 0 && wpx < MINW) {
          const cx = (minX + maxX) / 2, sc = MINW / wpx;
          for (const c of cols) for (const p of [c.top, c.bot]) p[0] = cx + (p[0] - cx) * sc;
        }
        // fill the belly as white cloth, one convex quad-strip at a time so the
        // whole surface reads white on every face (front and back of the belly),
        // never leaving a hole for the hull/mast to show through.
        for (let k = 0; k < N; k++) {
          const a = cols[k], b = cols[k + 1];
          ctx.beginPath();
          ctx.moveTo(a.top[0], a.top[1]); ctx.lineTo(b.top[0], b.top[1]); ctx.lineTo(b.bot[0], b.bot[1]); ctx.lineTo(a.bot[0], a.bot[1]); ctx.closePath();
          ctx.fillStyle = C.sail; ctx.fill();
          const shade = 0.2 * ((a.nrm * a.nrm + b.nrm * b.nrm) / 2); // soft rounding toward the edges
          if (shade > 0.01) { ctx.globalAlpha = shade; ctx.fillStyle = "#000"; ctx.fill(); ctx.globalAlpha = 1; }
          ctx.globalAlpha = 0.09; ctx.fillStyle = trim; ctx.fill(); ctx.globalAlpha = 1;
        }
        // silhouette outline + yard across the head
        ctx.beginPath();
        cols.forEach((c, i) => { if (i === 0) ctx.moveTo(c.top[0], c.top[1]); else ctx.lineTo(c.top[0], c.top[1]); });
        for (let k = N; k >= 0; k--) ctx.lineTo(cols[k].bot[0], cols[k].bot[1]);
        ctx.closePath();
        ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,0,0,0.28)"; ctx.stroke();
        line(cols[0].top, cols[N].top, s.cols.spar, 1.3);
      };
      const drawPole = (m, base, top) => {
        line(base, top, s.cols.spar, 1.7);
        const bz = mz(m.u);
        const f2 = P3(m.u - 5, 0, bz + m.h - 0.6), f3 = P3(m.u, 0, bz + m.h - 2.4);
        ctx.fillStyle = trim;
        ctx.beginPath(); ctx.moveTo(top[0], top[1]); ctx.lineTo(f2[0], f2[1]); ctx.lineTo(f3[0], f3[1]); ctx.closePath(); ctx.fill();
      };
      // a fore-and-aft panel: cloth standing along the keel line, filled from its outline. Kept to
      // a small on-screen minimum the same way the square bands are, so it never quite vanishes
      // when she sails straight up or down the screen.
      const drawPanel = (pts) => {
        const proj = pts.map(([uu, zz]) => P3(uu, 0, zz));
        let minX = Infinity, maxX = -Infinity;
        for (const p of proj) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; }
        const wpx = maxX - minX;
        if (wpx > 0 && wpx < MINW) {
          const cx = (minX + maxX) / 2, sc = MINW / wpx;
          for (const p of proj) p[0] = cx + (p[0] - cx) * sc;
        }
        ctx.beginPath();
        proj.forEach((p, i) => { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
        ctx.closePath();
        ctx.fillStyle = C.sail; ctx.fill();
        ctx.globalAlpha = 0.09; ctx.fillStyle = trim; ctx.fill(); ctx.globalAlpha = 1;
        ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,0,0,0.28)"; ctx.stroke();
      };
      // the outline of one fore-and-aft band, by its category: a gaff sail peaks high and aft of
      // the mast, a lug hangs from its raking yard with some cloth forward of the pole, and
      // triangular canvas is the lateen's fin, tacked forward and peaked aft
      const drawFin = (u, band) => {
        const bz = mz(u), sb = bz + band.sb, st = bz + band.st, h = band.st - band.sb;
        if (band.kind === "GAF") {
          const r = 0.85 * h + 3;
          drawPanel([[u, sb], [u, st - 0.24 * h], [u - 0.72 * r, st], [u - r, sb + 0.1 * h]]);
        } else if (band.kind === "LUG") {
          drawPanel([[u + 0.34 * h, sb], [u + 0.42 * h, st - 0.3 * h], [u - 0.58 * h, st], [u - 0.5 * h, sb + 0.06 * h]]);
        } else {
          drawPanel([[u + 0.45 * h, sb + 0.12 * h], [u - 0.55 * h, st], [u - 0.42 * h, sb]]);
        }
      };
      // a headsail: tacked on the bowsprit, hoisted toward the foremost masthead, clewed down aft
      const drawHead = (hd) => {
        const bz = mz(hd.mastU);
        drawPanel([[hd.tack, deckH + 2], [hd.mastU, bz + hd.mastZ], [hd.tack - 7, deckH + 2.5]]);
      };
      // depth-sort every pole and sail together: whichever is farther from the
      // camera is painted first, so the mast sits behind its bow-side sail when
      // she sails toward you and in front of it when she sails away.
      const prims = [];
      for (const m of masts) {
        prims.push({ d: m.u * sH, kind: "pole", m, base: P3(m.u, 0, mz(m.u)), top: P3(m.u, 0, mz(m.u) + m.h) });
        for (const band of m.sails) {
          if (SEA_FOREAFT.has(band.kind)) prims.push({ d: m.u * sH, kind: "fin", u: m.u, band });
          else prims.push({ d: (m.u + fwd + belly * 0.5) * sH, kind: "sail", u: m.u, band });
        }
      }
      if (!s.mastDown) {
        for (const hd of rig.heads) prims.push({ d: hd.tack * sH, kind: "head", hd });
        for (const sp of rig.sprits) prims.push({ d: sp.u * sH, kind: "sail", u: sp.u, band: sp });
      }
      prims.sort((a, b) => a.d - b.d);
      for (const p of prims) {
        if (p.kind === "pole") drawPole(p.m, p.base, p.top);
        else if (p.kind === "fin") drawFin(p.u, p.band);
        else if (p.kind === "head") drawHead(p.hd);
        else drawSail(p.u, p.band);
      }
      if (s.mastDown) line(P3(-2, 0, deckH), P3(-2, 3, deckH + 8), s.cols.spar, 1.8);

      // health bars + rank, above the rig
      if (!s.isPlayer) {
        const bw = 26, bxL = gx - bw / 2;
        // above her own rig, so a boat's bars sit close over her and a tall ship's clear the royals
        const byT = P3(1, 0, deckH + rig.top + 6)[1] - 14;
        if (g.rules.ranked && s.rank) {
          ctx.font = `700 10px ${UI}`;
          ctx.textAlign = "right";
          ctx.fillStyle = s.rank === 1 ? C.gold : "rgba(238,244,242,0.8)";
          ctx.fillText("#" + s.rank, bxL - 4, byT + 8);
          ctx.textAlign = "left";
        }
        const rows = [[s.hull / s.maxHull, C.hull], [s.mast / s.maxMast, C.mast], [s.crew / s.maxCrew, C.crew]];
        rows.forEach((r, i) => {
          const yy = byT + i * 4;
          ctx.fillStyle = "rgba(0,0,0,0.5)";
          ctx.fillRect(bxL, yy, bw, 2.6);
          ctx.fillStyle = r[1];
          ctx.fillRect(bxL, yy, bw * Math.max(0, r[0]), 2.6);
        });
      }
    }

    function drawShots(cam) {
      for (const b of gameRef.current.shots) {
        const sx = SX(b.x, cam), sy = SY(b.y, cam) - 3;
        if (b.kind === "musket") {
          ctx.strokeStyle = C.pellet;
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx - b.vx * 0.012, sy - b.vy * 0.012 * TILT);
          ctx.stroke();
        } else {
          // The smoke she drags comes first, so the ball sits on the head of it. It is drawn as a
          // wedge tapering to nothing astern rather than a line: a stroke this thin goes grey the
          // moment it lands under a pixel, where a shape narrowing to a point keeps its weight at
          // the ball and simply runs out. Two wedges, a long faint one and a short bright one,
          // give it a falling-off without a gradient per ball per frame.
          const dr = b.r * SHOT_DRAW; // what it looks like, which is not what it bites
          const tail = 0.06; // seconds of her flight lie behind her
          const px = -b.vx * tail, py = -b.vy * tail * TILT; // astern, in screen terms
          const nx = -py, ny = px; // across the trail, to give the wedge its width at the ball
          const nl = Math.hypot(nx, ny) || 1;
          for (const [reach, wide, alpha] of [[1, 0.85, 0.2], [0.45, 0.62, 0.28]]) {
            ctx.globalAlpha = alpha;
            ctx.fillStyle = C.smoke;
            ctx.beginPath();
            ctx.moveTo(sx + (nx / nl) * dr * wide, sy + (ny / nl) * dr * wide);
            ctx.lineTo(sx + px * reach, sy + py * reach);
            ctx.lineTo(sx - (nx / nl) * dr * wide, sy - (ny / nl) * dr * wide);
            ctx.closePath();
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          // cast iron, with the light off the top of it. No outline: a dark ball on this sea has
          // the contrast to stand on its own, and a hairline round something this small is a
          // smudge rather than an edge
          ctx.beginPath();
          ctx.arc(sx, sy, dr, 0, Math.PI * 2);
          ctx.fillStyle = C.ball;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(sx - dr * 0.3, sy - dr * 0.34, Math.max(SHOT_LIT_MIN, dr * 0.42), 0, Math.PI * 2);
          ctx.fillStyle = C.ballLit;
          ctx.fill();
        }
      }
    }

    function drawParts(cam) {
      const g = gameRef.current;
      for (const p of g.parts) {
        const sx = SX(p.x, cam), sy = SY(p.y, cam);
        if (p.kind === "muzzle") {
          const k = p.life / p.max;
          ctx.save();
          ctx.translate(sx, sy);
          ctx.scale(1, TILT);
          ctx.rotate(p.ang);
          ctx.globalAlpha = k;
          ctx.fillStyle = "#ffe9a8";
          ctx.beginPath();
          ctx.moveTo(6, 0); ctx.lineTo(14, -3); ctx.lineTo(20, 0); ctx.lineTo(14, 3);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.restore();
        } else if (p.kind === "puff") {
          // It swells the whole way and thins as it goes, so what fades out is a wide soft bank
          // rather than a hard dot winking out. Squashed like everything else lying on the water.
          //
          // Three rings of the one puff, each drawn over the last, in place of a soft-edged brush.
          // A single flat disc has a hard rim, and a dozen hard rims over a hull read as spots on
          // the water rather than as smoke; stacking them thickens the middle and lets the edge go
          // off gradually, which is the whole difference between a cloud and a blob. Three fills
          // beat building a gradient for every puff of every frame.
          const k = 1 - p.life / p.max;
          const rr = p.r0 + (p.r1 - p.r0) * Math.sqrt(k);
          const fade = (1 - k) * Math.min(1, k * 5); // a beat to bloom, then away
          ctx.fillStyle = C.smoke;
          for (const step of [1, 0.7, 0.44]) {
            ctx.globalAlpha = 0.26 * fade;
            ctx.beginPath();
            ctx.ellipse(sx, sy, rr * step, rr * step * TILT, 0, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        } else if (p.kind === "ring") {
          const k = 1 - p.life / p.max;
          ctx.globalAlpha = (1 - k) * 0.8;
          ctx.strokeStyle = p.col;
          ctx.lineWidth = 1.4;
          const rr = 3 + k * 16;
          ctx.beginPath();
          ctx.ellipse(sx, sy, rr, rr * TILT, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else {
          ctx.globalAlpha = Math.max(0, p.life / p.max);
          ctx.fillStyle = p.col;
          ctx.fillRect(sx - 1, sy - 1, 2, 2);
          ctx.globalAlpha = 1;
        }
      }
      ctx.textAlign = "center";
      // SUNK and MAST DOWN are white, outlined in a dark halo so they carry on open water — which is a
      // mid tone, where plain white would sit too close to it. Halo first: the stroke is centred on the
      // glyph edge and eats half its width into the letter, so the fill has to go down over it.
      ctx.lineJoin = "round";
      for (const t of g.texts) {
        ctx.globalAlpha = Math.min(1, t.life);
        ctx.font = `600 10px ${UI}`;
        const tx = SX(t.x, cam), ty = SY(t.y, cam);
        ctx.lineWidth = 3.4;
        ctx.strokeStyle = "rgba(6,32,31,0.7)";
        ctx.strokeText(t.t, tx, ty);
        ctx.fillStyle = C.ink;
        ctx.fillText(t.t, tx, ty);
        ctx.globalAlpha = 1;
      }
      ctx.textAlign = "left";
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function drawRadar() {
      const g = gameRef.current;
      const size = 96, rx = Wd - size - 10, ry = 10;
      ctx.save();
      ctx.fillStyle = "rgba(11,51,49,0.92)";
      ctx.strokeStyle = C.hair;
      ctx.lineWidth = 1;
      roundRect(rx, ry, size, size, 8);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      roundRect(rx, ry, size, size, 8);
      ctx.clip();
      const sc = size / WORLD;
      ctx.fillStyle = "rgba(111,174,92,0.85)";
      for (const isl of g.islands) { ctx.beginPath(); ctx.arc(rx + isl.x * sc, ry + isl.y * sc, Math.max(1.5, isl.r * sc), 0, Math.PI * 2); ctx.fill(); }
      const ang = clock * 1.4;
      ctx.strokeStyle = "rgba(95,168,160,0.25)";
      ctx.beginPath();
      ctx.moveTo(rx + size / 2, ry + size / 2);
      ctx.lineTo(rx + size / 2 + Math.cos(ang) * size, ry + size / 2 + Math.sin(ang) * size);
      ctx.stroke();
      ctx.strokeStyle = "rgba(236,226,204,0.3)";
      ctx.strokeRect(rx + g.cam.x * sc, ry + g.cam.y * sc, Vw * sc, (Vh / TILT) * sc);
      if (g.rules.storm) {
        ctx.strokeStyle = "rgba(209,91,91,0.85)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(rx + (WORLD / 2) * sc, ry + (WORLD / 2) * sc, g.stormR * sc, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (const s of g.ships) {
        if (!s.alive || s.isPlayer) continue;
        ctx.fillStyle = g.rules.ranked && s.rank === 1 ? C.gold : s.fill;
        ctx.beginPath();
        ctx.arc(rx + s.x * sc, ry + s.y * sc, g.rules.ranked && s.rank === 1 ? 3 : 2.3, 0, Math.PI * 2);
        ctx.fill();
      }
      if (g.player.alive) {
        ctx.fillStyle = C.player;
        ctx.beginPath();
        ctx.arc(rx + g.player.x * sc, ry + g.player.y * sc, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    function drawVignette() {
      const v = gameRef.current.vign;
      if (v <= 0) return;
      const grd = ctx.createRadialGradient(Wd / 2, Hd / 2, Math.min(Wd, Hd) * 0.3, Wd / 2, Hd / 2, Math.max(Wd, Hd) * 0.7);
      grd.addColorStop(0, "rgba(209,91,91,0)");
      grd.addColorStop(1, `rgba(209,91,91,${0.38 * v})`);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, Wd, Hd);
    }

    function render() {
      const g = gameRef.current;
      if (!g) return;
      const cam = g.cam;
      worldSpace();
      drawWater(cam);
      drawStormWater(cam);
      drawWakes(cam);
      drawIslands(cam);
      if (g.running) drawArcGuides(g.player, cam);
      drawShots(cam);
      const order = g.ships.filter((s) => s.alive).slice().sort((a, b) => a.y - b.y);
      for (const s of order) drawShip(s, cam);
      drawParts(cam);
      drawStormEdge(cam);
      screenSpace(); // the two that belong to the screen rather than to the sea
      drawVignette();
      drawRadar();
    }

    function loop(ts) {
      if (!last) last = ts;
      let dt = (ts - last) / 1000;
      last = ts;
      if (dt > 0.05) dt = 0.05;
      clock += dt;
      const g = gameRef.current;
      if (g && g.running) update(dt);
      render();
      raf = requestAnimationFrame(loop);
    }

    function start(m) {
      reset(m);
      camUpdate();
      const g = gameRef.current;
      if (g.rules.ranked) computeMeta();
      g.running = true;
      inputRef.current = { joyMag: 0, joyAng: 0, broadside: false, bow: false, musket: false };
      last = 0;
      syncRef.current();
      setResult("");
      setBanked(0);
      setMode(m);
      setPhase("playing");
    }
    startRef.current = start;

    resize();
    reset("arena");
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  const joyDown = (e) => {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    joyState.current = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2, R: r.width / 2 - 22 };
    e.currentTarget.setPointerCapture(e.pointerId);
    joyMove(e);
  };
  const joyMove = (e) => {
    const js = joyState.current;
    if (js.id !== e.pointerId) return;
    const dx = e.clientX - js.cx, dy = e.clientY - js.cy;
    const len = Math.hypot(dx, dy) || 1;
    const cl = Math.min(len, js.R);
    if (knobRef.current) knobRef.current.style.transform = `translate(${(dx / len) * cl}px, ${(dy / len) * cl}px)`;
    inputRef.current.joyMag = cl / js.R;
    inputRef.current.joyAng = Math.atan2(dy, dx);
  };
  const joyUp = (e) => {
    if (joyState.current.id !== e.pointerId) return;
    joyState.current.id = null;
    inputRef.current.joyMag = 0;
    if (knobRef.current) knobRef.current.style.transform = "translate(0px,0px)";
  };
  const holdBtn = (key, val) => (e) => { e.preventDefault(); inputRef.current[key] = val; };
  const rules = modeOf(mode);

  return (
    <div
      style={{ position: "relative", width: "100%", height: "100dvh", overflow: "hidden", background: C.water, userSelect: "none", WebkitUserSelect: "none", touchAction: "none", fontFamily: UI }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />

      {phase === "playing" && (
        <>
          <div style={{ position: "absolute", top: 8, left: 10, display: "flex", gap: 8 }}>
            <Pill label={`${coins} coins`}><CoinIcon /><span>{coins}</span></Pill>
            {rules.reinforcements ? (
              <>
                <Pill label={`${sunk} sunk`}><SunkIcon /><span>{sunk}</span></Pill>
                <Pill label={`${Math.max(0, left - 1)} hunting you`}><ShipIcon /><span>{Math.max(0, left - 1)} hunting</span></Pill>
              </>
            ) : (
              <Pill label={`${left} rivals left`}><ShipIcon /><span>{left} left</span></Pill>
            )}
            {rules.storm && <StormPill storm={storm} />}
          </div>

          <div style={{ position: "absolute", top: 36, left: 10, display: "flex", gap: 6, alignItems: "stretch", width: "min(236px, 72%)" }}>
            {rules.ranked && <RankBadge rank={rank.rank} total={rank.total} />}
            <div style={{ flex: 1 }}>
              <HealthPanel ph={ph} phMax={phMax} />
            </div>
          </div>

          {/* The repair rail, where the upgrade rail used to be. Two buttons, and each prices the
              work she would get this second rather than a list price. The hull can be part paid, so
              it shows what her purse actually buys; the mast cannot, so it shows the whole price
              whether she has it or not, because a figure she is saving towards is more use than the
              word "no". A button with nothing to do says which of the two reasons it is. */}
          {rules.repairs && (
          <div style={{ position: "absolute", top: 110, left: 8, right: 8, display: "flex", gap: 6, paddingBottom: 2 }}>
            {REPAIRS.map((t) => {
              const q = mend[t.key] || { whole: true, afford: 0, cost: 0, part: false };
              const can = !q.whole && q.afford > 0;
              const part = can && q.part && q.afford < q.cost; // her purse buys some of this bill, not all
              const price = can ? q.afford : q.cost; // what she would pay now, or what she is saving for
              return (
                // A dimmed button keeps its own ground and dims only what is written on it. Fading
                // the whole control put a half-transparent panel over a 50%-alpha ground, which came
                // to a quarter opaque: the sea showed straight through, and 8px of label landed on an
                // island and stopped being readable. The border goes neutral to say it is dead.
                <button
                  key={t.key}
                  disabled={!can}
                  onPointerDown={(e) => { e.preventDefault(); mendNow(t.key); }}
                  style={{ flex: "1 1 0", minWidth: 0, borderRadius: 10, border: `1px solid ${can ? t.color : C.hair}`, background: C.panel, color: C.ink, padding: "5px 4px", cursor: can ? "pointer" : "default", WebkitTapHighlightColor: "transparent" }}
                >
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, opacity: can ? 1 : 0.6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: t.color }}>{t.label}</span>
                    <span style={{ fontSize: 8, color: "rgba(238,244,242,0.55)", textAlign: "center", lineHeight: 1.25 }}>{t.sub}</span>
                    <span style={{ fontSize: 9, color: q.whole ? "rgba(238,244,242,0.6)" : can ? C.gold : "rgba(232,200,119,0.5)", display: "inline-flex", alignItems: "center", gap: 3 }}>
                      {/* A part payment names the whole bill beside it. "18 part" left a captain to
                          work out what part of what; "18 of 79" is the same width and answers it. */}
                      {q.whole ? t.whole : <><CoinIcon size={9} />{part ? `${price} of ${q.cost}` : price}</>}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          )}

          <div
            onPointerDown={joyDown}
            onPointerMove={joyMove}
            onPointerUp={joyUp}
            onPointerCancel={joyUp}
            style={{ position: "absolute", left: 24, bottom: 28, width: 120, height: 120, borderRadius: "50%", border: `1px solid ${C.hair}`, background: "rgba(13,58,56,0.55)", touchAction: "none" }}
          >
            <div ref={knobRef} style={{ position: "absolute", left: "50%", top: "50%", width: 52, height: 52, marginLeft: -26, marginTop: -26, borderRadius: "50%", background: "rgba(236,226,204,0.9)", boxShadow: "0 2px 6px rgba(0,0,0,0.4)", pointerEvents: "none" }} />
          </div>

          {rules.guns && (
          <div style={{ position: "absolute", right: 20, bottom: 26, display: "flex", flexDirection: "column", gap: 10 }}>
            <FireButton refEl={btnRefs.broadside} name="SIDE" sub="hull" color={C.hull} onDown={holdBtn("broadside", true)} onUp={holdBtn("broadside", false)} />
            <FireButton refEl={btnRefs.bow} name="FRONT" sub="mast" color={C.mast} onDown={holdBtn("bow", true)} onUp={holdBtn("bow", false)} />
            <FireButton refEl={btnRefs.musket} name="MUSKET" sub="crew" color={C.crew} onDown={holdBtn("musket", true)} onUp={holdBtn("musket", false)} />
          </div>
          )}
        </>
      )}

      {phase === "start" && <StartOverlay onStart={(m) => startRef.current(m)} onEdit={() => setPhase("yard")} onRecords={() => setPhase("records")} hold={hold} onScuttle={() => resetHold()} />}
      {phase === "yard" && <YardScreen hold={hold} onBack={() => setPhase("start")} onCommission={() => setPhase("commission")} onOutfit={() => setPhase("outfitter")} />}
      {phase === "commission" && <CommissionScreen hold={hold} onBack={() => setPhase("yard")} />}
      {phase === "outfitter" && <OutfitterScreen hold={hold} onBack={() => setPhase("yard")} />}
      {phase === "records" && <RecordsScreen hold={hold} onBack={() => setPhase("start")} onAchievements={() => setPhase("achievements")} />}
      {phase === "achievements" && <AchievementsScreen hold={hold} onBack={() => setPhase("records")} />}
      {phase === "won" && <EndOverlay title="LAST AFLOAT" titleColor={C.gold} result={result} stats={stats} mode={mode} place={place} hold={hold} banked={banked} onAgain={() => startRef.current(mode)} onMenu={() => setPhase("start")} />}
      {phase === "dead" && (
        <EndOverlay title="SUNK" titleColor={C.crew} result={result} stats={stats} mode={mode} place={place} hold={hold} banked={banked} onAgain={() => startRef.current(mode)} onMenu={() => setPhase("start")} />
      )}
    </div>
  );
}

// ---------------- HUD icons ----------------
// Drawn rather than set in emoji, so the HUD keeps its shape across iOS, Android and Windows instead
// of picking up whatever each OS ships in its emoji font. Every one is a 16-unit box filled with
// currentColor, so the same component serves the gold pills and the pale red storm-danger pill
// without a variant. aria-hidden throughout: the number beside the icon carries the meaning, and the
// pill itself takes the label.
//
// These run 9px to 17px, so every shape here is a mass rather than a stroke. The first drawn set was
// built out of outlines and hairlines, and at 1x the coin's ring and inner glyph read as a wall
// clock while the sinking hull read as a smudge. The rule the redraw follows: one silhouette a
// reader can name, and where an icon needs interior detail, cut it out of a filled body instead of
// drawing it in line, because a knocked-out mark keeps full contrast when it falls under a pixel and
// a thin stroke just fades.
const iconStyle = { verticalAlign: "-0.12em", flex: "0 0 auto" };

// Currency, both the run purse and the hold that outlives it. A solid disc with a skull struck into
// it, so the coin carries the same mark as the sunk counter and the money in this game is plainly
// pirate money. The disc doing the work is the whole reason it survives: at 17px on the menu the
// stamp resolves into a skull, and at 12px in the HUD it falls back to a round gold mass with a dark
// mark on it, which is still a coin. The version before this one was a ring with a thin glyph hung
// inside it, and at 12px a ring with a stub in the middle is a wall clock.
//
// Three levels of fill, and the order matters: gold disc, skull cut out of it, eye sockets filled
// back in. Cutting the skull out rather than drawing it in line is what keeps it black at 12px; the
// nose and teeth that SunkIcon can afford are left off here, because inside a 14-unit disc they are
// half-pixel marks that only silt up the sockets.
//
// The cranium is centred at 7.65 rather than 8, which is what sits the skull in the middle of the
// coin: the shape hangs down from the dome, so centring the dome leaves the whole mark riding high
// with a crescent of bare gold under the jaw. 7.65 puts the head-and-jaw box in the middle of the
// disc, within a tenth of a unit of where its centre of area wants to be.
function CoinIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={iconStyle}>
      <path
        fillRule="evenodd"
        d="M8 .8a7.2 7.2 0 1 1 0 14.4A7.2 7.2 0 0 1 8 .8Z
           M4.1 7.65a3.9 3.5 0 1 1 7.8 0v1.93H9.95v2.3h-3.9v-2.3H4.1Z
           M4.9 7.75a1.35 1.35 0 1 0 2.7 0 1.35 1.35 0 1 0-2.7 0Z
           M8.4 7.75a1.35 1.35 0 1 0 2.7 0 1.35 1.35 0 1 0-2.7 0Z"
      />
    </svg>
  );
}

// Rivals still afloat. A ship, not a flag: the counter is ships remaining. Three masses, sized so
// each one survives on its own: mast, mainsail, hull. The waves that used to run under the hull are
// gone. At 12px they were a 1px ripple that only furred the bottom edge, and the hull's own flat
// sheer line already puts the ship on the water.
function ShipIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={iconStyle}>
      <path d="M6.4 1.2h1.9v8.2H6.4z" />
      <path d="M9.1 2 13.6 8.2H9.1z" />
      <path d="M1.4 9.6h13.2l-2.4 4.6H3.8L1.4 9.6Z" />
    </svg>
  );
}

// Ships sunk. A skull over crossed bones: the count is kills, and the flag a captain runs up over
// them is the thing every player already reads as kills. It beats the sinking hull that stood here
// before, which needed a waterline to explain it and still arrived as a diagonal lump.
//
// The bones go down first and the skull over them, so the two shapes stay separate at size instead
// of fusing into one mass. Everything inside the skull is cut out, not drawn: sockets big enough to
// hold two dark pixels at 12px, and a nose that is the one detail here allowed to disappear, since
// a domed head with two sockets over a jaw is already a skull without it.
function SunkIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={iconStyle}>
      <path d="M1.27 11.7 14.07 15.5l.66-2.2L1.93 9.5ZM14.07 9.5 1.27 13.3l.66 2.2 12.8-3.8Z" />
      <path
        fillRule="evenodd"
        d="M3.5 5.6a4.5 4 0 1 1 9 0v2.2h-2.2v2.6H5.7V7.8H3.5Z
           M4.5 5.8a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0Z
           M8.5 5.8a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0Z
           M8 7.2l.6 1.2H7.4Z"
      />
    </svg>
  );
}

// The closing squall: the weather up top, the ring it is closing on underneath. The ring is the one
// thing the mode actually does to you, so it is worth the half of the box it takes.
//
// Both shapes run the full width. Two rules fought here and width settled both. A small cloud on a
// wide ring is a chess pawn, since the eye takes the narrow thing on top as a knob and the wide
// thing under it as a base; and a cloud tucked inside the ring, which is nearer to what the game
// draws, is worse still, because the overlap fuses them into one mass. Full-width and clear of each
// other, they stay two things: weather, and a perimeter drawing in under it.
//
// The ring is a shape with a hole rather than a stroked ellipse, so it keeps full contrast at 12px,
// and it can only be flattened so far: at this height the hole is about two device pixels, and
// squashing it further closes the hole and leaves a solid lozenge. The cloud is a bumpy top edge
// over a flat base, which is all a cloud is at 12px anyway.
function SquallIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={iconStyle}>
      <path d="M3.26 6.1Q1.6 6.1 1.6 3.87Q1.6 2.28 3.39 1.97Q3.9.8 6.98.8Q9.66.8 10.56 2.81Q12.61 2.5 14.4 3.87Q14.91 6.1 12.74 6.1Z" />
      <path
        fillRule="evenodd"
        d="M.4 12a7.6 3.8 0 1 0 15.2 0 7.6 3.8 0 1 0-15.2 0Z
           M1.9 12a6.1 2.3 0 1 1 12.2 0 6.1 2.3 0 1 1-12.2 0Z"
      />
    </svg>
  );
}

// A pill lays its children out in a row with a gap, so an icon sits beside its number without a
// space character doing the spacing. Wrap the text in one span: two loose children would each become
// a flex item and take the gap between them.
function Pill({ children, label }) {
  return <div aria-label={label} style={{ background: C.panel, border: `1px solid ${C.hair}`, borderRadius: 20, padding: "5px 11px", fontSize: 12, color: C.gold, fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>{children}</div>;
}

function StormPill({ storm }) {
  if (storm.out) return <div style={{ background: "rgba(70,18,18,0.85)", border: `1px solid ${C.crew}`, borderRadius: 20, padding: "5px 11px", fontSize: 12, color: "#ffd9d9", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }} aria-label="You are in the storm"><SquallIcon /><span>In the storm</span></div>;
  if (storm.closes > 0) return <Pill label={`Storm closes in ${fmtTime(storm.closes)}`}><SquallIcon /><span>{fmtTime(storm.closes)}</span></Pill>;
  return <Pill label={storm.closing ? "Storm closing" : "Storm closed"}><SquallIcon /><span>{storm.closing ? "closing" : "closed"}</span></Pill>;
}

function RankBadge({ rank, total }) {
  const leader = rank === 1;
  return (
    <div style={{ background: C.panel, border: `1px solid ${leader ? C.gold : C.hair}`, borderRadius: 10, padding: "4px 8px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 44 }}>
      <span style={{ fontSize: 8, letterSpacing: 1, color: "rgba(238,244,242,0.5)" }}>Rank</span>
      <span style={{ fontSize: 20, fontWeight: 800, lineHeight: 1, color: leader ? C.gold : C.ink }}>#{rank}</span>
      <span style={{ fontSize: 8, color: "rgba(238,244,242,0.5)" }}>of {total}</span>
    </div>
  );
}

function HealthPanel({ ph, phMax }) {
  const rows = [["HULL", ph.hull, phMax.hull, C.hull], ["MAST", ph.mast, phMax.mast, C.mast], ["CREW", ph.crew, phMax.crew, C.crew]];
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.hair}`, borderRadius: 10, padding: "7px 9px" }}>
      {rows.map(([label, val, max, col]) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 9, color: "rgba(238,244,242,0.6)", width: 30 }}>{label}</span>
          <div style={{ flex: 1, height: 6, background: "rgba(0,0,0,0.35)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.max(0, (val / max) * 100)}%`, background: col, transition: "width 0.15s" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function FireButton({ refEl, name, sub, color, onDown, onUp }) {
  return (
    <button
      ref={refEl}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      onPointerCancel={onUp}
      style={{ position: "relative", width: 66, height: 56, borderRadius: 10, border: `1px solid ${color}`, background: "rgba(13,58,56,0.88)", color: C.ink, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, overflow: "hidden", touchAction: "none", WebkitTapHighlightColor: "transparent", cursor: "pointer" }}
    >
      <span style={{ fontSize: 12, fontWeight: 700 }}>{name}</span>
      <span style={{ fontSize: 8, color, letterSpacing: 1 }}>{sub}</span>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "rgba(0,0,0,0.4)" }}>
        <div className="cd-fill" style={{ height: "100%", background: color, transformOrigin: "left", transform: "scaleX(1)" }} />
      </div>
    </button>
  );
}

function Shell({ children }) {
  return (
    // `margin:auto` rather than `align-items:center` so a tall menu on a short
    // screen scrolls from the top instead of having its head clipped off.
    <div style={{ position: "absolute", inset: 0, display: "flex", overflowY: "auto", padding: 24, background: "rgba(8,38,37,0.80)", backdropFilter: "blur(4px)" }}>
      <div style={{ margin: "auto", maxWidth: 360, textAlign: "center" }}>{children}</div>
    </div>
  );
}

const GALLEON_W = 268;
const GALLEON_ASPECT = 0.62; // the projection is drawn into a 1 : 0.62 box
const GALLEON_DEG_PER_MS = 0.012; // ~30s per revolution

// The ship on the menu: a 3-D hull re-projected to isometric every frame, so it
// turns rather than spinning a flat sprite.
//
// She is the captain's own ship, not a stock galleon: `rig` is what is actually
// stepped and bent on aboard whichever hull she is sailing, so buying a sail
// shows up here. Hull shapes per class are still to be drawn, so for now every
// class turns on this one hull and the rig on top of it is the part that is real.
function MenuGalleon({ rig }) {
  const cvs = useRef(null);
  // The rig changes rarely and the object is rebuilt on every render, so the
  // effect keys off the shape of it rather than its identity. Without this the
  // canvas tears down and restarts on every parent render, and the ship jumps
  // back to bearing zero mid-turn.
  const key = JSON.stringify(rig);

  useEffect(() => {
    const c = cvs.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    const w = GALLEON_W;
    const h = Math.round(w * GALLEON_ASPECT);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = w * dpr;
    c.height = h * dpr;

    const paint = (deg) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawGalleon(ctx, w, h, deg, rig);
    };

    // A perpetually turning ship is exactly what reduced-motion asks us to drop,
    // so hold a three-quarter view instead.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      paint(24);
      return;
    }

    let raf = 0;
    let last = 0;
    let deg = 0;
    const frame = (t) => {
      if (last) deg = (deg + (t - last) * GALLEON_DEG_PER_MS) % 360;
      last = t;
      paint(deg);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <canvas
      ref={cvs}
      aria-hidden="true"
      style={{ display: "block", width: GALLEON_W, height: Math.round(GALLEON_W * GALLEON_ASPECT), margin: "2px auto -6px" }}
    />
  );
}

/**
 * The hold on the menu: what she is worth, what that means, and the way into the log.
 *
 * The line under the total used to be a summary that appeared only once there was something to
 * summarise, and it was doing two jobs badly. What the hold *is* wants saying every time, including
 * to a captain fifty voyages in; the tallies want more room than one comma-spliced line and they now
 * have a screen. So the line stays put and says the one thing, and the record sits below it as its
 * own control.
 */
function HoldPanel({ hold, onRecords }) {
  return (
    <div style={{ background: "rgba(11,51,49,0.6)", border: `1px solid ${C.hair}`, borderRadius: 10, padding: "9px 12px 0", margin: "14px 0 18px", textAlign: "left" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        {/* Set exactly as the row at the foot of this panel: same size, same ink, no tracking, so the
            box has one voice for the two things it labels. It carried a size and a letterspacing of
            its own, which made a heading and a control that sit one above the other in one box read
            as two unrelated kinds of label. The tracking went rather than being copied down, because
            the thing below it is a button and a button takes size over tracking. */}
        <span style={{ fontSize: 11, color: "rgba(238,244,242,0.78)" }}>The Hold</span>
        <span style={{ fontSize: 17, fontWeight: 800, color: C.gold, display: "inline-flex", alignItems: "center", gap: 4 }} aria-label={`${fmtCoins(hold.coins)} coins in the hold`}><CoinIcon size={17} />{fmtCoins(hold.coins)}</span>
      </div>
      <div style={{ fontSize: 10, color: "rgba(238,244,242,0.5)", lineHeight: 1.6, marginTop: 4 }}>
        Keep what you earn at sea, less any spent
      </div>
      {/* Full width and edge to edge inside the box, so the row is visibly the whole bottom of the
          panel rather than a word someone has underlined. The negative margins pay back the box's
          own padding; the box gives none at the foot for the same reason.

          Its own line under it, in the same ink and size as the hold's, so the panel reads as two
          things each saying what it is rather than one explained thing and one bare label. The
          chevron centres against the pair. */}
      <button
        onClick={onRecords}
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
          width: "calc(100% + 24px)", margin: "8px -12px 0", padding: "9px 12px 10px",
          background: "transparent", border: "none", borderTop: `1px solid ${C.hair}`,
          fontFamily: UI, color: "rgba(238,244,242,0.78)", textAlign: "left",
          cursor: "pointer", WebkitTapHighlightColor: "transparent",
        }}
      >
        <span>
          <span style={{ display: "block", fontSize: 11 }}>Achievements &amp; Tallies</span>
          <span style={{ display: "block", fontSize: 10, color: "rgba(238,244,242,0.5)", lineHeight: 1.6, marginTop: 2 }}>
            Track stats and achievements
          </span>
        </span>
        <ChevronIcon />
      </button>
    </div>
  );
}

// Points the way into a screen, or back out of one. Drawn rather than a `›`, which sets in whatever
// the UI font has and sits at a different weight and height on every platform.
function ChevronIcon({ size = 11, back }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path
        d={back ? "M10 3l-5 5 5 5" : "M6 3l5 5-5 5"}
        stroke="rgba(238,244,242,0.55)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The way out, at the top of a screen. Every screen off the menu carries one.
 *
 * These screens are read from the top and some of them are long: a captain who opened the tallies to
 * glance at one figure should not have to scroll past four cards to leave. The button at the foot
 * stays where it is, for the captain who *has* read to the bottom and is done there, and the two
 * carry the same words — one thing under two names would read as two different exits.
 *
 * The menu is "the sea", because that is what a captain is going back out to and it is what the yard
 * has always called it. So the yard and the tallies both come back to the sea, and the achievements
 * come back to the tallies, which is the screen they open from rather than a description of it.
 */
function BackLink({ label, onClick }) {
  return (
    <div style={{ textAlign: "left" }}>
      <button
        onClick={onClick}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          // Pulled out by its own padding so the glyph lines up with the card edges below it while the
          // tappable area stays a comfortable size on a phone.
          margin: "0 0 4px -10px", padding: "8px 10px",
          background: "transparent", border: "none",
          fontFamily: UI, fontSize: 11, color: "rgba(238,244,242,0.78)",
          cursor: "pointer", WebkitTapHighlightColor: "transparent",
        }}
      >
        <ChevronIcon size={11} back />
        <span>{label}</span>
      </button>
    </div>
  );
}

/**
 * THE LOG — every voyage she has made, totalled and then broken out by mode.
 *
 * The overview is the honest total across everything, taken from `lifetime` rather than by adding the
 * modes up: a voyage banked under a mode this build no longer lists would go missing from a sum and
 * does not go missing from the total.
 *
 * What each mode shows is decided by what that mode *is*, not by what the record happens to hold.
 * Placement only means something where there are placements, so the derby and the free-for-all show a
 * best finish and the arena shows its own score, which is ships sunk in one voyage. Nothing is
 * repaired in the derby, so no carpenter's line appears there; there are no guns in it either, so it
 * counts rams where the other two count repairs, the same split the end-of-voyage tally makes.
 *
 * Achievements have a screen of their own, reached from the button above the tallies. What sits here
 * is the count, in the overview alongside everything else that is counted.
 */
function RecordsScreen({ hold, onBack, onAchievements }) {
  const lt = hold.lifetime;
  const sailed = lt.runs > 0;
  const won = tally(hold);

  return (
    <Shell>
      <BackLink label="Back to the sea" onClick={onBack} />
      <div style={{ fontFamily: DISPLAY, fontSize: "clamp(21px, 7vw, 26px)", color: C.gold, letterSpacing: 0.5 }}>
        Achievements &amp; Tallies
      </div>
      <div style={{ fontSize: 12, color: "rgba(238,244,242,0.7)", margin: "6px 0 2px" }}>
        {sailed
          ? `Everything from ${lt.runs} voyage${lt.runs === 1 ? "" : "s"}, totalled and by mode.`
          : "Nothing to show until you have been to sea."}
      </div>

      {/* Above the tallies, because it is the way to somewhere rather than a figure to read, and a
          control buried among nine rows of numbers is a control nobody finds. */}
      <BigRow label="Achievements" value={`${won.done} of ${won.total}`} onClick={onAchievements} />

      <Slab centred title="OVERVIEW">
        {sailed ? (
          <Rows
            rows={[
              // Achievements are not in here. The button above the card carries the same count, and
              // a figure printed twice on one screen is one of them saying nothing.
              //
              // Zero rows stay, though. A totals table whose rows appear and vanish as a captain
              // plays is harder to read than one that always has the same shape, and a nought is an
              // answer.
              ["Voyages", fmtNum(lt.runs)],
              ["Voyages won", fmtNum(lt.wins)],
              ["Ships sunk", fmtNum(lt.sunk)],
              ["Damage dealt", fmtNum(lt.dmg)],
              ["Rams landed", fmtNum(lt.rams)],
              ["Time afloat", fmtTime(lt.afloat)],
              ["Repairs bought", fmtNum(lt.patches)],
              ["Paid to the carpenter", <Coins key="c" n={lt.repaired} />],
              ["Into the hold", <Coins key="h" n={lt.earned} />],
            ]}
          />
        ) : (
          <Empty>Sail once and this fills in: what you sank, what it cost you, and what you kept.</Empty>
        )}
      </Slab>

      {sailed &&
        MODE_LIST.map((key) => {
          const m = MODES[key];
          const r = modeRecord(hold, key);
          return (
            <Slab centred key={key} title={m.title}>
              {r.runs > 0 ? (
                <Rows
                  rows={[
                    ["Voyages", fmtNum(r.runs)],
                    ...(m.ranked
                      ? [
                          ["Voyages won", fmtNum(r.wins)],
                          ["Best finish", r.bestRank > 0 ? `#${r.bestRank}` : "not yet placed"],
                        ]
                      : [["Most sunk in one voyage", fmtNum(r.bestSunk)]]),
                    ["Ships sunk", fmtNum(r.sunk)],
                    ["Damage dealt", fmtNum(r.dmg)],
                    // The end-of-voyage tally makes this same split, and for the same reason: a mode
                    // with no guns aboard is a mode where ramming is the whole of the fighting.
                    m.guns ? ["Repairs bought", fmtNum(r.patches)] : ["Rams landed", fmtNum(r.rams)],
                    ...(m.repairs ? [["Paid to the carpenter", <Coins key="c" n={r.repaired} />]] : []),
                    ["Time afloat", fmtTime(r.afloat)],
                    ["Longest voyage", fmtTime(r.bestTime)],
                    ["Into the hold", <Coins key="h" n={r.earned} />],
                  ]}
                />
              ) : (
                <Empty>{m.unsailed}</Empty>
              )}
            </Slab>
          );
        })}

      <div style={{ height: 6 }} />
      <StartButton onClick={onBack} label="Back to the sea" />
    </Shell>
  );
}

/**
 * A card that is a way into somewhere, sized and ruled like the slabs it sits among so a screen made
 * of cards keeps one rhythm. It carries its own figure on the right, because a captain who only
 * wanted the number should not have to open the screen to get it.
 */
function BigRow({ label, value, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
        width: "100%", margin: "12px 0", padding: "12px", textAlign: "left",
        background: "rgba(11,51,49,0.6)", border: `1px solid ${C.hair}`, borderRadius: 10,
        fontFamily: UI, color: C.ink, cursor: "pointer", WebkitTapHighlightColor: "transparent",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.gold }}>{value}</span>
        <ChevronIcon size={12} />
      </span>
    </button>
  );
}

/**
 * THE ACHIEVEMENTS — one card each, earned first.
 *
 * Nothing here is stored. `achievements.js` asks the hold a question per achievement and the answer
 * is the progress, which is why a captain who sank her first ship before any of this existed opens
 * the screen already holding it.
 */
function AchievementsScreen({ hold, onBack }) {
  const list = roll(hold);
  const won = tally(hold);
  return (
    <Shell>
      <BackLink label="Back to the tallies" onClick={onBack} />
      <div style={{ fontFamily: DISPLAY, fontSize: "clamp(24px, 8vw, 30px)", color: C.gold, letterSpacing: 0.5 }}>
        Achievements
      </div>
      <div style={{ fontSize: 12, color: "rgba(238,244,242,0.7)", margin: "6px 0 2px" }}>
        {won.done} of {won.total} earned.
      </div>

      {list.map((a) => (
        <div
          key={a.id}
          style={{
            display: "flex", alignItems: "center", gap: 11, textAlign: "left",
            background: "rgba(11,51,49,0.6)", borderRadius: 10, padding: "11px 12px", margin: "12px 0",
            border: `1px solid ${a.done ? C.grass : C.hair}`,
          }}
        >
          <SealIcon done={a.done} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: a.done ? C.ink : "rgba(238,244,242,0.7)" }}>{a.name}</div>
            <div style={{ fontSize: 11, color: "rgba(238,244,242,0.55)", lineHeight: 1.5, marginTop: 2 }}>{a.blurb}</div>
          </div>
          {/* The figure only earns its place while it is still moving. Once it is done the seal says
              so, and "1 of 1" beside a struck seal is the same news twice. */}
          {!a.done && a.goal > 1 && (
            <span style={{ fontSize: 12, fontWeight: 700, color: C.gold, flexShrink: 0 }}>{a.count} of {a.goal}</span>
          )}
        </div>
      ))}

      <div style={{ fontSize: 11, color: "rgba(238,244,242,0.5)", lineHeight: 1.6, margin: "2px 0 16px" }}>
        More come as the game grows. Each is worked out from what the hold already keeps, so anything
        you have done counts from the day it is added.
      </div>
      <StartButton onClick={onBack} label="Back to the tallies" />
    </Shell>
  );
}

/**
 * The mark on an achievement: a struck seal when it is earned, the empty ring it is struck into when
 * it is not.
 *
 * Drawn as masses rather than strokes, so it holds at the 20px it runs at here: the earned seal is a
 * filled disc with a notched ribbon under it and a tick knocked out of the body, and the unearned one
 * is the same outline with nothing in it. Neither needs the detail read to say which it is, because
 * the difference is a filled shape against an empty one.
 */
function SealIcon({ done, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      {done ? (
        <>
          <path d="M4.6 9.8 L3.2 14.6 L8 12.6 L12.8 14.6 L11.4 9.8Z" fill={C.grass} opacity="0.75" />
          <circle cx="8" cy="6.6" r="5.2" fill={C.grass} />
          <path d="M5.7 6.7 L7.3 8.3 L10.3 4.9" stroke="#0b3331" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </>
      ) : (
        <>
          <path d="M4.6 9.8 L3.2 14.6 L8 12.6 L12.8 14.6 L11.4 9.8" stroke="rgba(238,244,242,0.3)" strokeWidth="1.2" strokeLinejoin="round" fill="none" />
          <circle cx="8" cy="6.6" r="4.6" stroke="rgba(238,244,242,0.3)" strokeWidth="1.4" fill="none" />
        </>
      )}
    </svg>
  );
}

// A run of tally rows, ruled between. Takes `[label, value]` pairs so a caller can build the list
// conditionally without threading the rule through by hand and getting the first one wrong.
//
// Its labels sit a step brighter than the end screen's, because a card here is nothing but labels:
// there is no prose around them to carry the reading, and a screen of nine dim rows under a bright
// heading reads as a heading with a footnote under it. The end-of-voyage tally keeps the dimmer ink,
// where the labels are a caption on a result the captain is already looking at.
const ROW_LABEL = "rgba(238,244,242,0.8)";

function Rows({ rows }) {
  return rows.map(([label, value], i) => (
    <TallyRow key={label} label={label} value={value} labelColor={ROW_LABEL} rule={i === 0 ? undefined : "hair"} />
  ));
}

function Empty({ children }) {
  return (
    <div style={{ fontSize: 11, color: "rgba(238,244,242,0.6)", padding: "6px 0", lineHeight: 1.6 }}>{children}</div>
  );
}

function ScuttleHold({ onScuttle }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      onClick={() => (armed ? (onScuttle(), setArmed(false)) : setArmed(true))}
      onBlur={() => setArmed(false)}
      style={{ marginTop: 14, fontFamily: UI, fontSize: 10, letterSpacing: 1, color: armed ? C.crew : "rgba(238,244,242,0.35)", background: "transparent", border: "none", padding: 4, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}
    >
      {armed ? "Tap again to scuttle the hold" : "Scuttle the hold"}
    </button>
  );
}

/**
 * THE YARD — what the captain's own ship is, part by part.
 *
 * First screen of the shipyard, and deliberately the reading half of it. Everything here is already
 * worked out by `shipyard.js`: what she rates, what tier that puts her in, what is in every berth,
 * and what she still wants. None of it had anywhere to be shown, and a captain cannot make a decision
 * about a ship she cannot see. Buying and fitting come next, against a design that is still to come;
 * this is the screen they will be built into rather than a placeholder for it.
 *
 * The rig is listed socket by socket from the bow aft, because that is how a ship is rigged and how
 * `masts` reads in the catalogue. An empty socket and an empty berth are both shown rather than
 * skipped: the gaps are the whole point of the screen.
 */
function YardScreen({ hold, onBack, onCommission, onOutfit }) {
  const loadout = useMemo(() => shipLoadout(hold), [hold]);
  const rig = useMemo(() => rigSpec(loadout), [loadout]);
  const stats = useMemo(() => rate(loadout), [loadout]);
  const strength = useMemo(() => measure(stats), [stats]);
  const want = useMemo(() => shortfall(hold), [hold]);
  const rated = rateOf(loadout.hull);

  // Named for the parts rather than for the HUD buttons: this is the shipyard, where a captain is
  // looking at guns she owns, not at the three keys she fires them with.
  const guns = [
    ["Broadside guns, a side", stats.broadside.count, loadout.hull.guns.broadside],
    ["Bow chasers", stats.bow.count, loadout.hull.guns.bow],
    ["Swivel guns", stats.swivel.count, loadout.hull.guns.swivel],
  ];

  return (
    <Shell>
      <BackLink label="Back to the sea" onClick={onBack} />
      <div style={{ fontFamily: DISPLAY, fontSize: 30, color: C.gold, letterSpacing: 1 }}>THE YARD</div>
      <div style={{ fontSize: 12, color: "rgba(238,244,242,0.7)", margin: "6px 0 2px" }}>
        {loadout.hull.name}, {rated.name}, and she measures {Math.round(strength.overall)} as she stands.
      </div>
      <MenuGalleon rig={rig} />

      <Slab title="How she sails">
        <TallyRow label="Top speed" value={stats.speed.toFixed(2)} />
        <TallyRow label="Handling" value={stats.turn.toFixed(2)} rule="hair" />
        <TallyRow label="Hull" value={stats.hull} rule="hair" />
        <TallyRow label="Crew" value={stats.crew} rule="hair" />
        <TallyRow label="Muskets in a volley" value={stats.muskets} rule="hair" />
        {/* What a broadside actually throws, which stops matching the gun count once she bears more
            than ten a side and the guns start firing in stacked columns. Shown only when she has a
            broadside at all, because "0 balls" on a boat with no guns is a row saying nothing. */}
        {stats.broadside.count > 0 && (
          <TallyRow
            label="Broadside balls, a side"
            value={stats.broadside.columns}
            rule="hair"
          />
        )}
      </Slab>

      <Slab title="Her rigging">
        {loadout.hull.sockets.map((socket) => {
          const entry = loadout.rig[socket.id];
          const mast = entry && entry.mast;
          return (
            <div key={socket.id} style={{ borderTop: `1px solid rgba(160,224,210,0.14)`, padding: "7px 0 6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.mast }}>{socket.station.toUpperCase()}</span>
                <span style={{ fontSize: 11, color: mast ? C.ink : "rgba(238,244,242,0.4)" }}>
                  {mast ? mast.name : socket.spar ? "no spar rigged" : "no mast stepped"}
                </span>
              </div>
              {mast &&
                mast.berths.map((berth, i) => {
                  const sail = entry.sails[i];
                  const stud = (entry.studs || [])[i];
                  return (
                    <React.Fragment key={i}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 3, paddingLeft: 10 }}>
                        <span style={{ fontSize: 9, color: "rgba(238,244,242,0.45)" }}>
                          {kindOf(berth.kind)?.name || berth.kind}
                        </span>
                        <span style={{ fontSize: 10, color: sail ? "rgba(238,244,242,0.8)" : "rgba(238,244,242,0.35)" }}>
                          {sail ? sail.name : "bare"}
                        </span>
                      </div>
                      {/* run out beyond the sail above, so it reads as part of that sail's row */}
                      {stud && (
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 2, paddingLeft: 18 }}>
                          <span style={{ fontSize: 9, color: "rgba(238,244,242,0.45)" }}>Studdingsail</span>
                          <span style={{ fontSize: 10, color: "rgba(238,244,242,0.8)" }}>{stud.name}</span>
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
            </div>
          );
        })}
      </Slab>

      <Slab title="Her guns">
        {/* Green once a mount is full, and the ordinary gold otherwise. Colouring a short mount by its
            system read as an alarm: no swivels is not a fault, it is a purchase she has not made. */}
        {guns.map(([label, has, bears], i) => (
          <TallyRow
            key={label}
            label={label}
            value={`${has} of ${bears}`}
            rule={i > 0 ? "hair" : ""}
            valueColor={bears > 0 && has >= bears ? C.grass : undefined}
          />
        ))}
      </Slab>

      {/* What she is short, and what of it is already lying in the hold. The cheapest legal fill is a
          floor, not a recommendation: a pole mast is free and fits any socket. */}
      <Slab title={want.gaps.length ? `She wants ${want.gaps.length} more ${want.gaps.length === 1 ? "part" : "parts"}` : "Fully found"}>
        {want.gaps.length ? (
          <>
            <TallyRow label="Cheapest way to fill her out" value={<Coins n={want.cost} />} />
            <TallyRow
              label="Of those, already in the hold"
              value={want.gaps.filter((g) => g.owned.length).length}
              rule="hair"
            />
          </>
        ) : (
          <div style={{ fontSize: 11, color: "rgba(238,244,242,0.6)", padding: "6px 0", lineHeight: 1.6 }}>
            Every socket stepped, every berth bent on, every port run out.
          </div>
        )}
      </Slab>

      {/* The two shops. They are separate because they are separate decisions: a hull is one large,
          rare purchase and a rig is a dozen small ones, and putting them on one screen would bury the
          second in the first. The yard is the reading half and stays that way; these are the doing. */}
      <div style={{ display: "grid", gap: 10, margin: "4px 0 16px" }}>
        <ShopLink
          title="Boat Commission"
          sub="Buy a hull, and choose the one you sail"
          color={C.gold}
          onClick={onCommission}
        />
        <ShopLink
          title="Rigging Outfitter"
          sub="Masts, sails and guns for the ship you sail"
          color={C.mast}
          onClick={onOutfit}
        />
      </div>
      <StartButton onClick={onBack} label="Back to the sea" />
    </Shell>
  );
}

/** One of the yard's two doors. The whole card is the button, the same way the ship plate is. */
function ShopLink({ title, sub, color, onClick }) {
  const [lit, setLit] = useState(false);
  return (
    <button
      onClick={onClick}
      onPointerEnter={() => setLit(true)}
      onPointerLeave={() => setLit(false)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
        width: "100%", textAlign: "left", padding: "12px 14px",
        borderRadius: 10, border: `1px solid ${lit ? color : C.hair}`, background: C.panel,
        color: C.ink, cursor: "pointer", WebkitTapHighlightColor: "transparent",
      }}
    >
      <span>
        <span style={{ display: "block", fontFamily: DISPLAY, fontSize: 18, color }}>{title}</span>
        <span style={{ display: "block", fontSize: 11, color: "rgba(238,244,242,0.6)", marginTop: 2 }}>{sub}</span>
      </span>
      <ChevronIcon size={12} />
    </button>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* The two shops                                                                                   */
/* ---------------------------------------------------------------------------------------------- */

/**
 * A segmented control: two to four choices, one of them on.
 *
 * Sentence case and sized rather than letterspaced, like every other control in the game. It wraps,
 * because four labels do not fit across a 320px phone and a row that scrolls sideways hides the
 * choice a captain has not thought of yet.
 */
function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "10px 0 2px" }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            style={{
              flex: "1 1 auto", fontFamily: UI, fontSize: 11, fontWeight: on ? 700 : 500,
              color: on ? C.deep : "rgba(238,244,242,0.75)",
              background: on ? C.gold : "transparent",
              border: `1px solid ${on ? C.gold : C.hair}`,
              borderRadius: 20, padding: "7px 12px", cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * WHAT EVERY CLASS IS, worked out once when the module loads rather than on every render.
 *
 * Each row is a real loadout run through the same `rate()` the fight will read, at both ends: bare is
 * one mast, one sail and a chaser, and fully found is the dearest rig she can carry with every port
 * filled. Nothing here is a second set of numbers that can drift from the catalogue's.
 */
const SHELF = HULL_LIST.map((hull) => {
  const found = maximumLoadout(hull.id);
  let berths = 0;
  for (const socket of hull.sockets) {
    const entry = found.rig[socket.id];
    if (entry && entry.mast) berths += entry.mast.berths.length;
  }
  const foundRating = rate(found);
  return {
    hull,
    band: statBand(hull.id),
    rated: rateOf(hull),
    found: foundRating,
    masts: hull.sockets.filter((s) => !s.spar).length,
    berths,
    outfit: outfitCost(hull.id),
  };
});
const shelfOf = (hullId) => SHELF.find((s) => s.hull.id === hullId);

// How the shelf can be arranged. Four, because a captain shopping for a hull is asking one of four
// different questions and the answer to "what can I afford" is a different list from "what can I
// crew". Price runs through all of them as the tie-break, so every group climbs the same way.
const SHELVING = [
  { key: "price", label: "All by price" },
  { key: "purse", label: "Price range" },
  { key: "masts", label: "Masts" },
  { key: "canvas", label: "Sails needed" },
];

const PURSE_BANDS = [
  { title: "Under 1,000 coins", has: (s) => s.hull.price < 1000 },
  { title: "1,000 to 10,000", has: (s) => s.hull.price >= 1000 && s.hull.price < 10000 },
  { title: "10,000 to 50,000", has: (s) => s.hull.price >= 10000 && s.hull.price < 50000 },
  { title: "Over 50,000", has: (s) => s.hull.price >= 50000 },
];
const MAST_BANDS = [1, 2, 3, 4].map((n) => ({
  title: `${n} mast${n === 1 ? "" : "s"}`,
  has: (s) => s.masts === n,
}));
// What it takes to bend canvas on her, which is the question "sail types" was really asking: a hull
// with seventeen berths costs a fortune to fill however cheap she was to buy. Which CATEGORIES she
// wants is not a fact about the hull at all, because the mast a captain steps decides it.
const CANVAS_BANDS = [
  { title: "1 or 2 sails", lo: 1, hi: 2 },
  { title: "3 to 5 sails", lo: 3, hi: 5 },
  { title: "6 to 9 sails", lo: 6, hi: 9 },
  { title: "10 to 14 sails", lo: 10, hi: 14 },
  { title: "15 sails and over", lo: 15, hi: 999 },
].map((b) => ({ title: b.title, has: (s) => s.berths >= b.lo && s.berths <= b.hi }));

function shelve(how) {
  const byPrice = SHELF.slice().sort((a, b) => a.hull.price - b.hull.price || a.hull.order - b.hull.order);
  if (how === "price") return [{ title: "", ships: byPrice }];
  const bands = how === "purse" ? PURSE_BANDS : how === "masts" ? MAST_BANDS : CANVAS_BANDS;
  return bands
    .map((b) => ({ title: b.title, ships: byPrice.filter(b.has) }))
    .filter((g) => g.ships.length);
}

/**
 * THE BOAT COMMISSION: the hull shop.
 *
 * A hull is the one purchase in the game a captain saves for, so the shelf leads with what she costs
 * and every row opens on what she would be. The figures are the two ends of her: bare, which is what
 * the coins actually buy, and fully found, which is what she becomes after the outfitter has had the
 * rest of the money. Both are worth seeing before committing, because the gap between them is the
 * real price of a big hull.
 */
function CommissionScreen({ hold, onBack }) {
  const [how, setHow] = useState("price");
  const [open, setOpen] = useState(null);
  const groups = useMemo(() => shelve(how), [how]);
  const fleet = ownedShips(hold);
  const owned = new Set(fleet.map((s) => s.hull));

  const commission = (hullId) => {
    const bought = buyShip(hullId);
    // She becomes the ship you sail. Leaving the old one active would point the outfitter at the
    // wrong hull and hide the new one entirely, and the list below switches back in one tap.
    if (bought) setActiveShip(bought.ship);
  };

  return (
    <Shell>
      <BackLink label="Back to the yard" onClick={onBack} />
      <div style={{ fontFamily: DISPLAY, fontSize: 30, color: C.gold, letterSpacing: 1 }}>BOAT COMMISSION</div>
      <PurseLine hold={hold} />

      <Segmented options={SHELVING} value={how} onChange={setHow} />

      {groups.map((g) => (
        <Slab key={g.title || "all"} title={g.title || `${g.ships.length} classes, cheapest first`}>
          {g.ships.map((s, i) => (
            <HullRow
              key={s.hull.id}
              shelf={s}
              first={i === 0}
              owned={owned.has(s.hull.id)}
              coins={hold.coins}
              open={open === s.hull.id}
              onToggle={() => setOpen(open === s.hull.id ? null : s.hull.id)}
              onBuy={() => commission(s.hull.id)}
            />
          ))}
        </Slab>
      ))}

      <Slab title={`Your ships (${fleet.length})`}>
        {fleet.map((ship, i) => {
          const active = hold.yard.active === ship.id;
          return (
            <div key={ship.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "7px 0", borderTop: i ? "1px solid rgba(160,224,210,0.14)" : "none" }}>
              <span style={{ fontSize: 12, color: active ? C.gold : C.ink }}>
                {HULLS[ship.hull] ? HULLS[ship.hull].name : ship.hull}
              </span>
              {active ? (
                <span style={{ fontSize: 10, color: "rgba(238,244,242,0.5)" }}>the ship you sail</span>
              ) : (
                <TinyButton label="Sail her" onClick={() => setActiveShip(ship.id)} />
              )}
            </div>
          );
        })}
      </Slab>

      <StartButton onClick={onBack} label="Back to the yard" />
      <div style={{ height: 8 }} />
    </Shell>
  );
}

/** The purse, on its own line under a shop's title, because every price below is read against it. */
function PurseLine({ hold }) {
  return (
    <div style={{ fontSize: 12, color: "rgba(238,244,242,0.7)", margin: "6px 0 0" }}>
      In the hold: <span style={{ color: C.gold, fontWeight: 700 }}><Coins n={hold.coins} /></span>
    </div>
  );
}

/**
 * One class on the shelf, which opens on her figures.
 *
 * Closed it is a name, a price and the one line that decides whether to look further. Open it is the
 * whole stat line, both ends of it, and the button. An accordion rather than a screen of its own
 * because a captain comparing two classes should not have to leave the list to do it.
 */
function HullRow({ shelf, first, owned, coins, open, onToggle, onBuy }) {
  const { hull, band } = shelf;
  const afford = coins >= hull.price;
  /* Handling is the one stat that runs BACKWARDS: fully found, under a press of canvas with every
     port filled, she is stiffer on the helm than she was bare. Printed as a plain range that reads
     as a mistake, so a falling stat says which way it goes. */
  const range = (key, dp = 0) => {
    const b = band[key];
    const f = (v) => (dp ? v.toFixed(dp) : Math.round(v));
    if (b.low === b.high) return `${f(b.low)}`;
    return `${f(b.bare)} ${b.rises ? "to" : "down to"} ${f(b.found)}`;
  };
  return (
    <div style={{ borderTop: first ? "none" : "1px solid rgba(160,224,210,0.14)" }}>
      <button
        onClick={onToggle}
        style={{
          display: "flex", width: "100%", alignItems: "baseline", justifyContent: "space-between", gap: 8,
          background: "transparent", border: "none", padding: "8px 0", textAlign: "left",
          color: C.ink, cursor: "pointer", WebkitTapHighlightColor: "transparent",
        }}
      >
        <span>
          <span style={{ fontSize: 13, color: open ? C.gold : C.ink }}>{hull.name}</span>
          <span style={{ display: "block", fontSize: 10, color: "rgba(238,244,242,0.5)", marginTop: 2 }}>
            {plural(shelf.masts, "mast")}, {plural(shelf.berths, "sail")}, {plural(hull.guns.broadside, "gun")} a side
            {owned ? ", one in your yard" : ""}
          </span>
        </span>
        <span style={{ fontSize: 12, color: afford ? C.gold : "rgba(238,244,242,0.35)", whiteSpace: "nowrap" }}>
          {hull.price === 0 ? "free" : <Coins n={hull.price} />}
        </span>
      </button>

      {open && (
        <div style={{ padding: "2px 0 10px" }}>
          <div style={{ fontSize: 10, color: "rgba(238,244,242,0.45)", lineHeight: 1.6, marginBottom: 4 }}>
            Two figures where she changes: what she is bare, and what she becomes fully found.
          </div>
          <TallyRow label="Hull" value={range("hull")} />
          <TallyRow label="Crew" value={range("crew")} rule="hair" />
          <TallyRow label="Top speed" value={range("speed", 2)} rule="hair" />
          <TallyRow label="Handling" value={range("turn", 2)} rule="hair" />
          <TallyRow label="Broadside guns, a side" value={range("broadside")} rule="hair" />
          <TallyRow label="Bow chasers" value={range("bow")} rule="hair" />
          <TallyRow label="Swivel guns" value={range("swivel")} rule="hair" />
          <TallyRow label="Muskets in a volley" value={range("muskets")} rule="hair" />
          <TallyRow label="Broadside balls, a side" value={shelf.found.broadside.columns} rule="hair" />
          <TallyRow label="Rated" value={shelf.rated.name} rule="group" />
          <TallyRow label="Rigging and guns to fill her out" value={<Coins n={shelf.outfit} />} rule="hair" />
          <div style={{ marginTop: 10 }}>
            <WideButton
              label={hull.price === 0 ? "Commission her" : <span>Commission her for <Coins n={hull.price} /></span>}
              disabled={!afford}
              onClick={onBuy}
            />
            {!afford && (
              <div style={{ fontSize: 10, color: "rgba(238,244,242,0.45)", marginTop: 6 }}>
                Short by {fmtCoins(hull.price - coins)}.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * THE RIGGING OUTFITTER: masts, sails and guns for the ship she is sailing.
 *
 * One screen with a toggle at the head of it rather than two, because rigging and arming are the same
 * job done in one visit: a captain filling out a new hull moves between them a dozen times, and two
 * doors off the yard would make her walk back through it every time.
 *
 * Everything works on the ACTIVE ship. Which one that is comes from the Boat Commission, and the line
 * under the title says so, because fitting a topsail to a hull you are not sailing is the one mistake
 * this screen could invite.
 */
function OutfitterScreen({ hold, onBack }) {
  const [view, setView] = useState("rigging");
  const [picking, setPicking] = useState(null);
  const shipId = hold.yard.active;
  const loadout = useMemo(() => shipLoadout(hold), [hold]);

  // What she owns and has not fitted, counted by type, so the picker can offer "one in the hold"
  // ahead of "one in the shop" and a captain never buys a second of something she already has.
  const loose = useMemo(() => {
    const byType = new Map();
    for (const pid of loosePartIds(hold)) {
      const type = partOf(hold, pid);
      if (!type) continue;
      const list = byType.get(type.id) || [];
      list.push(pid);
      byType.set(type.id, list);
    }
    return byType;
  }, [hold]);

  const close = () => setPicking(null);
  const fitFrom = (typeId, fit) => {
    const held = loose.get(typeId);
    if (held && held.length) return fit(held[0]);
    const bought = buyPart(typeId);
    if (bought) fit(bought.part);
  };

  return (
    <Shell>
      <BackLink label="Back to the yard" onClick={onBack} />
      <div style={{ fontFamily: DISPLAY, fontSize: 30, color: C.gold, letterSpacing: 1 }}>RIGGING OUTFITTER</div>
      <div style={{ fontSize: 12, color: "rgba(238,244,242,0.7)", margin: "6px 0 0" }}>
        Fitting out your {loadout.hull.name.toLowerCase()}.
      </div>
      <PurseLine hold={hold} />

      <Segmented
        options={[{ key: "rigging", label: "Masts and sails" }, { key: "guns", label: "Guns" }]}
        value={view}
        onChange={(v) => { setView(v); close(); }}
      />

      {view === "rigging" &&
        loadout.hull.sockets.map((socket) => {
          const entry = loadout.rig[socket.id];
          const mast = entry && entry.mast;
          return (
            <Slab key={socket.id} title={`${socket.station.toUpperCase()}, ${socket.size}`}>
              <FitRow
                label={socket.spar ? "Spar" : "Mast"}
                value={mast ? mast.name : socket.spar ? "no spar rigged" : "no mast stepped"}
                empty={!mast}
                onClick={() => setPicking({ what: "mast", socket: socket.id })}
              />
              {mast &&
                mast.berths.map((berth, i) => {
                  const sail = entry.sails[i];
                  // a square sail that takes one gets a studdingsail row of its own under it: the
                  // stud hangs off the sail, so the row only exists while the sail does
                  const stud = (entry.studs || [])[i];
                  const takesStud = sail && studsForBerth(mast, i).length > 0;
                  return (
                    <React.Fragment key={i}>
                      <FitRow
                        indent
                        label={kindOf(berth.kind)?.name || berth.kind}
                        value={sail ? sail.name : "bare"}
                        empty={!sail}
                        onClick={() => setPicking({ what: "sail", socket: socket.id, berth: i })}
                      />
                      {takesStud && (
                        <FitRow
                          indent
                          label="Studdingsail"
                          value={stud ? stud.name : "none run out"}
                          empty={!stud}
                          onClick={() => setPicking({ what: "stud", socket: socket.id, berth: i })}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              {picking && picking.socket === socket.id && (
                <Picker
                  title={
                    picking.what === "mast"
                      ? socket.spar ? "Spars that fit" : "Masts that fit"
                      : picking.what === "stud"
                        ? "Studdingsails that boom out from this sail"
                        : "Sails that fit"
                  }
                  options={
                    picking.what === "mast"
                      ? mastsForSocket(socket)
                      : picking.what === "stud"
                        ? studsForBerth(mast, picking.berth)
                        : sailsForBerth(mast.berths[picking.berth])
                  }
                  fitted={
                    picking.what === "mast" ? mast
                      : picking.what === "stud" ? (entry.studs || [])[picking.berth]
                      : entry.sails[picking.berth]
                  }
                  removeLabel={
                    picking.what === "mast"
                      ? socket.spar ? "Unrig the spar" : "Take the mast down"
                      : picking.what === "stud" ? "Take it in"
                      : "Take the sail off"
                  }
                  loose={loose}
                  coins={hold.coins}
                  onRemove={() => {
                    if (picking.what === "mast") fitMast(shipId, socket.id, null);
                    else if (picking.what === "stud") fitStud(shipId, socket.id, picking.berth, null);
                    else fitSail(shipId, socket.id, picking.berth, null);
                    close();
                  }}
                  onPick={(type) => {
                    fitFrom(type.id, (pid) => {
                      if (picking.what === "mast") fitMast(shipId, socket.id, pid);
                      else if (picking.what === "stud") fitStud(shipId, socket.id, picking.berth, pid);
                      else fitSail(shipId, socket.id, picking.berth, pid);
                    });
                    close();
                  }}
                  onClose={close}
                />
              )}
            </Slab>
          );
        })}

      {view === "guns" &&
        GUN_MOUNTS.map(({ mount, title, note }) => {
          const bears = loadout.hull.guns[mount];
          const shipRec = hold.yard.ships[shipId];
          // Walked off the RECORD rather than off the resolved loadout, so the id taken off the rail
          // is the id in the slot the captain tapped. `resolve()` drops a part the catalogue no
          // longer knows, which would shift every index after it and unfit the wrong gun.
          const fitted = shipRec.guns[mount].map((pid) => ({ pid, type: partOf(hold, pid) })).filter((g) => g.type);
          return (
            <Slab key={mount} title={`${title}, ${fitted.length} of ${bears}`}>
              {bears === 0 ? (
                <div style={{ fontSize: 11, color: "rgba(238,244,242,0.5)", padding: "6px 0" }}>
                  She has no ports for these.
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 10, color: "rgba(238,244,242,0.45)", lineHeight: 1.6, paddingBottom: 2 }}>{note}</div>
                  {fitted.map(({ pid, type }) => (
                    <div key={pid} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid rgba(160,224,210,0.14)" }}>
                      <span style={{ fontSize: 11, color: C.ink }}>{type.name}</span>
                      <TinyButton label="Take it off" onClick={() => unfitGun(shipId, pid)} />
                    </div>
                  ))}
                  {fitted.length < bears && (
                    <FitRow
                      label="Another gun"
                      value={`${plural(bears - fitted.length, "port")} still empty`}
                      empty
                      onClick={() => setPicking({ what: "gun", mount })}
                    />
                  )}
                  {picking && picking.what === "gun" && picking.mount === mount && (
                    <Picker
                      title="Guns for this mount"
                      options={gunsForMount(mount)}
                      loose={loose}
                      coins={hold.coins}
                      onPick={(type) => {
                        fitFrom(type.id, (pid) => fitGun(shipId, mount, pid));
                        close();
                      }}
                      onClose={close}
                    />
                  )}
                </>
              )}
            </Slab>
          );
        })}

      <StartButton onClick={onBack} label="Back to the yard" />
      <div style={{ height: 8 }} />
    </Shell>
  );
}

// The three mounts, and what each is for. A captain buying her first gun should not have to work out
// from the name which of them puts iron into a hull.
const GUN_MOUNTS = [
  { mount: "broadside", title: "Broadside", note: "Counted a side and mirrored: one gun bought is one gun each side. These hole a hull." },
  { mount: "bow", title: "Bow chasers", note: "They point where the bow points, and aimed high they bring a rig down." },
  { mount: "swivel", title: "Swivels", note: "On the rail, one hand to a gun. Each one adds a ball to the musket volley." },
];

/** A slot in the outfitter: what is in it, and a tap to change it. */
function FitRow({ label, value, empty, indent, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", width: "100%", alignItems: "baseline", justifyContent: "space-between", gap: 8,
        background: "transparent", border: "none", borderTop: "1px solid rgba(160,224,210,0.14)",
        padding: "8px 0", paddingLeft: indent ? 10 : 0, textAlign: "left",
        color: C.ink, cursor: "pointer", WebkitTapHighlightColor: "transparent",
      }}
    >
      <span style={{ fontSize: indent ? 9 : 11, color: "rgba(238,244,242,0.5)" }}>{label}</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: indent ? 10 : 11, color: empty ? "rgba(238,244,242,0.4)" : C.ink }}>{value}</span>
        <ChevronIcon size={9} />
      </span>
    </button>
  );
}

/**
 * What could go in a slot, in one list: what she already owns first, then what the shop sells.
 *
 * A part in the hold is free to fit and a part in the shop is not, and that is the whole difference,
 * so they are one list with different right-hand ends rather than two lists a captain has to compare.
 * Spare rigging off a ship she no longer sails is the reason instances move at all, and this is where
 * that pays off.
 */
function Picker({ title, options, fitted, removeLabel, loose, coins, onPick, onRemove, onClose }) {
  return (
    <div style={{ borderTop: `1px solid ${C.hair}`, marginTop: 6, paddingTop: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, paddingBottom: 2 }}>
        <span style={{ fontSize: 10, letterSpacing: 1, color: C.gold }}>{title}</span>
        <TinyButton label="Close" onClick={onClose} />
      </div>
      {fitted && onRemove && (
        <div style={{ padding: "6px 0", borderTop: "1px solid rgba(160,224,210,0.14)" }}>
          <TinyButton label={removeLabel} onClick={onRemove} />
        </div>
      )}
      {options.map((type) => {
        const held = (loose.get(type.id) || []).length;
        const afford = held > 0 || coins >= type.price;
        return (
          <button
            key={type.id}
            onClick={() => afford && onPick(type)}
            style={{
              display: "flex", width: "100%", alignItems: "baseline", justifyContent: "space-between", gap: 8,
              background: "transparent", border: "none", borderTop: "1px solid rgba(160,224,210,0.14)",
              padding: "8px 0", textAlign: "left", cursor: afford ? "pointer" : "default",
              opacity: afford ? 1 : 0.45, WebkitTapHighlightColor: "transparent",
            }}
          >
            <span>
              <span style={{ display: "block", fontSize: 11, color: C.ink }}>{type.name}</span>
              <span style={{ display: "block", fontSize: 9, color: "rgba(238,244,242,0.45)", marginTop: 2 }}>
                {partLine(type)}
              </span>
            </span>
            <span style={{ fontSize: 11, color: held ? C.grass : afford ? C.gold : "rgba(238,244,242,0.4)", whiteSpace: "nowrap" }}>
              {held ? `${held} in the hold` : type.price === 0 ? "free" : <Coins n={type.price} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// The figures that decide between two parts of the same sort, and no others. A mast is chosen for
// what it can carry, a sail for what it pulls and what it costs the helm, a gun for what it throws
// and how fast.
function partLine(type) {
  if (type.part === "mast") {
    return `${type.berths.length} sail${type.berths.length === 1 ? "" : "s"}: ${type.berths.map((b) => kindOf(b.kind)?.name || b.kind).join(", ")}`;
  }
  if (type.part === "sail") {
    const helm = type.hand >= 0 ? `helps the helm by ${type.hand.toFixed(2)}` : `stiffens the helm by ${Math.abs(type.hand).toFixed(2)}`;
    // a studdingsail's drive is a share of the sail it booms out from, not of a course
    if (type.kind === "STU") return `adds ${type.drive.toFixed(2)} of the sail it extends, ${helm}`;
    return `pulls ${type.drive.toFixed(2)} of a course, ${helm}`;
  }
  // a swivel's grouping is the other half of what quality buys, so a tighter one says so
  const group = type.group != null && type.group < 1 ? `, groups ${Math.round((1 - type.group) * 100)}% tighter than a musket` : "";
  return `${type.damage} damage every ${type.reload.toFixed(2)}s, weighs ${type.weight.toFixed(2)}${group}`;
}

// "1 sails" is the sort of thing that makes a screen look unfinished, and this shelf counts four
// different things.
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A small inline action inside a slab: a link that is a button, not a control that competes. */
function TinyButton({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: UI, fontSize: 10, color: C.gold, background: "transparent",
        border: `1px solid ${C.hair}`, borderRadius: 20, padding: "4px 10px",
        cursor: "pointer", WebkitTapHighlightColor: "transparent",
      }}
    >
      {label}
    </button>
  );
}

/** The one action a screen is for, full width under what it acts on. */
function WideButton({ label, onClick, disabled }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        display: "block", width: "100%", fontFamily: UI, fontSize: 13, fontWeight: 700,
        color: disabled ? "rgba(238,244,242,0.4)" : C.deep,
        background: disabled ? "transparent" : C.gold,
        border: `1px solid ${disabled ? C.hair : C.gold}`,
        borderRadius: 10, padding: "11px 14px",
        cursor: disabled ? "default" : "pointer", WebkitTapHighlightColor: "transparent",
      }}
    >
      {label}
    </button>
  );
}

// A titled group inside the shell. The end screen's tally uses the same rules and radius, so the two
// screens read as one game rather than two.
//
// `centred` is for a screen that is nothing but slabs. The yard's headings sit over a list they
// introduce and belong at its left margin; the log's are the only thing telling one card from the
// next, so they are centred and set in full ink to read as the heading of a section rather than as
// the first line of it. Full ink is what the button above them uses, which is the brightest thing on
// that screen that is not a figure, and the headings are its equals.
function Slab({ title, children, centred }) {
  return (
    <div style={{ background: "rgba(11,51,49,0.6)", border: `1px solid ${C.hair}`, borderRadius: 10, padding: "8px 12px 10px", margin: "12px 0", textAlign: "left" }}>
      <div
        style={{
          fontSize: 10, letterSpacing: 1, marginBottom: 2,
          color: centred ? C.ink : "rgba(238,244,242,0.55)",
          textAlign: centred ? "center" : "left",
          padding: centred ? "2px 0 5px" : 0,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

const Coins = ({ n }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
    <CoinIcon size={12} />
    {fmtCoins(n)}
  </span>
);

/**
 * The ship on the menu, framed as the control it now is.
 *
 * She was decoration: a ship turning under the title, and nothing you could do with her. She is also
 * the only picture of the captain's own ship anywhere in the game, which makes her the obvious way in
 * to the yard, and a turning ship that does nothing when tapped is a worse answer than a still one.
 *
 * So she gets a frame, her class named in the corner and a line under her saying what tapping does.
 * The name is set in the display face rather than as a small bold label, because it is the name of a
 * ship and the game already sets its proper nouns that way: it reads as a plate on her transom
 * instead of a caption. The instruction goes underneath and centred, where it reads as a footer to
 * the whole picture rather than as a second thing competing with the name for the top line.
 *
 * The whole plate is one button. A frame you have to hit the middle of is a frame that feels broken
 * on a phone, and the ship inside it is a canvas with transparent corners.
 */
function ShipPlate({ loadout, rig, onEdit }) {
  const [lit, setLit] = useState(false);
  return (
    <button
      onClick={onEdit}
      onPointerEnter={() => setLit(true)}
      onPointerLeave={() => setLit(false)}
      style={{
        display: "block", width: "100%", margin: "10px 0 0", padding: "8px 10px 9px",
        borderRadius: 10, border: `1px solid ${lit ? C.gold : C.hair}`, background: C.panel,
        color: C.ink, cursor: "pointer", WebkitTapHighlightColor: "transparent",
      }}
    >
      <div style={{ textAlign: "left", lineHeight: 1.1 }}>
        <span style={{ fontFamily: DISPLAY, fontSize: 17, color: C.gold, letterSpacing: 0.4 }}>{loadout.hull.name}</span>
      </div>
      <MenuGalleon rig={rig} />
      {/* MenuGalleon carries a -6px bottom margin to tuck itself up under whatever follows, so this
          pays that back before spacing itself off her keel. */}
      <div style={{ textAlign: "center", paddingTop: 14, fontSize: 10, letterSpacing: 0.5, color: lit ? C.gold : "rgba(232,200,119,0.72)" }}>
        Tap to edit
      </div>
    </button>
  );
}

function StartOverlay({ onStart, onEdit, onRecords, hold, onScuttle }) {
  // What she is sailing, resolved from the hold every time it changes.
  const loadout = useMemo(() => shipLoadout(hold), [hold]);
  const rig = useMemo(() => rigSpec(loadout), [loadout]);
  return (
    <Shell>
      {/* The name is a lockup of two lines, and the first one carries it. STERNCHASE is the word a
          captain says; HELM & HULL sits under it at a third the size, in the same gold run dim, so
          the pair reads as one title rather than as a title and a tagline competing for the eye. */}
      {/* 44px is the size the title wants, but STERNCHASE at 44 measures wider than the 272px a
          320px phone leaves inside the shell's padding, and the last letter went off the screen.
          It gives size back on a narrow screen rather than being set small everywhere. */}
      <div style={{ fontFamily: DISPLAY, fontSize: "clamp(34px, 12vw, 44px)", color: C.gold, letterSpacing: 2, lineHeight: 1.05 }}>STERNCHASE</div>
      <div style={{ fontFamily: DISPLAY, fontSize: 15, color: "rgba(232,200,119,0.62)", letterSpacing: 3, marginTop: 4 }}>HELM &amp; HULL</div>
      <ShipPlate loadout={loadout} rig={rig} onEdit={onEdit} />
      <HoldPanel hold={hold} onRecords={onRecords} />
      {/* No prompt over the modes. Three named cards under the game's own title are visibly the
          choice, and a line telling you to choose is the kind of thing only a template asks for. */}
      <div style={{ height: 14 }} />
      {MODE_LIST.map((key) => {
        const m = MODES[key];
        return <ModeCard key={key} color={m.color} title={m.title} desc={m.desc} onClick={() => onStart(key)} />;
      })}
      <div style={{ marginTop: 16, fontSize: 11, color: "rgba(238,244,242,0.5)", lineHeight: 1.6 }}>
        Stick to sail. Your side guns hit the hull, the bow gun brings down the mast, muskets clear
        the crew. Rams can pack a punch.
      </div>
      {hold.lifetime.runs > 0 && <ScuttleHold onScuttle={onScuttle} />}
    </Shell>
  );
}

function ModeCard({ color, title, desc, onClick }) {
  return (
    <button onClick={onClick} style={{ display: "block", width: "100%", textAlign: "left", borderRadius: 10, border: `1px solid ${color}`, background: "rgba(13,58,56,0.85)", color: C.ink, padding: "14px 16px", marginBottom: 12, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
      <div style={{ fontFamily: DISPLAY, fontSize: 20, color, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: "rgba(238,244,242,0.78)", lineHeight: 1.5 }}>{desc}</div>
    </button>
  );
}

// One row of the end-of-voyage tally. `rule` draws the line above it: "hair" inside a group, "group"
// where one group ends and the next begins.
function TallyRow({ label, value, rule, labelColor, valueColor, valueSize, valueWeight }) {
  return (
    // A group break gets air as well as a brighter rule. The two line weights alone are 0.20 against
    // 0.14 and read as the same line, so the space is what actually separates the sections.
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: rule === "group" ? "11px 0 6px" : "6px 0", borderTop: rule ? `1px solid ${rule === "group" ? C.hair : "rgba(160,224,210,0.14)"}` : "none" }}>
      <span style={{ fontSize: 11, color: labelColor || "rgba(238,244,242,0.6)", letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: valueSize || 13, color: valueColor || C.gold, fontWeight: valueWeight || 700 }}>{value}</span>
    </div>
  );
}

function EndOverlay({ title, titleColor, result, stats, mode, place, hold, banked, onAgain, onMenu }) {
  const rules = modeOf(mode);

  // How she sailed.
  const statRows = [];
  if (rules.ranked && place) statRows.push(["Placement", `#${place.rank} of ${place.total}`]);
  statRows.push(["Time survived", fmtTime(stats.time)]);
  statRows.push(["Ships sunk", stats.kills]);
  statRows.push(["Damage dealt", stats.dmg]);
  statRows.push(rules.repairs ? ["Repairs bought", stats.patches || 0] : ["Rams landed", stats.rams || 0]);

  // What she was paid, kept apart from the stats and put directly above the total it makes, so the
  // column adds up on the page. "Coins earned" used to sit up among the stats, three rows from its
  // own subtotal, and named as though it were the lot when it was only what the guns took.
  //
  // The carpenter's bill is the one row that goes the other way, and it belongs here rather than
  // among the stats for exactly that reason: it is the last thing between what she took and what she
  // keeps, and a captain should be able to read straight down the column and see where the money
  // went. It is drawn in the same red as a sunk ship, and it is only shown when there is one.
  const payRows = [["From fighting", `+${fmtCoins(stats.coins)}`, null]];
  if (rules.timeCoins > 0) payRows.push(["For time at sea", `+${fmtCoins(stats.timePay)}`, null]);
  if (stats.winPay > 0) payRows.push(["For winning", `+${fmtCoins(stats.winPay)}`, null]);
  if (stats.repaired > 0) payRows.push(["Paid to the carpenter", `-${fmtCoins(stats.repaired)}`, C.crew]);
  return (
    <Shell>
      <div style={{ fontFamily: DISPLAY, fontSize: 40, color: titleColor, letterSpacing: 1 }}>{title}</div>
      <div style={{ fontSize: 13, color: "rgba(238,244,242,0.85)", margin: "10px 0 14px", lineHeight: 1.6 }}>{result}</div>
      <div style={{ background: "rgba(11,51,49,0.6)", border: `1px solid ${C.hair}`, borderRadius: 10, padding: "6px 12px", marginBottom: 18, textAlign: "left" }}>
        {statRows.map(([l, v], i) => <TallyRow key={l} label={l} value={v} rule={i > 0 ? "hair" : ""} />)}
        {payRows.map(([l, v, col], i) => <TallyRow key={l} label={l} value={v} valueColor={col} rule={i === 0 ? "group" : "hair"} />)}
        {/* The voyage is over and the ship's purse with it; this is the part that sails on. */}
        <TallyRow label="Into the hold" value={`+${fmtCoins(banked)}`} rule="group"
          valueColor={banked > 0 ? C.grass : "rgba(238,244,242,0.5)"} />
        <TallyRow label="Hold total" value={<span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><CoinIcon size={15} />{fmtCoins(hold.coins)}</span>} valueSize={15} valueWeight={800} />
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        <StartButton onClick={onAgain} label="Rematch" />
        <StartButton onClick={onMenu} label="Menu" ghost />
      </div>
    </Shell>
  );
}

function StartButton({ onClick, label, ghost }) {
  return (
    <button onClick={onClick} style={{ fontFamily: UI, fontSize: 14, letterSpacing: 0.5, fontWeight: 700, color: ghost ? C.gold : C.deep, background: ghost ? "transparent" : C.gold, border: ghost ? `1px solid ${C.gold}` : "none", borderRadius: 10, padding: "12px 22px", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
      {label}
    </button>
  );
}

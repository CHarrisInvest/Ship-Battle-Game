/**
 * THE FIRST RATE, MODELLED BY HAND. A 100-gun three-decker, about 186 ft on the gun deck and 52 ft
 * in the beam: three tiers of ports, a quarterdeck, a poop and a forecastle, a windowed stern with
 * two open balconies and side galleries round her quarters, and a full ship rig of up to four square
 * sails on the fore and main, a mizzen that crosses up to four with a spanker under them, and two
 * headsails on her jib-boom.
 *
 * This file is hers alone. Everything about her shape (the form, the deck heights, the breaks, the
 * tiers of ports, the stern, the masts and their yards) is a figure here, and changing one changes
 * nobody else; what she is built with (sweeps, baking, the materials, the sails) is the toolkit in
 * `kit.js`, which every bespoke class shares. A second class starts by copying this file and
 * changing her figures, never by changing the kit to suit her.
 *
 * WHAT SHE SHOWS COMES OFF HER RIG SPEC, like every ship in the game (`rigSpec` in shipyard.js):
 *   - each mast's `berths` says how tall it stands, as the file's "2, 3 or 4 sails": the fore and
 *     main count their square berths, the mizzen counts hers above the spanker's;
 *   - each filled berth is a sail set, and an empty one is a yard crossed bare, so a captain sees
 *     exactly the canvas she bought (every one of the 15 ways to fill four berths draws);
 *   - a spanker is the mizzen's gaff berth filled, and the headsails are the bowsprit's;
 *   - `guns` is her fitted broadside a side: she arms from the lowest deck up, an armed port is an
 *     open one with a barrel run out and, on the open decks, a gun on its carriage, and an unarmed
 *     port is shut, its lid painted on.
 *
 * Units are metres, X toward the bow, Y up from the waterline, Z to starboard; the registry scales
 * her to the menu and to her length at sea. Her length and beam below are what the reference row's
 * `drawnLength` and `drawnBeam` carry, so her collision ellipse at sea is as wide as her planking.
 */

import * as THREE from "three";
import {
  P, MARK, BAND, ROPE, col, ss, clamp01, lerp, V3, V2, UP, prng, roundRect, canvas, toTex,
  gridGeo, facing, placeGeo, rodGeo, rodCapB, boxGeo, frameBox, boxTop, frameBoxTop, NO_UNDERSIDE, sphereGeo,
  sweepGeo, keepFaces, deckBox, latheGeo, groupGeo, mergeGeos, mergeGroups, bakeGeos, fitAdd,
  shade, trimToken, sailBook, railing, lineGeo, DECK_TILE,
} from "./kit.js";

/* ---- what she is ------------------------------------------------------------------------------ */

/** Her figures the registry and the reference row read: stem to stern at the rail, and extreme beam. */
export const FIRST_RATE = { id: "firstRate", length: 58.7, beam: 15.8 };

/** The material slots her meshes index: the toolkit's solid batch, her painted hull, her decks, her sails. */
export const SLOT = { solid: 0, hull: 1, deck: 2, sail: 3 };

/* ---- hull form --------------------------------------------------------------------------------- */
// Waterline at y = 0, bow toward +x, starboard toward +z. Heights are "sheer-relative": measured at
// the lowest point of the sheer, then lifted by the sheer toward bow and stern, so every deck, wale
// and row of ports rises toward the ends together while the keel and the waterline stay straight.
// The upper sides lean inward (tumblehome), the bow is full and round, and the counter overhangs the
// sternpost. Draught 25 ft (7.6 m) to the underside of the keel, a first rate stored for sea. The
// form was first drawn to a 6.4 m keel (Y_FORM); deep() stretches only what lies more than 1.5 m
// under water down to the new keel, so every part of the hull that can be seen keeps its shape.
const HB = 7.9, Y_KEEL = -7.6, Y_FORM = -6.4, Y_DEEP = -1.5, Y_MAXB = 2.8, KEEL_HALF = 0.3;
// The painted sides stop at Y_CUT; what lies under it is built in plain copper (`underBody`), which
// the opaque sea hides until she heels, lists or goes down.
const Y_CUT = -2.4;
const deep = (Y) => (Y >= Y_DEEP ? Y : Y_DEEP + (Y - Y_DEEP) * (Y_DEEP - Y_FORM) / (Y_DEEP - Y_KEEL));
const D_LD = 1.05, D_MD = 3.2, D_UD = 5.35, D_QD = 7.5, D_POOP = 9.55; // lower, middle, upper gun decks, quarterdeck, poop
const R_WAIST = 8.15, R_QD = 9.1, R_POOP = 10.65; // top of the side: waist, quarterdeck and forecastle, poop
const X_POOP = -12.4, X_QD = 2.4, X_FC = 15.6; // forward edge of the poop and quarterdeck; after edge of the forecastle
const sheer = (x) => (x > -1.5 ? 1.15 * Math.pow((x + 1.5) / 30, 2) : 0.9 * Math.pow((-1.5 - x) / 28.5, 2));
const yOf = (x, Y) => Y + sheer(x) * ss(-1.2, 2.2, Y);
// stem: a rounded forefoot sweeping up into a stem that rakes gently forward
const xStem = (Y) => { const Rf = 5.2, k = clamp01((Y_FORM + Rf - deep(Y)) / Rf); return 28.1 + 0.05 * Y - Rf * (1 - Math.sqrt(1 - k * k)); };
// stern: an upright sternpost, then the counter sweeping aft from the tuck to the wing transom, then raking aft
const Y_TUCK = -1.0, Y_WING = 2.6;
const xPost = (Y) => -26.5 - 0.05 * (Y - Y_FORM);
const xAft = (Y) => xPost(Y) - 2.1 * ss(Y_TUCK, Y_WING, Y) - 0.16 * Math.max(0, Y - Y_WING);
const xAt = (t, Y) => xAft(Y) + t * (xStem(Y) - xAft(Y));
const tOf = (x, Y) => (x - xAft(Y)) / (xStem(Y) - xAft(Y));
function hbAt(t, Y) {
  const kb = Math.max(0, (t - 0.6) / 0.4), ks = Math.max(0, (0.36 - t) / 0.36);
  const top = Math.pow(Math.max(0, 1 - kb * kb), 0.5) * (1 - 0.3 * Math.pow(ks, 1.7)); // full round bow, broad stern
  const low = Math.pow(Math.max(0, 1 - Math.pow(kb, 1.7)), 0.7) * Math.pow(Math.max(0, 1 - Math.pow(ks, 1.6)), 0.85); // finer below
  const p = lerp(low, top, ss(Y_TUCK, Y_MAXB, Y));
  let s;
  if (Y < Y_MAXB) { // a flat-ish rising floor and round bilge amidships, sharper toward the ends
    const d = (Y_MAXB - deep(Y)) / (Y_MAXB - Y_FORM), full = 1 - Math.pow(Math.min(1, Math.abs(t - 0.48) / 0.52), 2);
    s = Math.pow(Math.max(0, 1 - Math.pow(d, 1.5 + 2.5 * full)), 0.55 + 0.15 * full);
  } else s = 1 - 0.0034 * Math.pow(Y - Y_MAXB, 2) * (1 - 0.65 * kb); // tumblehome, easing off round the bow
  return Math.max(KEEL_HALF, HB * p * s);
}
const hullPoint = (t, Y, side) => { const x = xAt(t, Y); return V3(x, yOf(x, Y), side * hbAt(t, Y)); };
const sidePt = (x, Y, side) => hullPoint(tOf(x, Y), Y, side);
const deckHalf = (x, Y) => hbAt(tOf(x, Y), Y);
const DRIFT = 0.65; // the top of the side steps up at the quarterdeck, poop and forecastle in short curved drifts
const railRel = (x) => R_WAIST + (R_QD - R_WAIST) * (1 - ss(X_QD - DRIFT, X_QD + DRIFT, x))
  + (R_POOP - R_QD) * (1 - ss(X_POOP - DRIFT, X_POOP + DRIFT, x)) + (R_QD - R_WAIST) * ss(X_FC - DRIFT, X_FC + DRIFT, x);
const topRel = (t) => railRel(xAt(t, 9));
function hullFrame(t, Y, side) { // along the side (forward), up the side, and out of it
  const e = 0.0015, P0 = hullPoint(t, Y, side);
  const T = hullPoint(Math.min(1, t + e), Y, side).sub(hullPoint(Math.max(0, t - e), Y, side)).normalize();
  const U = hullPoint(t, Y + 0.02, side).sub(hullPoint(t, Y - 0.02, side)).normalize();
  const N = new THREE.Vector3().crossVectors(T, U).normalize(); if (N.z * side < 0) N.negate();
  if (T.x < 0) T.negate();
  return { P: P0, T, U, N };
}
const levelOut = (t, Y, side) => { const f = hullFrame(t, Y, side); return V3(f.N.x, 0, f.N.z).normalize(); };
// Texture space for the sides: u runs with distance along the hull at 4.3 m, so paint keeps its
// proportions round the bow; v is sheer-relative height, so painted bands follow the sheer.
const Y_REF = 4.3, Y_TOP = R_POOP + 0.15;
const ARC = (function () {
  const n = 600, tab = [0]; let prev = hullPoint(0, Y_REF, 1);
  for (let i = 1; i <= n; i++) { const p = hullPoint(i / n, Y_REF, 1); tab.push(tab[i - 1] + p.distanceTo(prev)); prev = p; }
  return { n, tab, len: tab[n] };
})();
const arcU = (t) => { const f = clamp01(t) * ARC.n, i = Math.min(ARC.n - 1, Math.floor(f)); return lerp(ARC.tab[i], ARC.tab[i + 1], f - i) / ARC.len; };
const vOf = (Y) => (Y - Y_CUT) / (Y_TOP - Y_CUT); // the painted sides run from the cut up to the top of the side
const tOfArc = (u) => {
  const d = clamp01(u) * ARC.len; let lo = 0, hi = ARC.n;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ARC.tab[mid] < d) lo = mid; else hi = mid; }
  return (lo + (d - ARC.tab[lo]) / Math.max(1e-9, ARC.tab[hi] - ARC.tab[lo])) / ARC.n;
};
// The hull's rows up the side, above the one just under the waterline (-0.6 m), as shares of the
// height from there to the top of the side: closer together low down, where the side bends most.
const HULL_ROWS = [0, 0.18, 0.3, 0.4, 0.6, 0.8, 1];
// The hull's stations along the side: 36, closer together toward bow and stern, plus three where the
// round bow closes into the stem and five through each drift, so the steps in the top of the side
// keep their curve. The inboard faces and the cap rail use the same stations.
const HULL_T = (function () {
  const ts = [0.987, 0.9935, 0.9975];
  for (let i = 0; i <= 36; i++) { const k = i / 36; ts.push(0.35 * (0.5 - 0.5 * Math.cos(Math.PI * k)) + 0.65 * k); }
  [X_POOP, X_QD, X_FC].forEach((x) => [-1, -0.5, 0, 0.5, 1].forEach((d) => ts.push(tOf(x + d * DRIFT, 9))));
  ts.sort((a, b) => a - b);
  const out = [0];
  ts.forEach((t) => { if (t - out[out.length - 1] > 0.002 && t < 0.999) out.push(t); });
  out.push(1);
  return out;
})();

/* ---- the texture sheet's layout -------------------------------------------------------------- */
// One 1024 x 1024 canvas holds every painted surface, so the hull's sides, their inboard faces, the
// stern, the side galleries and the name board draw in one call from one texture:
//   outboard sides                    x 0..1024,   y 0..508
//   stern and side galleries          x 0..512,    y 512..1024 (drawn in their first 1024 layout, at half scale)
//   inboard faces, after half         x 516..1024, y 514..638 (from the waist deck up to the rail)
//   name board                        x 516..1024, y 644..720
//   inboard faces, forward half       x 516..1024, y 724..848
//   the three gratings                x 516..912,  y 858..954
//   the channels' top (deadeyes)      x 520..770,  y 960..1000
//   the capstan                       x 916..1020, y 862..1018
const ATLAS = 1024;
const atlasUV = (x, y) => [x / ATLAS, 1 - y / ATLAS];
const OUT_H = 508;
const IN_RECT = [{ x: 516, y: 514, w: 508, h: 124, u0: 0, pad: [512, 510, 1024, 641] }, { x: 516, y: 724, w: 508, h: 124, u0: 0.5, pad: [512, 723, 1024, 852] }];
const Y_IN0 = D_UD - 0.4; // the inboard faces' paint starts just under the waist deck

/* ---- gun ports: 100 guns ----------------------------------------------------------------------- */
// Lower deck 14 a side, middle deck 14 (offset half a port, its foremost well forward by the bow),
// upper deck 14, quarterdeck 6 (3 under the poop, 3 open) and forecastle 2: 50 a side. The middle
// deck's and the quarterdeck's aftmost ports, the pair nearest the stern galleries, are left off.
const PITCH = 3.25, X_PORT0 = -23.6, NUDGE = 1.4;
const row = (n, x0) => [...Array(n)].map((_, k) => x0 + k * PITCH);
const G0 = X_PORT0 - NUDGE;
const topRow = row(15, G0 + PITCH / 2); // the top row is chequered with the upper gun deck below it
const TIERS = [
  { Y: D_LD + 1.12, w: 1.12, h: 0.98, xs: row(14, G0 + PITCH), gun: 1.0, len: 2.9, out: 0.85 },
  { Y: D_MD + 1.08, w: 1.06, h: 0.94, xs: row(14, G0 + 1.5 * PITCH), gun: 0.9, len: 2.9, out: 0.8 },
  { Y: D_UD + 1.0, w: 1.0, h: 0.88, xs: row(14, G0 + PITCH), gun: 0.76, len: 2.75, out: 0.75 },
  { Y: D_QD + 0.85, w: 0.9, h: 0.78, xs: [1, 2, 3, 5, 6, 7].map((k) => topRow[k]), gun: 0.7, len: 2.4, out: 0.7, deck: true },
  { Y: D_QD + 0.85, w: 0.9, h: 0.78, xs: [13, 14].map((k) => topRow[k]), gun: 0.7, len: 2.4, out: 0.7, deck: true },
];
// Her ports a side, lowest deck first and forward along each, which is the order she arms them in.
const PORTS = [];
TIERS.forEach((tr, ti) => tr.xs.forEach((x) => PORTS.push({ x, ti, t: tOf(x, tr.Y), Y: tr.Y, w: tr.w, h: tr.h, gun: tr.gun, len: tr.len, out: tr.out, deck: !!tr.deck })));
/** A side's worth of her ports, which is what `broadside` counts. */
export const PORTS_A_SIDE = PORTS.length;
// guns you can see on deck, on their carriages: the quarterdeck forward of the poop, the forecastle
// and the upper deck in the open waist
const onDeck = (p) => (p.deck && p.x > X_POOP) || (p.ti === 2 && p.x > X_QD + 1 && p.x < X_FC - 0.9);
// hawse holes: low in the bow just above the main wale, where the cables come in on the lower gun deck
const HAWSE = [{ x: 27.35, Y: D_LD + 1.0 }, { x: 26.75, Y: D_LD + 0.95 }];
const Y_COPPER = 0.38, WALES = [1.25, 3.23, 5.33], WALE_H = 0.42;
const STRAKES = TIERS.slice(0, 4).map((tr, i) => [tr.Y - (i < 3 ? 0.58 : 0.5), tr.Y + (i < 3 ? 0.58 : 0.5)]);

/* ---- the stern's figures ------------------------------------------------------------------------ */
const STERN_BOW = 0.85, ARCH = 1.15;
const sternPt = (Y, f) => {
  const x0 = xAft(Y);
  return V3(x0 - STERN_BOW * ss(-1, 3.6, Y) * (1 - Math.pow(Math.abs(f), 2.4)), yOf(x0, Y), f * hbAt(0, Y));
};
const sternTop = (f) => R_POOP + ARCH * Math.pow(Math.max(0, 1 - f * f), 0.6); // the top edge arches
const sternOut = (Y, f) => { // level outward (aft) direction of the stern at f
  const e = 0.01, a = sternPt(Y, Math.max(-1, f - e)), b = sternPt(Y, Math.min(1, f + e));
  const n = V3(b.z - a.z, 0, a.x - b.x).normalize(); if (n.x > 0) n.negate(); return n;
};
const S_TIERS = [ // floor, window foot, window head, open balcony?
  { floor: D_MD, w0: 3.58, w1: 4.98, walk: true }, // wardroom
  { floor: D_UD, w0: 5.73, w1: 7.07, walk: true }, // great cabin
  { floor: D_QD, w0: 7.88, w1: 9.0, walk: false }, // captain's cabin, under a canopy
];
const WIN_F = [...Array(7)].map((_, k) => -0.78 + k * 0.26), WIN_HW = 0.08; // window centres and half-width across the stern
const PIERS = [...Array(8)].map((_, k) => -0.91 + k * 0.26); // the gaps between them
const WALK = 0.95; // depth of the balconies
const Y_ST0 = Y_TUCK - 0.1, Y_ST1 = R_POOP + ARCH + 0.1;
const vSt = (Y) => (Y - Y_ST0) / (Y_ST1 - Y_ST0);
const QG = { y0: 1.85, y1: D_MD, y2: D_POOP, y3: R_POOP - 0.1, depth: 1.05, xFront: -24.45 }; // side galleries
QG.lenAt = (Y) => QG.xFront - xAft(Y) - 0.04;
QG.lenMax = QG.lenAt(QG.y3);
const RECT = { st: [0, 0, 672, 1016], qg: [680, 0, 336, 672], qb: [680, 680, 48, 336] }; // stern, gallery sides, gallery after faces
const ST_X = 0, ST_Y = 512, ST_K = 0.5;
const uvIn = (r, u, v) => atlasUV(ST_X + ST_K * (RECT[r][0] + u * RECT[r][2]), ST_Y + ST_K * (RECT[r][1] + (1 - v) * RECT[r][3]));
const NAME_RECT = { x: 516, y: 644, w: 508, h: 76, k: 80 }, NB_Y = (D_POOP + R_POOP + ARCH * 0.7) / 2;
const NAME_MAX = 24;

/* ---- masts: positions and proportions ----------------------------------------------------------- */
// Heights are above the waterline. top: the lower mast's platform; cap: its masthead cap; xt: topmast
// crosstrees; tmCap: topmast cap; tg: topgallant masthead; truck3/4: the pole's tip with three or four
// sails; yards: course to royal. Fore and main step on the quarterdeck and forecastle, the mizzen on
// the poop. rake: how far each mast leans aft, in degrees.
const MASTS = [
  { name: "fore", x: 19.6, deck: D_QD, r: 0.5, top: 24.2, cap: 27.7, xt: 38.4, tmCap: 40.7, tg: 47.0, truck3: 48.9, truck4: 52.4,
    yards: [26.0, 19.6, 12.6, 8.4], topW: 6.6, topL: 4.1, foot: 12.3, shrouds: 9, step: 0.66, rake: 1, pennant: 10.8 },
  { name: "main", x: -1.0, deck: D_QD, r: 0.56, top: 26.0, cap: 29.8, xt: 41.8, tmCap: 44.2, tg: 51.1, truck3: 53.1, truck4: 56.9,
    yards: [29.0, 21.6, 13.8, 9.2], topW: 7.2, topL: 4.4, foot: 11.9, shrouds: 10, step: 0.66, rake: 2, pennant: 13.2 },
  { name: "mizzen", x: -18.6, deck: D_POOP, r: 0.38, top: 21.3, cap: 24.0, xt: 33.0, tmCap: 34.9, tg: 40.0, truck3: 41.5, truck4: 44.4,
    yards: [20.6, 15.2, 9.8, 6.6], topW: 5.0, topL: 3.2, foot: 13.9, shrouds: 6, step: 0.6, rake: 3, pennant: 9 },
];
// The figures above were drawn a little short. The whole rig is built RIG times larger, which puts the
// main truck (royals aloft) at Victory's 205 ft (62.5 m) above the waterline. Each mast is modelled
// upright and then raked aft about its step: m.rk() takes a point of the upright mast to where it stands.
const RIG = 1.114;
MASTS.forEach((m) => {
  m.yd = yOf(m.x, m.deck);
  ["top", "cap", "xt", "tmCap", "tg", "truck3", "truck4", "foot"].forEach((k) => { m[k] = m.yd + RIG * (m[k] - m.yd); });
  m.yards = m.yards.map((w) => w * RIG);
  m.rake *= Math.PI / 180;
  const c = Math.cos(m.rake), s = Math.sin(m.rake);
  m.rk = (p) => V3(m.x + (p.x - m.x) * c - (p.y - m.yd) * s, m.yd + (p.x - m.x) * s + (p.y - m.yd) * c, p.z);
});
const MAST_BY_STATION = Object.fromEntries(MASTS.map((m) => [m.name, m]));
// channels: fore and main above the upper-deck ports and below the quarterdeck ports; the mizzen higher, on the poop
const CHAN_Y = { fore: 7.2, main: 7.2, mizzen: R_QD - 0.12 };
const shroudTop = (m, side) => m.rk(V3(m.x - 0.1, m.top - 0.5, side * 0.48)); // where the lower shrouds go over the masthead

/* ---- bowsprit line ------------------------------------------------------------------------------ */
const bowLift = sheer(28.5);
const BS_STEEVE = 0.36, BS_LEN = 18.5; // from the stem head, steeved up at about 21 degrees
const bsStart = V3(xStem(8.6) - 0.6, 8.6 + bowLift, 0);
const bsDir = V3(Math.cos(BS_STEEVE), Math.sin(BS_STEEVE), 0), bsPerp = V3(-Math.sin(BS_STEEVE), Math.cos(BS_STEEVE), 0);
const bs = (f) => bsStart.clone().addScaledVector(bsDir, BS_LEN * f);
const bsR = (f) => lerp(0.62, 0.36, f); // the spar's radius along its length
const JB_IN = 0.64, JB_OUT = 11.5; // the jib-boom lies along the bowsprit's top and runs out 11.5 m beyond it
const jbStart = bs(JB_IN).addScaledVector(bsPerp, bsR(JB_IN) + 0.22);
const JB_LEN = (1 - JB_IN) * BS_LEN + JB_OUT;
const jb = (f) => jbStart.clone().addScaledVector(bsDir, JB_LEN * f);
const CAT_X = 24.95; // where the catheads leave the bow; each anchor hangs from a cathead's end
const RING_DROP = 1.3; // the top of each anchor's ring hangs this far below its cathead's end

/**
 * How far forward and how high she can ever reach, rig and jib-boom at their fullest: the menu frames
 * her by these rather than by what she carries today, so stepping a shorter spar or striking a
 * topgallant never makes her jump in her box. They are the extent of her model fully found (the cap
 * knob at the jib-boom's end, the main truck with royals aloft), and `npm run bespoke-test` holds
 * them to it, so she is framed exactly as she was when the frame followed her box.
 */
export const FIRST_RATE_FRAME = { reach: 55.998, top: 62.548 };

/* ---- decks' figures ---------------------------------------------------------------------------- */
const CAMBER = 0.12;
const deckY = (x, Y, z = 0) => yOf(x, Y) + CAMBER * Math.max(0, 1 - Math.pow(z / deckHalf(x, Y), 2));
const deckPt = (x, Y, z = 0) => V3(x, deckY(x, Y, z), z);
// The height of a deck's planking at (x, z) exactly as its grid draws it: the camber taken at the
// grid's DECK_M + 1 stations across the deck and straight between them.
const DECK_M = 6;
const deckSurfY = (x, Y, z) => {
  const w = deckHalf(x, Y) - 0.04, f = (Math.min(1, Math.max(-1, z / w)) + 1) / 2 * DECK_M, j = Math.min(DECK_M - 1, Math.floor(f));
  const c = (k) => { const v = -1 + 2 * k / DECK_M; return CAMBER * (1 - v * v); };
  return yOf(x, Y) + lerp(c(j), c(j + 1), f - j);
};
const GANG = 1.9; // width of the gangways along the waist
const GRATINGS = [[10.5, D_UD, 5.4, 2.4], [-15.3, D_POOP, 1.6, 1.8], [23.0, D_QD, 2.6, 1.8]]; // waist, poop, forecastle
const GRATE_K = 40, GRATE_Y = 858;
// each grating's patch of the sheet, laid left to right
const GRATE_RECTS = (function () { let x = 516; return GRATINGS.map(([, , len, wid]) => { const w = Math.round(len * GRATE_K), h = Math.round(wid * GRATE_K), r = { x, w, h }; x += w + 6; return r; }); })();
const CAP_R = { top: [916, 862, 96, 96], drum: [916, 962, 104, 12], barrel: [916, 978, 104, 40] };
const CH_K = 36, CH_STEP = 0.66, CH_R = { x: 520, y: 960, w: Math.round((1 + 9 * CH_STEP) * CH_K), h: Math.round(1.1 * CH_K) };

/* ---- the rig a spec asks for --------------------------------------------------------------------- */

/**
 * What the spec says she carries, in this model's own terms: for each mast its cap (how many square
 * sails tall it stands, 1 to 4) and what is set on each yard; what is set on her spanker's gaff; what
 * is set on each of her headsail stays; her fitted broadside. A station the spec does not step stays
 * null and is not built.
 *
 * A place in the rig holds the id of the sail bent on there (`staysail`, `jibFine`, `trysail` ...),
 * or false when it is empty, so what a captain put where in the outfitter is what is drawn there: a
 * staysail in the outer berth is drawn as a staysail on the outer stay, and a jib inboard as a jib.
 * A spec from before sails were named says only that a berth is filled, and reads as `true`, which
 * draws the sail that place was first drawn with.
 */
export function rigOf(spec) {
  // `sprit` is what is stepped on the bowsprit, as the length of spar it carries (0 nothing, 1 a
  // standing bowsprit, 2 a jib-boom run out beyond it), and what is set on each of its two stays,
  // berth by berth: the fore topmast stay first, the stay out to the jib-boom's end second
  const out = { fore: null, main: null, mizzen: null, gaff: false, sprit: { spar: 0, set: [false, false] }, guns: PORTS_A_SIDE };
  if (spec && Number.isFinite(spec.guns)) out.guns = Math.max(0, Math.min(PORTS_A_SIDE, spec.guns));
  const named = (s) => s.sail || true;
  for (const m of (spec && spec.masts) || []) {
    const berths = m.berths || [];
    const sails = m.sails || [];
    const at = new Map(sails.map((s) => [s.berth, s]));
    if (m.station === "bowsprit") {
      // a spec with no berth list (an old one) is read as long as its sails need
      const n = berths.length || (sails.length ? Math.max(...sails.map((s) => s.berth)) + 1 : 0);
      const spar = Math.max(1, Math.min(2, n));
      const set = [0, 1].map((i) => (i < spar && at.has(i) && at.get(i).kind === "TRI" ? named(at.get(i)) : false));
      out.sprit = { spar, set };
      continue;
    }
    if (!MAST_BY_STATION[m.station]) continue;
    const squares = berths.map((k, i) => ({ k, i })).filter((b) => b.k !== "GAF");
    // the fore and main count every berth, the mizzen those over her spanker; a mast with no berth
    // list (an old spec) is read as tall as its highest sail
    const count = squares.length || (sails.length ? Math.max(...sails.map((s) => s.berth)) + 1 : 0);
    const cap = Math.max(1, Math.min(4, count));
    const set = [false, false, false, false];
    squares.forEach((b, j) => { if (j < 4 && at.has(b.i)) set[j] = named(at.get(b.i)); });
    if (!squares.length) sails.forEach((s) => { if (s.kind !== "GAF" && s.berth < 4) set[s.berth] = named(s); });
    out[m.station] = { cap, sails: set };
    if (m.station === "mizzen") { const g = sails.find((s) => s.kind === "GAF"); out.gaff = g ? named(g) : false; }
  }
  return out;
}

/**
 * HOW EACH SAIL IS CUT, by what it is rather than where it hangs. The catalogue's plain and fine
 * grades of a sail are the same cloth to look at, so a sail's look is read off its id's stem.
 */
const sailStem = (id) => (typeof id === "string" ? id.replace(/Fine$/, "") : null);
// square canvas: the cloth it is drawn in, by what was bent on rather than by which yard
const squareCloth = (id, fallback) => {
  const s = sailStem(id);
  return s === "course" ? "course" : s === "topsail" ? "topsail" : s ? "plain" : fallback;
};
// A headsail on one of her two stays: where its tack and head sit up the stay, how far aft its clew
// stands as a share of the run from the foremast to the spar's end, how high over the stay's foot,
// and how full it draws. The staysail on the inner stay and the jib on the outer are the two she was
// first drawn with; the rest are each sail cut to its own size on the other stay.
const HEADSAIL = {
  staysail: [{ tack: 0.15, head: 0.72, share: 0.33, dy: 2.0, belly: 1.0 }, { tack: 0.14, head: 0.62, share: 0.7, dy: 2.4, belly: 1.0 }],
  jib: [{ tack: 0.12, head: 0.8, share: 0.27, dy: 1.6, belly: 1.2 }, { tack: 0.1, head: 0.75, share: 0.63, dy: 1.3, belly: 1.4 }],
  flyingJib: [{ tack: 0.2, head: 0.66, share: 0.4, dy: 2.6, belly: 0.9 }, { tack: 0.16, head: 0.68, share: 0.74, dy: 2.4, belly: 1.0 }],
};
const BERTH_HEADSAIL = ["staysail", "jib"]; // what each stay was first drawn with, for a sail with no name
const headsailCut = (id, stay) => (HEADSAIL[sailStem(id)] || HEADSAIL[BERTH_HEADSAIL[stay]])[stay];
// a fore-and-aft sail on her mizzen gaff, as a share of the full spanker: a gaff mainsail is as big,
// a trysail a smaller, heavier sail, a gaff topsail a scrap
const GAFF_SIZE = { spanker: 1, gaffMain: 1, trysail: 0.74, gaffTopsail: 0.52 };
const gaffSize = (id) => GAFF_SIZE[sailStem(id)] ?? 1;

/* ---- the texture sheet ---------------------------------------------------------------------------- */

// a gun port: a dark hole inside a slightly lighter frame where the lid seats, with a faint stain
// running down; or, where no gun is aboard, the lid shut over it
function port(gg, cx, cy, w, h, fw, fh, lining, stain, stainLen, shut) {
  if (stain) {
    const sg = gg.createLinearGradient(0, cy + h / 2, 0, cy + h / 2 + stainLen);
    sg.addColorStop(0, shut ? "rgba(20, 12, 6, 0.18)" : "rgba(20, 12, 6, 0.3)"); sg.addColorStop(1, "rgba(20, 12, 6, 0)");
    gg.fillStyle = sg; gg.fillRect(cx - w * 0.38, cy + h / 2, w * 0.76, stainLen);
  }
  gg.fillStyle = lining; roundRect(gg, cx - w / 2 - fw, cy - h / 2 - fh, w + 2 * fw, h + 2 * fh, Math.min(w, h) * 0.22); gg.fill();
  if (shut) {
    // the lid: planked a shade lighter than her side, lit along its top edge, seated in the frame
    gg.fillStyle = "#6a4730"; roundRect(gg, cx - w / 2, cy - h / 2, w, h, Math.min(w, h) * 0.18); gg.fill();
    gg.fillStyle = "rgba(255, 226, 180, 0.14)"; gg.fillRect(cx - w / 2, cy - h / 2, w, Math.max(1, h * 0.12));
    gg.fillStyle = "rgba(20, 12, 6, 0.25)"; gg.fillRect(cx - w / 2, cy + h / 2 - Math.max(1, h * 0.1), w, Math.max(1, h * 0.1));
    return;
  }
  gg.fillStyle = "#140c07"; roundRect(gg, cx - w / 2, cy - h / 2, w, h, Math.min(w, h) * 0.18); gg.fill();
}

const GLASS = ["#27404b", "#2a4450", "#2f4b57", "#33505c"];

/**
 * Her texture sheet, painted afresh: `trim` is the livery her stern carving, mouldings and name board
 * take, `guns` her fitted broadside (an unarmed port is painted shut), `name` what is painted on the
 * board across her stern. Returns the canvas; the caller makes the texture.
 */
export function paintAtlas({ trim = "#e8c877", guns = PORTS_A_SIDE, name = "" } = {}) {
  const TRIM = trim;
  const [atlasC, g] = canvas(ATLAS, ATLAS);
  const rnd = prng(11);
  g.fillStyle = P.hull; g.fillRect(0, 0, ATLAS, ATLAS); // gaps in the hull's colour, so mipmaps blend nothing odd
  const armed = (p) => PORTS.indexOf(p) < guns;

  // ---- the outboard sides: dark brown, an oak strake behind each row of ports, darker wales between
  // the rows, copper below; faint plank seams, a little weathering and a short stain under each port.
  // Drawn in their first 2048-wide layout and scaled by half into the top of the sheet.
  (function paintSides() {
    const W = 2048, H = 2 * OUT_H;
    g.save(); g.beginPath(); g.rect(0, 0, ATLAS, OUT_H); g.clip(); g.setTransform(0.5, 0, 0, 0.5, 0, 0);
    const px = W / ARC.len, py = H / (Y_TOP - Y_CUT);
    const U = (t) => arcU(t) * W, Vy = (Y) => (1 - vOf(Y)) * H;
    const band = (y0, y1, fill) => { g.fillStyle = fill; g.fillRect(0, Vy(y1), W, Vy(y0) - Vy(y1)); };
    rnd.reset(11);
    band(Y_CUT, Y_TOP, P.hull);
    STRAKES.forEach(([a, b]) => band(a, b, P.oak));
    [[Y_COPPER, Y_TOP]].concat(STRAKES).forEach(([a, b]) => {
      for (let k = 0; k < 150; k++) {
        const y = a + Math.floor(rnd() * (b - a) / 0.27) * 0.27, light = rnd() < 0.5;
        g.fillStyle = light ? `rgba(255, 225, 180, ${0.025 + rnd() * 0.035})` : `rgba(30, 16, 6, ${0.03 + rnd() * 0.04})`;
        g.fillRect(rnd() * W, Vy(Math.min(b, y + 0.27)), 20 + rnd() * 110, 0.27 * py);
      }
    });
    WALES.forEach((cy) => {
      band(cy - WALE_H / 2, cy + WALE_H / 2, P.wale);
      g.fillStyle = "rgba(255, 226, 180, 0.10)"; g.fillRect(0, Vy(cy + WALE_H / 2) - 2, W, 3);
    });
    g.fillStyle = "rgba(28, 16, 8, 0.22)"; // plank seams every 0.27 m
    for (let y = Y_COPPER + 0.27; y < Y_TOP; y += 0.27) g.fillRect(0, Vy(y) - 0.75, W, 1.5);
    band(Y_CUT, Y_COPPER, P.copper);
    g.fillStyle = "rgba(70, 35, 15, 0.55)"; g.fillRect(0, Vy(Y_COPPER) - 1, W, 2);
    PORTS.forEach((p) => port(g, U(p.t), Vy(p.Y), p.w * px, p.h * py, 0.09 * px, 0.09 * py, "#3d2817", true, 0.7 * py, !armed(p)));
    // hawse holes, each in a dark ring, its shadow below and a highlight along its top
    HAWSE.forEach((hh) => {
      const t = tOf(hh.x, hh.Y), cx = U(t), cy = Vy(hh.Y), e = 0.002;
      const pxL = (U(t + e) - U(t - e)) / hullPoint(t + e, hh.Y, 1).distanceTo(hullPoint(t - e, hh.Y, 1));
      const disc = (r, fill, dy = 0) => { g.fillStyle = fill; g.beginPath(); g.ellipse(cx, cy + dy * py, r * pxL, r * py, 0, 0, Math.PI * 2); g.fill(); };
      disc(0.47, "rgba(0, 0, 0, 0.28)", 0.04);
      disc(0.45, P.darkWood);
      g.fillStyle = "rgba(255, 230, 190, 0.14)"; g.beginPath();
      g.ellipse(cx, cy, 0.43 * pxL, 0.43 * py, 0, Math.PI * 1.1, Math.PI * 1.9); g.ellipse(cx, cy, 0.31 * pxL, 0.31 * py, 0, Math.PI * 1.9, Math.PI * 1.1, true); g.fill();
      disc(0.27, "#140c07");
    });
    g.restore();
  })();

  // ---- the inboard faces: red ochre with faint seams and the same ports, the part above the decks
  IN_RECT.forEach((R) => {
    const pxi = 2 * R.w / ARC.len, pyi = R.h / (Y_TOP - Y_IN0);
    const Ui = (t) => R.x + (arcU(t) - R.u0) * 2 * R.w, Vi = (Y) => R.y + (1 - (Y - Y_IN0) / (Y_TOP - Y_IN0)) * R.h;
    const [px0, py0, px1, py1] = R.pad;
    g.save(); g.beginPath(); g.rect(px0, py0, px1 - px0, py1 - py0); g.clip();
    g.fillStyle = P.ochre; g.fillRect(px0, py0, px1 - px0, py1 - py0);
    g.fillStyle = "rgba(40, 14, 6, 0.2)";
    for (let y = Y_FORM + 0.27; y < Y_TOP + 0.3; y += 0.27) if (y > Y_IN0 - 0.3) g.fillRect(px0, Vi(y) - 0.5, px1 - px0, 1);
    PORTS.forEach((p) => port(g, Ui(p.t), Vi(p.Y), p.w * pxi, p.h * pyi, 0.09 * pxi, 0.09 * pyi, "#5e2a1b", false, 0, !armed(p)));
    g.restore();
  });

  // ---- the stern and the side galleries, painted at half scale into the lower left quarter
  function paintWindow(x, y, w, h, rows, cols) {
    g.fillStyle = P.cream; g.fillRect(x - 2, y - 2, w + 4, h + 4);
    const bw = Math.max(1.5, w * 0.07), pw = (w - bw * (cols + 1)) / cols, ph = (h - bw * (rows + 1)) / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x0 = x + bw + c * (pw + bw), y0 = y + bw + r * (ph + bw);
      g.fillStyle = GLASS[Math.floor(rnd() * GLASS.length)]; g.fillRect(x0, y0, pw, ph);
      const sh = g.createLinearGradient(x0, y0, x0 + pw, y0 + ph);
      sh.addColorStop(0, "rgba(190, 220, 230, 0.16)"); sh.addColorStop(0.5, "rgba(190, 220, 230, 0)"); g.fillStyle = sh; g.fillRect(x0, y0, pw, ph);
    }
  }
  function pillar(x, y0, y1, w) { // carving painted flat in the trim colour, with a touch of painted shade so it reads as carved
    g.fillStyle = TRIM; g.fillRect(x - w / 2, y0, w, y1 - y0);
    g.fillStyle = "rgba(0, 0, 0, 0.22)"; g.fillRect(x + w * 0.22, y0, w * 0.28, y1 - y0);
    g.fillStyle = "rgba(255, 255, 240, 0.3)"; g.fillRect(x - w * 0.42, y0, w * 0.14, y1 - y0);
  }
  function leafRow(x0, x1, y, h) { // a running band of simple carved leaves
    const n = Math.max(2, Math.round((x1 - x0) / (h * 1.4)));
    for (let k = 0; k < n; k++) {
      const cx = x0 + (k + 0.5) * (x1 - x0) / n;
      g.fillStyle = "rgba(0, 0, 0, 0.25)"; g.beginPath(); g.ellipse(cx + 1, y + 1, h * 0.62, h * 0.36, 0.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = TRIM; g.beginPath(); g.ellipse(cx, y, h * 0.6, h * 0.32, 0.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = "rgba(255, 255, 240, 0.35)"; g.beginPath(); g.ellipse(cx - h * 0.15, y - h * 0.1, h * 0.25, h * 0.1, 0.5, 0, Math.PI * 2); g.fill();
    }
  }
  // her own colours, as on her sides, between heights y0 and y1
  function shipBands(X0, W, Vy, y0, y1, py) {
    const band = (a, b, fill) => { a = Math.max(a, y0); b = Math.min(b, y1); if (b > a) { g.fillStyle = fill; g.fillRect(X0, Vy(b), W, Vy(a) - Vy(b)); } };
    g.save(); g.beginPath(); g.rect(X0, Vy(y1), W, Vy(y0) - Vy(y1)); g.clip();
    band(y0, y1, P.hull);
    STRAKES.forEach(([a, b]) => band(a, b, P.oak));
    for (let k = 0; k < 40; k++) {
      const y = y0 + Math.floor(rnd() * (y1 - y0) / 0.27) * 0.27, light = rnd() < 0.5;
      g.fillStyle = light ? `rgba(255, 225, 180, ${0.025 + rnd() * 0.035})` : `rgba(30, 16, 6, ${0.03 + rnd() * 0.04})`;
      g.fillRect(X0 + rnd() * W, Vy(Math.min(y1, y + 0.27)), 20 + rnd() * 120, 0.27 * py);
    }
    WALES.forEach((c) => {
      band(c - WALE_H / 2, c + WALE_H / 2, P.wale);
      g.fillStyle = "rgba(255, 226, 180, 0.10)"; g.fillRect(X0, Vy(c + WALE_H / 2) - 2, W, 3);
    });
    g.fillStyle = "rgba(28, 16, 8, 0.22)";
    for (let y = Y_COPPER + 0.27; y < y1; y += 0.27) g.fillRect(X0, Vy(y) - 0.75, W, 1.5);
    g.restore();
  }
  const BLEED = 4; // mouldings run past each patch's edge into the gap, so a sampled edge never fades to the gap's colour
  function paintStern() {
    const [X0, Y0, W, H] = RECT.st;
    const Vy = (Y) => Y0 + (1 - vSt(Y)) * H, Fx = (f) => X0 + (f + 1) / 2 * W;
    const pxF = W / 2 / hbAt(0, 5), py = H / (Y_ST1 - Y_ST0);
    shipBands(X0 - BLEED, W + 2 * BLEED, Vy, Y_ST0, Y_ST1, py);
    g.fillStyle = P.copper; g.fillRect(X0 - BLEED, Vy(Y_COPPER), W + 2 * BLEED, Vy(Y_ST0) - Vy(Y_COPPER));
    g.fillStyle = "rgba(70, 35, 15, 0.55)"; g.fillRect(X0 - BLEED, Vy(Y_COPPER) - 1, W + 2 * BLEED, 2);
    [-0.3, 0.3].forEach((f) => { // two stern ports on the lower port row
      const w = TIERS[0].w * pxF, h = TIERS[0].h * py, cx = Fx(f), cy = Vy(TIERS[0].Y), fw = 0.09 * pxF;
      g.fillStyle = "#3d2817"; roundRect(g, cx - w / 2 - fw, cy - h / 2 - fw, w + 2 * fw, h + 2 * fw, h * 0.2); g.fill();
      g.fillStyle = "#140c07"; roundRect(g, cx - w / 2, cy - h / 2, w, h, h * 0.16); g.fill();
    });
    S_TIERS.forEach((tr) => {
      WIN_F.forEach((f) => paintWindow(Fx(f - WIN_HW), Vy(tr.w1), WIN_HW * W, Vy(tr.w0) - Vy(tr.w1), 4, 3));
      PIERS.forEach((f) => pillar(Fx(f), Vy(tr.w1 + 0.15), Vy(tr.w0 - 0.1), 0.13 * pxF));
      g.fillStyle = TRIM; g.fillRect(X0 - BLEED, Vy(tr.w1 + 0.2) - 0.035 * py, W + 2 * BLEED, 0.07 * py);
      g.fillRect(X0 - BLEED, Vy(tr.floor) - 0.04 * py, W + 2 * BLEED, 0.08 * py);
    });
    g.fillStyle = TRIM; g.fillRect(X0 - BLEED, Vy(D_POOP + 0.06) - 0.035 * py, W + 2 * BLEED, 0.07 * py);
    leafRow(X0, X0 + W, Vy(D_POOP + 0.3), 0.14 * py);
  }
  function paintGallery() {
    const [X0, Y0, W, H] = RECT.qg;
    const Vy = (Y) => Y0 + (1 - (Y - QG.y0) / (QG.y3 - QG.y0)) * H, py = H / (QG.y3 - QG.y0), pa = W / QG.lenMax;
    shipBands(X0 - BLEED, W + 2 * BLEED, Vy, QG.y0, QG.y3, py);
    S_TIERS.forEach((tr) => {
      [1.7, 3.05].forEach((d) => paintWindow(X0 + d * pa - 0.42 * pa, Vy(tr.w1), 0.84 * pa, Vy(tr.w0) - Vy(tr.w1), 4, 2));
      [1.0, 2.37, 3.72].forEach((d) => pillar(X0 + d * pa, Vy(tr.w1 + 0.15), Vy(tr.w0 - 0.1), 0.13 * pa));
      g.fillStyle = TRIM;
      g.fillRect(X0 - BLEED, Vy(tr.w1 + 0.2) - 0.035 * py, W + 2 * BLEED, 0.07 * py);
      g.fillRect(X0 - BLEED, Vy(tr.floor + 0.01), W + 2 * BLEED, 0.25 * py);
      g.fillStyle = "rgba(255, 255, 240, 0.3)"; g.fillRect(X0 - BLEED, Vy(tr.floor + 0.01), W + 2 * BLEED, 0.03 * py);
      g.fillStyle = "rgba(0, 0, 0, 0.22)"; g.fillRect(X0 - BLEED, Vy(tr.floor - 0.17), W + 2 * BLEED, 0.07 * py);
    });
  }
  function paintGalleryBack() {
    const [X0, Y0, W, H] = RECT.qb;
    const Vy = (Y) => Y0 + (1 - (Y - QG.y0) / (QG.y3 - QG.y0)) * H, py = H / (QG.y3 - QG.y0);
    shipBands(X0 - BLEED, W + 2 * BLEED, Vy, QG.y0, QG.y3, py);
    S_TIERS.forEach((tr) => {
      g.fillStyle = TRIM; g.fillRect(X0 - BLEED, Vy(tr.w1 + 0.2) - 0.035 * py, W + 2 * BLEED, 0.07 * py);
      g.fillRect(X0 - BLEED, Vy(tr.floor) - 0.04 * py, W + 2 * BLEED, 0.08 * py);
    });
  }
  rnd.reset(21);
  g.save(); g.beginPath(); g.rect(ST_X, ST_Y, 512, 512); g.clip(); g.setTransform(ST_K, 0, 0, ST_K, ST_X, ST_Y);
  paintStern(); paintGallery(); paintGalleryBack();
  g.restore();

  // ---- the name board, on its own strip of the sheet at NAME_RECT.k pixels a metre so the name stays crisp
  (function paintName() {
    const cx = NAME_RECT.x + NAME_RECT.w / 2, cy = NAME_RECT.y + NAME_RECT.h / 2, pyU = NAME_RECT.k, pxU = NAME_RECT.k;
    g.save(); g.beginPath(); g.rect(512, NAME_RECT.y - 2, 512, NAME_RECT.h + 4); g.clip();
    g.fillStyle = P.hull; g.fillRect(512, NAME_RECT.y - 2, 512, NAME_RECT.h + 4);
    g.fillStyle = "rgba(28, 16, 8, 0.22)";
    for (let y = Y_COPPER + 0.27; y < Y_ST1; y += 0.27) g.fillRect(512, cy - (y - NB_Y) * NAME_RECT.k - 0.75, 512, 1.5);
    const bw = 6.0 * pxU, bh = 0.68 * pyU, fr = 0.08 * pyU, r = bh / 2;
    g.fillStyle = "rgba(0, 0, 0, 0.3)"; roundRect(g, cx - bw / 2 - fr + 1.5, cy - bh / 2 - fr + 2, bw + 2 * fr, bh + 2 * fr, r + fr); g.fill();
    g.fillStyle = TRIM; roundRect(g, cx - bw / 2 - fr, cy - bh / 2 - fr, bw + 2 * fr, bh + 2 * fr, r + fr); g.fill();
    g.fillStyle = "#2e1d12"; roundRect(g, cx - bw / 2, cy - bh / 2, bw, bh, r); g.fill();
    const ins = 0.07 * pyU;
    g.strokeStyle = TRIM; g.lineWidth = Math.max(1, 0.022 * pyU);
    roundRect(g, cx - bw / 2 + ins, cy - bh / 2 + ins, bw - 2 * ins, bh - 2 * ins, r - ins); g.stroke();
    const text = String(name || "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX).toUpperCase();
    if (text) {
      const maxW = bw - 2 * r;
      let size = bh * 0.6;
      const font = () => `700 ${size.toFixed(1)}px Georgia, "Times New Roman", "Noto Serif", serif`;
      g.font = font();
      if ("letterSpacing" in g) g.letterSpacing = (size * 0.12).toFixed(1) + "px";
      const w = g.measureText(text).width;
      if (w > maxW) { size *= maxW / w; g.font = font(); if ("letterSpacing" in g) g.letterSpacing = (size * 0.12).toFixed(1) + "px"; }
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillStyle = "rgba(0, 0, 0, 0.5)"; g.fillText(text, cx + 1, cy + 2);
      g.fillStyle = TRIM; g.fillText(text, cx, cy + 1);
      if ("letterSpacing" in g) g.letterSpacing = "0px";
    }
    g.restore();
  })();

  // ---- the gratings: crossing slats about every 0.4 m in light wood, over squares in black
  GRATINGS.forEach(([, , len, wid], i) => {
    const { x: X0, w, h } = GRATE_RECTS[i], nx = Math.max(2, Math.round(len / 0.4)), nz = Math.max(2, Math.round(wid / 0.4)), slat = 0.08 * GRATE_K;
    g.fillStyle = P.black; g.fillRect(X0, GRATE_Y, w, h);
    g.fillStyle = P.lightWood;
    for (let k = 0; k <= nx; k++) g.fillRect(X0 + k * (w - slat) / nx, GRATE_Y, slat, h);
    for (let j = 0; j <= nz; j++) g.fillRect(X0, GRATE_Y + j * (h - slat) / nz, w, slat);
  });

  // ---- the capstan: the whelps round the barrel, the bar holes round the drumhead and its top
  (function paintCapstan() {
    const [tx, ty, tw] = CAP_R.top, [dx, dy, dw, dh] = CAP_R.drum, [bx, by, bw, bh] = CAP_R.barrel;
    g.fillStyle = P.midWood; g.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
    g.fillStyle = P.darkWood; g.fillRect(bx - 2, by + bh * 0.86, bw + 4, bh * 0.14 + 2);
    for (let k = 0; k < 8; k++) {
      const x = bx + (k + 0.5) / 8 * bw;
      g.fillStyle = P.lightWood; g.fillRect(x - bw * 0.024, by - 2, bw * 0.048, bh * 0.84 + 2);
      g.fillStyle = "rgba(0, 0, 0, 0.28)"; g.fillRect(x + bw * 0.024, by - 2, bw * 0.014, bh * 0.84 + 2);
    }
    g.fillStyle = P.lightWood; g.fillRect(dx - 2, dy - 2, dw + 4, dh + 4);
    g.fillStyle = P.hole; for (let k = 0; k < 8; k++) g.fillRect(dx + (k + 0.5) / 8 * dw - dw * 0.014, dy + dh * 0.25, dw * 0.028, dh * 0.5);
    const cx = tx + tw / 2, cy = ty + tw / 2, ring = (r, fill) => { g.fillStyle = fill; g.beginPath(); g.arc(cx, cy, r * tw / 1.6, 0, Math.PI * 2); g.fill(); };
    g.fillStyle = P.lightWood; g.fillRect(tx - 2, ty - 2, tw + 4, tw + 4);
    ring(0.8, "rgba(0, 0, 0, 0.18)"); ring(0.74, P.lightWood);
    ring(0.24, "rgba(0, 0, 0, 0.3)"); ring(0.22, P.darkWood);
  })();

  // ---- the channels' top: deadeyes by the outer edge, from a strip laid out for the main's ten shrouds
  (function paintChannel() {
    const { x, y, w, h } = CH_R;
    g.fillStyle = P.black; g.fillRect(x - 3, y - 3, w + 6, h + 6);
    for (let j = 0; j < 10; j++) {
      const cx = x + (0.5 + j * CH_STEP) * CH_K, cy = y + 0.26 * CH_K, r = 0.19 * CH_K;
      const disc = (rr, fill, ox = 0, oy = 0) => { g.fillStyle = fill; g.beginPath(); g.arc(cx + ox, cy + oy, rr, 0, Math.PI * 2); g.fill(); };
      disc(r * 1.08, "rgba(0, 0, 0, 0.5)", 0.6, 0.8);
      disc(r, P.darkWood); disc(r * 0.82, P.midWood);
      [0, 2.09, 4.19].forEach((a) => disc(r * 0.17, P.hole, Math.cos(a - 1.57) * r * 0.42, Math.sin(a - 1.57) * r * 0.42));
    }
  })();

  return atlasC;
}

/* ---- the model ------------------------------------------------------------------------------------ */

/**
 * Build her for a rig spec. Returns, in metres:
 *
 *   hull        BufferGeometry: her hull, bowsprit, decks, fittings, guns and under-body, grouped by SLOT
 *   rig         BufferGeometry: every mast, spar, yard and sail, grouped by SLOT; null if no mast is stepped
 *   hullLines   rope on the hull (lanyards, cables, cat falls), for a LineSegments
 *   rigLines    the standing and running rigging, likewise
 *   flags       her pennant mounts for flags.js, one per mast stepped, foremost first, each on `part`
 *   masts       how many masts stand, and `boxes`, a Box3 for each in the same order
 *   guns        her fitted broadside, for the atlas
 */
export function buildFirstRate(spec) {
  const cfg = rigOf(spec);
  const guns = cfg.guns;
  const armed = (p) => PORTS.indexOf(p) < guns;
  const fit = new THREE.Group(); // scratch: every static solid part of the hull, baked below
  const atlasParts = []; // every painted surface
  const deckParts = []; // every deck surface
  const hullLines = [], rigLines = [];
  const DARK = shade(P.dark), WOOD = shade(P.darkWood), MID = shade(P.midWood), LIGHT = shade(P.lightWood),
    COPPER = shade(P.copper), RED = shade(P.carriage), PINE = shade(P.pine), WALE_S = shade(P.wale), BRONZE = shade(P.bronze),
    OCHRE_S = shade(P.ochre), DECK_S = shade(P.deck), KNEE = shade(P.hull), ironMat = shade(P.iron), blackMat = shade(P.black), trimMat = trimToken;

  // ---- the outboard sides and the inboard faces -------------------------------------------------
  {
    const NJ0 = 2, NJ1 = HULL_ROWS.length - 1, NT = HULL_T.length - 1;
    const YAt = (i, j) => (j <= NJ0 ? lerp(Y_CUT, -0.6, j / NJ0) : lerp(-0.6, topRel(HULL_T[i]), HULL_ROWS[j - NJ0]));
    [1, -1].forEach((side) => atlasParts.push(facing(gridGeo(NT, NJ0 + NJ1,
      (i, j) => hullPoint(HULL_T[i], YAt(i, j), side), (i, j) => atlasUV(arcU(HULL_T[i]) * ATLAS, (1 - vOf(YAt(i, j))) * OUT_H)), V3(0, 0, side))));
    // the inboard faces, facing in: from just under the highest deck at each station up to the top of the side
    const deckAt = (x) => (x >= X_FC ? D_QD : x >= X_QD ? D_UD : x >= X_POOP ? D_QD : D_POOP);
    const footAt = (t) => { const x = xAt(t, 9); return Math.min(deckAt(x - 1.5), deckAt(x), deckAt(x + 1.5)) - 0.2; };
    const tHalf = tOfArc(0.5), stations = [[], []];
    HULL_T.forEach((t) => { if (t < tHalf - 1e-4) stations[0].push(t); else if (t > tHalf + 1e-4) stations[1].push(t); });
    stations[0].push(tHalf); stations[1].unshift(tHalf);
    IN_RECT.forEach((R, h) => [1, -1].forEach((side) => {
      const ts = stations[h], YIn = (i, j) => lerp(footAt(ts[i]), topRel(ts[i]), j / 2);
      atlasParts.push(facing(gridGeo(ts.length - 1, 2, (i, j) => hullPoint(ts[i], YIn(i, j), side),
        (i, j) => atlasUV(R.x + (arcU(ts[i]) - R.u0) * 2 * R.w, R.y + (1 - (Math.max(Y_IN0, YIn(i, j)) - Y_IN0) / (Y_TOP - Y_IN0)) * R.h)), V3(0, 0, side), true));
    }));
  }

  // ---- her body under the water, in plain copper: from the cut down to the keel ----------------
  // The sea is opaque, so it shows only as she heels, lists or goes down; it keeps her from being an
  // open shell then. Built from the same form, which is defined to the keel.
  {
    const YS = [Y_CUT, -3.4, -4.6, -5.8, -6.8, Y_KEEL + 0.05];
    const T = HULL_T.filter((_, i) => i % 2 === 0 || i === HULL_T.length - 1);
    [1, -1].forEach((side) => fitAdd(fit, COPPER, facing(gridGeo(T.length - 1, YS.length - 1,
      (i, j) => hullPoint(T[i], YS[j], side), () => [0, 0]), V3(0, 0, side))));
    // the flat of the keel between the two sides
    fitAdd(fit, COPPER, facing(gridGeo(T.length - 1, 1, (i, j) => hullPoint(T[i], Y_KEEL + 0.05, j ? 1 : -1), () => [0, 0]), V3(0, -1, 0)));
  }

  // ---- guns: turned barrels run out level and square to the side -------------------------------
  // Only an armed port shows a barrel; the eighteen on the open decks are whole, on red carriages.
  const BARREL_FULL = [[0, -0.2], [0.27, 0.02], [0.25, 1.12], [0.19, 2.5], [0.235, 2.72]];
  const BARREL_OUT = [[0.2, 1.55], [0.185, 2.5], [0.235, 2.72]];
  const MUZZLE = { r: 0.235, y: 2.72, iron: col(P.iron), bore: col("#080505") };
  function muzzleFace(s) {
    const pos = [0, MUZZLE.y, 0], clr = [MUZZLE.bore.r, MUZZLE.bore.g, MUZZLE.bore.b], idx = [];
    for (let k = 0; k < 6; k++) { const t = k / 6 * Math.PI * 2; pos.push(MUZZLE.r * s * Math.sin(t), MUZZLE.y, MUZZLE.r * s * Math.cos(t)); clr.push(MUZZLE.iron.r, MUZZLE.iron.g, MUZZLE.iron.b); }
    for (let k = 1; k <= 6; k++) idx.push(0, k, k % 6 + 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(21).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(14).fill(0), 2)); g.setAttribute("color", new THREE.Float32BufferAttribute(clr, 3)); g.setIndex(idx);
    return g;
  }
  PORTS.forEach((p) => { if (!armed(p)) return; [1, -1].forEach((side) => {
    const f = hullFrame(p.t, p.Y, side), out = levelOut(p.t, p.Y, side), s = p.gun;
    const muzzle = f.P.clone().add(V3(0, -0.06 * s, 0)).addScaledVector(out, p.out);
    const geo = latheGeo((onDeck(p) ? BARREL_FULL : BARREL_OUT).map(([r, y]) => [r * s, y]), 6), face = muzzleFace(s);
    const at = muzzle.clone().addScaledVector(out, -p.len), turn = new THREE.Quaternion().setFromUnitVectors(UP, out);
    [geo, face].forEach((g) => { g.scale(1, p.len / 2.75, 1); fitAdd(fit, ironMat, placeGeo(g, at, turn)); });
    if (!onDeck(p)) return;
    const inX = out.clone().negate(), along = V3().crossVectors(inX, UP).normalize();
    const axisY = f.P.y - 0.06 * s, yDeck = yOf(p.x, p.ti === 2 ? D_UD : D_QD);
    const back = V3(f.P.x, axisY, f.P.z).addScaledVector(inX, 0.3), Lc = 1.55, ch = axisY - yDeck - 0.12;
    const hb = ch - 0.12;
    fitAdd(fit, RED, frameBoxTop(Lc, hb, 0.62, V3(back.x, yDeck + 0.12 + hb / 2, back.z).addScaledVector(inX, Lc / 2), inX, UP, along));
    [0.2, Lc - 0.22].forEach((d) => fitAdd(fit, WOOD, frameBoxTop(0.38, 0.4, 0.82, V3(back.x, yDeck + 0.2, back.z).addScaledVector(inX, d), inX, UP, along)));
  }); });

  // ---- moulded cap rail along the top of the side, in the trim colour ----------------------------
  const CAP_PROFILE = [[-0.34, -0.02], [0.13, -0.02], [0.13, 0.08], [-0.34, 0.17]];
  [1, -1].forEach((side) => {
    const path = [];
    for (let i = 0; i < HULL_T.length; i++) {
      const t = Math.min(0.9985, Math.max(0.0015, HULL_T[i])), Y = topRel(t);
      path.push({ p: hullPoint(t, Y, side), o: levelOut(t, Math.min(Y, 9.5), side), u: UP });
    }
    fitAdd(fit, trimMat, sweepGeo(path, CAP_PROFILE, true, { skip: NO_UNDERSIDE }));
  });
  // ---- and a sheer moulding down the outside of her side under it, so her livery runs her whole
  // length at sea rather than as a rail seen edge-on. It leans with her tumblehome, and stops just
  // clear of the frames of her quarterdeck and forecastle ports.
  const SHEER_MOULD = [[0, -0.26], [0.06, -0.26], [0.08, -0.23], [0.08, -0.02], [0, -0.02]];
  [1, -1].forEach((side) => {
    const path = [];
    for (let i = 0; i < HULL_T.length; i++) {
      const t = Math.min(0.9985, Math.max(0.0015, HULL_T[i])), Y = topRel(t), p = hullPoint(t, Y, side);
      const u = p.clone().sub(hullPoint(t, Y - 0.3, side)).normalize(), o = levelOut(t, Math.min(Y, 9.5), side);
      path.push({ p, o: o.addScaledVector(u, -o.dot(u)).normalize(), u });
    }
    fitAdd(fit, trimMat, sweepGeo(path, SHEER_MOULD));
  });

  // ---- stem and sternpost: solid timber along the centreline, coppered below the waterline -------
  {
    const line = (xFn, y0, y1, n, fwd) => {
      const path = [];
      for (let k = 0; k <= n; k++) {
        const Y = lerp(y0, y1, k / n), x = xFn(Y), p = V3(x, yOf(x, Y), 0);
        const q = V3(xFn(Y + 0.05), yOf(xFn(Y + 0.05), Y + 0.05), 0).sub(V3(xFn(Y - 0.05), yOf(xFn(Y - 0.05), Y - 0.05), 0)).normalize();
        path.push({ p, o: V3(0, 0, 1), u: V3(fwd * q.y, -fwd * q.x, 0) });
      }
      return path;
    };
    const S1 = R_QD - 0.4;
    const stem = line((Y) => xStem(Y) - 0.2, Y_KEEL + 0.3, S1, 24, 1), prof = [[-0.32, -0.3], [0.32, -0.3], [0.32, 0.25], [-0.32, 0.25]];
    fitAdd(fit, COPPER, sweepGeo(stem.filter((q) => q.p.y <= Y_COPPER + 0.5), prof));
    fitAdd(fit, DARK, sweepGeo(stem.filter((q) => q.p.y >= Y_COPPER - 0.5), prof));
    fitAdd(fit, COPPER, sweepGeo(line((Y) => xPost(Y) + 0.1, Y_KEEL + 0.3, Y_TUCK - 0.3, 4, -1), [[-0.32, -0.3], [0.32, -0.3], [0.32, 0.12], [-0.32, 0.12]]));
  }

  // ---- the stern: counter, three tiers of windows, balconies, side galleries, name board, rudder ---
  {
    const painted = [];
    const EDGE_Y = [Y_ST0], rowY = (j) => (j <= 2 ? lerp(Y_CUT, -0.6, j / 2) : lerp(-0.6, R_POOP, HULL_ROWS[j - 2]));
    for (let j = 0; j <= HULL_ROWS.length + 1; j++) if (rowY(j) > Y_ST0 + 0.05) EDGE_Y.push(rowY(j));
    const NF = 12, NY = EDGE_Y.length - 1, fAt = (i) => -1 + 2 * i / NF;
    const YAt = (i, j) => Y_ST0 + (EDGE_Y[j] - Y_ST0) / (R_POOP - Y_ST0) * (sternTop(fAt(i)) - Y_ST0);
    const sternGridPt = (i, j) => {
      if (j === 0 && (i === 0 || i === NF)) {
        const s = fAt(i), a = sternPt(rowY(1), s), b = sternPt(rowY(2), s);
        return a.lerp(b, (Y_ST0 - rowY(1)) / (rowY(2) - rowY(1)));
      }
      return sternPt(YAt(i, j), fAt(i));
    };
    painted.push(facing(gridGeo(NF, NY, sternGridPt, (i, j) => uvIn("st", (fAt(i) + 1) / 2, vSt(YAt(i, j)))), V3(-1, 0, 0)));
    fitAdd(fit, OCHRE_S, facing(gridGeo(NF, 2, (i, j) => sternPt(lerp(D_POOP - 0.1, sternTop(fAt(i)), j / 2), fAt(i)), () => [0, 0]), V3(-1, 0, 0), true));

    const zFace = hbAt(0.04, (QG.y1 + QG.y2) / 2) + QG.depth;
    const prof = (Y) => (Y < QG.y1 ? Math.sqrt(Math.max(0, 1 - Math.pow((QG.y1 - Y) / (QG.y1 - QG.y0), 2)))
      : Y > QG.y2 ? Math.cos(Math.PI / 2 * Math.min(1, (Y - QG.y2) / (QG.y3 - QG.y2))) : 1);
    const plan = (a, Y) => { const d = a * QG.lenAt(Y); return d < 1 ? Math.pow(Math.sin(Math.PI / 2 * d), 0.6) : 1; };
    const xQ = (a, Y) => QG.xFront - a * QG.lenAt(Y);
    const ptQ = (a, Y, side) => {
      const base = sidePt(xQ(a, Y), Y, side), k = plan(a, Y) * prof(Y);
      base.z = side * lerp(Math.abs(base.z), Math.max(Math.abs(base.z), zFace), k);
      return base;
    };
    const NA = 10, NQ = 10, aQ = (i) => Math.pow(1 - i / NA, 1.6);
    const Yq = (j) => (j <= 3 ? lerp(QG.y0, QG.y1, j / 3) : j <= 7 ? lerp(QG.y1, QG.y2, (j - 3) / 4) : lerp(QG.y2, QG.y3, (j - 7) / 3));
    const vQ = (j) => (Yq(j) - QG.y0) / (QG.y3 - QG.y0);
    [1, -1].forEach((side) => {
      painted.push(facing(gridGeo(NA, NQ, (i, j) => ptQ(aQ(i), Yq(j), side), (i, j) => uvIn("qg", aQ(i) * QG.lenAt(Yq(j)) / QG.lenMax, vQ(j))), V3(0, 0, side)));
      painted.push(facing(gridGeo(1, NQ, (i, j) => { const Y = Yq(j), p = ptQ(1, Y, side); if (!i) p.z = side * Math.abs(sidePt(xQ(1, Y), Y, side).z); return p; },
        (i, j) => uvIn("qb", i, vQ(j))), V3(-1, 0, 0)));
    });

    const NL = 7, NB = 2;
    function wallLine(Y, zEnd = zFace) {
      const x0 = xAft(Y), y = yOf(x0, Y), hb0 = hbAt(0, Y), pts = [];
      for (let k = NB; k >= 1; k--) pts.push(V3(x0, y, -lerp(hb0, zEnd, k / NB)));
      for (let i = 0; i <= NL; i++) pts.push(sternPt(Y, -1 + 2 * i / NL));
      for (let k = 1; k <= NB; k++) pts.push(V3(x0, y, lerp(hb0, zEnd, k / NB)));
      const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + pts[i].distanceTo(pts[i - 1]));
      const raw = pts.map((q, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; return V3(a.z - b.z, 0, b.x - a.x).normalize(); });
      return pts.map((q, i) => {
        const o = V3(0, 0, 0);
        raw.forEach((r, j) => { const d = Math.abs(s[j] - s[i]); if (d < 1.0) o.addScaledVector(r, 1 - d / 1.0); });
        return { p: q, o: o.normalize(), u: UP };
      });
    }
    const off = (line, d, dy = 0) => line.map((q) => ({ p: q.p.clone().addScaledVector(q.o, d).add(V3(0, dy, 0)), o: q.o, u: UP }));
    const lineAt = (line, f) => {
      const k = NB + (f + 1) / 2 * NL, i = Math.min(line.length - 2, Math.floor(k)), t = k - i;
      return { p: line[i].p.clone().lerp(line[i + 1].p, t), o: line[i].o.clone().lerp(line[i + 1].o, t).normalize() };
    };
    function galleryLine(Y, side, ext) {
      const pts = [];
      if (ext) pts.push(V3(xQ(1, Y) - ext, yOf(xQ(1, Y), Y), side * zFace));
      for (let k = 0; k <= 10; k++) pts.push(ptQ(k < 10 ? Math.pow(1 - k / 10, 1.6) : 0.005, Y, side));
      return pts.map((q, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        return { p: q, o: V3(a.z - b.z, 0, b.x - a.x).multiplyScalar(-side).normalize(), u: UP };
      });
    }
    const baluster = latheGeo([[0.065, 0], [0.05, 0.66]], 4).rotateY(Math.PI / 4);
    const column = new THREE.CylinderGeometry(0.09, 0.09, 1.66, 4, 1, true).translate(0, 0.83, 0).rotateY(Math.PI / 4);
    function balustersBetweenColumns(path, dy) {
      const s = [0]; for (let i = 1; i < path.length; i++) s.push(s[i - 1] + path[i].p.distanceTo(path[i - 1].p));
      const sAt = (k) => { const i = Math.min(path.length - 2, Math.floor(k)); return s[i] + (k - i) * (s[i + 1] - s[i]); };
      const stops = [0, ...PIERS.map((f) => sAt(NB + (f + 1) / 2 * NL)), s[s.length - 1]];
      for (let k = 0; k < stops.length - 1; k++) {
        const d = (stops[k] + stops[k + 1]) / 2; let i = 0; while (i < s.length - 2 && s[i + 1] < d) i++;
        const t = (d - s[i]) / Math.max(1e-6, s[i + 1] - s[i]), q = path[i].p.clone().lerp(path[i + 1].p, t);
        fitAdd(fit, trimMat, baluster.clone().translate(q.x, q.y + dy, q.z));
      }
    }
    const FOOT_RAIL = [[-0.07, -0.04], [0.07, -0.04], [0.07, 0.04], [-0.07, 0.04]];
    const HAND_RAIL = [[-0.09, -0.03], [0.09, -0.03], [0.08, 0.07], [-0.09, 0.07]];
    const RAIL_OUT = WALK - 0.1;
    S_TIERS.forEach((tr, i) => {
      const Yf = tr.floor, line = wallLine(Yf);
      fitAdd(fit, WALE_S, sweepGeo(line, [[-0.05, -0.26], [WALK, -0.26], [WALK, 0], [-0.05, 0]], true,
        { paint: { base: P.wale, edges: { 1: "trim" }, caps: "trim" } }));
      if (!tr.walk) return;
      const rail = off(wallLine(Yf, zFace - 0.07), RAIL_OUT);
      balustersBetweenColumns(rail, 0.12);
      fitAdd(fit, trimMat, sweepGeo(off(rail, 0, 0.08), FOOT_RAIL, true, { skip: NO_UNDERSIDE }), sweepGeo(off(rail, 0, 0.82), HAND_RAIL, true, { skip: NO_UNDERSIDE }));
      const up = S_TIERS[i + 1].floor - 0.26 - Yf;
      const colAt = (p) => { const c = column.clone(); c.scale(1, up / 1.66, 1); c.translate(p.x, p.y, p.z); fitAdd(fit, trimMat, c); };
      PIERS.forEach((f) => { const q = lineAt(line, f); colAt(q.p.addScaledVector(q.o, WALK - 0.18)); });
      [1, -1].forEach((side) => {
        const end = rail[side > 0 ? rail.length - 1 : 0].p;
        const ret = [{ p: end.clone(), o: V3(0, 0, side), u: UP }, { p: V3(xAft(Yf) + 0.06, end.y, end.z), o: V3(0, 0, side), u: UP }];
        fitAdd(fit, trimMat, sweepGeo(off(ret, 0, 0.08), FOOT_RAIL, true, { skip: NO_UNDERSIDE }), sweepGeo(off(ret, 0, 0.82), HAND_RAIL, true, { skip: NO_UNDERSIDE }));
        colAt(end);
      });
    });
    baluster.dispose(); column.dispose();
    const CORNICE = [[-0.05, -0.08], [0.2, 0.0], [0.2, 0.1], [-0.05, 0.1]], Yc = S_TIERS[2].w1 + 0.32;
    fitAdd(fit, trimMat, sweepGeo(wallLine(Yc, zFace + 0.2), CORNICE));
    [1, -1].forEach((side) => fitAdd(fit, trimMat, sweepGeo(galleryLine(Yc, side, 0.2), CORNICE)));
    const cap = [];
    for (let i = 0; i <= 12; i++) { const f = -1 + 2 * i / 12; cap.push({ p: sternPt(sternTop(f), f), o: sternOut(9, f), u: UP }); }
    fitAdd(fit, trimMat, sweepGeo(cap, [[-0.3, -0.02], [0.13, -0.02], [0.11, 0.17], [-0.3, 0.17]]));

    // the name board's quad, 5 cm proud of the stern
    const hb5 = hbAt(0, 5), sHalf = (NAME_RECT.w / 2 - 2) / NAME_RECT.k, yHalf = (NAME_RECT.h / 2 - 2) / NAME_RECT.k;
    painted.push(facing(gridGeo(8, 1, (i, j) => {
      const f = (-1 + 2 * i / 8) * sHalf / hb5, Y = NB_Y + (j ? yHalf : -yHalf);
      return sternPt(Y, f).addScaledVector(sternOut(Y, f), 0.05);
    }, (i, j) => atlasUV(NAME_RECT.x + NAME_RECT.w / 2 + (-1 + 2 * i / 8) * sHalf * NAME_RECT.k, NAME_RECT.y + NAME_RECT.h / 2 - (j ? yHalf : -yHalf) * NAME_RECT.k)), V3(-1, 0, 0)));
    atlasParts.push(...painted);

    // the rudder: a broad blade on the sternpost, coppered below the waterline, iron straps across the hinge
    const post = (y) => xPost(y) + 0.05, y0 = Y_KEEL + 0.25, yF = Y_FORM + 0.25, yT = 3.2, yC = yOf(xPost(0), Y_COPPER);
    const back = (y) => post(y) - lerp(2.5, 1.45, clamp01((y - yF) / (yT - yF))) + 0.4 * Math.pow(1 - Math.min(1, (y - y0) / 1.0), 2);
    const slab = (ya, yb) => {
      const pts = [];
      for (let k = 0; k <= 4; k++) { const y = lerp(ya, yb, k / 4); pts.push(V2(post(y), y)); }
      for (let k = 4; k >= 0; k--) { const y = lerp(ya, yb, k / 4); pts.push(V2(back(y), y)); }
      const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 0.46, bevelEnabled: false }); geo.translate(0, 0, -0.23);
      return geo;
    };
    fitAdd(fit, COPPER, slab(y0, yC)); fitAdd(fit, DARK, slab(yC, yT));
    for (let y = 1.05; y > y0; y -= 1.25) fitAdd(fit, ironMat, boxGeo(1.2, 0.13, 0.56, V3(post(y) - 0.45, y, 0)));
  }

  // ---- the bow: the head knee, the knightheads, the catheads and the bower anchors --------------
  {
    const stem = (Y) => V3(xStem(Y), yOf(xStem(Y), Y), 0);
    const Y_FOOT = 3.6, Y_HEAD = 7.9, F_TIP = 0.21;
    const foot = stem(Y_FOOT), tan = stem(Y_FOOT + 0.1).sub(stem(Y_FOOT - 0.1)).normalize();
    const tip = bs(F_TIP).add(V3(0, -bsR(F_TIP) + 0.05, 0));
    const edge = new THREE.QuadraticBezierCurve3(foot, foot.clone().addScaledVector(tan, 0.5 * foot.distanceTo(tip)), tip);
    const pts = [];
    for (let k = 0; k <= 10; k++) { const p = edge.getPoint(k / 10); pts.push(V2(p.x, p.y)); }
    for (let k = 1; k <= 4; k++) { const p = bs(F_TIP * (1 - k / 4)); pts.push(V2(p.x, p.y - bsR(F_TIP * (1 - k / 4)) + 0.05)); }
    for (let k = 4; k >= 0; k--) { const p = stem(Y_FOOT + (Y_HEAD - Y_FOOT) * k / 4); pts.push(V2(p.x - 0.35, p.y)); }
    const KNEE_W = 0.5, bevel = 0.07;
    const knee = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: KNEE_W, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1 });
    knee.translate(0, 0, -KNEE_W / 2);
    fitAdd(fit, KNEE, knee);

    [1, -1].forEach((side) => {
      const kh = V3(xStem(9) - 0.6, R_QD + bowLift - 1.6, side * 0.95);
      fitAdd(fit, DARK, boxGeo(0.4, 2.6, 0.4, kh.clone().add(V3(0, 1.0, 0))));
      fitAdd(fit, trimMat, sphereGeo(0.25, kh.clone().add(V3(0, 2.4, 0))));
      const Yc = R_QD - 0.45, tc = tOf(CAT_X, Yc), base = hullPoint(tc, Yc, side), out = levelOut(tc, Yc, side);
      const inb = base.clone().addScaledVector(out, -0.8), dir = out.clone().add(V3(0.3, 0.18, 0)).normalize(), end = base.clone().addScaledVector(dir, 2.0);
      const X = V3().crossVectors(UP, dir).normalize(), Yv = V3().crossVectors(dir, X).normalize();
      fitAdd(fit, WOOD, frameBox(0.48, 0.48, inb.distanceTo(end), inb.clone().lerp(end, 0.5), X, Yv, dir));
      fitAdd(fit, trimMat, placeGeo(new THREE.CylinderGeometry(0.27, 0.27, 0.08, 10), end.clone().addScaledVector(dir, 0.04), new THREE.Quaternion().setFromUnitVectors(UP, dir)));
      // the bower anchor (5 m shank), hanging straight down from the cathead
      const LS = 5.0, ARM_X = 1.65, ARM_Y = 1.5, RING_TOP = 0.39, ANCHOR_TURN = 30 * Math.PI / 180;
      const hang = end.clone().add(V3(0, -RING_DROP, 0));
      const aft = V3(-out.z, 0, out.x); if (aft.x > 0) aft.negate();
      const armOut = out.clone().multiplyScalar(Math.cos(ANCHOR_TURN)).addScaledVector(aft, Math.sin(ANCHOR_TURN)).normalize();
      const along = V3().crossVectors(armOut, UP).normalize();
      const frame = new THREE.Matrix4().makeBasis(armOut, UP, along).setPosition(hang.clone().add(V3(0, -RING_TOP, 0)));
      const crown = V3(0, -LS, 0), iron = [], oak = [];
      iron.push(new THREE.TorusGeometry(0.34, 0.075, 3, 6).rotateY(Math.PI / 2).translate(0, 0.05, 0), rodGeo(0.14, 0.19, V3(0, -0.25, 0), crown, 4));
      [1, -1].forEach((sx) => {
        const c = new THREE.QuadraticBezierCurve3(crown, crown.clone().add(V3(sx * 1.3, 0.1, 0)), crown.clone().add(V3(sx * ARM_X, ARM_Y, 0)));
        iron.push(new THREE.TubeGeometry(c, 3, 0.14, 4, false));
        const tp = c.getPoint(1), tg = c.getTangent(1).normalize();
        const fl = new THREE.ConeGeometry(0.48, 1.1, 4); fl.scale(0.24, 1, 1);
        fl.applyMatrix4(new THREE.Matrix4().makeBasis(V3().crossVectors(tg, V3(0, 0, 1)), tg, V3(0, 0, 1)));
        fl.translate(...tp.clone().addScaledVector(tg, -0.36).toArray());
        iron.push(fl);
      });
      const STOCK = 4.6, SW0 = 0.42, SW1 = 0.22, SY = -0.45;
      [1, -1].forEach((sz) => {
        const half = new THREE.BoxGeometry(SW0, STOCK / 2, SW0, 1, 1, 1).translate(0, STOCK / 4, 0), a = half.attributes.position;
        for (let i = 0; i < a.count; i++) if (a.getY(i) > 0.01) { a.setX(i, a.getX(i) * SW1 / SW0); a.setZ(i, a.getZ(i) * SW1 / SW0); }
        half.computeVertexNormals();
        oak.push(half.rotateX(sz * Math.PI / 2).translate(0, SY, 0));
      });
      iron.forEach((g) => fitAdd(fit, ironMat, g.applyMatrix4(frame)));
      oak.forEach((g) => fitAdd(fit, MID, g.applyMatrix4(frame)));
      const ringTop = V3(0, RING_TOP, 0).applyMatrix4(frame), blk = ringTop.clone().add(V3(0, 0.3, 0));
      fitAdd(fit, WOOD, frameBox(0.3, 0.42, 0.24, blk.clone().add(V3(0, 0.21, 0)), X, UP, V3().crossVectors(X, UP)));
      fitAdd(fit, ironMat, rodGeo(0.035, 0.035, ringTop, blk.clone().add(V3(0, 0.05, 0)), 4, true));
      [-0.12, 0, 0.12].forEach((o) => hullLines.push(end.clone().addScaledVector(X, o).add(V3(0, -0.2, 0)), blk.clone().addScaledVector(X, o * 0.6).add(V3(0, 0.42, 0)), ROPE.hemp));
    });
  }

  // ---- decks -------------------------------------------------------------------------------------
  {
    function deckGeo(x0, x1, Y, toStern) {
      const N = Math.max(3, Math.ceil((x1 - x0) * 0.4)), M = DECK_M;
      return facing(gridGeo(N, M, (i, j) => {
        const v = -1 + 2 * j / M;
        let x = lerp(x0, x1, i / N), w = deckHalf(x, Y) - 0.04;
        if (toStern && i === 0) { const p = sternPt(Y, v); x = p.x + 0.04; w = hbAt(0, Y) - 0.04; }
        return V3(x, yOf(x, Y) + CAMBER * (1 - v * v), v * w);
      }, (i, j) => { const x = lerp(x0, x1, i / N), v = -1 + 2 * j / M; return [x / DECK_TILE.x, v * deckHalf(x, Y) / DECK_TILE.z]; }), UP);
    }
    deckParts.push(deckGeo(X_QD - 1.5, X_FC + 1.5, D_UD)); // upper deck, open in the waist
    deckParts.push(deckGeo(X_POOP - 1, X_QD, D_QD)); // quarterdeck
    deckParts.push(deckGeo(xAft(D_POOP), X_POOP, D_POOP, true)); // poop, back to the taffrail
    deckParts.push(deckGeo(X_FC, xStem(D_QD) - 0.3, D_QD)); // forecastle
    // gangways along each side of the waist, with a dark rail on posts along the inner edge
    const gangY = (x, z) => deckSurfY(x, D_QD, z);
    [1, -1].forEach((side) => {
      const at = (i, j, dy = 0) => { const x = lerp(X_QD, X_FC, i / 10), w = deckHalf(x, D_QD) - 0.04, z = j ? w : w - GANG; return V3(x, gangY(x, z) + dy, side * z); };
      deckParts.push(facing(gridGeo(10, 1, (i, j) => at(i, j), (i, j) => [lerp(X_QD, X_FC, i / 10) / DECK_TILE.x, j * GANG / DECK_TILE.z]), UP));
      fitAdd(fit, WOOD, facing(gridGeo(10, 1, (i, j) => at(i, j, -0.12), () => [0, 0]), UP, true));
      const pts = [];
      for (let k = 0; k <= 8; k++) { const x = lerp(X_QD + 0.2, X_FC - 0.2, k / 8), z = deckHalf(x, D_QD) - GANG + 0.04; pts.push(V3(x, gangY(x, z), side * z)); }
      railing(fit, pts, WOOD);
    });
  }

  // ---- break walls, ladders and staircases -------------------------------------------------------
  function cask(c, s = 1) {
    const H = 1.1 * s;
    fitAdd(fit, KNEE, latheGeo([[0.34 * s, 0], [0.44 * s, H / 2], [0.34 * s, H], [0.001, H]], 6).translate(c.x, c.y, c.z));
    [0.16 * s, H - 0.16 * s].forEach((y) => fitAdd(fit, blackMat, rodGeo(0.41 * s, 0.41 * s, c.clone().add(V3(0, y - 0.04, 0)), c.clone().add(V3(0, y + 0.04, 0)), 6, true)));
  }
  function breakWall(x, Dlo, Dhi, dir, gangway) {
    const y0 = yOf(x, Dlo), y1 = yOf(x, Dhi), h = y1 - y0;
    const half = Math.min(deckHalf(x, Dlo), deckHalf(x, Dhi)) - 0.05;
    const wc = deckHalf(x, Dhi) - 0.04, zs = [-half, half];
    for (let k = 0; k <= DECK_M; k++) { const z = (-1 + 2 * k / DECK_M) * wc; if (Math.abs(z) < half) zs.push(z); }
    zs.sort((a, b) => a - b);
    const pl = gridGeo(zs.length - 1, 1, (i, j) => V3(x, j ? deckSurfY(x, Dhi, zs[i]) : y0, zs[i]), () => [0, 0]);
    fitAdd(fit, OCHRE_S, facing(pl, V3(dir, 0, 0)));
    const dh = Math.min(1.85, h - 0.15);
    [-1, 1].forEach((s) => fitAdd(fit, DARK, boxGeo(0.06, dh, 0.95, V3(x + dir * 0.03, deckY(x, Dlo, 1.4) + dh / 2, s * 1.4))));
    const xw = x - dir * 0.08;
    if (gangway) {
      const LW = 0.95, INSET = 0.3, RUN = 1.2, n = 6;
      const gIn = deckHalf(x, D_QD) - GANG, zOut = gIn - 0.05 - INSET, zIn = zOut - LW, zMid = (zIn + zOut) / 2;
      railing(fit, [V3(xw, y1, -zIn), V3(xw, y1, zIn)], WOOD);
      [1, -1].forEach((side) => {
        const xF = x + dir * (RUN + 0.03), F = V3(xF, deckY(xF, Dlo, zMid), 0), T = V3(x + dir * 0.03, deckSurfY(x, Dhi, zMid) - 0.06, 0);
        const S = T.clone().sub(F).normalize(), Yp = V3(S.y, -S.x, 0), Z1 = V3(0, 0, 1), L = F.distanceTo(T);
        [zIn + 0.04, zOut - 0.04].forEach((z) => fitAdd(fit, OCHRE_S, frameBox(0.08, 0.22, L, F.clone().lerp(T, 0.5).setZ(side * z), Z1, Yp, S)));
        for (let k = 1; k < n; k++) { const Pk = F.clone().lerp(T, k / n); fitAdd(fit, DECK_S, boxTop(0.24, 0.05, LW - 0.1, V3(Pk.x, Pk.y - 0.025, side * zMid))); }
        [zIn, zOut].forEach((z) => railing(fit, [V3(xF, F.y, side * z), V3(xw, y1, side * z)], WOOD, 1.0, 10));
        railing(fit, [V3(xw, y1, side * zOut), V3(xw, y1, side * (gIn + 0.04))], WOOD);
      });
      return;
    }
    const outer = half - 0.08, sw = 2.4, zIn = outer - sw;
    if (Dhi === D_POOP) [1, -1].forEach((side) => cask(deckPt(x + dir * 0.5, Dlo, side * (zIn - 0.5))));
    railing(fit, [V3(xw, y1, -zIn), V3(xw, y1, zIn)], WOOD);
    const n = 6, rise = h / n, tread = 0.55;
    [1, -1].forEach((side) => {
      for (let k = 1; k < n; k++) {
        const sh = k * rise, dist = (n - 1 - k + 0.5) * tread;
        fitAdd(fit, OCHRE_S, deckBox(tread, sh + 0.01, sw, V3(x + dir * dist, y0 + (sh + 0.01) / 2, side * (zIn + sw / 2)), P.deck));
      }
      railing(fit, [V3(x + dir * 4 * tread, y0 + rise, side * (zIn + 0.05)), V3(x + dir * 0.05, y0 + 5 * rise, side * (zIn + 0.05))], WOOD, 1.0, 1.1);
    });
  }
  breakWall(X_QD, D_UD, D_QD, 1, true);
  breakWall(X_POOP, D_QD, D_POOP, 1, false);
  breakWall(X_FC, D_UD, D_QD, -1, true);

  // ---- deck fittings -----------------------------------------------------------------------------
  {
    // the capstan in the waist: two plain cylinders drawn with the painted surfaces
    const cp = deckPt(4.8, D_UD);
    const add = (geo, R, y) => {
      const [x0, y0, w, h] = R, a = geo.attributes.uv;
      for (let i = 0; i < a.count; i++) a.setXY(i, (x0 + a.getX(i) * w) / ATLAS, 1 - (y0 + (1 - a.getY(i)) * h) / ATLAS);
      atlasParts.push(geo.translate(cp.x, cp.y - 0.04 + y, cp.z));
    };
    add(new THREE.CylinderGeometry(0.6, 0.76, 0.99, 10, 1, true), CAP_R.barrel, 0.495);
    add(new THREE.CylinderGeometry(0.8, 0.8, 0.24, 12, 1, true), CAP_R.drum, 1.11);
    add(new THREE.CircleGeometry(0.8, 12).rotateX(-Math.PI / 2), CAP_R.top, 1.23);
    // gratings, flat on the deck, 4 cm above the planking
    GRATINGS.forEach(([x, Y, len, wid], i) => {
      const { x: X0, w, h } = GRATE_RECTS[i];
      atlasParts.push(facing(gridGeo(1, 1, (ii, j) => deckPt(x + (ii - 0.5) * len, Y, (j - 0.5) * wid).add(V3(0, 0.04, 0)),
        (ii, j) => atlasUV(X0 + ii * w, GRATE_Y + j * h)), UP));
    });
    // the wheel on the quarterdeck, forward of the poop, and the binnacle just forward of it
    const WHEEL_X = -7.1, WHL = 0.62;
    const wb = deckPt(WHEEL_X, D_QD), R = 0.95, HUB = 1.35, PED = { x: 0.42, z: 0.5 };
    fitAdd(fit, WOOD, deckBox(PED.x, HUB + 0.2, PED.z, wb.clone().add(V3(0, (HUB + 0.2) / 2, 0)), P.midWood));
    const hub = wb.clone().add(V3(-PED.x / 2 - 0.14, HUB, 0)), AX = V3(1, 0, 0);
    const rim = placeGeo(new THREE.TorusGeometry(R, 0.08, 4, 12), hub, new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2));
    fitAdd(fit, MID, ((g) => { const n = g.toNonIndexed(); g.dispose(); n.computeVertexNormals(); return n; })(rim));
    for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI, d = V3(0, Math.cos(a), Math.sin(a)); fitAdd(fit, LIGHT, frameBox(0.08, 2 * (R + 0.3), 0.08, hub, AX, d, V3().crossVectors(AX, d))); }
    fitAdd(fit, BRONZE, rodGeo(0.15, 0.15, hub.clone().add(V3(-0.08, 0, 0)), hub.clone().add(V3(0.15, 0, 0)), 6));
    const bn = deckPt(WHEEL_X + WHL + 1.25, D_QD);
    fitAdd(fit, WOOD, deckBox(0.68, 0.1, 1.24, bn.clone().add(V3(0, 0.05, 0))));
    fitAdd(fit, MID, deckBox(0.6, 0.85, 1.16, bn.clone().add(V3(0, 0.525, 0))));
    [[-0.34, 0.3, "#2a4450"], [0, 0.2, "#e3b75a"], [0.34, 0.3, "#2a4450"]].forEach(([dz, w, hex]) =>
      fitAdd(fit, shade(hex), boxGeo(0.02, 0.26, w, bn.clone().add(V3(-0.305, 0.62, dz)))));
    [1, -1].forEach((s) => fitAdd(fit, DARK, boxGeo(0.44, 0.05, 1.3, bn.clone().add(V3(s * 0.22 * Math.cos(0.5), 1.15 - 0.22 * Math.sin(0.5), 0)),
      new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), -s * 0.5))));
    // the poop deck: the cabin skylight, the signal flag lockers, the arms chests, casks and a tub
    const poop = (x, z = 0) => deckPt(x, D_POOP, z), edgeZ = (x, inset) => deckHalf(x, D_POOP) - inset;
    const sk = poop(-25.6), SL = 2.0, SW = 1.4;
    fitAdd(fit, WOOD, deckBox(SL, 0.45, SW, sk.clone().add(V3(0, 0.22, 0))));
    [1, -1].forEach((sd) => {
      const tilt = new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), sd * 0.5);
      fitAdd(fit, shade("#2a4450"), boxGeo(SL - 0.12, 0.04, SW / 2 / Math.cos(0.5), sk.clone().add(V3(0, 0.45 + 0.17, sd * SW / 4)), tilt));
      for (let k = -1; k <= 1; k++) fitAdd(fit, MID, boxGeo(0.05, 0.06, SW / 2 / Math.cos(0.5), sk.clone().add(V3(k * (SL - 0.12) / 4, 0.46 + 0.17, sd * SW / 4)), tilt));
    });
    fitAdd(fit, MID, boxGeo(SL, 0.07, 0.08, sk.clone().add(V3(0, 0.45 + 0.35, 0))));
    [1, -1].forEach((sd) => {
      const lk = poop(-30.0, sd * 2.0);
      fitAdd(fit, WOOD, deckBox(0.6, 0.755, 2.2, lk.clone().add(V3(0, 0.3775, 0)), P.midWood));
    });
    [1, -1].forEach((sd) => [-24.6, -26.6].forEach((x) => {
      const ac = poop(x, sd * edgeZ(x, 0.55));
      fitAdd(fit, WOOD, deckBox(1.5, 0.655, 0.55, ac.clone().add(V3(0, 0.3275, 0)), P.midWood));
    }));
    const cz = (x) => edgeZ(x, 0.8);
    cask(poop(-21.2, cz(-21.2))); cask(poop(-22.15, cz(-22.15))); cask(poop(-21.65, cz(-21.65) - 0.85), 0.75);
    const tub = poop(-21.4, -cz(-21.4));
    fitAdd(fit, KNEE, latheGeo([[0.3, 0], [0.34, 0.45], [0.31, 0.45], [0.27, 0.06], [0.001, 0.06]], 6).translate(tub.x, tub.y, tub.z));
    fitAdd(fit, blackMat, rodGeo(0.33, 0.33, tub.clone().add(V3(0, 0.3, 0)), tub.clone().add(V3(0, 0.36, 0)), 6, true));
    // the belfry at the forecastle's after edge
    const bf = deckPt(X_FC + 0.7, D_QD);
    [-0.55, 0.55].forEach((dz) => fitAdd(fit, WOOD, deckBox(0.18, 1.6, 0.18, bf.clone().add(V3(0, 0.8, dz)))));
    fitAdd(fit, WOOD, boxGeo(0.4, 0.14, 1.4, bf.clone().add(V3(0, 1.62, 0))));
    const pitch = 0.6, slope = 0.62;
    [1, -1].forEach((s) => fitAdd(fit, DARK, boxGeo(slope, 0.06, 1.5, bf.clone().add(V3(s * slope / 2 * Math.cos(pitch), 1.69 + 0.18 - slope / 2 * Math.sin(pitch) + 0.18, 0)),
      new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), -s * pitch))));
    fitAdd(fit, WOOD, boxGeo(0.1, 0.1, 1.56, bf.clone().add(V3(0, 2.08, 0))));
    fitAdd(fit, BRONZE, latheGeo([[0.0, 0.0], [0.24, 0.02], [0.16, 0.22], [0.14, 0.4], [0.06, 0.46], [0.0, 0.47]], 8).translate(bf.x, bf.y + 1.0, bf.z));
    // the galley chimney
    const ch = deckPt(X_FC + 2.6, D_QD, 1.0);
    fitAdd(fit, ironMat, rodGeo(0.26, 0.26, ch, ch.clone().add(V3(0, 1.4, 0)), 8), rodGeo(0.26, 0.3, ch.clone().add(V3(0, 1.3, 0)), ch.clone().add(V3(-0.6, 1.65, 0)), 8), deckBox(0.7, 0.3, 0.7, ch.clone().add(V3(0, 0.15, 0))));
    // pin rails round each mast
    MASTS.forEach((m) => {
      const p = deckPt(m.x, m.deck), h = 0.85, s = 0.95;
      [[-s, -s], [-s, s], [s, -s], [s, s]].forEach(([dx, dz]) => fitAdd(fit, WOOD, deckBox(0.14, h, 0.14, p.clone().add(V3(dx, h / 2, dz)))));
      [-s, s].forEach((d) => {
        fitAdd(fit, MID, boxTop(2 * s + 0.2, 0.1, 0.16, p.clone().add(V3(0, h, d))), boxTop(0.16, 0.1, 2 * s + 0.2, p.clone().add(V3(d, h, 0))));
      });
    });
  }

  // ---- channels: platforms outside the hull that spread the lower shrouds -------------------------
  const CHAN = {};
  MASTS.forEach((m) => {
    const Y = CHAN_Y[m.name], n = m.shrouds, x0 = m.x + 0.7, ch = CHAN[m.name] = { Y, x0, x1: x0 - (n - 1) * m.step, 1: [], [-1]: [] };
    [1, -1].forEach((side) => {
      for (let k = 0; k < n; k++) {
        const x = x0 - k * m.step, t = tOf(x, Y), o = levelOut(t, Y, side), edge = hullPoint(t, Y, side).addScaledVector(o, 0.95);
        const low = edge.clone().add(V3(0, 0.32, 0)), dir = shroudTop(m, side).sub(low).normalize();
        ch[side].push({ o, low, up: low.clone().addScaledVector(dir, 0.95), dir });
      }
      const path = [];
      for (let k = 0; k <= 4; k++) { const x = lerp(ch.x1 - 0.5, ch.x0 + 0.5, k / 4), t = tOf(x, Y); path.push({ p: hullPoint(t, Y, side), o: levelOut(t, Y, side), u: UP }); }
      const chLen = ch.x0 - ch.x1 + 1, black = atlasUV(CH_R.x + 2, CH_R.y + CH_R.h - 2);
      atlasParts.push(sweepGeo(path, [[-0.05, -0.1], [1.05, -0.1], [1.05, 0.1], [-0.05, 0.1]], true, {
        uv: (e, i, end) => {
          if (e !== 2) return black;
          const sx = 0.5 + (i / 4 * chLen - 0.5) * CH_STEP / m.step;
          return atlasUV(CH_R.x + sx * CH_K, CH_R.y + (end ? CH_R.h : 0));
        }, capUV: black }));
      fitAdd(fit, trimMat, sweepGeo(path.map((q) => ({ p: q.p.clone().addScaledVector(q.o, 1.05), o: q.o, u: q.u })), [[-0.01, -0.06], [0.04, -0.06], [0.04, 0.06], [-0.01, 0.06]]));
      ch[side].forEach((d) => {
        hullLines.push(d.low.clone().add(V3(0, -0.1, 0)), d.up, ROPE.hemp); // the lanyard
        const a = d.low.clone().add(V3(0, -0.15, 0));
        let foot = a.clone().addScaledVector(d.dir, -2.1);
        PORTS.forEach((p) => {
          const topY = yOf(p.x, p.Y + p.h / 2 + 0.15);
          if (Math.abs(p.x - a.x) < p.w / 2 + 0.2 && foot.y < topY && a.y > topY) foot = a.clone().lerp(foot, (a.y - topY) / (a.y - foot.y));
        });
        const Yf = foot.y - sheer(foot.x);
        foot.z = side * (Math.abs(hullPoint(tOf(foot.x, Yf), Yf, side).z) + 0.06);
        hullLines.push(a, foot, ROPE.iron); // the chain
      });
    });
  });

  // ---- the hull, as one geometry: the solid batch, the painted surfaces and the decks ------------
  const hullSolid = bakeGeos(fit).get("solid");
  const hullPieces = [{ geo: hullSolid, material: SLOT.solid }, { geo: mergeGeos(atlasParts), material: SLOT.hull }, { geo: mergeGeos(deckParts), material: SLOT.deck }];

  // ---- the rig --------------------------------------------------------------------------------------
  const rf = new THREE.Group(); // scratch: every spar of the rig
  const sails = sailBook();
  const M = {}; // each built mast's handles, for the stays and sails
  const stood = MASTS.filter((m) => cfg[m.name]); // the masts the spec steps, foremost first
  const boxes = [];
  const flags = [];

  // the bowsprit, the jib-boom laid along its top with a black cap block at the bowsprit's end, and a cap at the tip
  // The bowsprit is always hers; the jib-boom only when a spar carrying two headsails is stepped on
  // it. Without one the bowsprit's cap takes the trim knob the jib-boom's end would have carried.
  const boom = cfg.sprit.spar >= 2;
  if (spec?.bowsprit !== false) {
    const bw = new THREE.Group();
    fitAdd(bw, PINE, rodGeo(bsR(0) + 0.06, bsR(1), bs(-0.12), bs(1), 8));
    fitAdd(bw, blackMat, frameBox(0.45, 1.6, 0.95, bs(1).addScaledVector(bsPerp, 0.2), bsDir, bsPerp, V3(0, 0, 1)));
    if (boom) {
      fitAdd(bw, PINE, rodGeo(0.27, 0.13, jbStart.clone().addScaledVector(bsDir, -0.4), jb(1), 6));
      fitAdd(bw, trimMat, rodGeo(0.16, 0.16, jb(0.99), jb(1.004), 6), sphereGeo(0.16, jb(1.004)));
    } else {
      fitAdd(bw, trimMat, sphereGeo(0.2, bs(1).addScaledVector(bsDir, 0.3).addScaledVector(bsPerp, 0.2)));
    }
    // the bowsprit is the hull's: it stays when she is dismasted
    hullPieces.push({ geo: bakeGeos(bw).get("solid"), material: SLOT.solid });
  }

  function buildMast(m, mi) {
    const c = cfg[m.name], cap = c.cap, set = (i) => i < cap && c.sails[i], x = m.x, r = m.r, rHead = r * 0.78;
    const raked = new THREE.Group(), rfm = new THREE.Group();
    raked.position.set(x, m.yd, 0); raked.rotation.z = m.rake; rfm.position.set(-x, -m.yd, 0); raked.add(rfm);
    const s0 = sails.parts.length;
    // lower mast: pine, eight-sided, with thin black iron bands every 1.45 m that the shader paints on;
    // from the platform to the cap it is painted black
    const yM0 = m.yd - 0.4, rAt = (y) => lerp(r, rHead, (y - yM0) / (m.top - yM0));
    const yB0 = m.yd + 1.2, nB = Math.ceil((m.top - 1.6 - yB0) / BAND.every), yB1 = yB0 + (nB - 1) * BAND.every + BAND.width + 0.3;
    const banded = rodGeo(r, rAt(yB1), V3(x, yM0, 0), V3(x, yB1, 0), 8, true), bp = banded.attributes.position;
    banded.setAttribute("aMark", new THREE.BufferAttribute(Float32Array.from({ length: bp.count }, (_, i) => (bp.getY(i) - yB0) / BAND.every), 1));
    fitAdd(rfm, PINE, banded, rodGeo(rAt(yB1), rHead, V3(x, yB1, 0), V3(x, m.top, 0), 8, true));
    fitAdd(rfm, blackMat, rodGeo(rHead, rHead * 0.95, V3(x, m.top, 0), V3(x, m.cap + 0.2, 0), 8));
    // the platform: D-shaped, top and bottom in the hull's wood, its edge in the trim colour, a rail along the back
    const tl = m.topL, a = tl * 0.33, cc = tl * 0.12, R = tl - a - cc, Wh = m.topW / 2;
    const shp = new THREE.Shape(); shp.moveTo(-a, -Wh); shp.lineTo(cc, -Wh); shp.absellipse(cc, 0, R, Wh, -Math.PI / 2, Math.PI / 2, false); shp.lineTo(-a, Wh); shp.lineTo(-a, -Wh);
    const plat = new THREE.ExtrudeGeometry(shp, { depth: 0.3, bevelEnabled: false, curveSegments: 5 });
    plat.rotateX(Math.PI / 2); plat.translate(x, m.top + 0.15, 0);
    fitAdd(rfm, KNEE, groupGeo(plat, 0)); fitAdd(rfm, trimMat, groupGeo(plat, 1)); plat.dispose();
    railing(rfm, [V3(x - a + 0.1, m.top + 0.15, -(Wh - 0.15)), V3(x - a + 0.1, m.top + 0.15, Wh - 0.15)], WOOD, 0.9, 1.0, true);
    // the lower cap, and the topmast stepped through it forward of the masthead
    const xT = x + rHead + 0.42, rT = 0.36 * (r / 0.56);
    fitAdd(rfm, blackMat, boxGeo(xT - x + 1.0, 0.42, 1.0, V3((x + xT) / 2, m.cap, 0)));
    let truck;
    const xG = xT + rT * 0.7 + 0.26, rG = 0.22 * (r / 0.56);
    if (cap === 1) { // a lower mast alone: a short pole over the cap, for the stays and the pennant
      truck = V3(xT, m.cap + 4.2, 0);
      fitAdd(rfm, PINE, rodGeo(rT, rT * 0.45, V3(xT, m.top - 0.6, 0), truck, 6));
    } else {
      fitAdd(rfm, PINE, rodGeo(rT, rT * 0.72, V3(xT, m.top - 0.6, 0), V3(xT, m.xt, 0), 8));
      fitAdd(rfm, blackMat, rodGeo(rT * 0.72, rT * 0.68, V3(xT, m.xt, 0), V3(xT, m.tmCap + 0.15, 0), 8));
      const xtW = m.topW * 0.58; // crosstrees: two fore-and-aft bars and three cross bars
      [-0.32, 0.32].forEach((z) => fitAdd(rfm, blackMat, boxGeo(2.2, 0.2, 0.14, V3(xT + 0.2, m.xt - 0.1, z))));
      [-0.55, 0.25, 0.95].forEach((dx) => fitAdd(rfm, blackMat, boxGeo(0.14, 0.14, xtW, V3(xT + dx, m.xt + 0.06, 0))));
      if (cap === 2) { // a short pole above the topmast cap, for the stays and the pennant
        truck = V3(xT, m.tmCap + 3.6, 0);
        fitAdd(rfm, PINE, rodGeo(rT * 0.6, rT * 0.35, V3(xT, m.tmCap, 0), truck, 6));
      } else { // the topgallant mast, and above it the pole for a royal
        fitAdd(rfm, blackMat, boxGeo(xG - xT + 0.7, 0.3, 0.66, V3((xT + xG) / 2, m.tmCap, 0)));
        truck = V3(xG, cap === 3 ? m.truck3 : m.truck4, 0);
        fitAdd(rfm, PINE, rodGeo(rG, rG * 0.6, V3(xG, m.xt - 0.3, 0), V3(xG, m.tg, 0), 6));
        fitAdd(rfm, PINE, rodGeo(rG * 0.6, rG * 0.32, V3(xG, m.tg, 0), truck, 6));
      }
    }
    // yards: black, tapering to the yardarms, with a footrope sagging under each half
    const yardAt = (k, xm, rm) => {
      const ry = [0.32, 0.26, 0.17, 0.12][k] * (r / 0.56 * 0.7 + 0.3);
      const y = k === 0 ? m.top - 1.25 : k === 1 ? m.xt - 1.0 : k === 2 ? m.tg - 0.75 : truck.y - 1.6;
      return { w: m.yards[k], ry, y, x: xm + rm + ry + 0.05 };
    };
    const Y = [yardAt(0, x, rHead)];
    if (cap >= 2) Y.push(yardAt(1, xT, rT * 0.75));
    if (cap >= 3) Y.push(yardAt(2, xG, rG * 0.8));
    if (cap >= 4) Y.push(yardAt(3, xG, rG * 0.4));
    Y.forEach((yd) => [1, -1].forEach((s) => {
      fitAdd(rfm, blackMat, rodCapB(yd.ry, yd.ry * 0.42, V3(yd.x, yd.y, 0), V3(yd.x, yd.y, s * yd.w / 2), 6));
      const fa = V3(yd.x - 0.1, yd.y - 0.2, s * 0.9), fb = V3(yd.x - 0.1, yd.y - 0.15, s * (yd.w / 2 - 0.3)), pts = [];
      for (let q = 0; q <= 3; q++) { const p = fa.clone().lerp(fb, q / 3); p.y -= 0.8 * Math.sin(Math.PI * q / 3) + 0.1; pts.push(p); }
      for (let q = 0; q < 3; q++) rigLines.push(m.rk(pts[q]), m.rk(pts[q + 1]), ROPE.hemp);
    }));
    // sails only where set; each foot's rounded middle clears the platform or crosstrees below it
    const footOver = (yHead, clear) => yHead - (yHead - clear) / 1.12;
    if (set(0)) sails.square(Y[0].x - 0.3, Y[0].y - 0.3, m.foot, Y[0].w * 0.94, Y[0].w * 0.98, mi, squareCloth(c.sails[0], "course"));
    if (set(1) && Y[1]) sails.square(Y[1].x - 0.3, Y[1].y - 0.3, footOver(Y[1].y - 0.3, m.top + 0.5), Y[1].w * 0.94, Y[0].w * 0.86, mi + 1.7, squareCloth(c.sails[1], "topsail"));
    if (set(2) && Y[2]) sails.square(Y[2].x - 0.3, Y[2].y - 0.3, footOver(Y[2].y - 0.3, m.xt + 0.5), Y[2].w * 0.94, Y[1].w * 0.84, mi + 3.1, squareCloth(c.sails[2], "plain"));
    if (set(3) && Y[3]) sails.square(Y[3].x - 0.3, Y[3].y - 0.3, footOver(Y[3].y - 0.3, Y[2].y + 0.4), Y[3].w * 0.94, Y[2].w * 0.86, mi + 4.4, squareCloth(c.sails[3], "plain"));
    // rake this mast's sails: each breathing point moves only in x, so its rest x and reach are re-based on the raked point
    const cR = Math.cos(m.rake);
    for (let i = s0; i < sails.parts.length; i++) {
      const sp = sails.parts[i], p = sp.pos;
      for (let k = 0; k < p.length; k += 3) { const q = m.rk(V3(p[k], p[k + 1], p[k + 2])); p[k] = q.x; p[k + 1] = q.y; p[k + 2] = q.z; }
      if (sp.anim) for (let k = 0; k < sp.anim.length; k += 3) { const amp = sp.anim[k + 1] * cR; sp.anim[k] = p[k] - amp; sp.anim[k + 1] = amp; }
    }
    // shrouds and ratlines: the lower shrouds from the masthead to the channels' outer edge, the
    // topmast shrouds from the topmast head down to the platform's rim
    [1, -1].forEach((side) => {
      const st = shroudTop(m, side), lower = CHAN[m.name][side].map((d, k) => [st.clone().add(V3(-k * 0.05, -k * 0.05, 0)), d.up]);
      const upper = [];
      if (cap >= 2) for (let k = 0; k < 3; k++) upper.push([m.rk(V3(xT - 0.1 - k * 0.15, m.xt - 0.35, side * 0.35)), m.rk(V3(x + 0.4 - k * 0.55, m.top + 0.15, side * (Wh - 0.2)))]);
      [lower, upper].forEach((setOf) => {
        if (!setOf.length) return;
        setOf.forEach(([p, q]) => rigLines.push(p, q, ROPE.tar));
        const yLo = Math.max(...setOf.map(([, q]) => q.y)) + 0.8, yHi = Math.min(...setOf.map(([p]) => p.y)) - 0.5;
        const onShroud = ([p, q], y) => q.clone().lerp(p, (y - q.y) / (p.y - q.y));
        for (let y = yLo; y < yHi; y += 1.7) for (let k = 0; k < setOf.length - 1; k++) rigLines.push(onShroud(setOf[k], y), onShroud(setOf[k + 1], y), ROPE.ratline);
      });
    });
    // this mast's spars, baked on their own so the mast has a box of its own, then into the rig
    const baked = bakeGeos(raked).get("solid");
    baked.computeBoundingBox();
    boxes.push(baked.boundingBox.clone());
    const truckAt = m.rk(truck);
    M[m.name] = { x, xT, xG, top: m.top, xt: m.xt, tg: m.tg, truck: truckAt, truckUp: truck, n: cap, yd: m.yd, at: (px, py) => m.rk(V3(px, py, 0)) };
    // her pennant: a long tapering streamer from just under the pole's tip, flown by flags.js
    // deep enough at the hoist to carry her livery at sea, its foot just clear of a royal yard
    flags.push({ x: truckAt.x, z: truckAt.y - 0.1, len: m.pennant, hoist: 1.35, fly: 0.3, wave: 0.8, part: "mast" + mi });
    return baked;
  }
  const mastGeos = stood.map((m, i) => buildMast(m, i));

  const F = M.fore, Mn = M.main, Z = M.mizzen, below = (mm) => mm.at(mm.truckUp.x, mm.truckUp.y - 2);
  // The stays: each runs from a masthead forward and down to the mast or spar ahead of it. There is
  // deliberately no mainstay: its true lead would cut through the fore course. With royals set the
  // topgallant stays leave from the topgallant masthead, under the royal. A mast not stepped has no
  // stay led to or from it.
  const tgHead = (mm) => (mm.n >= 4 ? mm.at(mm.xG, mm.tg - 0.4) : below(mm));
  const onBs = (f) => bs(f).addScaledVector(bsPerp, bsR(f));
  const sprit = spec?.bowsprit !== false;
  if (F && sprit) {
    // Three stays come forward from the foremast whatever is set on them: the forestay to the
    // bowsprit by the stem, the fore topmast stay to the bowsprit's end and the fore topgallant
    // stay to the jib-boom's end. Without a jib-boom the topgallant stay comes in to the bowsprit's
    // cap and the topmast stay sets up a little further inboard, so the two never share a point.
    const foreTop = F.at(F.x + 2.6, F.top), forestayFoot = onBs(0.1);
    const capTop = bs(1).addScaledVector(bsPerp, 0.95);
    const ftmTop = F.at(F.xT + 1.0, F.xt - 0.3), ftmFoot = onBs(boom ? 0.95 : 0.72);
    const jibTop = F.n >= 2 ? tgHead(F) : below(F), jibFoot = boom ? jb(1) : capTop;
    rigLines.push(foreTop, forestayFoot, ROPE.tar, ftmTop, ftmFoot, ROPE.tar, jibTop, jibFoot, ROPE.tar);
    // head sails, berth by berth: the fore topmast staysail on the topmast stay, and outside it the
    // jib on the stay to the jib-boom's end, which has nowhere to set without the jib-boom
    const reach = boom ? jb(1).x : bs(1).x;
    const clew = (share, stayFoot, dy) => V3(F.x + share * (reach - F.x), stayFoot.y + dy, 0);
    const headSail = (stayTop, stayFoot, tackAt, headAt, clewAt, sheetTo, belly) => {
      sails.tri(stayFoot.clone().lerp(stayTop, tackAt), stayFoot.clone().lerp(stayTop, headAt), clewAt, belly, 0.07, 0.05);
      rigLines.push(clewAt, sheetTo, ROPE.hemp);
    };
    // each stay carries whatever sail was bent on its berth, cut to that sail's own size: the outer
    // stay's sheet comes down to the bowsprit by its cap, the inner stay's to the bow
    if (boom && cfg.sprit.set[1]) {
      const c = headsailCut(cfg.sprit.set[1], 1);
      headSail(jibTop, jibFoot, c.tack, c.head, clew(c.share, jibFoot, c.dy), bs(0.97).add(V3(0, 0, bsR(0.97))), c.belly);
    }
    if (cfg.sprit.set[0]) {
      const c = headsailCut(cfg.sprit.set[0], 0);
      // without a jib-boom the run to the spar's end is shorter, so the clew stands a little further out along it
      headSail(ftmTop, ftmFoot, c.tack, c.head, clew(boom ? c.share : c.share * 1.27, ftmFoot, c.dy), forestayFoot.clone(), c.belly);
    }
  }
  if (F && Mn) {
    rigLines.push(Mn.at(Mn.xT + 1.0, Mn.xt - 0.3), F.at(F.x - 0.3, F.top - 0.3), ROPE.tar); // main topmast stay: to the fore top
    if (Mn.n >= 2) rigLines.push(tgHead(Mn), F.at(F.xT, F.xt + 0.3), ROPE.tar); // main topgallant stay: to the fore topmast head
  }
  if (Z && Mn) {
    rigLines.push(Z.at(Z.x + 0.3, Z.top - 0.6), Mn.at(Mn.x - 0.6, Mn.yd + 2.2), ROPE.tar); // mizzen stay: down to the mainmast
    rigLines.push(Z.at(Z.xT + 0.8, Z.xt - 0.3), Mn.at(Mn.x - 0.4, Mn.top - 0.6), ROPE.tar); // mizzen topmast stay: to the main top
    if (Z.n >= 2) rigLines.push(...(Z.n >= 4 ? [Z.at(Z.xG, Z.tg - 0.6), Mn.at(Mn.xT - 0.3, Mn.xt - 2.0)] : [below(Z), Mn.at(Mn.xT, Mn.xt + 0.2)]), ROPE.tar);
  }

  // spanker: gaff and boom come with the sail, riding on the raked mizzen at their jaws
  if (Z && cfg.gaff) {
    const BOOM_Y = 3.1, BOOM_OUT = 4.0, BOOM_CLEAR = 0.9;
    const throat = Z.at(Z.x - 0.5, Z.top - 1.6), jaw = Z.at(Z.x - 0.5, Z.yd + BOOM_Y);
    const taff = sternPt(sternTop(0), 0);
    const BOOM = jaw.x + 0.5 - taff.x + BOOM_OUT, GAFF = BOOM * 0.66;
    const lift = (taff.y + 0.17 + 0.21 + BOOM_CLEAR - jaw.y) / (jaw.x - taff.x);
    const boomEnd = V3(jaw.x + 0.5 - BOOM, jaw.y + lift * (BOOM - 0.5), 0), peak = throat.clone().add(V3(-GAFF * 0.92, GAFF * 0.39, 0));
    const sp = new THREE.Group();
    fitAdd(sp, blackMat, rodGeo(0.27, 0.19, jaw, boomEnd, 6), rodGeo(0.25, 0.16, throat, peak, 6));
    mastGeos.push(bakeGeos(sp).get("solid"));
    // the sail bent on the gaff, at its own size: a trysail or a gaff topsail is hoisted on the same
    // spars and stands short of the peak and the boom's end, toward the mast
    const k = gaffSize(cfg.gaff), tack = Z.at(Z.x - 0.7, Z.yd + BOOM_Y + 0.2), thr = Z.at(Z.x - 0.7, Z.top - 1.75);
    const pk = peak.clone().add(V3(0, -0.2, 0)), cl = boomEnd.clone().add(V3(0.2, 0.15, 0));
    sails.quad(tack, thr, thr.clone().lerp(pk, k), tack.clone().lerp(cl, k), 1.2 * k);
  }

  const rigPieces = mastGeos.map((g) => ({ geo: g, material: SLOT.solid }));
  const sailGeo = sails.finish();
  if (sailGeo) rigPieces.push({ geo: sailGeo, material: SLOT.sail });

  return {
    hull: mergeGroups(hullPieces),
    rig: rigPieces.length ? mergeGroups(rigPieces) : null,
    hullLines: hullLines.length ? lineGeo(hullLines) : null,
    rigLines: rigLines.length ? lineGeo(rigLines) : null,
    flags,
    masts: stood.length,
    boxes,
    guns,
  };
}

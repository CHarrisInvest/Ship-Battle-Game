/**
 * THE HULL FORMS — each class modelled from her own reference proportions.
 *
 * `shipref.js` was generated and kept for exactly this: a hull drawn from her real length, beam,
 * freeboard, sheer, castles and stern is a hull that looks like herself, where every class drawn on
 * the galleon's hull at the galleon's size looked like the galleon. This module turns those reference
 * figures into the two geometries the game draws:
 *
 *   `menu`  the 3-D model `galleon.js` builds: her station table, castles, gunports, bowsprit and
 *           the mast geometry per station, all in the renderer's own units.
 *   `sea`   the top-down hull the fight draws: her world length and beam (which are also her
 *           collision ellipse), her outline, her stern cabin, and where her masts stand.
 *
 * THE GALLEON IS THE AUTHORED ANCHOR: her station table, castles, bow, bowsprit and mast geometry
 * are the literal numbers this game has always drawn, and a handful of her small fittings (the stern
 * lights, the window bands, the hatch) are re-derived as ratios that land within a few hundredths of
 * a unit of the old literals, which is sub-pixel at any size the plate draws. Every other class is
 * derived by the same rules from her own row: her length and beam set the size, `freeboard` the depth of side,
 * `sheer` how the deck sweeps up at the ends, `castle` whether and how high her decks rise fore and
 * aft, `bowFine` how her entry narrows, `tumblehome` how the sides roll in above the waterline,
 * `stern` whether she shows a transom, a round tuck or a windowed gallery, and `battery` where every
 * gun she carried stood. So a cutter is a long, low, fine-ended hull with no castles and five small
 * ports, and a first rate is a wall of timber, three tiers of ports, a quarterdeck of guns above
 * them and stern lights, and neither is a scaled galleon.
 *
 * Sizes are deliberately compressed: real lengths run 24 ft to 205 ft, a factor of nearly nine, and
 * a fleet drawn at true ratio would put boats nobody can see beside ships that fill the screen. Both
 * views raise length and beam to a power below one, anchored so the galleon keeps exactly the size
 * she has always been, which also keeps the fight's feel unchanged for the middle of the fleet.
 */

import { HULL_REF } from "./shipref.js";

/* ---- the galleon's authored hull, the anchor everything else is derived against ---------------- */

// [x, w, sheer, wl] per station: position along the keel, half-beam at the rail, deck height at the
// side, and half-beam at the waterline. These are the numbers `galleon.js` has always drawn.
export const GALLEON_ST = [
  [-60, 9.6, 23.2, 4.4], [-52, 12.6, 20.6, 9.4], [-40, 15.3, 17.0, 14.1],
  [-26, 17.6, 14.2, 18.3], [-12, 18.9, 12.7, 20.5], [2, 18.7, 12.3, 20.2],
  [16, 17.4, 12.7, 18.6], [30, 14.6, 14.1, 15.3], [42, 10.8, 16.2, 10.6],
  [52, 6.2, 18.6, 5.4], [56, 4.4, 19.9, 3.8], [60, 1.7, 21.2, 1.2],
];

/**
 * Where a mast stands and the air its sails occupy, per station: the galleon's authored geometry,
 * which every other class scales from. `slots` are square-sail bands at the height `ref` names;
 * `tri` is fore-and-aft canvas as fractions of the masthead. The bowsprit is the odd one: a spar
 * over the bow with tack and head runs for its headsails and a sling for square canvas beneath it.
 */
export const GALLEON_GEOM = {
  fore: {
    x: 36, pole: 88.64, ref: 78, r0: 1.05, r1: 0.58, hoist: 0.8114,
    shrouds: [-8, -2.5], ratlines: true, stay: { from: 0.963, to: 1.0 },
    slots: [
      { span: 15.5, zt: 49.8, zb: 33.9, bulge: 5.2, seg: 10 },
      { span: 10.5, zt: 67.6, zb: 53.4, bulge: 4.0, seg: 9 },
      { span: 7.6, zt: 76.2, zb: 69.4, bulge: 3.0, seg: 8 },
    ],
    tri: [{ zb: 0.24, zt: 0.90 }, { zb: 0.64, zt: 0.96 }, { zb: 0.82, zt: 1.0 }],
  },
  main: {
    x: 0, pole: 90, ref: 90, r0: 1.2, r1: 0.64, hoist: 0.7964,
    shrouds: [-8, -2.5], ratlines: true, stay: { from: 0.9722, to: 1.0 },
    slots: [
      { span: 18.5, zt: 48.2, zb: 30.1, bulge: 6.2, seg: 11 },
      { span: 13.0, zt: 68.5, zb: 52.7, bulge: 4.6, seg: 10 },
      { span: 8.5, zt: 81.0, zb: 71.9, bulge: 3.4, seg: 8 },
    ],
    tri: [{ zb: 0.20, zt: 0.90 }, { zb: 0.62, zt: 0.96 }, { zb: 0.80, zt: 1.0 }],
  },
  mizzen: {
    x: -32, pole: 87.84, ref: 65, r0: 0.95, r1: 0.52, hoist: 1.0,
    shrouds: [-3.5], ratlines: false, stay: { from: 0.9262, to: 0.9156 },
    slots: [
      { span: 13.4, zt: 41.5, zb: 28.4, bulge: 4.5, seg: 10 },
      { span: 9.4, zt: 55.6, zb: 47.2, bulge: 3.3, seg: 9 },
      { span: 6.1, zt: 62.2, zb: 57.0, bulge: 2.4, seg: 8 },
    ],
    tri: [{ zb: 0.4538, zt: 0.9 }, { zb: 0.72, zt: 0.97 }, { zb: 0.84, zt: 1.0 }],
  },
  bonaventure: {
    x: -44, pole: 70, ref: 70, r0: 0.82, r1: 0.44, hoist: 1.0,
    shrouds: [-3.0], ratlines: false, stay: { from: 0.92, to: 0.86 },
    slots: [
      { span: 10.5, zt: 42.0, zb: 28.0, bulge: 3.6, seg: 9 },
      { span: 7.4, zt: 56.0, zb: 46.5, bulge: 2.7, seg: 8 },
      { span: 5.0, zt: 63.5, zb: 57.5, bulge: 2.0, seg: 8 },
    ],
    tri: [{ zb: 0.55, zt: 0.86 }, { zb: 0.74, zt: 0.94 }, { zb: 0.86, zt: 1.0 }],
  },
  bowsprit: {
    spar: true, x: 66,
    tack: [0.34, 0.98], head: [0.40, 0.76], foot: 0.5,
    slung: [0.42, 0.82], span: [9.0, 6.2], drop: [11.0, 7.6],
  },
};

// The galleon's reference row, restated as the constants her model was drawn to. Every scale factor
// below is a ratio against these, so handing her own row back reproduces her exactly.
const G = { lod: 130, beam: 38, fb: 12, sheer: 4, castle: 4, mastH: 0.95 };

// The galleon's own menu form: her authored geometry, wrapped in the same shape generated forms use.
const GALLEON_MENU = {
  Lh: 60,
  ST: GALLEON_ST,
  bulwark: 2.7,
  k: 1, // the general fitting scale: stairs, hatch gratings, port trim, flag sizes
  aft: { x0: -60, x1: -18, z: 23.6 },
  fore: { x0: 24, x1: 50, z: 20.2 },
  bow: { x0: 42, x1: 60, rake: 8.5 },
  bowsprit: { heel: [50, 0, 22.6], tip: [88, 0, 33.5], r0: 1.3, r1: 0.66 },
  // Four ports a side at the authored size, and nothing on her upper works: she is the anchor, and
  // what she draws is what this game has always drawn rather than anything derived from a row.
  ports: { hw: 2.6, hh: 2.2, gun: 1, rows: [{ f: 0.47, xs: [-21, -8, 6, 19] }], works: [] },
  lights: true,
  beak: true,
  geom: GALLEON_GEOM,
  span: 248,
};

/* ---- timber ------------------------------------------------------------------------------------ */

/**
 * WHAT SHE IS BUILT OF, as a cast over the palette. The reference's `species` and `timber` columns
 * were recorded for exactly this: a pine launch is paler and yellower than an oak brig, teak runs
 * warm and golden, and live oak is the dense, dark timber a heavy frigate was famous for. Each
 * species is a per-channel cast applied to the wooden parts of the palette — canvas, glass and flags
 * are not timber and keep their colours — and the `timber` score leans the brightness a little
 * further, so the two 1.12-teak ships sit slightly deeper than the cast alone. Oak at 1 is the
 * identity: the galleon, and most of the fleet, paint exactly as they always did.
 */
const SPECIES = {
  // eased off full paleness so a pine boat stays clear of the beach sand she fights beside
  Pine: { bright: 1.1, r: 1.03, g: 1.0, b: 0.88 },
  Cedar: { bright: 1.06, r: 1.07, g: 0.97, b: 0.94 },
  Teak: { bright: 1.02, r: 1.08, g: 0.99, b: 0.86 },
  "Live oak": { bright: 0.88, r: 0.99, g: 1.0, b: 1.03 },
  Oak: { bright: 1, r: 1, g: 1, b: 1 },
};

function timberOf(ref) {
  const s = SPECIES[ref.species] || SPECIES.Oak;
  // denser timber reads a little darker; oak at 1 stays the identity
  const bright = s.bright * Math.pow(1 / (ref.timber || 1), 0.35);
  return { bright, r: s.r, g: s.g, b: s.b };
}

/** One hex colour under a timber cast. The identity cast returns the colour unchanged. */
export function tintTimber(hex, t) {
  if (!t || (t.bright === 1 && t.r === 1 && t.g === 1 && t.b === 1)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const ch = (c, m) => Math.max(0, Math.min(255, Math.round(c * t.bright * m)));
  return (
    "#" +
    [ch(n >> 16 & 255, t.r), ch(n >> 8 & 255, t.g), ch(n & 255, t.b)]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}

const OAK = { bright: 1, r: 1, g: 1, b: 1 };

/* ---- deriving a class's menu model ------------------------------------------------------------- */

// Size compression: a fleet drawn at true ratio is boats nobody can see beside ships that fill the
// screen, so lengths and beams are raised to this power of their ratio to the galleon's.
const MENU_POW = 0.68;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * WHAT HER STERN IS, beyond whether it is windowed. `full` is how much of her beam she keeps right
 * aft against the galleon's own taper: a scow barely narrows, a square transom stays wide, a round
 * or pear tuck keeps some fullness, and an overhanging stern draws in hard. `rake` leans the stern
 * itself: the rail carries aft over the waterline, which is a raking transom on a Baltimore clipper,
 * the long overhang of a xebec, or the gentle counter of an elliptical stern. Types not named here
 * taper as the galleon does, which is what a gallery stern is.
 */
const STERNS = {
  Scow: { full: 0.5, rake: 0 },
  Round: { full: 0.2, rake: 0 },
  Pear: { full: 0.28, rake: 0 },
  Elliptical: { full: 0.15, rake: 3.2 },
  "Raking transom": { full: 0.08, rake: 5.5 },
  Overhanging: { full: -0.38, rake: 8.5 },
  Square: { full: 0.45, rake: 0 },
};

/**
 * THE PORT ITSELF, and the room one needs. `hw` and `hh` are the galleon's authored opening, which is
 * the largest any class shows; `sill` is how far a port's lower edge stands clear of the water and
 * `head` how far its upper edge stays under the sheer; `pad` is how much of her own depth a port
 * keeps between herself and the tier above; `fill` is how much of the space between two ports along
 * a deck the port itself may take. The last two are what a port is sized against, and they are near
 * enough what a real one measured: about two fifths of the way from one port to the next, and a
 * clear port's depth of timber between one deck's ports and the next deck's.
 */
const PORT = { hw: 2.6, hh: 2.2, sill: 0.9, head: 0.4, pad: 1.15, fill: 0.42 };

/**
 * HER ESTABLISHMENT, deck by deck, as guns A SIDE.
 *
 * `battery` is written "lower/.../upper+quarterdeck/forecastle", guns aboard, the way a ship was
 * rated: "10" is a cutter, "28+8/2" a frigate, "30+20" a spar-decked heavy frigate whose upper
 * battery ran the length of her, "28/28/30+12/2" a first rate. A row with no battery at all falls
 * back to every gun she carried on one deck, which is right for a boat and wrong for nothing else
 * that has a row in the table.
 */
export function parseBattery(ref) {
  const [decks, works] = String(ref.battery == null ? ref.histGuns || 0 : ref.battery).split("+");
  const half = (t) => Math.max(0, Math.round(Number(t) / 2) || 0);
  const tiers = decks.split("/").map(half).filter((n) => n > 0).slice(0, 3);
  return {
    decks: tiers.length ? tiers : [half(ref.histGuns || 0)],
    works: works ? works.split("/").map(half).slice(0, 2) : [],
  };
}

/**
 * WHERE EVERY GUN SHE CARRIED ACTUALLY STOOD, which is two unlike fittings and not one.
 *
 * A GUN DECK is a continuous battery pierced through her side, so every tier runs the whole length
 * of her, under the castles the way a lower deck really did. HER UPPER WORKS carried the rest in the
 * open behind a bulwark, with no lidded port to show, and on a two-decker they are what leaves her
 * waist empty between the quarterdeck group and the forecastle group.
 *
 * It used to be `histGuns / 2` split evenly over the tiers `decks` named, with the top tier clipped
 * to between the castle breaks. That put a quarterdeck's guns into the ship's side, gave a frigate a
 * second tier she never had, and crammed a first rate's top tier into 0.58 of her length at a
 * spacing of 2.8 against a port 5.2 wide: not a row of ports but one continuous smear. The waist is
 * in fact the one stretch of a two-decker's side with no ports in it at all.
 *
 * THE PORT IS SIZED TO THE SIDE IT IS CUT IN, which is the other half of the same fault. The
 * authored port is 4.4 deep, which is more than the whole freeboard of half this fleet and more than
 * three tiers of them can stand in on any of it, so the tiers are spread over the usable side and
 * the port sized to the space left between them and along them. Nothing is ever larger than the
 * galleon's own, and a hull with the room keeps hers exactly.
 */
function portsOf(ref, { Lh, ST, aft, fore }) {
  const bat = parseBattery(ref);
  const sheerAt = (x) => {
    let i = 0;
    while (i < ST.length - 2 && ST[i + 1][0] < x) i++;
    return lerp(ST[i][2], ST[i + 1][2], clamp((x - ST[i][0]) / (ST[i + 1][0] - ST[i][0] || 1), 0, 1));
  };
  // evenly along the run, and inset by half a gap so the end ports do not sit on her stem and post
  const run = (a, b, n) => Array.from({ length: n }, (_, j) => lerp(a, b, n > 1 ? (j + 0.5) / n : 0.5));
  const lo = -0.86 * Lh, hi = 0.66 * Lh;

  // The shallowest side under the battery is what every tier has to fit inside: her sheer sweeps up
  // toward the ends, so the ports have more room there than the figure this solves against.
  let side = Infinity;
  for (let i = 0; i <= 12; i++) side = Math.min(side, sheerAt(lerp(lo, hi, i / 12)));

  const tiers = bat.decks.length;
  let hh = Math.min(PORT.hh, (side - PORT.sill - PORT.head) / (2 + 2 * PORT.pad * (tiers - 1)));
  let hw = hh * (PORT.hw / PORT.hh);
  // and she can be pierced no thicker along a deck than there is timber to pierce
  const tight = Math.min(...bat.decks.map((n) => (hi - lo) / n));
  if (hw > PORT.fill * tight) { const t = (PORT.fill * tight) / hw; hw *= t; hh *= t; }

  // Her topmost tier sits just under her rail, which is where a flush-decked ship's one deck of guns
  // goes too, and the rest hang below it at the spacing the solve left.
  const top = side - PORT.head - hh, bottom = PORT.sill + hh;
  const step = tiers > 1 ? (top - bottom) / (tiers - 1) : 0;
  const rows = bat.decks.map((n, i) => ({ f: (top - (tiers - 1 - i) * step) / side, xs: run(lo, hi, n) }));

  /* HER UPPER WORKS. Two figures are her quarterdeck and her forecastle, each group kept to the
     castle it stood on. One figure is a battery running the whole length of her upper works, as a
     spar-decked frigate's did, which lands partly on each castle and partly along her waist rail:
     `deck` is which of the three a gun stands on, and the renderer takes its height from there. */
  const works = [];
  const group = (deck, a, b, n) => { if (n > 0) works.push({ deck, xs: run(a, b, n) }); };
  const inset = 0.05 * Lh;
  if (bat.works.length > 1) {
    if (aft) group("aft", aft.x0 + inset, aft.x1 - inset, bat.works[0]);
    if (fore) group("fore", fore.x0 + inset, fore.x1 - inset, bat.works[1]);
  } else if (bat.works.length === 1) {
    const stands = (x) => (aft && x <= aft.x1 ? "aft" : fore && x >= fore.x0 ? "fore" : "rail");
    const xs = run(lo, hi, bat.works[0]);
    for (const deck of ["aft", "rail", "fore"]) {
      const g = xs.filter((x) => stands(x) === deck);
      if (g.length) works.push({ deck, xs: g });
    }
  }

  // `gun` is what the barrel standing out of a port scales by: the authored gun belongs to the
  // authored port and looks stuck on a smaller one.
  return { hw, hh, gun: hh / PORT.hh, rows, works };
}

function menuForm(ref) {
  const lf = Math.pow(ref.lod / G.lod, MENU_POW); // length scale
  const wf = Math.pow(ref.beam / G.beam, MENU_POW); // beam scale
  const k = Math.pow(lf, 0.75); // fittings, sheer sweep, castle heights: with the size, but gently
  const Lh = 60 * lf;
  const maxW = 18.9 * wf;
  const zMid = Math.max(2.8, ref.freeboard * 0.923); // depth of side amidships, feet to model units
  const bulwark = clamp(2.7 * Math.sqrt(lf), 1.5, 3.2);

  // The deck sweeps up toward the ends by her sheer score, more at the stern than the bow, the way
  // the galleon's own 12 stations do. Profiles below are the galleon's, normalised.
  const riseStern = ref.sheer * 2.72 * k;
  const riseBow = ref.sheer * 2.22 * k;
  const SHEER_AFT = [1, 0.761, 0.431, 0.174, 0.037, 0];
  const SHEER_FWD = [0, 0.045, 0.202, 0.438, 0.708, 0.854, 1];

  // Rail and waterline half-beam profiles, normalised from the galleon's stations, then pulled in
  // forward by how fine her entry is and rolled in or flared by her tumblehome.
  const XF = [-1, -0.867, -0.667, -0.433, -0.2, 0.033, 0.267, 0.5, 0.7, 0.867, 0.933, 1];
  const WN = [0.508, 0.667, 0.810, 0.931, 1.0, 0.989, 0.921, 0.772, 0.571, 0.328, 0.233, 0.09];
  const WLN = [0.215, 0.459, 0.688, 0.893, 1.0, 0.985, 0.907, 0.746, 0.517, 0.263, 0.185, 0.059];
  const wlMax = maxW * (1 + 0.021 * ref.tumblehome);
  const fine = (t) => (t > 0.25 ? 1 - 0.055 * (ref.bowFine - 3) * ((t - 0.25) / 0.75) : 1);
  const sternShape = STERNS[ref.stern] || { full: 0, rake: 0 };
  const aftFill = (t) => (t < -0.5 ? 1 + sternShape.full * ((-t - 0.5) / 0.5) : 1);

  const ST = XF.map((t, i) => {
    const x = t * Lh;
    const sheer =
      zMid +
      (i <= 5 ? SHEER_AFT[i] * riseStern : 0) +
      (i >= 5 ? SHEER_FWD[i - 5] * riseBow : 0);
    const w = Math.max(0.8, maxW * WN[i] * fine(t) * Math.min(1.9, aftFill(t)));
    const wl = Math.max(0.5, wlMax * WLN[i] * fine(t) * Math.min(1.9, aftFill(t)));
    return [x, w, sheer, wl];
  });

  // Castles: whether her decks rise at all is her castle score. 1 is an open boat; 2 raises a
  // quarterdeck; 3 and up add a forecastle, and the heights climb with the score.
  const aft = ref.castle >= 2 ? { x0: -Lh, x1: -0.3 * Lh, z: zMid + ref.castle * 2.83 * k } : null;
  const fore = ref.castle >= 3 ? { x0: 0.4 * Lh, x1: 0.833 * Lh, z: zMid + ref.castle * 1.98 * k } : null;

  const ports = portsOf(ref, { Lh, ST, aft, fore });

  // The bow rake and the bowsprit hang off the forward stations the same way the galleon's do. An
  // open boat's bowsprit steeves lower: the galleon's angle came with her built-up head, and on a
  // low hull the same angle read as a spar pointing at the sky.
  const bow = { x0: 0.7 * Lh, x1: Lh, rake: 8.5 * k };
  const fcz = fore ? fore.z : ST[10][2];
  const steeve = fore ? 0.287 : 0.16;
  const bowsprit = {
    heel: [0.833 * Lh, 0, fcz + 2.4 * k],
    tip: [1.467 * Lh, 0, fcz + 2.4 * k + steeve * 0.634 * Lh],
    r0: 1.3 * Math.sqrt(k), r1: 0.66 * Math.sqrt(k),
  };

  // Stern lights are a windowed stern: a gallery or a stern castle. A transom or a round tuck has
  // none, whatever she cost.
  const lights = /aller|castle/i.test(ref.stern || "") && ref.castle >= 3;

  // Mast geometry: the galleon's stations scaled into this hull. Heights go with the hull and with
  // her own rig height; yards go with the beam; everything up the pole keeps its proportions.
  const zf = Math.pow(lf, 0.85) * ((ref.mastHeight || 1) / G.mastH);
  const rf = Math.sqrt(zf);
  const geom = {};
  for (const [name, g0] of Object.entries(GALLEON_GEOM)) {
    if (g0.spar) {
      geom[name] = {
        ...g0, x: g0.x * lf,
        span: g0.span.map((v) => v * wf), drop: g0.drop.map((v) => v * zf),
      };
      continue;
    }
    geom[name] = {
      x: g0.x * lf, pole: g0.pole * zf, ref: g0.ref * zf, r0: g0.r0 * rf, r1: g0.r1 * rf,
      hoist: g0.hoist, shrouds: g0.shrouds.map((v) => v * lf), ratlines: g0.ratlines, stay: g0.stay,
      slots: g0.slots.map((s) => ({ span: s.span * wf, zt: s.zt * zf, zb: s.zb * zf, bulge: s.bulge * wf, seg: s.seg })),
      tri: g0.tri,
    };
  }

  // The plate box was cut for the galleon; a class that would overflow it draws at a smaller scale
  // instead of poking through the frame, and everything the galleon's size or under keeps hers.
  const reach = Math.max(bowsprit.tip[0] + 8, Lh + 10);
  const highest = geom.main.pole + 12;
  const span = Math.max(248, reach * 2.62, highest * 2.55);

  return {
    Lh, ST, bulwark, k, aft, fore, bow, bowsprit, ports, lights, beak: !!fore, geom, span,
    sternRake: sternShape.rake * k,
    timber: timberOf(ref),
  };
}

/* ---- deriving a class's hull at sea ------------------------------------------------------------ */

// The fight compresses harder than the menu: the sea is 2000 across and a first rate at true ratio
// to a launch would fill a phone screen. Anchored so the galleon keeps the 36 by 13 hull every ship
// used to share, which is also what keeps the middle of the fleet feeling as it always did.
const SEA_POW = 0.62;

function seaForm(ref, menu) {
  const L = clamp(36 * Math.pow(ref.lod / G.lod, SEA_POW), 16, 52);
  const W = clamp(13 * Math.pow(ref.beam / G.beam, SEA_POW), 5.5, 20);

  // Outline points, bow first, clockwise down the starboard side: a fine entry pulls the shoulders
  // aft, and the stern is the type the reference names. A transom cuts flat; a round or pear tuck
  // comes nearly to a point; a scow barely narrows; a square stern stays wide right aft; a raking
  // transom carries a long flat counter; an overhanging stern runs out to a narrow point past where
  // a transom would stop; an elliptical counter rounds out a little further aft than a plain tuck.
  const shoulder = 0.5 - (0.115 + 0.03 * ref.bowFine);
  const pts = [[0.5, 0]];
  const side = (v) => {
    pts.push([shoulder, -v]);
    if (ref.stern === "Scow") { pts.push([-0.44, -v * 0.96], [-0.5, -v * 0.55]); }
    else if (ref.stern === "Square") { pts.push([-0.43, -v], [-0.48, -v * 0.72]); }
    else if (ref.stern === "Raking transom") { pts.push([-0.4, -v], [-0.5, -v * 0.6]); }
    else if (ref.stern === "Overhanging") { pts.push([-0.36, -v * 0.92], [-0.52, -v * 0.14]); }
    else if (ref.stern === "Round" || ref.stern === "Pear" || ref.stern === "Elliptical") { pts.push([-0.4, -v], [-0.5, -v * 0.2]); }
    else { pts.push([-0.38, -v], [-0.48, -v * 0.5]); }
  };
  side(0.5);
  const starboard = pts.slice(1).map(([u, v]) => [u, -v]).reverse();
  const outline = [...pts, ...starboard].map(([u, v]) => [u * L, v * W]);

  // Her stern cabin is her aft castle: open boats have none, and the height climbs with the score.
  const castle =
    ref.castle >= 2
      ? { fx: -0.3 * L, bx: -0.47 * L, hw: 0.42 * W, h: 2.2 * ref.castle }
      : null;

  const sizeF = Math.pow(L / 36, 0.9);
  const masts = { fore: 0.306 * L, main: 0.028 * L, mizzen: -0.25 * L, bonaventure: -0.39 * L };
  const tops = { fore: 30, main: 36, mizzen: 26, bonaventure: 20 };
  for (const kName of Object.keys(tops)) tops[kName] = Math.max(9, tops[kName] * sizeF * ((ref.mastHeight || 1) / G.mastH));
  const wBase = { fore: 14, main: 18, mizzen: 13, bonaventure: 10 };
  for (const kName of Object.keys(wBase)) wBase[kName] = Math.max(4, wBase[kName] * Math.pow(W / 13, 0.9));

  const deckH = clamp(4 * Math.pow(W / 13, 0.5), 2.4, 5.2);
  return { L, W, outline, castle, masts, tops, wBase, deckH };
}

// The galleon's own sea numbers: exactly the hull every ship used to draw.
const GALLEON_SEA = {
  L: 36, W: 13,
  outline: [[18, 0], [11, -6], [-13, -6], [-17, 0], [-13, 6], [11, 6]],
  castle: { fx: -11, bx: -17, hw: 5, h: 9 },
  masts: { fore: 11, main: 1, mizzen: -9, bonaventure: -14 },
  tops: { fore: 30, main: 36, mizzen: 26, bonaventure: 20 },
  wBase: { fore: 14, main: 18, mizzen: 13, bonaventure: 10 },
  deckH: 4,
};

/* ---- the forms, one per class, worked out once ------------------------------------------------- */

const FORMS = new Map();

/** The default form: the galleon this game has always drawn, for her own class and for anything unknown. */
export const DEFAULT_FORM = { id: "galleon", menu: GALLEON_MENU, sea: GALLEON_SEA, timber: OAK };

/** The form for one class: her menu model, her hull at sea and her timber, derived from her reference row. */
export function hullForm(id) {
  if (!id || id === "galleon") return DEFAULT_FORM;
  let form = FORMS.get(id);
  if (!form) {
    const ref = HULL_REF[id];
    if (!ref) return DEFAULT_FORM;
    const menu = menuForm(ref);
    form = { id, menu, sea: seaForm(ref, menu), timber: menu.timber };
    FORMS.set(id, form);
  }
  return form;
}

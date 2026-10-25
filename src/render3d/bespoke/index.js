/**
 * THE BESPOKE SHIPS' REGISTRY: which classes have a hand-modelled 3D ship of their own, and how one
 * is dressed for whoever sails her.
 *
 * `shipModel` in `shipmodel.js` asks here first: a class listed below is built by her own file
 * (`bespokeOf(hullId).build(spec)`) and every other class is the face list `galleon.js` builds from
 * her form. The 2D fallback and the catalogue bench still draw every class from her form; this is
 * the 3D sea's and the 3D plate's, and only theirs.
 *
 * A bespoke ship's materials are hers for the ship, not shared: her livery is a uniform of her own
 * solid material (the trim the kit's `MARK.trim` vertices take), her painted hull is a texture sheet
 * painted in that livery with her fitted ports open and the rest shut, and her timber is a tint over
 * both. `dressBespoke` makes that set for one ship; the atlases are cached by what they show, so
 * eleven ships of one class in one livery share one sheet, and `clearBespoke` lets them all go.
 */

import * as THREE from "three";
import { C } from "../../render/palette.js";
import { hullForm, timberCast } from "../../hullform.js";
import { solidMaterial, hullMaterial, deckMaterial, sailMaterial, flagMaterial, toTex } from "./kit.js";
import { FIRST_RATE, FIRST_RATE_FRAME, buildFirstRate, paintAtlas as paintFirstRate, SLOT as FIRST_RATE_SLOT, PORTS_A_SIDE as FIRST_RATE_PORTS, BATTERY as FIRST_RATE_BATTERY } from "./firstRate.js";
import { SECOND_RATE, SECOND_RATE_FRAME, buildSecondRate, paintAtlas as paintSecondRate, SLOT as SECOND_RATE_SLOT, PORTS_A_SIDE as SECOND_RATE_PORTS, BATTERY as SECOND_RATE_BATTERY } from "./secondRate.js";
import { THIRD_RATE, THIRD_RATE_FRAME, buildThirdRate, paintAtlas as paintThirdRate, SLOT as THIRD_RATE_SLOT, PORTS_A_SIDE as THIRD_RATE_PORTS, BATTERY as THIRD_RATE_BATTERY } from "./thirdRate.js";
import { FOURTH_RATE, FOURTH_RATE_FRAME, buildFourthRate, paintAtlas as paintFourthRate, SLOT as FOURTH_RATE_SLOT, PORTS_A_SIDE as FOURTH_RATE_PORTS, BATTERY as FOURTH_RATE_BATTERY } from "./fourthRate.js";

/** The trim a bespoke ship wears until a layer dresses her: the gold the viewer's own ship flies, as on the menu's plate. */
export const BESPOKE_TRIM = C.own;

/**
 * One entry per class with a model of her own:
 *   build(spec)                   her geometry for a rig spec, in metres (see her file for the shape of it)
 *   paintAtlas({ trim, guns, name, band })  her texture sheet, as a canvas
 *   length, beam                  her drawn size in metres, which the reference row repeats
 *   slot                          the material slots her geometry's groups index
 *   frame                         { reach, top } in metres: her furthest bowsprit tip and highest
 *                                 truck at any fit, which the menu frames her by
 *   ports, battery                what she is pierced for: her ports a side, and her establishment in
 *                                 the reference row's notation, which the bespoke test holds her row to
 */
const BESPOKE = {
  firstRate: { ...FIRST_RATE, build: buildFirstRate, paintAtlas: paintFirstRate, slot: FIRST_RATE_SLOT, frame: FIRST_RATE_FRAME,
    ports: FIRST_RATE_PORTS, battery: FIRST_RATE_BATTERY },
  secondRate: { ...SECOND_RATE, build: buildSecondRate, paintAtlas: paintSecondRate, slot: SECOND_RATE_SLOT, frame: SECOND_RATE_FRAME,
    ports: SECOND_RATE_PORTS, battery: SECOND_RATE_BATTERY },
  thirdRate: { ...THIRD_RATE, build: buildThirdRate, paintAtlas: paintThirdRate, slot: THIRD_RATE_SLOT, frame: THIRD_RATE_FRAME,
    ports: THIRD_RATE_PORTS, battery: THIRD_RATE_BATTERY },
  fourthRate: { ...FOURTH_RATE, build: buildFourthRate, paintAtlas: paintFourthRate, slot: FOURTH_RATE_SLOT, frame: FOURTH_RATE_FRAME,
    ports: FOURTH_RATE_PORTS, battery: FOURTH_RATE_BATTERY },
};

/** The bespoke entry for a hull id, or null for a class drawn from her form. */
export const bespokeOf = (hullId) => (hullId && BESPOKE[hullId]) || null;
/** Every class that has a model of her own. */
export const bespokeIds = () => Object.keys(BESPOKE);

/**
 * A timber cast (`timberCast` in hullform.js: a brightness and a per-channel multiplier over sRGB)
 * as a linear colour a material can multiply by. The cast works on sRGB bytes, so its factors are
 * raised to the display gamma to land about where `tintTimber` puts the palette.
 */
export function tintOf(cast) {
  if (!cast || (cast.bright === 1 && cast.r === 1 && cast.g === 1 && cast.b === 1)) return null;
  const k = (m) => Math.pow(Math.max(0, cast.bright * m), 2.2);
  return new THREE.Color(k(cast.r), k(cast.g), k(cast.b));
}

/** The tint a ship of this class is drawn under: her captain's timber if she has one, her class's own if not. */
const tintFor = (hullId, timber) => tintOf(timber ? timberCast(timber) : hullForm(hullId).timber);

/**
 * What a ship's livery bands are painted in on her sheet so that they come out as her livery: her
 * timber's tint multiplies the whole sheet, so it is divided back out of the band's colour here
 * (as far as a colour can go), and the bands match her moulding and her flags rather than reading a
 * shade darker on a captain's live oak than on a rival's plain hull.
 */
function bandFor(trim, tint) {
  if (!tint) return trim;
  const c = new THREE.Color(trim);
  c.setRGB(Math.min(1, c.r / Math.max(tint.r, 1e-3)), Math.min(1, c.g / Math.max(tint.g, 1e-3)), Math.min(1, c.b / Math.max(tint.b, 1e-3)));
  return "#" + c.getHexString();
}

/* ---- the atlases ------------------------------------------------------------------------------- */

const ATLASES = new Map(); // "hull|trim|band|guns|name" -> { tex, refs }

function atlasKey(entry, { trim, band, guns, name }) {
  return `${entry.id}|${trim}|${band || trim}|${guns}|${name || ""}`;
}

/** The sheet a ship of this class shows in this livery with these guns aboard, shared and counted. */
function holdAtlas(entry, how) {
  const key = atlasKey(entry, how);
  let a = ATLASES.get(key);
  if (!a) {
    a = { tex: toTex(entry.paintAtlas(how)), refs: 0 };
    ATLASES.set(key, a);
  }
  a.refs++;
  return { key, tex: a.tex };
}
function letGoAtlas(key) {
  const a = ATLASES.get(key);
  if (!a) return;
  a.refs--;
  // kept while it has no holder: a round brings the same ship back on the next frame, and a sheet is
  // cheap to keep and dear to paint. `clearBespoke` is where they go.
}

/**
 * Paint the sheets a round will want before it starts, so no ship's first frame waits on a canvas:
 * `wants` is a list of `{ hullId, trim, guns, name, timber }`, `timber` the captain's species for a
 * captain's ship. Sheets already painted cost nothing.
 */
export function prewarmBespoke(wants) {
  for (const w of wants) {
    const entry = bespokeOf(w.hullId);
    if (!entry) continue;
    const held = holdAtlas(entry, { trim: w.trim, band: bandFor(w.trim, tintFor(w.hullId, w.timber)), guns: w.guns, name: w.name });
    letGoAtlas(held.key);
  }
}

/* ---- dressing a ship ----------------------------------------------------------------------------- */

/**
 * The materials one bespoke ship wears, in her slots' order, for her hull and rig meshes to index:
 *
 *   trim   the colour her trim, pennants, stern carving and name board take (her livery)
 *   guns   her fitted broadside a side, for which ports are open
 *   tint   a linear colour her timber is multiplied by, or null
 *   name   what is painted across her stern
 *
 * Returns `{ mats, flag, lit, dispose() }`: `mats` for the meshes, `flag` for her pennants, `lit`
 * the materials a hit's light goes on. Dispose it when she goes.
 */
export function dressBespoke(entry, { trim = BESPOKE_TRIM, guns, tint = null, name = "" } = {}) {
  const held = holdAtlas(entry, { trim, band: bandFor(trim, tint), guns, name });
  const mats = [];
  mats[entry.slot.solid] = solidMaterial({ trim, tint });
  mats[entry.slot.hull] = hullMaterial(held.tex, { tint });
  mats[entry.slot.deck] = deckMaterial({ tint });
  mats[entry.slot.sail] = sailMaterial();
  const flag = flagMaterial(trim);
  return {
    mats, flag, lit: [mats[entry.slot.solid], mats[entry.slot.hull]],
    dispose() {
      for (const m of mats) m.dispose();
      flag.dispose();
      letGoAtlas(held.key);
    },
  };
}

/** Let go of every painted sheet. For a renderer's teardown; a ship still drawn paints hers again. */
export function clearBespoke() {
  for (const a of ATLASES.values()) a.tex.dispose();
  ATLASES.clear();
}

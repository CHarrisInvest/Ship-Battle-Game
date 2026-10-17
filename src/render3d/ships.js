/**
 * THE SHIPS ON THE 3D SEA. Owned by the ships layer (see the module contract in
 * docs/superpowers/specs/2026-10-15-three-renderer-design.md).
 *
 * Every ship afloat is her own `shipModel` at sea, the same model the menu turns, placed where she
 * is drawn `alpha` of the way through the last step and on her heading blended the short way round,
 * exactly as the 2D sea placed her. Around that model this layer hangs what is hers alone:
 *
 *   - her livery: her topsides, bulwarks and castle walls painted in her colour (the look's `fill`,
 *     which is `C.player` for the viewer's own ship, as the 2D hulls were filled), her flags and a
 *     band along her rail in it too (gold for the viewer's own), on materials cloned for her. A
 *     rail band alone was a pixel wide at phone zoom and every rival read as the same brown ship;
 *     the painted side is what matches her to her dot on the radar;
 *   - her rig, never under a readable size: a small craft's masts are scaled up about their feet
 *     until her rig stands at least `RIG_FLOOR` of her length (and `RIG_MIN` units) over the
 *     water, the way the 2D sea rig exaggerated it, or a gundalow at sea is a bean with no mast;
 *   - her heel: the look's roll into a turn with the idle heel on the swell, the 2D figure;
 *   - her flags blown: down the wind when she lies stopped, swinging round to stream astern as she
 *     gathers way (flags.js), each ship's wave started at her own phase so a fleet does not flap in
 *     step;
 *   - a hit: a brief, faint warm light over her timber, off `look.flash`, held low and squared so
 *     her colours and the toon bands survive a broadside landing hit after hit;
 *   - a dismasting: every mast and what is set on the bowsprit struck, a broken stump left standing;
 *   - her bow wave, a curl of foam at the stem that grows with her speed, by the 2D wave's figures;
 *   - her shadow: a soft blob on the water under every hull, and the sun's as well where the tier
 *     has shadows. The sun's alone left a dismasted hull or a small craft pasted on the water.
 *
 * A SINKING. The engine takes a ship off the sea the step she sinks, and the 2D sea let her vanish.
 * Here the model she was is kept a moment longer: she lists to the side she was heeled to, goes
 * down by the bow or the stern, carries her way a little and settles under in `SINK_TIME`. It is
 * drawing only: it starts from the last place she was drawn, never reads the world again, and the
 * engine never hears of it. Her end-of-life is decided by this layer, from her not being afloat in
 * `world.ships` any more; the round's own "sunk" words and wreckage are fx's.
 *
 * The menu model is built from the waterline up, so this layer gives every hull the body under it
 * as well (`hullBits`): a heel or a ship going down by the head lifts one side or one end out of
 * the water, and without it that is an open shell. She lists and settles with her hull still
 * showing for the first part of it, then goes under, and the opaque sea hides what is below.
 *
 * Nothing here allocates per frame once a ship is built: the blend and `labelOf`'s answer are
 * scratches, each ship's entry is stamped with the frame that saw her, a hit's light is written only
 * when it changes, and the bow wave rewrites its own buffer in place. Geometry that does not depend
 * on her speed (the rail band and underwater body per class, the stump, the blob) is shared, and her
 * few materials are clones of the shared ones, made when she first appears and disposed with her.
 */

import { SX, SY } from "../render/view.js";
import { norm, clamp } from "../sim/index.js";
import { rigSpec } from "../shipyard.js";
import { hullForm } from "../hullform.js";
import { WIND } from "./flags.js";

const SINK_TIME = 2.5; // seconds from the last step she was afloat to under the water
const WARM = [1.0, 0.92, 0.78]; // the hit's light, a warm white, as linear-ish multipliers
const FLASH_MAX = 0.35; // look.flash as fxEvents sets it on a hit
const BOW_N = 14; // segments along the bow wave's curl
const CAP_N = 12; // segments round its cap
const FOAM = "#eaf6f4";
const FLASH_GAIN = 0.12; // how much warm light a fresh hit adds to her timber
const RIG_FLOOR = 0.8; // her rig stands at least this share of her length over the water...
const RIG_MIN = 14; // ...and at least this many units
const RIG_MAX_SCALE = 2.2; // and is never blown up more than this
const LIVERY_MIX = 0.92; // how far her painted planking goes from the timber to her colour

/**
 * Give a clone of the shared timber material her livery: every vertex the ship model marks
 * `paint` (shipmodel.js) takes `color` in place of the timber, keeping a little of each strake's
 * light and dark so she still reads as planked. One program serves every ship; the colour is a
 * uniform of her own.
 */
function paintWith(mat, color) {
  const uLivery = { value: color };
  mat.userData.livery = uLivery;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uLivery = uLivery;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float paint;\nvarying float vPaint;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPaint = paint;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uLivery;\nvarying float vPaint;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          float lum = dot(vColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          vec3 coat = uLivery * clamp(0.72 + 1.5 * lum, 0.86, 1.1);
          diffuseColor.rgb = mix(diffuseColor.rgb, coat, vPaint * ${LIVERY_MIX.toFixed(3)});
        }`,
      );
  };
  mat.customProgramCacheKey = () => "ship-livery";
  return mat;
}

// a stable small hash of an id, for which way a ship goes down
function hashId(id) {
  const str = String(id);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeIn = (t) => t * t;

export function createShipLayer(scene, ctx) {
  const { THREE } = ctx;
  const C = ctx.palette;
  const root = new THREE.Group();
  root.name = "ships";
  scene.add(root);

  /** id -> entry; see `makeEntry` */
  const live = new Map();
  /** entries going down, no longer in `live` */
  const sinking = [];
  let lastFx = null;
  let frame = 0;
  const pos = { x: 0, y: 0, h: 0 }; // scratch for the blend
  const label = { gx: 0, gy: 0, h: 0, roll: 0, topZ: 0 }; // labelOf's answer, reused

  // ---- shared pieces --------------------------------------------------------------------------

  // a soft disc: solid to 0.55 of the way out, then fading to nothing at the rim
  const blobGeo = (() => {
    const N = 28, pos = [0, 0, 0], col = [0, 0, 0, 1], idx = [];
    for (const [r, a] of [[0.55, 1], [1, 0]]) {
      for (let i = 0; i < N; i++) {
        const t = (i / N) * Math.PI * 2;
        pos.push(Math.cos(t) * r, 0, Math.sin(t) * r);
        col.push(0, 0, 0, a);
      }
    }
    for (let i = 0; i < N; i++) {
      const a = 1 + i, b = 1 + ((i + 1) % N), c = 1 + N + i, d = 1 + N + ((i + 1) % N);
      idx.push(0, b, a, a, b, d, a, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(idx);
    return g;
  })();
  // under the sun's own shadow on the high tier it only has to ground her, so it is lighter there
  const blobMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false,
    opacity: ctx.quality.shadows ? 0.34 : 0.42,
  });
  // a broken mast: a short tapering post, base at the origin, a unit tall
  const stumpGeo = new THREE.CylinderGeometry(0.42, 0.55, 1, 7).translate(0, 0.5, 0);
  const stumpMats = new Map(); // spar colour -> material (shared toon material, cached by toon.js)
  const bottomMats = new Map(); // dark timber colour -> material (likewise)
  /** hull id + scale -> { trim, bottom, freeboard }; see `hullBits` */
  const hullGeos = new Map();

  // her heel as drawn: the look's roll into a turn, and a gentle idle heel on the swell
  const rollOf = (look) => (look ? look.roll + Math.sin(look.rollPhase * 1.2) * 0.05 : 0);

  function blendInto(s, alpha, out) {
    out.x = s.px + (s.x - s.px) * alpha;
    out.y = s.py + (s.y - s.py) * alpha;
    out.h = s.pHeading + norm(s.heading - s.pHeading) * alpha;
    return out;
  }

  /**
   * What this layer adds to a hull, per class and scale, built from her own menu stations (`ST` rows
   * are `[x, half-breadth at the rail, sheer, half-breadth at the waterline]`) and shared by every
   * ship of the class:
   *
   *   trim       her livery: a band down the outside of her bulwark from the sheer to the rail and
   *              a cap along its top, both sides and across the stern, laid a hair proud of the
   *              planking so it never fights it for depth
   *   bottom     the body under her waterline, which the menu model never needed: a V from each
   *              station's waterline down to a keel. It keeps the open underside of a hull built
   *              from the waterline up from showing when she heels or goes down by the head
   *   freeboard  the height of her sheer amidships, in sea units
   */
  function hullBits(hullId, k) {
    const key = `${hullId}|${k}`;
    let bits = hullGeos.get(key);
    if (bits) return bits;
    const menu = hullForm(hullId).menu;
    const ST = menu.ST, B = menu.bulwark || 1.5, BOW = menu.bow;
    const SR = menu.sternRake || 0, SX0 = ST[0][0], SX1 = SX0 + 0.22 * (ST[ST.length - 1][0] - SX0);
    // galleon.js's rake of the stern at the rail and of the stem at the waterline
    const sternShift = (x) => {
      if (!SR || x >= SX1) return 0;
      const t = (SX1 - x) / (SX1 - SX0);
      return -SR * t * t;
    };
    const bowShift = (x) => {
      if (!BOW || x <= BOW.x0) return 0;
      const t = (x - BOW.x0) / (BOW.x1 - BOW.x0);
      return -BOW.rake * t * t;
    };
    const lerp = (a, b, t) => a + (b - a) * t;
    // sample the stations finely enough that the band follows her sheer
    const xs = [];
    for (let i = 0; i < ST.length - 1; i++) for (let j = 0; j < 3; j++) xs.push([i, j / 3]);
    xs.push([ST.length - 2, 1]);
    const rows = xs.map(([i, t]) => {
      const x = lerp(ST[i][0], ST[i + 1][0], t);
      return { x, w: lerp(ST[i][1], ST[i + 1][1], t), sheer: lerp(ST[i][2], ST[i + 1][2], t), wl: lerp(ST[i][3], ST[i + 1][3], t) };
    });
    const geometry = (out) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(out), 3));
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      return geo;
    };
    // menu (x, y, z) into the model frame (X bow, Y up, Z starboard), scaled to sea
    const P = (x, y, z) => [x * k, z * k, y * k];
    const quad = (out, a, b, c, d) => out.push(...a, ...b, ...c, ...a, ...c, ...d);

    const trim = [];
    const OUT = 0.14, CAP = 0.7;
    const lo = (r) => r.sheer + 0.05, hi = (r) => r.sheer + B + 0.08;
    for (const side of [-1, 1]) {
      for (let i = 0; i < rows.length - 1; i++) {
        const r0 = rows[i], r1 = rows[i + 1];
        const x0 = r0.x + sternShift(r0.x), x1 = r1.x + sternShift(r1.x);
        const w0 = side * (r0.w + OUT), w1 = side * (r1.w + OUT);
        quad(trim, P(x0, w0, lo(r0)), P(x1, w1, lo(r1)), P(x1, w1, hi(r1)), P(x0, w0, hi(r0)));
        const c0 = side * Math.max(0, r0.w - CAP), c1 = side * Math.max(0, r1.w - CAP);
        quad(trim, P(x0, w0, hi(r0)), P(x1, w1, hi(r1)), P(x1, c1, hi(r1)), P(x0, c0, hi(r0)));
      }
    }
    const s0 = rows[0], xs0 = s0.x + sternShift(s0.x) - OUT, ws0 = s0.w + OUT;
    quad(trim, P(xs0, -ws0, lo(s0)), P(xs0, ws0, lo(s0)), P(xs0, ws0, hi(s0)), P(xs0, -ws0, hi(s0)));

    const bottom = [];
    const maxWl = Math.max(...ST.map((r) => r[3]));
    const ring = rows.map((r) => {
      const x = r.x + bowShift(r.x), d = 0.3 * maxWl + 0.4 * r.wl;
      return [P(x, -r.wl, 0), P(x, -r.wl * 0.6, -0.55 * d), P(x, 0, -d), P(x, r.wl * 0.6, -0.55 * d), P(x, r.wl, 0)];
    });
    for (let i = 0; i < ring.length - 1; i++) {
      for (let j = 0; j < 4; j++) quad(bottom, ring[i][j], ring[i + 1][j], ring[i + 1][j + 1], ring[i][j + 1]);
    }
    for (const end of [ring[0], ring[ring.length - 1]]) {
      for (let j = 1; j < 4; j++) bottom.push(...end[0], ...end[j], ...end[j + 1]);
    }
    const mid = ST.reduce((m, r) => (r[1] > m[1] ? r : m), ST[0]);
    bits = { trim: geometry(trim), bottom: geometry(bottom), freeboard: mid[2] * k };
    hullGeos.set(key, bits);
    return bits;
  }

  /** A bow wave's geometry of her own, rewritten in place each frame: the curl, then its cap. */
  function bowGeometry() {
    const nStrip = 2 * (BOW_N + 1), nCap = CAP_N + 1;
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array((nStrip + nCap) * 3);
    const c = new Float32Array((nStrip + nCap) * 4);
    const idx = [];
    for (let i = 0; i < BOW_N; i++) {
      const a = 2 * i, b = a + 1, d = a + 2, e = a + 3;
      idx.push(a, d, b, b, d, e);
    }
    const c0 = nStrip;
    for (let i = 0; i < CAP_N; i++) idx.push(c0, c0 + 1 + i, c0 + 1 + ((i + 1) % CAP_N));
    // the curl fades out toward the ends of its arms; the cap is solid in the middle, soft at the rim
    const col = new THREE.Color(FOAM);
    for (let i = 0; i <= BOW_N; i++) {
      const t = i / BOW_N, a = Math.pow(Math.sin(Math.PI * t), 0.6) * 0.9 + 0.1;
      for (let j = 0; j < 2; j++) c.set([col.r, col.g, col.b, a], (2 * i + j) * 4);
    }
    c.set([col.r, col.g, col.b, 1], c0 * 4);
    for (let i = 0; i < CAP_N; i++) c.set([col.r, col.g, col.b, 0.35], (c0 + 1 + i) * 4);
    geo.setAttribute("position", new THREE.BufferAttribute(p, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("color", new THREE.BufferAttribute(c, 4));
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60); // it moves with her; never culled wrongly
    return geo;
  }

  /**
   * The bow wave at speed share `sf`, by the 2D wave's figures: a curl from one shoulder round the
   * stem to the other, reaching forward of her stem as she speeds up, and a cap of foam at its head.
   * Model frame, in the yawed (not heeled) group, just over the water.
   */
  function writeBow(geo, s, sf) {
    const p = geo.attributes.position.array;
    const hullA = s.hullA, hullB = s.hullB;
    const ax = hullA + 2 * sf; // the control point at the stem
    const len = (10 + 10 * sf) * (hullA / 18), spread = (6 + 6 * sf) * (hullB / 6.5);
    const ex = hullA + 2 - len;
    const half = (1.3 + 1.4 * sf) * 0.5;
    const Y = 0.35;
    for (let i = 0; i <= BOW_N; i++) {
      const t = i / BOW_N, u = 1 - t;
      // quadratic from the port arm's end, through the stem, to the starboard arm's end
      const x = u * u * ex + 2 * u * t * ax + t * t * ex;
      const z = u * u * -spread + t * t * spread;
      const dx = 2 * u * (ax - ex) + 2 * t * (ex - ax);
      const dz = 2 * u * spread + 2 * t * spread;
      const l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l, nz = dx / l;
      const o = 2 * i * 3;
      p[o] = x + nx * half; p[o + 1] = Y; p[o + 2] = z + nz * half;
      p[o + 3] = x - nx * half; p[o + 4] = Y; p[o + 5] = z - nz * half;
    }
    // the cap stands where the curl turns, at the middle of the curve
    const cx = 0.5 * ex + 0.5 * ax, cap = 2 + 1.5 * sf;
    const c0 = 2 * (BOW_N + 1) * 3;
    p[c0] = cx; p[c0 + 1] = Y + 0.02; p[c0 + 2] = 0;
    for (let i = 0; i < CAP_N; i++) {
      const a = (i / CAP_N) * Math.PI * 2, o = c0 + (1 + i) * 3;
      p[o] = cx + Math.cos(a) * cap; p[o + 1] = Y + 0.02; p[o + 2] = Math.sin(a) * cap;
    }
    geo.attributes.position.needsUpdate = true;
  }

  // ---- one ship ------------------------------------------------------------------------------

  function makeEntry(s, look) {
    const model = ctx.shipModel(rigSpec(s.loadout), { units: "sea", phase: (hashId(s.id) % 628) / 100 });
    const [timber0, canvas0, flag0] = model.materials;
    const livery = s.id === lastFx.me ? C.gold : look.fill;
    const timber = paintWith(timber0.clone(), new THREE.Color(look.fill));
    const canvas = canvas0.clone();
    const flag = flag0.clone();
    flag.color.set(livery);
    const floor = canvas0.emissive.clone();
    const mats = [timber, canvas, flag];
    const meshes = [model.parts.hull, model.parts.bowsprit, model.parts.sprit, ...model.parts.masts].filter(Boolean);
    for (const m of meshes) m.material = mats;
    for (const m of model.flags.meshes) m.material = flag;

    // the whole of her, yawed on her heading; the model inside it heels, pitches and settles
    const outer = new THREE.Group();
    outer.name = "ship:" + s.id;
    outer.add(model.group);

    // her livery along the rail
    const trimMat = flag.clone();
    trimMat.side = THREE.DoubleSide;
    trimMat.polygonOffset = true;
    trimMat.polygonOffsetFactor = -1;
    trimMat.polygonOffsetUnits = -2;
    const hullId = s.loadout.hull.id;
    const bits = hullBits(hullId, model.scale);
    const trim = new THREE.Mesh(bits.trim, trimMat);
    trim.name = "trim";
    trim.castShadow = false;
    trim.receiveShadow = true;
    model.group.add(trim);
    // and her body under the water, in her darkest timber
    const dark = look.cols.dark;
    let bm = bottomMats.get(dark);
    if (!bm) bottomMats.set(dark, (bm = ctx.toon.material({ color: dark, side: THREE.DoubleSide })));
    const bottom = new THREE.Mesh(bits.bottom, bm);
    bottom.name = "bottom";
    model.group.add(bottom);

    // a small craft's rig, scaled up about each mast's foot until it reads
    let rigTop = 0;
    for (const m of model.parts.masts) rigTop = Math.max(rigTop, m.geometry.boundingBox.max.y);
    const want = Math.max(RIG_FLOOR * model.length, RIG_MIN);
    const rigScale = rigTop > 0 ? clamp(want / rigTop, 1, RIG_MAX_SCALE) : 1;
    if (rigScale > 1) {
      for (const m of model.parts.masts) {
        const bb = m.geometry.boundingBox, fx0 = (bb.min.x + bb.max.x) / 2, fy0 = Math.max(0, bb.min.y);
        m.scale.setScalar(rigScale);
        m.position.set(fx0 * (1 - rigScale), fy0 * (1 - rigScale), 0);
      }
    }
    const height = Math.max(model.height, rigTop * rigScale);

    // the stump, stood where her mainmast was: the tallest mast's foot
    let stump = null;
    if (model.parts.masts.length) {
      let tall = model.parts.masts[0];
      for (const m of model.parts.masts) if (m.geometry.boundingBox.max.y > tall.geometry.boundingBox.max.y) tall = m;
      const bb = tall.geometry.boundingBox;
      const spar = look.cols.spar;
      let sm = stumpMats.get(spar);
      if (!sm) stumpMats.set(spar, (sm = ctx.toon.material({ color: spar })));
      stump = new THREE.Mesh(stumpGeo, sm);
      stump.name = "stump";
      const r = Math.max(0.35, model.beam * 0.045);
      stump.scale.set(r, Math.min(8, model.height * 0.22), r);
      stump.position.set((bb.min.x + bb.max.x) / 2, bb.min.y, 0);
      stump.rotation.set(0.12, 0, 0.28); // broken off and leaning
      stump.castShadow = true;
      stump.visible = false;
      model.group.add(stump);
    }

    // the bow wave
    const bowGeo = bowGeometry();
    const bowMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false });
    const bow = new THREE.Mesh(bowGeo, bowMat);
    bow.name = "bowwave";
    bow.renderOrder = 4; // over the wakes (3), the shallows and the surf
    bow.frustumCulled = false;
    outer.add(bow);

    // her contact shadow: a soft dark blob under her, offset down and right as the sun has it
    const blob = new THREE.Mesh(blobGeo, blobMat);
    blob.name = "blob";
    blob.scale.set(s.hullA * 1.1, 1, s.hullB * 1.2 + 2 / 0.6);
    blob.renderOrder = 3; // over the shallows and the surf, so she is shadowed in from the shore as well
    blob.frustumCulled = false;
    root.add(blob);

    root.add(outer);
    return {
      id: s.id, model, outer, mats, floor, trimMat, trim, bottom, freeboard: bits.freeboard, height, rigScale,
      stump, bow, bowGeo, bowMat, blob,
      stamp: 0, x: 0, y: 0, h: 0, roll: 0, speed: 0, mastDown: false, flashK: -1,
      sink: null, // { t, pitch, list, vx, vy, depth }
    };
  }

  function disposeEntry(e) {
    e.outer.removeFromParent();
    e.model.group.remove(e.trim);
    e.model.group.remove(e.bottom);
    if (e.stump) e.model.group.remove(e.stump);
    for (const m of e.model.parts.masts) { m.scale.setScalar(1); m.position.set(0, 0, 0); }
    e.model.dispose();
    if (e.blob) e.blob.removeFromParent();
    for (const m of e.mats) m.dispose();
    e.trimMat.dispose();
    e.bowGeo.dispose();
    e.bowMat.dispose();
  }

  function setFlash(e, k) {
    // k is 0..1, falling over a third of a second: a faint warm light on her timber, squared so it
    // is mostly gone by the middle of that. Her canvas and colours are left alone, so a ship under
    // a broadside is still the colour she was and still lit in bands; the hit itself is the
    // splinters and the smoke.
    if (k === e.flashK) return;
    e.flashK = k;
    const g = k * k * FLASH_GAIN;
    e.mats[0].emissive.setRGB(WARM[0] * g, WARM[1] * g, WARM[2] * g);
  }

  function setMastDown(e, down) {
    if (e.mastDown === down) return;
    e.mastDown = down;
    for (const m of e.model.parts.masts) m.visible = !down;
    if (e.model.parts.sprit) e.model.parts.sprit.visible = !down;
    if (e.stump) e.stump.visible = down;
  }

  /** She is gone from the sea: start her going down from where she was last drawn. */
  function startSinking(e) {
    const hsh = hashId(e.id);
    const byBow = (hsh & 1) === 0;
    const side = Math.abs(e.roll) > 0.04 ? Math.sign(e.roll) : (hsh & 2) ? 1 : -1;
    e.sink = {
      t: 0,
      pitch: (byBow ? -1 : 1) * 0.22, // radians about her beam: bow down is negative
      list: side * 0.55,
      // she carries a little of her way, and loses it fast
      vx: Math.cos(e.h) * e.speed * 0.25, vy: Math.sin(e.h) * e.speed * 0.25,
      // enough to take her trucks under even with her high end raised by the trim
      depth: e.height + 4 + (e.model.length / 2) * Math.sin(0.22),
      roll0: e.roll,
    };
    setFlash(e, 0);
    e.bow.visible = false;
    sinking.push(e);
  }

  function stepSinking(e, dt) {
    const k = e.sink;
    k.t += dt;
    const t = Math.min(1, k.t / SINK_TIME);
    // her way carries her on a little and dies away
    const decay = Math.exp(-2 * dt);
    e.x += k.vx * dt; e.y += k.vy * dt;
    k.vx *= decay; k.vy *= decay;
    // first she lists and settles by the head (or the stern) with her hull still showing, then she
    // goes, faster as she fills
    const lean = easeOut(Math.min(1, t / 0.45));
    const pitch = k.pitch * lean;
    const list = k.roll0 + (k.list - k.roll0) * lean;
    const settle = 0.55 * e.freeboard * easeOut(Math.min(1, t / 0.4));
    const y = -(settle + easeIn(Math.max(0, (t - 0.3) / 0.7)) * k.depth);
    e.outer.position.set(e.x, 0, e.y);
    e.outer.rotation.set(0, -e.h, 0);
    e.model.group.position.set(0, y, 0);
    e.model.group.rotation.set(-list, 0, pitch, "XYZ");
    // her way is gone, so her flags fall back to the wind as she goes
    e.model.flags.blow(WIND.sea - e.h, 0, dt);
    if (e.blob) {
      e.blob.position.set(e.x + 1.5, 0.2, e.y + 4);
      e.blob.rotation.y = -e.h;
      e.blob.visible = t < 0.6;
    }
    return t >= 1;
  }

  // ---- the frame -----------------------------------------------------------------------------

  function clearAll() {
    for (const e of live.values()) disposeEntry(e);
    live.clear();
    for (const e of sinking) disposeEntry(e);
    sinking.length = 0;
  }

  // she was not afloat this frame: off the live list and going down
  function goneIfUnseen(e, id) {
    if (e.stamp === frame) return;
    live.delete(id);
    startSinking(e);
  }

  function update(world, fx, alpha, dt = 0) {
    // a fresh picture is a fresh round: nothing from the last one goes down in this one
    if (fx !== lastFx) { clearAll(); lastFx = fx; }
    frame++;
    const ships = world.ships;
    for (let i = 0; i < ships.length; i++) {
      const s = ships[i];
      if (!s.alive) continue;
      const look = ctx.lookOf(fx, s);
      // keyed by id alone: a ship never changes her rig mid-round, and a copied world (the one a
      // sunk captain watches) carries copies of the same loadouts
      let e = live.get(s.id);
      if (!e) { e = makeEntry(s, look); live.set(s.id, e); }
      e.stamp = frame;
      blendInto(s, alpha, pos);
      const roll = rollOf(look);
      e.x = pos.x; e.y = pos.y; e.h = pos.h; e.roll = roll; e.speed = s.spdCur || 0;
      e.outer.position.set(pos.x, 0, pos.y);
      e.outer.rotation.set(0, -pos.h, 0);
      e.model.group.position.set(0, 0, 0);
      e.model.group.rotation.set(-roll, 0, 0);
      setMastDown(e, !!s.mastDown);
      setFlash(e, clamp(look.flash / FLASH_MAX, 0, 1));
      e.model.flags.blow(WIND.sea - pos.h, e.speed, dt);
      // the bow wave, subtle at cruise and pronounced on a charge
      const sf = clamp((e.speed - 28) / 110, 0, 1);
      e.bow.visible = sf > 0.03;
      if (e.bow.visible) {
        writeBow(e.bowGeo, s, sf);
        e.bowMat.opacity = 0.18 + 0.4 * sf;
      }
      e.blob.position.set(pos.x + 1.5, 0.2, pos.y + 4);
      e.blob.rotation.y = -pos.h;
    }
    live.forEach(goneIfUnseen);
    for (let i = sinking.length - 1; i >= 0; i--) {
      if (stepSinking(sinking[i], dt)) {
        disposeEntry(sinking[i]);
        sinking.splice(i, 1);
      }
    }
  }

  /** Where the overlay hangs a ship's bars: her keel in view space, her heading, heel and rig top. */
  function labelOf(s, alpha) {
    blendInto(s, alpha, pos);
    const e = live.get(s.id);
    const look = lastFx ? ctx.lookOf(lastFx, s) : null;
    // one answer reused: the overlay reads it at once and keeps nothing
    label.gx = SX(pos.x, ctx.view); label.gy = SY(pos.y, ctx.view); label.h = pos.h; label.roll = rollOf(look);
    label.topZ = (e ? e.height : 24) + 6;
    return label;
  }

  function dispose() {
    clearAll();
    for (const b of hullGeos.values()) { b.trim.dispose(); b.bottom.dispose(); }
    hullGeos.clear();
    blobGeo.dispose();
    blobMat.dispose();
    stumpGeo.dispose();
    stumpMats.clear(); // the materials are toon.js's, disposed with its cache
    bottomMats.clear();
    root.removeFromParent();
  }

  return { update, labelOf, dispose };
}

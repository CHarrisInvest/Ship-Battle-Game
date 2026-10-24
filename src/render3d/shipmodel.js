/**
 * THE SHIP, AS ONE MODEL: galleon.js's face list turned into three.js geometry.
 *
 * There is one ship model in the game. The menu has always turned a real 3-D hull built from her
 * class's form and her own rig (`buildShip` in `galleon.js`); this takes that same face list and
 * hands it to the GPU, so the ship on the plate and the ship at sea are the same object at two
 * sizes. Every class keeps her own hull, timber, ports and rig, because they come from the same
 * `rigSpec` and `hullForm` the menu reads.
 *
 * AXES. The engine's sea is x across, y down the screen and z up. three.js is Y up, so a point at
 * engine (x, y, z) is three (x, z, y) everywhere in the 3D renderer (`toThree` in camera.js). A
 * model is built in her own frame the same way: three X is toward her bow, three Z is abeam (the
 * engine's starboard, +v), three Y is up from the waterline, and the origin is amidships at the
 * waterline. Galleon.js's menu frame is x toward the bow, y abeam and z up, from x = -Lh at the
 * stern to about +Lh at the stem, so menu (x, y, z) becomes model (x, z, y) times the scale. To
 * sail her on heading h at engine (x, y): `group.position.set(x, 0, y)` and
 * `group.rotation.y = -h`, which puts her bow along (cos h, sin h) on the water as the engine has it.
 *
 * SCALE. `units: "menu"` keeps galleon.js's units (the galleon is 120 long). `units: "sea"` scales
 * her to her length at sea, `hullForm(id).sea.L`, which is also her collision ellipse's long axis
 * (`hullA * 2` in the engine), so `scale = sea.L / (2 * menu.Lh)`: 0.3 for the galleon.
 *
 * PIECES. The faces carry a `part` from galleon.js: each mast standing with all she carries
 * ("mast0" foremost), the bowsprit spar, what is set on it ("sprit"), and the hull, which is
 * everything else. Each is a mesh of its own, so a mast can be hidden or dropped on its own and a
 * dismasting takes the masts and the sprit and leaves the hull and her bowsprit. At sea, given a
 * `rig` rule, the pieces are merged into two meshes, her hull with her bowsprit and her whole rig,
 * because that is all a dismasting there ever tells apart and every mesh is a draw call a material
 * (see `seaPieces`).
 *
 * MATERIALS. Each mesh carries three material groups: 0 timber and fittings, 1 canvas, 2 flags.
 * Colour is per vertex for the first two, the palette under her timber exactly as the menu paints
 * it; the flags take one material colour so a layer can fly a ship's own colour by giving her a
 * clone of `materials[2]`. Materials are shared across every ship (see toon.js): clone before
 * changing one for one ship, and dispose the clone yourself.
 *
 * FLAGS. galleon.js paints a fixed pennant and ensign for the 2D view; this model leaves both out
 * and hangs live cloth on the same staffs instead (flags.js), one strip per flag, made per instance
 * because each ship's flags blow on her own heading and speed. The pennant is a child of the mast it
 * flies from, so it comes down with a dismasting and is scaled with a small craft's rig; the ensign
 * is a child of the hull. Each is its own mesh under `materials[2]`, listed in `flags.meshes`, and
 * `flags.blow(rel, speed, dt)` moves them (see flags.js for what `rel` is). Until a caller blows
 * them they stand where the wind puts a ship lying stopped.
 *
 * CACHE. Geometry is built once per spec, units and scale, and shared by every instance; a model's
 * `dispose()` detaches the instance and lets go of its hold on the geometry. The cache keeps the
 * `KEEP` most recently used specs and evicts only geometry no live model holds, so browsing the yard
 * never pulls a hull out from under a ship at sea. `clearShipModels()` releases it all, for the
 * renderer's teardown.
 *
 * LIVERY. Every face galleon.js marks `paint` carries its weight in the `paint` attribute and
 * everything else 0: her topsides above the lowest strake, her bulwarks and her castles' walls at
 * 1, and the inside of her rail, the ring of colour round her deck seen from above, a little less
 * so it stays a shade darker. A layer can then lay a ship's colours over her planking without
 * touching her ports, wales or deck.
 */

import * as THREE from "three";
import { shipFaces } from "../galleon.js";
import { hullForm, timberCast } from "../hullform.js";
import { toonMaterial } from "./toon.js";
import { flagCloth, flagSet, WIND } from "./flags.js";
import { bespokeOf, dressBespoke, tintOf, clearBespoke } from "./bespoke/index.js";
import { lineMaterial } from "./bespoke/kit.js";

const FLAG = "#c8452f"; // galleon.js's flag, which no timber changes
const CLOTH_FLOOR = "#24211b"; // canvas is lit through from both sides: a floor under its bands
const LIVERY_MIX = 0.92; // how far a painted plank goes from the timber to her colour

/** The three shared materials every face-list ship mesh uses, in group order: timber, canvas, flags. */
export function shipMaterials() {
  return [
    toonMaterial({ vertexColors: true }),
    toonMaterial({ vertexColors: true, emissive: CLOTH_FLOOR }),
    toonMaterial({ color: FLAG }),
  ];
}

/**
 * Give a clone of the shared timber material a livery: every vertex the face-list model marks
 * `paint` takes `color` in place of the timber, keeping a little of each strake's light and dark so
 * she still reads as planked. One program serves every ship; the colour is a uniform of her own.
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

/**
 * A BESPOKE SHIP: a class with a hand-modelled three.js ship of her own (`bespoke/`), built in
 * metres by her own file and scaled here to the same menu and sea lengths her form gives her, so
 * everything that places, follows, labels or sinks a ship is none the wiser. She comes as her hull
 * (with her bowsprit, her decks and her under-body) and her rig, which is what a dismasting tells
 * apart, each with its rope as a line batch of its own, and her pennant mounts for flags.js.
 */
function scaleGeometry(geo, k) {
  if (!geo) return null;
  geo.applyMatrix4(new THREE.Matrix4().makeScale(k, k, k));
  // the sails' breathing is a distance along x, in metres until now
  const w = geo.attributes.aWaveA;
  if (w) { for (let i = 0; i < w.count; i++) w.setX(i, w.getX(i) * k); w.needsUpdate = true; }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
function buildBespoke(entry, spec, units, seaLength) {
  const form = hullForm(spec.hull);
  const L = seaLength ?? (units === "sea" ? form.sea.L : 2 * form.menu.Lh);
  const k = L / entry.length;
  const b = entry.build(spec);
  const geoms = { hull: scaleGeometry(b.hull, k), rig: scaleGeometry(b.rig, k) };
  const lines = { hull: scaleGeometry(b.hullLines, k), rig: scaleGeometry(b.rigLines, k) };
  const box = new THREE.Box3();
  for (const g of Object.values(geoms)) if (g) box.union(g.boundingBox);
  const boxes = b.boxes.map((bb) => new THREE.Box3(bb.min.clone().multiplyScalar(k), bb.max.clone().multiplyScalar(k)));
  const pivots = {};
  boxes.forEach((bb, i) => { pivots["mast" + i] = { s: 1, at: [0, 0] }; });
  let top = 0;
  for (const bb of boxes) top = Math.max(top, bb.max.y);
  // The plate's box, cut for the galleon: the span her bowsprit and her rig need, as hullform works
  // it out for a form, with a little less air over her truck, because a bespoke rig stands at its
  // true height over her length and the form's margin left her small in the box. Worked from the
  // most she can ever carry (`frame`), so she is the same size in the box at every fit.
  const fx = entry.frame ? entry.frame.reach * k : box.max.x, fy = entry.frame ? entry.frame.top * k : box.max.y;
  const reach = Math.max(fx + 8 * k, L / 2 + 10 * k);
  const span = units === "menu" ? Math.max(248, reach * 2.62, (fy + 4 * k) * 2.45) : null;
  return {
    geoms, lines, flags: b.flags, masts: b.masts, scale: k, height: box.max.y, length: entry.length * k, beam: entry.beam * k, box,
    sea: { top, scale: 1, boxes, pivots }, bespoke: entry, guns: b.guns, span,
  };
}

const KEEP = 32;
const CACHE = new Map();

// A face's group: canvas, flag or timber.
const groupOf = (f) => (f.tag === "flag" ? 2 : f.tag === "sail" ? 1 : 0);
const COS_CREASE = Math.cos((38 * Math.PI) / 180); // faces meeting flatter than this share a normal

/**
 * One piece's faces as a non-indexed BufferGeometry: each convex face fanned into triangles, with
 * the axes swapped into the model frame (which is a mirror, so each triangle's winding is turned
 * back over to keep it facing out), coloured per vertex, and given normals smoothed across seams
 * flatter than the crease angle so a hull rounds off into bands instead of reading as facets. A
 * double-sided face (canvas, flags) is laid down twice, the back reversed in its own back colour.
 */
function buildGeometry(faces, k) {
  // triangles bucketed by material group, then laid out group after group
  const buckets = [[], [], []];
  const col = new THREE.Color();
  for (const f of faces) {
    const g = groupOf(f);
    const sides = f.double ? [false, true] : [false];
    for (const back of sides) {
      const n = back ? [-f.n[0], -f.n[1], -f.n[2]] : f.n;
      col.set(back ? f.back || f.color : f.color);
      const c = [col.r, col.g, col.b];
      const P = f.pts;
      for (let i = 1; i < P.length - 1; i++) {
        // menu (x, y, z) to model (x, z, y); reversed once for the mirror and again for the back
        const tri = back ? [P[0], P[i], P[i + 1]] : [P[0], P[i + 1], P[i]];
        buckets[g].push({ tri, n, c, paint: f.paint || 0 });
      }
    }
  }
  const count = buckets.reduce((a, b) => a + b.length, 0) * 3;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), cols = new Float32Array(count * 3);
  const paint = new Float32Array(count);
  const geo = new THREE.BufferGeometry();
  // smoothing: every vertex keyed by where it stands, normals summed over the faces meeting there
  // within the crease angle
  const at = new Map();
  const keyOf = (p) => `${Math.round(p[0] * 50)},${Math.round(p[1] * 50)},${Math.round(p[2] * 50)}`;
  let v = 0, start = 0;
  const verts = [];
  buckets.forEach((list, g) => {
    for (const { tri, n, c, paint: pf } of list) {
      for (const p of tri) {
        paint[v] = pf;
        pos[v * 3] = p[0] * k; pos[v * 3 + 1] = p[2] * k; pos[v * 3 + 2] = p[1] * k;
        cols[v * 3] = c[0]; cols[v * 3 + 1] = c[1]; cols[v * 3 + 2] = c[2];
        const nn = [n[0], n[2], n[1]];
        const key = keyOf(p);
        let list2 = at.get(key);
        if (!list2) at.set(key, (list2 = []));
        list2.push(nn);
        verts.push({ key, nn });
        v++;
      }
    }
    const len = list.length * 3;
    if (len) geo.addGroup(start, len, g);
    start += len;
  });
  for (let i = 0; i < verts.length; i++) {
    const { key, nn } = verts[i];
    let x = 0, y = 0, z = 0;
    for (const m of at.get(key)) {
      if (m[0] * nn[0] + m[1] * nn[1] + m[2] * nn[2] >= COS_CREASE) { x += m[0]; y += m[1]; z += m[2]; }
    }
    const l = Math.hypot(x, y, z) || 1;
    nor[i * 3] = x / l; nor[i * 3 + 1] = y / l; nor[i * 3 + 2] = z / l;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  geo.setAttribute("paint", new THREE.BufferAttribute(paint, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * The faces worth drawing with a depth buffer. galleon.js cuts every spar into short lengths so its
 * painter's sort keys stay local, and each length is a closed prism: where two lengths meet, two caps
 * lie face to face inside the spar, where nothing can ever see them. They were over a third of a
 * first rate's spar triangles. A face whose twin (same corners, opposite way round) is in the list
 * is one of those, and both go.
 */
function visibleFaces(faces) {
  const key = (f) => {
    let x = 0, y = 0, z = 0;
    for (const p of f.pts) { x += p[0]; y += p[1]; z += p[2]; }
    const n = f.pts.length;
    return `${f.part || ""}|${n}|${Math.round((x / n) * 200)},${Math.round((y / n) * 200)},${Math.round((z / n) * 200)}`;
  };
  const at = new Map();
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    if (f.double || f.pts.length < 3) continue;
    const k = key(f);
    let list = at.get(k);
    if (!list) at.set(k, (list = []));
    list.push(i);
  }
  const drop = new Set();
  for (const list of at.values()) {
    if (list.length < 2) continue;
    for (let a = 0; a < list.length; a++) {
      if (drop.has(list[a])) continue;
      const fa = faces[list[a]];
      for (let b = a + 1; b < list.length; b++) {
        if (drop.has(list[b])) continue;
        const fb = faces[list[b]];
        if (fa.n[0] * fb.n[0] + fa.n[1] * fb.n[1] + fa.n[2] * fb.n[2] < -0.999) { drop.add(list[a]); drop.add(list[b]); break; }
      }
    }
  }
  return drop.size ? faces.filter((_, i) => !drop.has(i)) : faces;
}

/**
 * Several pieces' geometries as one, laid out group after group as `buildGeometry` lays out one:
 * every piece's timber, then every piece's canvas, so the whole is one draw call a material however
 * many pieces went in. Each piece's vertices are copied as they stand, normals and all, so nothing
 * is smoothed across a seam that was not smoothed before. `moves[i]`, where given, is a uniform
 * scale `s` about a point `[x, y]` in the model's frame, baked into piece i's positions.
 */
function mergeGeometry(geos, moves = []) {
  const names = ["position", "normal", "color", "paint"];
  let count = 0;
  for (const g of geos) count += g.attributes.position.count;
  const out = {};
  for (const n of names) out[n] = new Float32Array(count * geos[0].attributes[n].itemSize);
  const geo = new THREE.BufferGeometry();
  let v = 0;
  for (let mat = 0; mat < 3; mat++) {
    const start = v;
    geos.forEach((g, i) => {
      for (const grp of g.groups) {
        if (grp.materialIndex !== mat) continue;
        for (const n of names) {
          const a = g.attributes[n], w = a.itemSize;
          out[n].set(a.array.subarray(grp.start * w, (grp.start + grp.count) * w), v * w);
        }
        const mv = moves[i];
        if (mv && mv.s !== 1) {
          const p = out.position;
          for (let j = v; j < v + grp.count; j++) {
            p[j * 3] = mv.at[0] + (p[j * 3] - mv.at[0]) * mv.s;
            p[j * 3 + 1] = mv.at[1] + (p[j * 3 + 1] - mv.at[1]) * mv.s;
            p[j * 3 + 2] *= mv.s;
          }
        }
        v += grp.count;
      }
    });
    if (v > start) geo.addGroup(start, v - start, mat);
  }
  geo.setAttribute("position", new THREE.BufferAttribute(out.position, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(out.normal, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(out.color, 3));
  geo.setAttribute("paint", new THREE.BufferAttribute(out.paint, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * At sea she is two meshes, not one a piece. A ship at sea only ever loses her masts and what is set
 * on the bowsprit all together, so her hull and bowsprit are one mesh and every mast and the sprit
 * the other, which is three draw calls where a first rate's eight pieces were eleven. A small craft's
 * rig is scaled up about each mast's foot until it reads (`rig` is the rule: at least `floor` of her
 * length and `min` units over the water, never more than `max` times), and that is baked into the
 * rig's positions here rather than set on each mast's mesh as it was. `pivots` are where each mast's
 * pennant hangs, scaled about the same foot.
 */
function seaPieces(geoms, masts, length, rig) {
  const mastGeos = [];
  for (let i = 0; i < masts; i++) if (geoms["mast" + i]) mastGeos.push(["mast" + i, geoms["mast" + i]]);
  let top = 0;
  for (const [, g] of mastGeos) top = Math.max(top, g.boundingBox.max.y);
  const want = Math.max(rig.floor * length, rig.min);
  const scale = top > 0 ? Math.min(Math.max(want / top, 1), rig.max) : 1;
  const boxes = [], pivots = {}, moves = [];
  for (const [name, g] of mastGeos) {
    const bb = g.boundingBox;
    const at = [(bb.min.x + bb.max.x) / 2, Math.max(0, bb.min.y)];
    boxes.push(bb.clone());
    pivots[name] = { s: scale, at };
    moves.push({ s: scale, at });
  }
  const hullGeos = [geoms.hull, geoms.bowsprit].filter(Boolean);
  const rigGeos = [...mastGeos.map(([, g]) => g)];
  if (geoms.sprit) { rigGeos.push(geoms.sprit); moves.push(null); }
  const out = {
    hull: hullGeos.length ? mergeGeometry(hullGeos) : null,
    rig: rigGeos.length ? mergeGeometry(rigGeos, moves) : null,
  };
  // the pieces are copied, so they go
  for (const g of Object.values(geoms)) g.dispose();
  return { geoms: out, sea: { top, scale, boxes, pivots } };
}

function build(spec, units, seaLength, rigRule) {
  const entry = bespokeOf(spec?.hull);
  if (entry) return buildBespoke(entry, spec, units, seaLength);
  const { faces: all, flags, rig, form } = shipFaces(spec);
  const faces = visibleFaces(all);
  const L = seaLength ?? (units === "sea" ? hullForm(spec?.hull).sea.L : 2 * form.menu.Lh);
  const k = units === "sea" ? L / (2 * form.menu.Lh) : 1;
  const byPart = new Map();
  for (const f of faces) {
    // At sea the standing rigging is a twentieth of a unit thick, under a pixel at any zoom the sea
    // is drawn at: it only shimmered, and it was a fifth of a first rate's triangles, drawn twice
    // with the sun's shadow. The menu, where she is a hand's width long, keeps it.
    if (units === "sea" && f.tag === "rig") continue;
    // the fixed flags are the 2D view's; this model flies cloth of its own on the same staffs
    if (f.tag === "flag") continue;
    const p = f.part || "hull";
    let list = byPart.get(p);
    if (!list) byPart.set(p, (list = []));
    list.push(f);
  }
  let geoms = {};
  for (const [p, list] of byPart) geoms[p] = buildGeometry(list, k);
  const box = new THREE.Box3();
  for (const g of Object.values(geoms)) box.union(g.boundingBox);
  const length = 2 * form.menu.Lh * k;
  let sea = null;
  if (rigRule) ({ geoms, sea } = seaPieces(geoms, rig.masts.length, length, rigRule));
  return { geoms, flags, masts: rig.masts.length, sea, scale: k, height: box.max.y, length, beam: 2 * box.max.z, box };
}

const keyFor = (spec, units, seaLength, rig) =>
  `${units}|${seaLength ?? ""}|${rig ? `${rig.floor},${rig.min},${rig.max}` : ""}|${spec ? JSON.stringify(spec) : "galleon"}`;

/**
 * A ship as a three.js Group, ready to add to a scene.
 *
 *   spec   a rig spec, `rigSpec(loadout)` from shipyard.js (or null for the galleon); the same
 *          thing drawGalleon takes
 *   units  "sea" (default) for her length at sea, "menu" for galleon.js's own units
 *   seaLength  overrides her length in "sea" units
 *   phase  where her flags' wave starts, in radians, so a fleet's flags do not flap in step
 *   rig    at sea, `{ floor, min, max }`: build her as two meshes with a small craft's rig scaled
 *          up by that rule and baked in (see `seaPieces`)
 *
 * Returns
 *   { group, parts: { hull, bowsprit, sprit, masts: [mesh, ...] }, flags: { meshes, blow, pose },
 *     materials, scale, height, length, beam, key, rig, dispose() }
 *
 * Given `rig`, `parts` is `{ hull, rig }` with the others empty, and `rig` says what was done to her
 * rig: `{ top, scale, boxes, pivots }`, her tallest mast before it was scaled, the scale, and each
 * mast's own box before it.
 *
 * `group` is in the model frame described at the top of this file. `parts` are its child meshes
 * (`bowsprit` and `sprit` are null when she has none); `masts` runs foremost first. `flags` is her
 * live cloth (see FLAGS above). `height` is the top of her rig over the waterline, `length` and
 * `beam` her extent, all in the units asked for. Every mesh casts and receives shadows; the
 * renderer's shadow map decides whether that costs anything. `dispose()` takes the group out of its
 * parent and lets go of her flags; the shared geometry stays cached.
 */
export function shipModel(spec, { units = "sea", seaLength, phase = 0, rig } = {}) {
  const key = keyFor(spec, units, seaLength, rig);
  let built = CACHE.get(key);
  if (built) {
    // most recently used goes to the back of the line
    CACHE.delete(key);
    CACHE.set(key, built);
  } else {
    evict(KEEP - 1);
    built = build(spec, units, seaLength, rig);
    built.refs = 0;
    CACHE.set(key, built);
  }
  built.refs++;
  let held = true;
  const bespoke = built.bespoke || null;
  // a bespoke ship wears materials of her own from the start; a face-list ship the shared trio
  let current = null;
  const dressFor = (how) => {
    if (bespoke) {
      const tint = tintOf(spec.timber ? timberCast(spec.timber) : hullForm(spec.hull).timber);
      return dressBespoke(bespoke, { trim: how.trim, guns: built.guns, tint, name: how.name || "" });
    }
    const [t0, c0, f0] = shipMaterials();
    const trim = how.trim ?? FLAG;
    const timber = paintWith(t0.clone(), new THREE.Color(how.paint ?? trim));
    const canvas = c0.clone();
    const flag = f0.clone();
    flag.color.set(trim);
    const mats = [timber, canvas, flag];
    return { mats, flag, lit: [timber], dispose() { for (const m of mats) m.dispose(); } };
  };
  if (bespoke) current = dressFor({});
  const materials = current ? current.mats : shipMaterials();
  const group = new THREE.Group();
  group.name = "ship";
  const mesh = (name) => {
    const g = built.geoms[name];
    if (!g) return null;
    const m = new THREE.Mesh(g, materials);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    // her rope, a line batch under the piece it is bent to, so it goes where the piece goes
    const l = built.lines && built.lines[name];
    if (l) { const ls = new THREE.LineSegments(l, lineMaterial()); ls.name = name + "-lines"; m.add(ls); }
    return m;
  };
  let parts;
  if (built.sea) {
    parts = { hull: mesh("hull"), rig: mesh("rig"), bowsprit: null, sprit: null, masts: [] };
    // a pivot a mast, under the rig so it comes down with her, for the pennant that flies there
    for (const [name, { s, at }] of Object.entries(built.sea.pivots)) {
      const pivot = new THREE.Group();
      pivot.name = name;
      pivot.scale.setScalar(s);
      pivot.position.set(at[0] * (1 - s), at[1] * (1 - s), 0);
      (parts.rig || group).add(pivot);
    }
  } else {
    parts = { hull: mesh("hull"), bowsprit: mesh("bowsprit"), sprit: mesh("sprit"), masts: [] };
    for (let i = 0; i < built.masts; i++) parts.masts.push(mesh("mast" + i));
    parts.masts = parts.masts.filter(Boolean);
  }
  // a flag bent on to a piece merged into another flies from the one it went into
  const merged = { bowsprit: parts.hull, sprit: parts.rig };

  // her flags, each on the piece of her it flies from
  const cloths = [], flagMeshes = [];
  for (const mount of built.flags) {
    const host = (mount.part && (group.getObjectByName(mount.part) || (built.sea && merged[mount.part]))) || parts.hull || group;
    const cloth = flagCloth(mount, built.scale, phase);
    const m = new THREE.Mesh(cloth.geometry, current ? current.flag : materials[2]);
    m.name = mount.part ? "pennant" : "ensign";
    m.castShadow = true;
    m.receiveShadow = true;
    host.add(m);
    cloths.push(cloth);
    flagMeshes.push(m);
  }
  const flags = Object.assign(flagSet(cloths), { meshes: flagMeshes });
  flags.pose(WIND.menu, 0);

  const pieces = () => [parts.hull, parts.rig, parts.bowsprit, parts.sprit, ...parts.masts].filter(Boolean);

  return {
    group, parts, flags, materials, key, rig: built.sea, bespoke: !!bespoke, span: built.span || null,
    scale: built.scale, height: built.height, length: built.length, beam: built.beam,
    /**
     * Dress her for whoever sails her: `trim` is her livery (her flags, and a bespoke ship's trim),
     * `paint` the colour a face-list ship's planking takes (her livery again if left out), `name`
     * what a bespoke ship paints across her stern. The materials are hers alone and go with her;
     * `lit` are the ones a hit's light is put on. Dressing her again replaces the last set.
     */
    dress(how = {}) {
      const next = dressFor(how);
      for (const m of pieces()) m.material = next.mats;
      for (const m of flagMeshes) m.material = next.flag;
      if (current) current.dispose();
      current = next;
      return { mats: next.mats, flag: next.flag, lit: next.lit };
    },
    dispose() {
      group.removeFromParent();
      for (const m of flagMeshes) { m.removeFromParent(); m.geometry.dispose(); }
      flagMeshes.length = 0;
      if (current) { current.dispose(); current = null; }
      if (held) { held = false; built.refs--; }
    },
  };
}

function disposeBuilt(b) {
  for (const g of Object.values(b.geoms)) if (g) g.dispose();
  if (b.lines) for (const g of Object.values(b.lines)) if (g) g.dispose();
}

/**
 * Let go of the least recently used geometry no live model is drawing until at most `keep` specs
 * are cached. A spec a ship at sea or a plate is still showing is never disposed, so the cache can
 * run over `KEEP` for as long as more than that are on screen at once, and comes back down after.
 */
function evict(keep) {
  if (CACHE.size <= keep) return;
  for (const [key, b] of CACHE) {
    if (CACHE.size <= keep) break;
    if (b.refs > 0) continue;
    disposeBuilt(b);
    CACHE.delete(key);
  }
}

/** Release every cached ship geometry and painted sheet. For the renderer's teardown; live models re-upload if drawn. */
export function clearShipModels() {
  for (const b of CACHE.values()) disposeBuilt(b);
  CACHE.clear();
  clearBespoke();
}

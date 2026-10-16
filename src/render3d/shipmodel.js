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
 * dismasting takes the masts and the sprit and leaves the hull and her bowsprit.
 *
 * MATERIALS. Each mesh carries three material groups: 0 timber and fittings, 1 canvas, 2 flags.
 * Colour is per vertex for the first two, the palette under her timber exactly as the menu paints
 * it; the flags take one material colour so a layer can fly a ship's own colour by giving her a
 * clone of `materials[2]`. Materials are shared across every ship (see toon.js): clone before
 * changing one for one ship, and dispose the clone yourself.
 *
 * CACHE. Geometry is built once per spec, units and scale, and shared by every instance; a model's
 * `dispose()` only detaches the instance. The cache is bounded the way galleon.js's is, and
 * `clearShipModels()` releases it all, for the renderer's teardown.
 */

import * as THREE from "three";
import { shipFaces } from "../galleon.js";
import { hullForm } from "../hullform.js";
import { toonMaterial } from "./toon.js";

const FLAG = "#c8452f"; // galleon.js's flag, which no timber changes
const CLOTH_FLOOR = "#24211b"; // canvas is lit through from both sides: a floor under its bands

/** The three shared materials every ship mesh uses, in group order: timber, canvas, flags. */
export function shipMaterials() {
  return [
    toonMaterial({ vertexColors: true }),
    toonMaterial({ vertexColors: true, emissive: CLOTH_FLOOR }),
    toonMaterial({ color: FLAG }),
  ];
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
        buckets[g].push({ tri, n, c });
      }
    }
  }
  const count = buckets.reduce((a, b) => a + b.length, 0) * 3;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), cols = new Float32Array(count * 3);
  const geo = new THREE.BufferGeometry();
  // smoothing: every vertex keyed by where it stands, normals summed over the faces meeting there
  // within the crease angle
  const at = new Map();
  const keyOf = (p) => `${Math.round(p[0] * 50)},${Math.round(p[1] * 50)},${Math.round(p[2] * 50)}`;
  let v = 0, start = 0;
  const verts = [];
  buckets.forEach((list, g) => {
    for (const { tri, n, c } of list) {
      for (const p of tri) {
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
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function build(spec, units, seaLength) {
  const { faces, rig, form } = shipFaces(spec);
  const L = seaLength ?? (units === "sea" ? hullForm(spec?.hull).sea.L : 2 * form.menu.Lh);
  const k = units === "sea" ? L / (2 * form.menu.Lh) : 1;
  const byPart = new Map();
  for (const f of faces) {
    const p = f.part || "hull";
    let list = byPart.get(p);
    if (!list) byPart.set(p, (list = []));
    list.push(f);
  }
  const geoms = {};
  for (const [p, list] of byPart) geoms[p] = buildGeometry(list, k);
  const box = new THREE.Box3();
  for (const g of Object.values(geoms)) box.union(g.boundingBox);
  return { geoms, masts: rig.masts.length, scale: k, height: box.max.y, length: 2 * form.menu.Lh * k, beam: 2 * box.max.z, box };
}

const keyFor = (spec, units, seaLength) => `${units}|${seaLength ?? ""}|${spec ? JSON.stringify(spec) : "galleon"}`;

/**
 * A ship as a three.js Group, ready to add to a scene.
 *
 *   spec   a rig spec, `rigSpec(loadout)` from shipyard.js (or null for the galleon); the same
 *          thing drawGalleon takes
 *   units  "sea" (default) for her length at sea, "menu" for galleon.js's own units
 *   seaLength  overrides her length in "sea" units
 *
 * Returns
 *   { group, parts: { hull, bowsprit, sprit, masts: [mesh, ...] }, materials, scale, height,
 *     length, beam, key, dispose() }
 *
 * `group` is in the model frame described at the top of this file. `parts` are its child meshes
 * (`bowsprit` and `sprit` are null when she has none); `masts` runs foremost first. `height` is the
 * top of her rig over the waterline, `length` and `beam` her extent, all in the units asked for.
 * Every mesh casts and receives shadows; the renderer's shadow map decides whether that costs
 * anything. `dispose()` takes the group out of its parent; the shared geometry stays cached.
 */
export function shipModel(spec, { units = "sea", seaLength } = {}) {
  const key = keyFor(spec, units, seaLength);
  let built = CACHE.get(key);
  if (!built) {
    if (CACHE.size >= KEEP) clearShipModels();
    built = build(spec, units, seaLength);
    CACHE.set(key, built);
  }
  const materials = shipMaterials();
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
    return m;
  };
  const parts = { hull: mesh("hull"), bowsprit: mesh("bowsprit"), sprit: mesh("sprit"), masts: [] };
  for (let i = 0; i < built.masts; i++) parts.masts.push(mesh("mast" + i));
  parts.masts = parts.masts.filter(Boolean);
  return {
    group, parts, materials, key,
    scale: built.scale, height: built.height, length: built.length, beam: built.beam,
    dispose() { group.removeFromParent(); },
  };
}

/** Release every cached ship geometry. For the renderer's teardown; live models re-upload if drawn. */
export function clearShipModels() {
  for (const b of CACHE.values()) for (const g of Object.values(b.geoms)) g.dispose();
  CACHE.clear();
}

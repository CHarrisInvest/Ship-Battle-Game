/**
 * THE BESPOKE SHIPS' TEST — `npm run bespoke-test`
 *
 * A class with a hand-modelled 3D ship of her own (`src/render3d/bespoke/`) is built here, in Node,
 * with a stand-in canvas, for every fit the stock fleet issues her at and for every way her fore and
 * main berths can be filled, and checked for what nothing else would catch: a figure that is not a
 * number, a hull that comes out the wrong length for her form, a mast the spec steps that she does
 * not build, a sail bought and not drawn, a texture sheet that will not paint, a reference row that
 * does not say what the model draws, and a triangle or draw-call count past what a phone affords.
 *
 * It imports the real modules, so there is no second copy of the model here to disagree with the
 * game. three.js builds its geometry without WebGL, which is what makes this possible in Node.
 */

import { setBespokeEnv, stubCanvas } from "../src/render3d/bespoke/kit.js";
import { bespokeOf, bespokeIds } from "../src/render3d/bespoke/index.js";
import { shipModel, clearShipModels } from "../src/render3d/shipmodel.js";
import { HULLS, STANDARDS, fitOut, rigSpec, MASTS, berthsOf, sailsForBerth, mastFitsSocket } from "../src/shipyard.js";
import { hullForm } from "../src/hullform.js";
import { HULL_REF } from "../src/shipref.js";

setBespokeEnv({ createCanvas: stubCanvas });

const problems = [];
const fault = (where, what) => problems.push(`${where}: ${what}`);
const ok = (what) => console.log("  ok    " + what);
const RIG = { floor: 0.8, min: 14, max: 2.2 };
// what a phone affords for one ship: a first rate fully found is about 14,000 and 2,300
const BUDGET = { hullTris: 24000, rigTris: 8000, groups: 4 };

const tris = (g) => (g ? g.index.count / 3 : 0);
const finite = (g) => { if (!g) return true; const a = g.attributes.position.array; for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; };

for (const id of bespokeIds()) {
  const entry = bespokeOf(id), where = `bespoke "${id}"`;
  const hull = HULLS[id];
  if (!hull) { fault(where, "has a model and no class that sails"); continue; }
  const ref = HULL_REF[id] || {};
  if (Math.abs((ref.drawnLength || 0) - entry.length) > 0.05 || Math.abs((ref.drawnBeam || 0) - entry.beam) > 0.05) {
    fault(where, `the reference row says drawnLength ${ref.drawnLength} and drawnBeam ${ref.drawnBeam}; the model is ${entry.length} by ${entry.beam}`);
  }

  // her frame is the extent of her model fully found, which is what the menu frames her by
  if (entry.frame) {
    const b = entry.build(rigSpec(fitOut(id, 1)));
    const box = b.hull.boundingBox.clone().union(b.rig.boundingBox);
    if (Math.abs(box.max.x - entry.frame.reach) > 0.01 || Math.abs(box.max.y - entry.frame.top) > 0.01) {
      fault(where, `her frame says she reaches ${entry.frame.reach} and stands ${entry.frame.top}; fully found she reaches ${box.max.x.toFixed(3)} and stands ${box.max.y.toFixed(3)}`);
    }
  }

  // every fit the stock fleet issues her at, on the sea and on the plate
  for (const st of STANDARDS) {
    const lo = fitOut(id, st.quality), spec = rigSpec(lo);
    for (const units of ["sea", "menu"]) {
      const at = `${where} fitted ${st.label}, ${units}`;
      let m;
      try { m = shipModel(spec, units === "sea" ? { units, rig: RIG } : { units }); } catch (e) { fault(at, `does not build: ${e.message}`); continue; }
      if (!m.bespoke) fault(at, "built from her form rather than her own model");
      const h = m.parts.hull, r = m.parts.rig;
      if (!h) fault(at, "has no hull");
      if (!r) fault(at, "has no rig");
      if (!finite(h?.geometry) || !finite(r?.geometry)) fault(at, "has a vertex that is not a number");
      const form = hullForm(id), L = units === "sea" ? form.sea.L : 2 * form.menu.Lh;
      if (Math.abs(m.length - L) > 0.01) fault(at, `comes out ${m.length.toFixed(2)} long against her form's ${L.toFixed(2)}`);
      const box = h?.geometry.boundingBox;
      if (box && (box.max.x - box.min.x < 0.9 * L || box.max.x - box.min.x > 1.6 * L)) fault(at, `her hull spans ${(box.max.x - box.min.x).toFixed(1)} for a length of ${L.toFixed(1)}`);
      if (m.height > 2.5 * L || m.height < 0.5 * L) fault(at, `her rig stands ${m.height.toFixed(1)} over the water for a length of ${L.toFixed(1)}`);
      const stepped = spec.masts.filter((x) => x.station !== "bowsprit").length;
      if (m.rig.boxes.length !== stepped) fault(at, `the spec steps ${stepped} masts and she stands ${m.rig.boxes.length}`);
      if (m.flags.meshes.length !== stepped) fault(at, `flies ${m.flags.meshes.length} pennants from ${stepped} masts`);
      if (tris(h?.geometry) > BUDGET.hullTris) fault(at, `her hull is ${tris(h.geometry)} triangles, over the ${BUDGET.hullTris} budget`);
      if (tris(r?.geometry) > BUDGET.rigTris) fault(at, `her rig is ${tris(r.geometry)} triangles, over the ${BUDGET.rigTris} budget`);
      for (const [name, mesh] of [["hull", h], ["rig", r]]) {
        if (mesh && mesh.geometry.groups.length > BUDGET.groups) fault(at, `her ${name} draws in ${mesh.geometry.groups.length} calls, over ${BUDGET.groups}`);
      }
      // the sea dresses her in a livery and a hit lights her; both have to take
      const d = m.dress({ trim: "#3aa65a", paint: "#3aa65a" });
      if (!d.lit.length) fault(at, "has nothing a hit's light can be put on");
      if (!d.mats.every(Boolean)) fault(at, "a material slot is empty");
      m.dispose();
    }
  }

  // every way her fore and main berths can be filled, with her best mast in each: a sail bought is
  // a sail drawn, and an empty berth is a yard crossed bare
  const best = (socket) => Object.values(MASTS).filter((mm) => mastFitsSocket(mm, socket)).sort((a, b) => b.price - a.price)[0];
  const dearest = (berth) => sailsForBerth(berth).slice().sort((a, b) => b.price - a.price)[0];
  const full = fitOut(id, 1);
  const squares = hull.sockets.filter((s) => s.station === "fore" || s.station === "main");
  const nBerths = squares.length ? berthsOf(best(squares[0])).length : 0;
  let combos = 0;
  for (let mask = 1; mask < 1 << nBerths; mask++) {
    const lo = fitOut(id, 1);
    for (const s of squares) {
      const mast = best(s);
      lo.rig[s.id] = { mast, sails: berthsOf(mast).map((b, i) => (mask & (1 << i) ? dearest(b) : null)), studs: [] };
    }
    const spec = rigSpec(lo);
    const at = `${where} with fore and main berths ${mask.toString(2).padStart(nBerths, "0").split("").reverse().join("")} filled`;
    let m;
    try { m = shipModel(spec, { units: "sea", rig: RIG }); } catch (e) { fault(at, `does not build: ${e.message}`); continue; }
    // a square sail is 35 vertices, a headsail 28, a four-sided sail 25: the rig's canvas has to add up
    const set = spec.masts.reduce((n, mm) => n + mm.sails.length, 0);
    const want = spec.masts.reduce((n, mm) => n + mm.sails.reduce((k, s) => k + (s.kind === "TRI" ? 28 : s.kind === "GAF" ? 25 : 35), 0), 0);
    const sailGroup = m.parts.rig?.geometry.groups.find((g) => g.materialIndex === entry.slot.sail);
    const verts = sailGroup ? sailGroup.count : 0;
    if (set && !sailGroup) fault(at, `${set} sails bent on and none drawn`);
    // the group counts triangle corners; vertices are shared, so compare through the index
    if (sailGroup) {
      const g = m.parts.rig.geometry, idx = g.index.array, seen = new Set();
      for (let i = sailGroup.start; i < sailGroup.start + sailGroup.count; i++) seen.add(idx[i]);
      if (seen.size !== want) fault(at, `${set} sails bent on should draw ${want} vertices of canvas and draw ${seen.size}`);
    }
    if (!finite(m.parts.rig?.geometry)) fault(at, "a vertex that is not a number");
    m.dispose();
    combos++;
    void verts;
  }
  // everything that can be stepped on her bowsprit, and every way to fill it: nothing, then each
  // spar with each set of its berths, and her headsails come out as the spec bends them on
  const sprit = hull.sockets.find((s) => s.station === "bowsprit");
  let spritCases = 0;
  if (sprit) {
    const spars = [null, ...Object.values(MASTS).filter((mm) => mastFitsSocket(mm, sprit))];
    for (const spar of spars) {
      const n = spar ? berthsOf(spar).length : 0;
      for (let mask = 0; mask < 1 << n; mask++) {
        const lo = fitOut(id, 1);
        lo.rig[sprit.id] = spar
          ? { mast: spar, sails: berthsOf(spar).map((b, i) => (mask & (1 << i) ? dearest(b) : null)), studs: [] }
          : { mast: null, sails: [], studs: [] };
        const spec = rigSpec(lo);
        const at = `${where} with ${spar ? spar.name : "nothing"} on her bowsprit, berths ${mask.toString(2).padStart(n, "0")}`;
        let m;
        try { m = shipModel(spec, { units: "sea", rig: RIG }); } catch (e) { fault(at, `does not build: ${e.message}`); continue; }
        const set = spec.masts.reduce((k, mm) => k + mm.sails.length, 0);
        const want = spec.masts.reduce((k, mm) => k + mm.sails.reduce((q, s) => q + (s.kind === "TRI" ? 28 : s.kind === "GAF" ? 25 : 35), 0), 0);
        const g = m.parts.rig?.geometry, grp = g?.groups.find((x) => x.materialIndex === entry.slot.sail);
        const seen = new Set();
        if (grp) for (let i = grp.start; i < grp.start + grp.count; i++) seen.add(g.index.array[i]);
        if (seen.size !== want) fault(at, `${set} sails bent on should draw ${want} vertices of canvas and draw ${seen.size}`);
        if (!finite(m.parts.hull?.geometry) || !finite(g)) fault(at, "a vertex that is not a number");
        m.dispose();
        spritCases++;
      }
    }
  }
  // her sheet paints for an empty battery, a full one and one in between
  for (const guns of [0, Math.floor(hull.guns.broadside / 2), hull.guns.broadside]) {
    try { entry.paintAtlas({ trim: "#e8c877", guns, name: "Sternchase" }); } catch (e) { fault(`${where} with ${guns} guns a side`, `her sheet does not paint: ${e.message}`); }
  }
  if (!problems.some((p) => p.startsWith(where))) ok(`${hull.name}: ${STANDARDS.length} fits on the sea and the plate, ${combos} ways to fill her fore and main, ${spritCases} on her bowsprit, her sheet at 3 batteries`);
}
clearShipModels();

if (!bespokeIds().length) { console.log("no class has a model of her own"); }
if (problems.length) {
  console.log(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
  for (const p of problems) console.log("  " + p);
  process.exit(1);
}
console.log("\nEvery bespoke ship builds.");

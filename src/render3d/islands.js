/**
 * THE ISLANDS ON THE 3D SEA. Owned by the islands layer (see the module contract in
 * docs/superpowers/specs/2026-10-15-three-renderer-design.md).
 *
 * The islands are not redesigned here, only given depth: everything is today's 2D island
 * (`drawIslands` in src/render/renderer.js) carried into the scene.
 *
 *   - Her outline is the same closed quadratic spline through the midpoint of each edge of her
 *     `verts` polygon, so the sand ends where the 2D sand ended. Every band is that spline scaled
 *     about her middle (a quadratic spline of scaled points is the scaled spline), so one sampling
 *     serves them all.
 *   - The water comes up to her in two steps that roll on the swell as they always did: the shallows
 *     at 1.30 of her and the beach rim at 1.08, each a translucent sheet just over the water, the
 *     outer wider and slower over fewer crests so the two edges never march in step.
 *   - The land is one low mound: sand from her edge in to 0.72 of her and grass over the rest, a
 *     smoothstep rise so the toon bands lie round her in contours. Its edge stands a little over the
 *     rim on a skirt of `sandDark`, which is the 2D sand's dark stroke seen as the face it was.
 *   - The planting is `genFoliage` with the same seed, so the same palms stand in the same places.
 *     Each palm is a bowed tapered trunk and a crown of folded blades; each bush a dark mass with a
 *     lighter lobe and a few short blades. All of an island's plants are one merged mesh in vertex
 *     colours, and the blades gust in the vertex shader on the 2D phases, their shadows with them.
 *
 * Plant sizes are the 2D figures: across is one to one, and a height drawn as `h` screen units in
 * 2D rises `h / ZUP` here, which is what lands it on the same pixels under the shared camera.
 *
 * Built once per `world.islands` array (new each round), with the plantings remembered per island
 * object; the old round's geometry is released when the array changes.
 */

import { seedFrom } from "../sim/index.js";
import { genFoliage, PLANT } from "../render/foliage.js";
import { ZUP } from "../render/view.js";

// the bands, as shares of the island's radius and heights over the water (three Y)
const SHALLOWS = { scale: 1.30, y: 0.12, waves: 2, amp: 3, speed: 1.6, opacity: 0.86 };
const RIM = { scale: 1.08, y: 0.24, waves: 3, amp: 2, speed: 2, opacity: 0.94 };
const GRASS_AT = 0.72;
const EDGE_H = 1.1;          // the sand's edge over the water
const EDGE_LINE = 1.5;      // the dark line round the sand, in world units, as the 2D stroke
const PEAK_SHARE = 0.06;     // her crown's height as a share of her radius...
const PEAK_MAX = 7;          // ...and never more than this, so the land stays low
const SPLINE_STEPS = 8;      // spline samples per edge of her polygon
const SAND_RINGS = [1, 0.93, 0.86, 0.79, GRASS_AT];
const GRASS_RINGS = [GRASS_AT, 0.6, 0.46, 0.32, 0.18, 0.07];

const smooth = (t) => t * t * (3 - 2 * t);

export function createIslandLayer(scene, ctx) {
  const { THREE, palette: C, quality } = ctx;
  const LOW = quality.tier === "low";
  const root = new THREE.Group();
  root.name = "islands";
  scene.add(root);

  const plantings = new WeakMap();
  const plantingOf = (isl) => {
    let p = plantings.get(isl);
    if (!p) plantings.set(isl, (p = genFoliage(isl.r, isl.verts, { rng: seedFrom(isl.x, isl.y, isl.r) })));
    return p;
  };

  // The blades gust in the vertex shader. `aSway` is (amplitude, phase, frequency) per vertex, the
  // amplitude already scaled by how far out along the blade the vertex is, so the root stays pinned
  // and only the outer half travels, as in the 2D drawing. The shadow pass bends them the same way.
  const uTime = { value: 0 };
  const SWAY = `
    float swayK = aSway.x * (0.55 + 0.45 * sin(uTime * aSway.z + aSway.y));
    transformed.x += swayK;
    transformed.y -= swayK * 0.18;
  `;
  const patch = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aSway;\nuniform float uTime;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + SWAY);
  };
  const plantMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ctx.toon.ramp(), side: THREE.DoubleSide });
  plantMat.onBeforeCompile = patch;
  plantMat.customProgramCacheKey = () => "isl-plants";
  const plantDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  plantDepth.onBeforeCompile = patch;
  plantDepth.customProgramCacheKey = () => "isl-plants-depth";

  const mats = {
    shallows: ctx.toon.material({ color: C.shallows, transparent: true, opacity: SHALLOWS.opacity, depthWrite: false }),
    rim: ctx.toon.material({ color: C.beachRim, transparent: true, opacity: RIM.opacity, depthWrite: false }),
    sand: ctx.toon.material(C.sand),
    grass: ctx.toon.material(C.grass),
    skirt: ctx.toon.material(C.sandDark),
    contact: ctx.toon.flat({ color: "#000000", transparent: true, opacity: PLANT.shadowOpa, depthWrite: false }),
  };

  let builtFor = null;
  let geos = [];
  let waterlines = []; // { geo, base, isl, band }

  // ---------- the outline ----------

  // The spline at scale 1 about her middle, as plan offsets, with each sample's bearing. The same
  // curve `drawIslands` traces with quadraticCurveTo, sampled.
  function outline(isl) {
    const n = isl.verts.length, P = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, rr = isl.r * isl.verts[k];
      P.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    const out = [];
    for (let k = 0; k < n; k++) {
      const p = P[k], q = P[(k + 1) % n], prev = P[(k + n - 1) % n];
      const m0 = [(prev[0] + p[0]) / 2, (prev[1] + p[1]) / 2], m1 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      for (let i = 0; i < SPLINE_STEPS; i++) {
        const t = i / SPLINE_STEPS, u = 1 - t;
        const x = u * u * m0[0] + 2 * u * t * p[0] + t * t * m1[0];
        const y = u * u * m0[1] + 2 * u * t * p[1] + t * t * m1[1];
        out.push({ x, y, a: Math.atan2(y, x) });
      }
    }
    return out;
  }

  const peakOf = (isl) => Math.min(PEAK_MAX, isl.r * PEAK_SHARE);
  // the land's height at `s`, her distance from the middle as a share of the way to the sand's edge
  const heightAt = (isl, s) => EDGE_H + (peakOf(isl) - EDGE_H) * (1 - smooth(Math.min(1, Math.max(0, s))));

  // the ground under a plan offset from her middle: the share of her outline's radius on that bearing
  function groundAt(isl, x, y) {
    const n = isl.verts.length;
    let b = (Math.atan2(y, x) / (Math.PI * 2)) * n;
    if (b < 0) b += n;
    const k = Math.floor(b) % n, f = b - Math.floor(b);
    const rr = isl.r * (isl.verts[k] * (1 - f) + isl.verts[(k + 1) % n] * f) * 0.97; // the spline sits a touch inside
    return heightAt(isl, Math.hypot(x, y) / rr);
  }

  // ---------- the land ----------

  // Rings of the outline from outermost in, `rings[j] = [scale, height]`, stitched band to band,
  // capped with a point at the middle when `cap` is given. Faces up (counter-clockwise from above).
  function landGeo(line, rings, cap) {
    const M = line.length, pos = [], idx = [];
    for (const [s, h] of rings) for (const p of line) pos.push(p.x * s, h, p.y * s);
    for (let j = 0; j + 1 < rings.length; j++) {
      for (let k = 0; k < M; k++) {
        const o0 = j * M + k, o1 = j * M + ((k + 1) % M), i0 = o0 + M, i1 = o1 + M;
        idx.push(i0, o1, o0, i0, i1, o1);
      }
    }
    if (cap != null) {
      const c = pos.length / 3, last = (rings.length - 1) * M;
      pos.push(0, cap, 0);
      for (let k = 0; k < M; k++) idx.push(c, last + ((k + 1) % M), last + k);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geos.push(geo);
    return geo;
  }

  // the sand's edge as a face, from under the water up to the sand, facing out
  function skirtGeo(line, top) {
    const M = line.length, pos = [], nrm = [], idx = [];
    for (const p of line) {
      const l = Math.hypot(p.x, p.y) || 1;
      pos.push(p.x, top, p.y, p.x * 1.004, -0.4, p.y * 1.004);
      nrm.push(p.x / l, 0.25, p.y / l, p.x / l, 0.25, p.y / l);
    }
    for (let k = 0; k < M; k++) {
      const t0 = 2 * k, b0 = t0 + 1, t1 = 2 * ((k + 1) % M), b1 = t1 + 1;
      idx.push(t0, b0, t1, t1, b0, b1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    geo.setIndex(idx);
    geos.push(geo);
    return geo;
  }

  // ---------- the waterline ----------

  // A flat sheet of her outline at `band.scale`, fanned from her middle, whose edge rolls on the
  // swell. The roll is a whole number of waves round her, taken from each sample's bearing, so the
  // ring closes on itself without a notch; `rollWaterline` moves the edge every frame.
  function waterlineGeo(isl, line, band) {
    const M = line.length;
    const pos = new Float32Array((M + 1) * 3), nrm = new Float32Array((M + 1) * 3), idx = [];
    for (let i = 0; i <= M; i++) nrm[i * 3 + 1] = 1;
    pos[1] = band.y;
    for (let k = 0; k < M; k++) idx.push(0, 1 + ((k + 1) % M), 1 + k);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), isl.r * 1.08 * band.scale + band.amp + 1);
    geos.push(geo);
    const w = { geo, line, band };
    rollWaterline(w, 0);
    waterlines.push(w);
    return geo;
  }

  function rollWaterline({ geo, line, band }, t) {
    const pos = geo.attributes.position.array;
    for (let k = 0; k < line.length; k++) {
      const p = line[k], l = Math.hypot(p.x, p.y) || 1;
      const rr = l * band.scale + Math.sin(t * band.speed + p.a * band.waves) * band.amp;
      pos[3 + k * 3] = (p.x / l) * rr;
      pos[4 + k * 3] = band.y;
      pos[5 + k * 3] = (p.y / l) * rr;
    }
    geo.attributes.position.needsUpdate = true;
  }

  // ---------- the planting ----------

  // One growing buffer of triangles in vertex colours, with normals given and a sway per vertex.
  function plantBuffer() {
    const P = [], N = [], Cl = [], S = [];
    const col = {};
    const rgb = (hex) => col[hex] || (col[hex] = new THREE.Color(hex));
    return {
      P, N, Cl, S,
      vert(p, n, hex, sway = [0, 0, 0]) {
        const c = rgb(hex);
        P.push(p[0], p[1], p[2]);
        N.push(n[0], n[1], n[2]);
        Cl.push(c.r, c.g, c.b);
        S.push(sway[0], sway[1], sway[2]);
      },
      tri(a, b, c, hex, swayA, swayB, swayC, mix) {
        // a flat face, its normal from the winding; `mix` bends it toward a given normal
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        if (mix) n = [n[0] / (Math.hypot(...n) || 1) + mix[0], n[1] / (Math.hypot(...n) || 1) + mix[1], n[2] / (Math.hypot(...n) || 1) + mix[2]];
        const l = Math.hypot(...n) || 1;
        n = [n[0] / l, n[1] / l, n[2] / l];
        const hx = Array.isArray(hex) ? hex : [hex, hex, hex];
        this.vert(a, n, hx[0], swayA);
        this.vert(b, n, hx[1], swayB);
        this.vert(c, n, hx[2], swayC);
      },
    };
  }

  // A low-poly lump: an icosahedron scaled to radii (rx, ry, rz) about `c`, smooth shaded.
  const lumps = [new THREE.IcosahedronGeometry(1, 0), new THREE.IcosahedronGeometry(1, 1)];
  function lump(buf, c, rx, ry, rz, hex, detail = 1, sway) {
    const src = lumps[detail].attributes.position.array;
    for (let i = 0; i < src.length; i += 3) {
      const x = src[i], y = src[i + 1], z = src[i + 2];
      const nl = Math.hypot(x / rx, y / ry, z / rz) || 1;
      buf.vert([c[0] + x * rx, c[1] + y * ry, c[2] + z * rz], [x / rx / nl, y / ry / nl, z / rz / nl], hex, sway);
    }
  }

  // One blade, swept along a quadratic from `root` out on plan bearing `a`, rising `arch` of its
  // length at mid-blade and dropping `droop` at the tip, folded along its midrib so the bands catch
  // both halves. Dark at the root, the frond green out along it, as the 2D crown core shaded it.
  function blade(buf, root, a, L, wMax, arch, droop, notch, steps, amp, ph, freq) {
    const dx = Math.cos(a), dz = Math.sin(a);
    const p0 = root;
    const p1 = [root[0] + dx * L * 0.5, root[1] + (arch * L) / ZUP, root[2] + dz * L * 0.5];
    const p2 = [root[0] + dx * L, root[1] - (droop * L) / ZUP, root[2] + dz * L];
    const sect = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      const p = [0, 1, 2].map((j) => u * u * p0[j] + 2 * u * t * p1[j] + t * t * p2[j]);
      let w = wMax * Math.sin(Math.PI * Math.pow(t, 0.8));
      if (notch && i % 2) w *= 0.52;
      // across the blade is level and square to its bearing; the edges hang a little under the rib
      const side = [-dz * w, -w * 0.28, dx * w], side2 = [dz * w, -w * 0.28, -dx * w];
      const bend = (2 * u * t * 0.3 + t * t) * amp;
      const sw = [bend, ph, freq];
      const hex = t < 0.28 ? C.frondDk : C.frond;
      sect.push({ m: p, l: [p[0] + side[0], p[1] + side[1], p[2] + side[2]], r: [p[0] + side2[0], p[1] + side2[1], p[2] + side2[2]], sw, hex });
    }
    for (let i = 0; i < steps; i++) {
      const s0 = sect[i], s1 = sect[i + 1], hx = [s0.hex, s1.hex, s1.hex];
      buf.tri(s0.m, s1.l, s0.l, [s0.hex, s1.hex, s0.hex], s0.sw, s1.sw, s0.sw, [0, 0.6, 0]);
      buf.tri(s0.m, s1.m, s1.l, [s0.hex, s1.hex, s1.hex], s0.sw, s1.sw, s1.sw, [0, 0.6, 0]);
      buf.tri(s0.m, s0.r, s1.r, [s0.hex, s0.hex, s1.hex], s0.sw, s0.sw, s1.sw, [0, 0.6, 0]);
      buf.tri(s0.m, s1.r, s1.m, hx, s0.sw, s1.sw, s1.sw, [0, 0.6, 0]);
    }
  }

  // A bowed, tapered trunk from `base` to `top`, five-sided, bowing `bow` across at its middle.
  function trunk(buf, base, top, wb, wt, bow) {
    const SIDES = 5, SEG = 6;
    const p1 = [(base[0] + top[0]) / 2 + bow, (base[1] + top[1]) / 2, (base[2] + top[2]) / 2];
    const ring = [];
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG, u = 1 - t;
      const c = [0, 1, 2].map((j) => u * u * base[j] + 2 * u * t * p1[j] + t * t * top[j]);
      const r = (wb + (wt - wb) * t) / 2;
      const pts = [];
      for (let k = 0; k < SIDES; k++) {
        const a = (k / SIDES) * Math.PI * 2;
        pts.push({ p: [c[0] + Math.cos(a) * r, c[1], c[2] + Math.sin(a) * r], n: [Math.cos(a), 0.15, Math.sin(a)] });
      }
      ring.push(pts);
    }
    for (let i = 0; i < SEG; i++) {
      for (let k = 0; k < SIDES; k++) {
        const a = ring[i][k], b = ring[i][(k + 1) % SIDES], c = ring[i + 1][(k + 1) % SIDES], d = ring[i + 1][k];
        for (const v of [a, d, c, a, c, b]) buf.vert(v.p, v.n, C.wood);
      }
    }
  }

  function palm(buf, f, gy) {
    const tr = PLANT.canopy * f.s;
    const lean = f.k * PLANT.bow * tr;
    const base = [f.x, gy - 0.3, f.y];
    const crown = [f.x + lean, gy + (tr * PLANT.trunkH) / ZUP, f.y];
    const wb = Math.max(1.1, tr * PLANT.trunkW);
    trunk(buf, base, crown, wb, wb * PLANT.taper, lean * 0.9);

    const n = tr < 6 ? Math.max(4, PLANT.fronds - 2) : PLANT.fronds;
    const step = (Math.PI * 2) / n;
    // the low tier cuts the blades to fewer sections and drops the leaflet notches
    const notch = tr > 7 && !LOW;
    const steps = LOW ? 5 : notch ? 10 : 8;
    for (let i = 0; i < n; i++) {
      const a = f.a + i * step + Math.sin(f.ph + i * 2.4) * step * 0.18;
      const jitter = 1 + Math.sin(f.ph * 3 + a * 2) * 0.14;
      blade(buf, crown, a, tr * PLANT.frondLen * jitter, tr * PLANT.frondWidth, PLANT.arch, PLANT.droop,
        notch, steps, PLANT.wind * tr, f.ph + i * 0.9, 1.5);
    }
    lump(buf, crown, tr * 0.16, (tr * 0.13) / ZUP, tr * 0.16, C.frondDk, 0);
    if (tr > 9 && f.nuts > 0.45) {
      const rN = Math.max(1, tr * 0.085);
      for (let i = 0; i < 3; i++) {
        const a = f.ph + i * 2.1;
        lump(buf, [crown[0] + Math.cos(a) * tr * 0.17, crown[1] - (tr * 0.14) / ZUP, crown[2] + Math.sin(a) * tr * 0.17], rN, rN, rN, C.coconut, 0);
      }
    }
  }

  function bush(buf, f, gy) {
    const tr = PLANT.canopy * f.s * 0.62;
    const at = (up) => [f.x, gy + up / ZUP, f.y];
    lump(buf, at(tr * 0.24), tr * 0.70, (tr * 0.46) / ZUP, tr * 0.62, C.frondDk);
    lump(buf, [f.x - tr * 0.14, gy + (tr * 0.5) / ZUP, f.y - tr * 0.1], tr * 0.5, (tr * 0.36) / ZUP, tr * 0.46, C.frond);
    if (tr < 4) return;
    const n = tr < 8 ? 5 : 7, step = (Math.PI * 2) / n;
    const root = at(tr * 0.28);
    for (let i = 0; i < n; i++) {
      const a = f.a + i * step + Math.sin(f.ph + i * 1.7) * step * 0.22;
      const jitter = 1 + Math.sin(f.ph * 2 + a * 3) * 0.18;
      blade(buf, root, a, tr * 0.98 * jitter, tr * 0.30, 0.44, 0.06, false, LOW ? 4 : 6, PLANT.wind * tr * 0.75, f.ph + i * 1.1, 1.9);
    }
  }

  function plantingGeo(isl) {
    const buf = plantBuffer();
    for (const f of plantingOf(isl)) (f.isPalm ? palm : bush)(buf, f, groundAt(isl, f.x, f.y));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(buf.P, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(buf.N, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(buf.Cl, 3));
    geo.setAttribute("aSway", new THREE.Float32BufferAttribute(buf.S, 3));
    geo.computeBoundingSphere();
    geo.boundingSphere.radius += PLANT.wind * PLANT.canopy * PLANT.scaleMax + 2; // room for the gust
    geos.push(geo);
    return geo;
  }

  // Without shadow maps a plant would float, so the low tier lays the 2D sea's small patch at each
  // base instead: "this touches the ground here", leaning toward the crown.
  function contactGeo(isl) {
    const pos = [], idx = [], SIDES = 10;
    for (const f of plantingOf(isl)) {
      const tr = PLANT.canopy * f.s * (f.isPalm ? 1 : 0.62);
      const lean = f.isPalm ? f.k * PLANT.bow * tr : 0;
      const r = tr * PLANT.shadowSize * 1.2, ox = f.x + lean * PLANT.shadowLean, oz = f.y + tr * 0.08;
      const y = groundAt(isl, ox, oz) + 0.08;
      const c = pos.length / 3;
      pos.push(ox, y, oz);
      for (let k = 0; k < SIDES; k++) {
        const a = (k / SIDES) * Math.PI * 2;
        pos.push(ox + Math.cos(a) * r, y, oz + Math.sin(a) * r);
        idx.push(c, c + 1 + ((k + 1) % SIDES), c + 1 + k);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geos.push(geo);
    return geo;
  }

  // ---------- one round's islands ----------

  function release() {
    for (const g of geos) g.dispose();
    geos = [];
    waterlines = [];
    root.clear();
  }

  function build(world) {
    release();
    for (const isl of world.islands) {
      const g = new THREE.Group();
      g.name = "island";
      g.position.set(isl.x, 0, isl.y);
      const line = outline(isl);

      const shallows = new THREE.Mesh(waterlineGeo(isl, line, SHALLOWS), mats.shallows);
      shallows.renderOrder = 1;
      const rim = new THREE.Mesh(waterlineGeo(isl, line, RIM), mats.rim);
      rim.renderOrder = 2;

      // the 2D sand's dark stroke, a hairline band round her edge
      const lip = 1 - EDGE_LINE / (isl.r * 0.93);
      const edge = new THREE.Mesh(landGeo(line, [[1, heightAt(isl, 1)], [lip, heightAt(isl, lip)]], null), mats.skirt);
      const sandRings = [[lip, heightAt(isl, lip)], ...SAND_RINGS.slice(1).map((s) => [s, heightAt(isl, s)])];
      const grassRings = GRASS_RINGS.map((s) => [s, heightAt(isl, s)]);
      const sand = new THREE.Mesh(landGeo(line, sandRings, null), mats.sand);
      const grass = new THREE.Mesh(landGeo(line, grassRings, heightAt(isl, 0)), mats.grass);
      const skirt = new THREE.Mesh(skirtGeo(line, EDGE_H), mats.skirt);
      const plants = new THREE.Mesh(plantingGeo(isl), plantMat);
      plants.customDepthMaterial = plantDepth;

      for (const m of [shallows, rim]) m.receiveShadow = quality.shadows;
      for (const m of [edge, sand, grass, skirt, plants]) {
        m.castShadow = quality.shadows;
        m.receiveShadow = quality.shadows;
      }
      g.add(shallows, rim, edge, sand, grass, skirt, plants);
      if (!quality.shadows) {
        const contact = new THREE.Mesh(contactGeo(isl), mats.contact);
        contact.renderOrder = 3;
        g.add(contact);
      }
      root.add(g);
    }
  }

  function update(world) {
    if (world.islands !== builtFor) {
      builtFor = world.islands;
      build(world);
    }
    const t = ctx.clock.t;
    uTime.value = t;
    for (const w of waterlines) rollWaterline(w, t);
  }

  function dispose() {
    release();
    plantMat.dispose();
    plantDepth.dispose();
    for (const g of lumps) g.dispose();
    root.removeFromParent();
  }

  return { update, dispose };
}

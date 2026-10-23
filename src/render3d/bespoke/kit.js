/**
 * THE BESPOKE SHIPS' TOOLKIT: what every hand-modelled class is built with.
 *
 * A bespoke ship (`src/render3d/bespoke/<class>.js`) is a three.js model of one class, built from her
 * own figures rather than from the galleon's form, and this is the vocabulary those files share:
 * sweeps, rods, boxes with the faces nobody sees left off, the merging and baking that turns hundreds
 * of pieces into a handful of draw calls, the materials (a solid batch coloured per vertex with a
 * trim mark the shader paints in her livery and the iron bands it paints on a lower mast, a painted
 * hull from a texture sheet, decks, sailcloth that breathes on the GPU, rope as lines), the shared
 * textures, and the sail, railing and flag builders. Nothing in here knows what a first rate is.
 *
 * Changing this file changes every bespoke ship, which is what `npm run shiplab -- --diff staging`
 * is for. A class's own look lives in her own file; this stays a toolkit.
 *
 * AXES. The model frame is `shipmodel.js`'s: X toward the bow, Y up from the waterline, Z to
 * starboard, 1 unit = 1 metre as the class files are drawn, scaled by the registry afterwards.
 *
 * CANVAS. The painted surfaces are drawn with Canvas 2D at build time. In Node, where there is no
 * canvas, `setBespokeEnv({ createCanvas })` hands in a stand-in so the geometry still builds and the
 * bench can check it; the textures are then empty, which nothing in Node looks at.
 *
 * three.js here is the game's own (0.186): colours are managed, so a hex string is converted to
 * linear by `THREE.Color` itself and never by hand, textures declare their colour space, and the
 * Lambert material lights per fragment.
 */

import * as THREE from "three";

/* ---- the environment ---------------------------------------------------------------------------- */

let ENV = {
  createCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  },
};
/** Replace how a canvas is made, for an environment without a document. */
export function setBespokeEnv(env) { ENV = { ...ENV, ...env }; }

/**
 * A canvas that paints nothing: every method is a no-op returning another such object, so a
 * painter written against the 2D context runs to the end in Node. `setBespokeEnv({ createCanvas:
 * stubCanvas })` is how the bench builds a ship.
 */
export function stubCanvas(w, h) {
  const nothing = new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === "width" ? 0 : nothing),
    set: () => true,
    apply: () => nothing,
    has: () => false,
  });
  return { width: w, height: h, getContext: () => nothing, toDataURL: () => "" };
}

export const canvas = (w, h) => { const c = ENV.createCanvas(w, h); return [c, c.getContext("2d")]; };

/* ---- small helpers ------------------------------------------------------------------------------ */

export const col = (hex) => new THREE.Color(hex); // sRGB hex in, linear out, under three's colour management
export const ss = (a, b, t) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
export const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const lerp = (a, b, k) => a + (b - a) * k;
export const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
export const V2 = (x, y) => new THREE.Vector2(x, y);
export const UP = V3(0, 1, 0);

/** A fixed pseudo-random sequence, so painted detail comes out the same on every build. */
export function prng(seed = 7) {
  let s = seed;
  const next = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  next.reset = (v) => { s = v; };
  return next;
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** A canvas as a texture: sRGB unless `linear`, with a little anisotropy (three clamps it to the device's). */
export function toTex(c, linear) {
  const t = new THREE.CanvasTexture(c);
  if (!linear) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* ---- geometry builders --------------------------------------------------------------------------- */

export function gridGeo(cols, rows, pointAt, uvAt) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= cols; i++) for (let j = 0; j <= rows; j++) {
    const p = pointAt(i, j); pos.push(p.x, p.y, p.z); const q = uvAt(i, j); uv.push(q[0], q[1]);
  }
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const a = i * (rows + 1) + j, b = a + rows + 1; idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** Turn a single-sided surface so its faces look the given way (checked at its middle), or the other way if `reverse`. */
export function facing(geo, dir, reverse) {
  const n = geo.attributes.normal, mid = Math.floor(n.count / 2);
  const out = new THREE.Vector3().fromBufferAttribute(n, mid).dot(dir) > 0;
  if (out === !!reverse) {
    const ix = geo.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    geo.index.needsUpdate = true; geo.computeVertexNormals();
  }
  return geo;
}

// Parts are built from primitives placed in ship space, then merged so each material costs one draw call.
export function placeGeo(geo, pos, quat, scale) {
  return geo.applyMatrix4(new THREE.Matrix4().compose(pos || V3(0, 0, 0), quat || new THREE.Quaternion(), scale || V3(1, 1, 1)));
}
/** A round rod from a (radius r0) to b (radius r1). */
export function rodGeo(r0, r1, a, b, seg, open) {
  const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
  return placeGeo(new THREE.CylinderGeometry(r1, r0, len, seg || 8, 1, !!open), a.clone().addScaledVector(dir, 0.5),
    new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
}
/**
 * A rod like rodGeo, closed only at b: its end at a is hidden where it meets another part (a yard's
 * two halves meet at the mast). Its cap at b is a fan without a centre point.
 */
export function rodCapB(r0, r1, a, b, seg) {
  const dir = new THREE.Vector3().subVectors(b, a), len = dir.length(), pos = [], nrm = [], idx = [];
  for (let k = 0; k < seg; k++) { const t = k / seg * Math.PI * 2; pos.push(r1 * Math.sin(t), len / 2, r1 * Math.cos(t)); nrm.push(0, 1, 0); }
  for (let k = 1; k < seg - 1; k++) idx.push(0, k, k + 1);
  const cap = new THREE.BufferGeometry();
  cap.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); cap.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  cap.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(seg * 2).fill(0), 2)); cap.setIndex(idx);
  const m = new THREE.Matrix4().compose(a.clone().addScaledVector(dir, 0.5), new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()), V3(1, 1, 1));
  return mergeGeos([new THREE.CylinderGeometry(r1, r0, len, seg, 1, true).applyMatrix4(m), cap.applyMatrix4(m)]);
}
export const boxGeo = (w, h, d, pos, quat) => placeGeo(new THREE.BoxGeometry(w, h, d), pos, quat);
/** A box whose local x, y, z axes are the given unit vectors. */
export const frameBox = (w, h, d, pos, X, Y, Z) => new THREE.BoxGeometry(w, h, d).applyMatrix4(new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(pos));
/**
 * Level undersides that only a camera below the ship's rails could see are left off: the cap rail's,
 * the stern balconies' rails', the deck railings' top rails, the gun carriages', the pin rails' and
 * the ladder treads'. Not where a rail slopes (a sloping underside faces an ordinary camera), and
 * nothing aloft (the tops, caps and crosstrees are seen from below). Both the sea's camera and the
 * menu's look down on her, so this stays false.
 */
export const UNDERSIDES = false;
export const boxTop = (w, h, d, pos, quat) => UNDERSIDES ? boxGeo(w, h, d, pos, quat) : placeGeo(keepFaces(new THREE.BoxGeometry(w, h, d), [0, 1, 2, 4, 5]), pos, quat);
export const frameBoxTop = (w, h, d, pos, X, Y, Z) => UNDERSIDES ? frameBox(w, h, d, pos, X, Y, Z)
  : keepFaces(new THREE.BoxGeometry(w, h, d), [0, 1, 2, 4, 5]).applyMatrix4(new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(pos));
export const LEVEL = 0.18; // "level": rising no more than 0.18 m a metre (about 10 degrees); a sheer stays well under it
export const NO_UNDERSIDE = UNDERSIDES ? undefined : { edges: [0], maxSlope: LEVEL }; // a sweep's profile edge 0 is its underside
export const sphereGeo = (r, p, w = 6, h = 4) => placeGeo(new THREE.SphereGeometry(r, w, h), p);

/** The vertex marks the solid material reads: -2 is trim, painted in her livery; 0 and up counts iron bands up a lower mast; -1 is plain. */
export const MARK = { plain: -1, trim: -2 };

/**
 * Sweep a closed 2-D profile [[out, up], ...] (anticlockwise) along a path of frames {p, o, u}. Each
 * profile edge gets its own strip, so corners stay crisp; faces are wound outward whichever way the
 * path runs. opts.paint = { base: hex, edges: { [edge]: hex | 'trim' }, caps: hex | 'trim' } colours
 * each edge's strip (and the end caps) in the vertices, 'trim' taking the livery, so one sweep can
 * carry two colours. opts.uv(edge, i, end) and opts.capUV give texture-sheet coordinates instead,
 * for a sweep drawn with the painted surfaces. opts.skip = { edges, maxSlope } leaves off those
 * profile edges' strips wherever the path runs level, rising no more than maxSlope per metre.
 */
export function sweepGeo(path, profile, caps = true, opts = {}) {
  const pos = [], idx = [], uv = [], clr = [], mark = [], paint = opts.paint;
  const tone = (c) => (c === "trim" ? [1, 1, 1, MARK.trim] : ((q) => [q.r, q.g, q.b, MARK.plain])(col(c)));
  const dab = (c) => { const t = tone(c); clr.push(t[0], t[1], t[2]); mark.push(t[3]); };
  const n = profile.length, m = path.length;
  const flip = new THREE.Vector3().crossVectors(path[0].o, path[0].u).dot(path[1].p.clone().sub(path[0].p)) > 0;
  const tri = (a, b, c) => (flip ? idx.push(a, c, b) : idx.push(a, b, c));
  const at = (f, k) => { const [a, b] = profile[k]; return f.p.clone().addScaledVector(f.o, a).addScaledVector(f.u, b); };
  const level = (i) => { const d = path[i + 1].p.clone().sub(path[i].p), run = Math.hypot(d.x, d.z); return Math.abs(d.y) <= opts.skip.maxSlope * run; };
  for (let e = 0; e < n; e++) {
    const k0 = e, k1 = (e + 1) % n;
    const keep = (i) => !(opts.skip && opts.skip.edges.includes(e) && level(i));
    const pushPair = (i) => {
      const base = pos.length / 3, a = at(path[i], k0), b = at(path[i], k1);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      if (opts.uv) uv.push(...opts.uv(e, i, 0), ...opts.uv(e, i, 1)); else uv.push(0, 0, 0, 0);
      if (paint) { const c = (paint.edges && paint.edges[e]) || paint.base; dab(c); dab(c); }
      return base;
    };
    let last = -2, a0 = 0;
    for (let i = 0; i < m - 1; i++) {
      if (!keep(i)) continue;
      if (last !== i - 1) a0 = pushPair(i);
      const a = a0, b = pushPair(i + 1); tri(a, b, a + 1); tri(a + 1, b, b + 1);
      last = i; a0 = b;
    }
  }
  if (caps) [0, m - 1].forEach((i, s) => {
    const base = pos.length / 3;
    for (let k = 0; k < n; k++) {
      const p = at(path[i], k); pos.push(p.x, p.y, p.z); uv.push(...(opts.capUV || [0, 0]));
      if (paint) dab(paint.caps || paint.base);
    }
    for (let k = 1; k < n - 1; k++) s ? tri(base, base + k + 1, base + k) : tri(base, base + k, base + k + 1);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  if (paint) { g.setAttribute("color", new THREE.Float32BufferAttribute(clr, 3)); g.setAttribute("aMark", new THREE.Float32BufferAttribute(mark, 1)); }
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** A box with only some of its faces (0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z): faces that can never be seen are left off. */
export function keepFaces(box, faces) {
  const out = new THREE.BufferGeometry(), keys = ["position", "normal", "uv"], dst = { position: [], normal: [], uv: [] }, idx = [];
  faces.forEach((fc, n) => {
    for (let v = 0; v < 4; v++) keys.forEach((k) => { const a = box.attributes[k]; for (let c = 0; c < a.itemSize; c++) dst[k].push(a.array[(fc * 4 + v) * a.itemSize + c]); });
    for (let t = 0; t < 6; t++) idx.push(box.index.array[fc * 6 + t] - fc * 4 + n * 4);
  });
  keys.forEach((k) => out.setAttribute(k, new THREE.Float32BufferAttribute(dst[k], box.attributes[k].itemSize)));
  out.setIndex(idx); box.dispose();
  return out;
}
/** A box standing on the deck (or on another part): its underside is left off. `top` colours its top face (a lid, a cap, a tread). */
export function deckBox(w, h, d, pos, top) {
  const g = keepFaces(new THREE.BoxGeometry(w, h, d), [0, 1, 2, 4, 5]).translate(pos.x, pos.y, pos.z);
  if (top) g.userData.top = col(top);
  return g;
}
/** A turned profile (gun barrels, balusters, columns, finials): [[radius, height], ...] bottom to top. */
export const latheGeo = (prof, seg = 8) => new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)), seg);
/** One material group of a non-indexed geometry (an extrusion's caps or its sides), as its own geometry. */
export function groupGeo(geo, gi) {
  const gr = geo.groups[gi], out = new THREE.BufferGeometry();
  ["position", "normal", "uv"].forEach((k) => { const a = geo.attributes[k]; out.setAttribute(k, new THREE.BufferAttribute(a.array.slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize), a.itemSize)); });
  return out;
}

/**
 * Several geometries as one. Position, normal, uv, colour and mark are carried; a piece without
 * colours comes through white and a piece without marks plain, so the result always has both when
 * any piece did. The pieces are disposed. Indices are 16-bit whenever they reach (below 65535:
 * WebGL 2 reads 65535 as "restart", which would drop a triangle).
 */
export function mergeGeos(list) {
  let nv = 0, ni = 0, hasCol = false, hasMark = false, hasWave = false;
  list.forEach((g) => {
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    if (!g.attributes.normal) g.computeVertexNormals();
    nv += g.attributes.position.count; ni += g.index.count;
    if (g.attributes.color) hasCol = true;
    if (g.attributes.aMark) hasMark = true;
    if (g.attributes.aWaveA) hasWave = true;
  });
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = nv < 65535 ? new Uint16Array(ni) : new Uint32Array(ni);
  const clr = hasCol ? new Float32Array(nv * 3).fill(1) : null, mk = hasMark ? new Float32Array(nv).fill(MARK.plain) : null;
  const wA = hasWave ? new Float32Array(nv * 4) : null, wB = hasWave ? new Float32Array(nv * 3) : null;
  let v = 0, i = 0;
  list.forEach((g) => {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, n * 3), v * 3); nor.set(g.attributes.normal.array.subarray(0, n * 3), v * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, n * 2), v * 2);
    if (clr && g.attributes.color) clr.set(g.attributes.color.array.subarray(0, n * 3), v * 3);
    if (mk && g.attributes.aMark) mk.set(g.attributes.aMark.array.subarray(0, n), v);
    if (wA && g.attributes.aWaveA) { wA.set(g.attributes.aWaveA.array.subarray(0, n * 4), v * 4); wB.set(g.attributes.aWaveB.array.subarray(0, n * 3), v * 3); }
    const gi = g.index.array; for (let k = 0; k < gi.length; k++) idx[i + k] = gi[k] + v;
    v += n; i += gi.length; g.dispose();
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  if (clr) out.setAttribute("color", new THREE.BufferAttribute(clr, 3));
  if (mk) out.setAttribute("aMark", new THREE.BufferAttribute(mk, 1));
  if (wA) { out.setAttribute("aWaveA", new THREE.BufferAttribute(wA, 4)); out.setAttribute("aWaveB", new THREE.BufferAttribute(wB, 3)); }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/**
 * Several geometries as one mesh's geometry with a material group each: `[{ geo, material }]` where
 * `material` is the index into the mesh's material array. Pieces sharing an index are laid out
 * together, so the mesh draws once per material it uses. Every attribute any piece carries is
 * carried by all, with the defaults `mergeGeos` fills in.
 */
export function mergeGroups(pieces) {
  const order = [...new Set(pieces.map((p) => p.material))].sort((a, b) => a - b);
  const runs = order.map((m) => mergeGeos(pieces.filter((p) => p.material === m).map((p) => p.geo)));
  const counts = runs.map((g) => g.index.count); // taken before the runs are merged and disposed
  const out = mergeGeos(runs);
  let start = 0;
  counts.forEach((n, i) => { out.addGroup(start, n, order[i]); start += n; });
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/* ---- materials ---------------------------------------------------------------------------------- */

const inject = (src, chunk, code) => {
  if (!src.includes(chunk)) console.warn("bespoke ship shader: no " + chunk + " to patch (three.js version?)");
  return src.replace(chunk, chunk + "\n" + code);
};

/**
 * THE SKY'S SOFT LIGHT ON HER, over and above the scene's lights: the sky's colour on faces that
 * look up, the bright horizon's on faces that look out and the sea's bounced up on faces that look
 * down, as the ship was first lit. Without it her canvas and timber facing away from the key go a
 * flat grey, because a Lambert surface takes only the light that reaches it and the sea's own
 * hemisphere fill is tuned for the toon ramp, which never falls that far. Worked per fragment, so
 * it costs a mix and a dot. `k` is how strong; 0 switches it off.
 */
export const FILL = { k: 0.5, sky: "#a9d3e4", horizon: "#d5ebef", ground: "#3c8aa6" };
function withFill(m) {
  const prev = m.onBeforeCompile, key = m.customProgramCacheKey.call(m);
  const u = { sky: { value: col(FILL.sky).multiplyScalar(FILL.k) }, horizon: { value: col(FILL.horizon).multiplyScalar(FILL.k) }, ground: { value: col(FILL.ground).multiplyScalar(FILL.k) } };
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.fillSky = u.sky; sh.uniforms.fillHorizon = u.horizon; sh.uniforms.fillGround = u.ground;
    sh.fragmentShader = inject(inject(sh.fragmentShader, "#include <common>", `uniform vec3 fillSky, fillHorizon, fillGround;
        vec3 skyFill( float up ) { return up > 0.0 ? mix( fillHorizon, fillSky, up ) : mix( fillHorizon, fillGround, -up ); }`),
      "#include <lights_fragment_begin>", `{
        vec3 fillUpDir = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
        irradiance += PI * skyFill( dot( normal, fillUpDir ) );
      }`);
  };
  m.customProgramCacheKey = () => key + "|fill";
  return m;
}

/** The lower masts' iron bands, which the solid material paints: one every 1.45 m, 0.12 m deep. */
export const BAND = { every: 1.45, width: 0.12 };

/**
 * The solid material: every timber, iron, copper and trim part of a ship in one Lambert material
 * that takes its colour from the vertices. Each vertex carries a mark (`aMark`): -2 for trim, which
 * the shader paints in `trim` (a uniform of this material's own, so changing it costs nothing); 0
 * and up along a lower mast, where the shader paints the black iron bands; -1 for everything else.
 * `tint` multiplies every colour but the trim, for her timber.
 */
export function solidMaterial({ trim = "#e8c877", tint = null } = {}) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  const uTrim = { value: col(trim) }, uBand = { value: col("#1c1b1d") };
  const w = (BAND.width / BAND.every).toFixed(5);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.trimColor = uTrim; sh.uniforms.bandColor = uBand;
    sh.vertexShader = inject(inject(sh.vertexShader, "#include <common>", "attribute float aMark;\nvarying float vMark;"),
      "#include <begin_vertex>", "vMark = aMark;");
    sh.fragmentShader = inject(inject(sh.fragmentShader, "#include <common>", `uniform vec3 trimColor, bandColor;
        varying float vMark;
        float bandRun( float x ) { return floor( x ) * ${w} + min( fract( x ), ${w} ); }`),
      "#include <color_fragment>", `float bandFw = max( fwidth( vMark ), 1e-4 );
        if ( vMark < -1.5 ) diffuseColor.rgb = trimColor;
        else if ( vMark >= 0.0 ) diffuseColor.rgb = mix( diffuseColor.rgb, bandColor,
          clamp( ( bandRun( vMark + 0.5 * bandFw ) - bandRun( vMark - 0.5 * bandFw ) ) / bandFw, 0.0, 1.0 ) );`);
  };
  m.customProgramCacheKey = () => "bespoke-solid";
  m.userData.trim = uTrim;
  if (tint) m.color.copy(tint);
  return withFill(m);
}

/** The painted surfaces: her sides, stern and galleries off one texture sheet. `tint` is her timber. */
export function hullMaterial(atlasTex, { tint = null } = {}) {
  const m = new THREE.MeshLambertMaterial({ map: atlasTex });
  m.customProgramCacheKey = () => "bespoke-hull";
  if (tint) m.color.copy(tint);
  return withFill(m);
}

/** Decks: lit per fragment, from the shared planking texture. */
export function deckMaterial({ tint = null } = {}) {
  const m = new THREE.MeshLambertMaterial({ map: deckTexture() });
  m.customProgramCacheKey = () => "bespoke-deck";
  if (tint) m.color.copy(tint);
  return withFill(m);
}

/** The clock the sails breathe on: one float, written by whoever draws the ship. Shared by every bespoke ship. */
export const SHIP_TIME = { value: 0 };
/** Advance the sails' clock to `t` seconds. Wrapped so sin() stays precise on a mobile GPU in a long session. */
export const tickSails = (t) => { SHIP_TIME.value = t % (100 * Math.PI); };

/**
 * Sailcloth: double-sided Lambert off the shared canvas texture, breathing in the vertex shader so the
 * CPU does nothing for it. Each vertex carries its own motion: an offset along x (a square sail) of
 * A (sin(P + S t) + W sin(Q + R t)), with aWaveA = (A, P, S, axis) and aWaveB = (W, Q, R).
 */
export function sailMaterial() {
  const m = new THREE.MeshLambertMaterial({ map: sailTexture(), side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.shipTime = SHIP_TIME;
    sh.vertexShader = inject(inject(sh.vertexShader, "#include <common>", "uniform float shipTime;\nattribute vec4 aWaveA;\nattribute vec3 aWaveB;"),
      "#include <begin_vertex>", `float waveD = aWaveA.x * ( sin( aWaveA.y + aWaveA.z * shipTime ) + aWaveB.x * sin( aWaveB.y + aWaveB.z * shipTime ) );
        if ( aWaveA.w > 0.5 ) transformed.z += waveD; else transformed.x += waveD;`);
  };
  m.customProgramCacheKey = () => "bespoke-sail";
  return withFill(m);
}

/** Rope: one batch of coloured lines, about a pixel wide wherever it is drawn. */
let lineMat = null;
export function lineMaterial() { return lineMat || (lineMat = new THREE.LineBasicMaterial({ vertexColors: true })); }
export const ROPE = { tar: 0, ratline: 1, hemp: 2, iron: 3 };
const ROPE_COL = [col("#2b2016"), col("#4d4034"), col("#7d6a50"), col("#2a2c2e")];
/** Lines from [a, b, kind, a, b, kind, ...]. */
export function lineGeo(segs) {
  const n = segs.length / 3, pos = new Float32Array(n * 6), clr = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const a = segs[i * 3], b = segs[i * 3 + 1], c = ROPE_COL[segs[i * 3 + 2]];
    pos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6); clr.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(clr, 3));
  g.computeBoundingSphere();
  return g;
}

/** Her flags' cloth, in her livery: front-sided, because flags.js lays down both faces itself. */
export function flagMaterial(color = "#e8c877") {
  const m = new THREE.MeshLambertMaterial({ color: col(color) });
  m.customProgramCacheKey = () => "bespoke-flag";
  return withFill(m);
}

/* ---- colour tokens and baking ------------------------------------------------------------------- */

/**
 * Parts are modelled with a colour "token" as their material: a stand-in that names a colour (and a
 * mark), which `bakeGeos` writes into the vertices and merges into the solid batch. Tokens are keyed
 * by colour and shared by every build.
 */
const tokens = new Map();
export function shade(hex) {
  let t = tokens.get(hex);
  if (!t) { t = Object.assign(new THREE.MeshBasicMaterial(), { userData: { solid: col(hex) } }); tokens.set(hex, t); }
  return t;
}
export const trimToken = Object.assign(new THREE.MeshBasicMaterial(), { userData: { solid: new THREE.Color(1, 1, 1), mark: MARK.trim } });

/**
 * Parts are modelled as ordinary meshes in a scratch group (which must have no parent), then baked:
 * each piece is moved into ship space and merged with every other piece that shares its material,
 * so a material costs one draw call however many pieces use it. Colour tokens join the solid batch,
 * returned under the key `"solid"`; any other material is returned under itself.
 */
export function bakeGeos(group) {
  group.updateMatrixWorld(true);
  const byMat = new Map(), m4 = new THREE.Matrix4();
  const push = (material, geo) => {
    const tint = material.userData.solid;
    if (tint) {
      const n = geo.attributes.position.count, top = geo.userData.top, nrm = geo.attributes.normal;
      if (!geo.attributes.color) {
        const a = new Float32Array(n * 3);
        for (let k = 0; k < n; k++) { const c = top && nrm.getY(k) > 0.9 ? top : tint; a[k * 3] = c.r; a[k * 3 + 1] = c.g; a[k * 3 + 2] = c.b; }
        geo.setAttribute("color", new THREE.BufferAttribute(a, 3));
      }
      if (!geo.attributes.aMark) geo.setAttribute("aMark", new THREE.BufferAttribute(new Float32Array(n).fill(material.userData.mark || MARK.plain), 1));
      material = "solid";
    }
    if (!byMat.has(material)) byMat.set(material, []);
    byMat.get(material).push(geo);
  };
  group.traverse((o) => {
    if (!o.isMesh) return;
    if (o.isInstancedMesh) for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m4); push(o.material, o.geometry.clone().applyMatrix4(m4.premultiply(o.matrixWorld)));
    }
    else push(o.material, o.geometry.clone().applyMatrix4(o.matrixWorld));
  });
  const used = new Set(); group.traverse((o) => { if (o.geometry) used.add(o.geometry); });
  used.forEach((g) => g.dispose());
  const out = new Map();
  byMat.forEach((geos, material) => out.set(material, mergeGeos(geos)));
  return out;
}
/** Put finished geometry (already in ship space) into a scratch group, ready for `bakeGeos`. */
export const fitAdd = (group, material, ...geos) => geos.forEach((g) => group.add(new THREE.Mesh(g, material)));

/* ---- the shared textures ----------------------------------------------------------------------- */

const DECK_TX = 12, DECK_TZ = 4; // one tile of planking is 12 m by 4 m
export const DECK_TILE = { x: DECK_TX, z: DECK_TZ };
let deckTex = null;
/** Planking: pale, holystoned planks with dark pitch seams, staggered butts and trenails. One per page. */
export function deckTexture() {
  if (deckTex) return deckTex;
  const [c, g] = canvas(256, 128), n = 16, ph = 512 / n, rnd = prng(41); g.scale(0.25, 0.25);
  g.fillStyle = "#cdb48a"; g.fillRect(0, 0, 1024, 512);
  for (let k = 0; k < n; k++) {
    const y = k * ph;
    let x = -rnd() * 600;
    while (x < 1024) {
      const len = 380 + rnd() * 260, tone = rnd();
      g.fillStyle = tone < 0.5 ? `rgba(120, 90, 50, ${0.03 + tone * 0.1})` : `rgba(255, 245, 220, ${(tone - 0.5) * 0.14})`;
      g.fillRect(x, y, len, ph);
      g.fillStyle = "rgba(55, 40, 25, 0.5)"; g.fillRect(x, y, 2.2, ph);
      x += len;
    }
    g.fillStyle = "rgba(45, 32, 20, 0.6)"; g.fillRect(0, y, 1024, 2.4);
    for (let i = 0; i < 6; i++) { g.fillStyle = "rgba(60, 45, 30, 0.35)"; g.fillRect(rnd() * 1024, y + ph * (0.3 + rnd() * 0.4), 3, 3); }
  }
  deckTex = toTex(c); deckTex.wrapS = deckTex.wrapT = THREE.RepeatWrapping;
  return deckTex;
}

const SAIL_REGION = { course: [0, 0], topsail: [256, 0], plain: [0, 256], stay: [256, 256] };
let sailTex = null;
/** Four kinds of cloth on one sheet: courses (two reef bands), topsails (three), topgallants and royals (none), and the jibs. */
export function sailTexture() {
  if (sailTex) return sailTex;
  const [c, g] = canvas(256, 256), S = 256, rnd = prng(51); g.scale(0.5, 0.5);
  [["course", 2, 28], ["topsail", 3, 22], ["plain", 0, 16], ["stay", 0, 12]].forEach(([name, reefs, cloths]) => {
    const [x0, y0] = SAIL_REGION[name];
    rnd.reset(51 + reefs * 7 + cloths);
    g.fillStyle = "#fbf6ec"; g.fillRect(x0, y0, S, S);
    for (let k = 0; k < cloths; k++) { g.fillStyle = `rgba(${rnd() < 0.5 ? "150, 135, 105" : "255, 252, 240"}, ${0.03 + rnd() * 0.05})`; g.fillRect(x0 + k * S / cloths, y0, S / cloths, S); }
    g.fillStyle = "rgba(120, 105, 80, 0.32)";
    for (let k = 1; k < cloths; k++) g.fillRect(x0 + k * S / cloths - 0.5, y0, 1, S);
    for (let q = 1; q <= reefs; q++) {
      const y = y0 + q * S * 0.09;
      g.fillStyle = "rgba(130, 115, 85, 0.35)"; g.fillRect(x0, y - 2, S, 4);
      g.fillStyle = "rgba(95, 80, 60, 0.7)"; for (let x = 4; x < S; x += 7) g.fillRect(x0 + x, y - 1, 1.5, 7);
    }
  });
  sailTex = toTex(c);
  return sailTex;
}
export const sailUV = (name, u, v) => { const [x0, y0] = SAIL_REGION[name]; return [(x0 + 3 + u * 250) / 512, 1 - (y0 + 3 + (1 - v) * 250) / 512]; };

/** Release the shared textures and the rope material, for a renderer's teardown. */
export function disposeKit() {
  if (deckTex) { deckTex.dispose(); deckTex = null; }
  if (sailTex) { sailTex.dispose(); sailTex = null; }
  if (lineMat) { lineMat.dispose(); lineMat = null; }
}

/* ---- sails -------------------------------------------------------------------------------------- */

/**
 * A book of sails under construction. `square`, `tri` and `quad` add cloth; `finish()` returns one
 * geometry carrying every sail with its breathing in the `aWaveA` / `aWaveB` attributes. Square
 * sails breathe along x, so their normals are worked out once, here.
 */
export function sailBook() {
  const parts = [];
  return {
    parts,
    /** A square sail hung from a yard at height yTop, its foot at yBot; wTop and wBot its widths. */
    square(x, yTop, yBot, wTop, wBot, phase, region) {
      const NU = 6, NV = 4, h = yTop - yBot, pos = [], uv = [], idx = [], anim = [];
      for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
        const u = i / NU, v = j / NV, w = wBot + (wTop - wBot) * v, across = 1 - Math.pow(2 * u - 1, 2);
        const belly = across * Math.sin(Math.PI * (1 - v) * 0.85), amp = 0.2 * h * belly;
        const y = yBot + v * h - 0.12 * h * Math.pow(1 - v, 3) * across;
        const z = (u - 0.5) * w * (1 + 0.035 * Math.sin(Math.PI * v));
        pos.push(x + 0.5 + amp, y, z); uv.push(...sailUV(region, u, v)); anim.push(x + 0.5, amp, phase + u * 2);
      }
      for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const a = j * (NU + 1) + i, b = a + NU + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
      parts.push({ pos, uv, idx, anim });
    },
    /** A tack, B head, C clew. The leech (B to C) and the foot (C to A) can bow outward in a soft curve. */
    tri(A, B, C, push, leechRoach = 0, footRoach = 0) {
      const n = 6, pos = [], uv = [], idx = [], id = (i, j) => i * (n + 1) - (i * (i - 1)) / 2 + j;
      const outward = (Pp, Q, away) => {
        const d = new THREE.Vector3().subVectors(Q, Pp), nrm = new THREE.Vector3(-d.y, d.x, 0).normalize();
        if (nrm.dot(new THREE.Vector3().subVectors(Pp.clone().lerp(Q, 0.5), away)) < 0) nrm.negate();
        return nrm.multiplyScalar(d.length());
      };
      const nLeech = outward(B, C, A), nFoot = outward(C, A, B);
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
        const a = i / n, b = j / n, c = 1 - a - b;
        const p = A.clone().multiplyScalar(c).addScaledVector(B, a).addScaledVector(C, b);
        p.addScaledVector(nLeech, leechRoach * 4 * a * b).addScaledVector(nFoot, footRoach * 4 * b * c);
        p.z += push * 27 * a * b * c; pos.push(p.x, p.y, p.z); uv.push(...sailUV("stay", b + a * 0.5, a));
      }
      for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
        idx.push(id(i, j), id(i + 1, j), id(i, j + 1));
        if (j < n - i - 1) idx.push(id(i + 1, j), id(i + 1, j + 1), id(i, j + 1));
      }
      parts.push({ pos, uv, idx });
    },
    /** P0 tack, P1 throat, P2 peak, P3 clew: a four-sided fore-and-aft sail. */
    quad(P0, P1, P2, P3, push) {
      const n = 4, pos = [], uv = [], idx = [];
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
        const u = i / n, v = j / n, p = P0.clone().lerp(P3, u).lerp(P1.clone().lerp(P2, u), v);
        p.z += push * Math.sin(Math.PI * u) * Math.sin(Math.PI * v); pos.push(p.x, p.y, p.z); uv.push(...sailUV("plain", u, v));
      }
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const a = i * (n + 1) + j, b = a + n + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
      parts.push({ pos, uv, idx });
    },
    /** Every sail as one geometry, or null if none was set. */
    finish() {
      let nv = 0; parts.forEach((s) => { nv += s.pos.length / 3; });
      if (!nv) return null;
      const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), wA = new Float32Array(nv * 4), wB = new Float32Array(nv * 3), idx = [];
      let v = 0;
      parts.forEach((s) => {
        const n = s.pos.length / 3;
        pos.set(s.pos, v * 3); uv.set(s.uv, v * 2); s.idx.forEach((k) => idx.push(k + v));
        // a square sail's point: its belly's reach breathes by 6%, at 1.3 rad/s, from its own phase
        if (s.anim) for (let k = 0; k < n; k++) wA.set([0.06 * s.anim[k * 3 + 1], s.anim[k * 3 + 2], 1.3, 0], (v + k) * 4);
        v += n;
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      g.setAttribute("aWaveA", new THREE.BufferAttribute(wA, 4));
      g.setAttribute("aWaveB", new THREE.BufferAttribute(wB, 3));
      g.setIndex(idx); g.computeVertexNormals();
      g.computeBoundingSphere(); g.boundingSphere.radius += 2; // culled by the resting bounds, widened past any breathing
      parts.length = 0;
      return g;
    },
  };
}

/* ---- railings ----------------------------------------------------------------------------------- */

export const POST_W = 0.05 * Math.SQRT2; // the posts' square section

/**
 * One simple railing for every inboard rail: dark wooden posts about every metre and a top rail in
 * the trim colour. `pts` are where it stands (they may change in height, for a stair); `h` its
 * height. `aloft`: a railing up on a mast's platform, seen from below, so its top rail keeps its
 * underside. `wood` is the posts' token.
 */
export function railing(group, pts, wood, h = 1.0, step = 1.0, aloft = false) {
  for (let s = 0; s < pts.length - 1; s++) {
    const a = pts[s], b = pts[s + 1], n = Math.max(1, Math.round(a.distanceTo(b) / step));
    const turn = Math.atan2(b.x - a.x, b.z - a.z);
    for (let k = s ? 1 : 0; k <= n; k++) {
      const q = a.clone().lerp(b, k / n), post = keepFaces(new THREE.BoxGeometry(POST_W, h, POST_W), [0, 1, 4, 5]).rotateY(turn);
      fitAdd(group, wood, post.translate(q.x, q.y + h / 2, q.z));
    }
    const sloped = Math.abs(b.y - a.y) > LEVEL * Math.hypot(b.x - a.x, b.z - a.z);
    const bar = (y, w, t, m) => {
      const p0 = a.clone().add(V3(0, y, 0)), p1 = b.clone().add(V3(0, y, 0)), D = p1.clone().sub(p0).normalize();
      const S = V3().crossVectors(UP, D).normalize(), Y = V3().crossVectors(D, S);
      fitAdd(group, m, (aloft || sloped ? frameBox : frameBoxTop)(w, t, p0.distanceTo(p1) + w, p0.clone().lerp(p1, 0.5), S, Y, D));
    };
    bar(h + 0.04, 0.14, 0.08, trimToken);
  }
}

/* ---- the colours the bespoke ships are painted in ---------------------------------------------- */

/** The palette the first rate was painted in, kept here so a second class can paint in the same colours. */
export const P = {
  sail: "#fbf6ec",
  hull: "#553823", oak: "#6b472c", wale: "#3e2716", copper: "#cf7a43", dark: "#3a2516",
  darkWood: "#5a3a22", midWood: "#8a5f3b", lightWood: "#a5764a", hole: "#24170e", carriage: "#7e3424",
  pine: "#c58b4f", cream: "#e9dcbc", bronze: "#a8742e", deck: "#cdb48a", black: "#1c1b1d",
  iron: "#202224",
  ochre: "#84402a", // red ochre: the inboard face of a ship's sides, the break walls and the stair walls
};

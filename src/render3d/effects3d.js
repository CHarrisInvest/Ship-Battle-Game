/**
 * THE SHOT AND THE SMOKE ON THE 3D SEA. Owned by the effects layer (see the module contract in
 * docs/superpowers/specs/2026-10-15-three-renderer-design.md).
 *
 * What is in the air and on the water for a moment: every ball with the light on it and the smoke it
 * drags, the musket shot as bright streaks, and `fx.parts` (which `src/render/effects.js` still
 * makes from the step's events, for both renderers) as the 3D sea draws them:
 *
 *   puff    powder smoke, a soft billboard that swells, rises a little and thins, lit in the toon
 *           bands with a lumpy rim so a bank of them reads as cloud rather than as discs
 *   muzzle  the flash, a tongue of flame lying along the barrel and a glow at the port,
 *           drawn over the smoke for the reason the 2D sea drew it last
 *   ring    a ring of foam spreading on the water where a ball bit or a ship went down
 *   spark   splinters (wood, rope, crew red) that tumble up and fall, or spray that does the same
 *
 * Two things here are the 3D sea's own and in no `fx.parts`: a ball that comes down in open water
 * or on a shoal throws up a column of water with a foam ring, found by watching for a ball that is
 * gone from `world.shots` without a hull near where it went; and each particle's height, spin and
 * rise, kept in a WeakMap off the particle so effects.js stays a flat picture both renderers read.
 * None of it is the round; it decorates the sea, so `Math.random` is fine here.
 *
 * Everything is instanced: one draw call per kind of thing, pooled to a fixed size, with the counts
 * written each frame. On the low tier (`quality.particles` 0.5) half the smoke, splinters and spray
 * are drawn, chosen once per particle so nothing flickers.
 */

import { TICK, WP } from "../sim/index.js";
import { SHOT_DRAW, ZUP } from "../render/view.js";

// the 2D sea drew a ball three view units over the water, which is this high in the world
const SHOT_Z = 3 / ZUP;
// how high the guns stand: where the smoke and the flash come from
const GUN_Z = 4;
// seconds of a ball's flight her smoke trail covers, as the 2D sea drew it
const TAIL = 0.06;
const GRAVITY = 42;

const MAX_BALLS = 4096;
const MAX_PUFFS = 4096;
const MAX_FLAT = 8192; // trails (two a ball), streaks, rings
const MAX_FLASH = 2048; // flames and glows
const MAX_SHARDS = 2048;
// a ball's drawn radius against the 2D one: a lit sphere reads bigger than a flat disc the same size
const BALL_DRAW = 0.8;
// splashes that land this close together, this soon after one another, are one splash
const SPLASH_JOIN = 9;
const SPLASH_JOIN_T = 0.3;
const SPLASH_MAX_H = 17;

const POOL_KEYS = ["iPos", "iSize", "iDir", "iExt", "iCol", "iMisc"];

// ---- shaders ----

// A billboard: a quad facing the camera at `iPos`, `iSize` across and up. Shape 0 is a puff of
// smoke (lumpy round, toon banded off the key light), 1 a column of water standing on its foot,
// 2 a soft glow (the flash at the port). Nothing here is added onto the sea: a warm colour added
// to this teal comes out mint, which is not a colour fire is.
const BB_VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec2 iSize;
  attribute vec4 iCol;
  attribute vec2 iMisc;
  varying vec2 vUv;
  varying vec4 vCol;
  varying vec2 vMisc;
  void main() {
    vUv = position.xy;
    vCol = iCol;
    vMisc = iMisc;
    vec4 mv = viewMatrix * vec4(iPos, 1.0);
    vec2 off = position.xy * iSize;
    if (iMisc.x > 0.5 && iMisc.x < 1.5) off.y += iSize.y;
    mv.xy += off;
    gl_Position = projectionMatrix * mv;
  }
`;
const BB_FRAG = /* glsl */ `
  uniform vec3 uLight;
  varying vec2 vUv;
  varying vec4 vCol;
  varying vec2 vMisc;
  void main() {
    vec2 p = vUv;
    float shape = vMisc.x;
    if (shape > 1.5) {
      // glow: a hot core falling off to nothing
      float d = length(p);
      if (d > 1.0) discard;
      float g = 1.0 - smoothstep(0.25, 1.0, d);
      gl_FragColor = vec4(vCol.rgb, vCol.a * g);
    } else {
      float rim = 1.0;
      if (shape > 0.5) {
        // a column: wider at its foot, rounding off at the top
        float h = (p.y + 1.0) * 0.5;
        p.x *= 1.0 + 0.9 * h;
      } else {
        float a = atan(p.y, p.x);
        float s = vMisc.y * 6.2831;
        rim = 1.0 - 0.05 * (0.5 + 0.5 * sin(a * 7.0 + s)) - 0.06 * (0.5 + 0.5 * sin(a * 3.0 - s * 1.7));
      }
      float d = length(p) / rim;
      if (d > 1.0) discard;
      vec3 n = normalize(vec3(p / rim, sqrt(max(0.0, 1.0 - d * d))));
      float l = dot(n, uLight) * 0.5 + 0.5;
      float band = l > 0.66 ? 1.0 : (l > 0.42 ? 0.9 : 0.79);
      float edge = 1.0 - smoothstep(0.72, 1.0, d);
      gl_FragColor = vec4(vCol.rgb * band, vCol.a * edge);
    }
    #include <colorspace_fragment>
  }
`;

// A decal lying flat at `iPos`, along `iDir` (engine x, y, which is three x, z), `iExt` half its
// length and half its width. Shape 0 is a ring (`param` its thickness as a share of the radius),
// 1 a diamond (the flame), 2 a wedge tapering astern (a ball's smoke), 3 a streak (a musket shot).
const FLAT_VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec2 iDir;
  attribute vec2 iExt;
  attribute vec4 iCol;
  attribute vec2 iMisc;
  varying vec2 vUv;
  varying vec4 vCol;
  varying vec2 vMisc;
  void main() {
    vUv = position.xy;
    vCol = iCol;
    vMisc = iMisc;
    vec3 d = vec3(iDir.x, 0.0, iDir.y);
    vec3 n = vec3(-iDir.y, 0.0, iDir.x);
    vec3 w = iPos + d * position.x * iExt.x + n * position.y * iExt.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }
`;
const FLAT_FRAG = /* glsl */ `
  varying vec2 vUv;
  varying vec4 vCol;
  varying vec2 vMisc;
  void main() {
    vec2 p = vUv;
    float shape = vMisc.x;
    float a;
    if (shape < 0.5) {
      float t = vMisc.y;
      float off = abs(length(p) - (1.0 - t));
      if (off > t) discard;
      a = 1.0 - smoothstep(t * 0.55, t, off);
    } else if (shape < 1.5) {
      float m = (1.0 - abs(p.x)) - abs(p.y);
      if (m < 0.0) discard;
      a = smoothstep(0.0, 0.18, m);
    } else {
      // head at +1, running out to nothing at -1
      float w = (p.x + 1.0) * 0.5;
      if (abs(p.y) > w) discard;
      a = shape < 2.5 ? smoothstep(-1.0, 0.4, p.x) : 1.0;
    }
    gl_FragColor = vec4(vCol.rgb, vCol.a * a);
    #include <colorspace_fragment>
  }
`;

export function createEffectsLayer(scene, ctx) {
  const { THREE, palette: C, quality } = ctx;
  const share = quality.particles ?? 1;
  const owned = []; // [object3d, geometry, material] to let go of

  // ---- the pools ----

  const quad = new THREE.PlaneGeometry(2, 2);

  function instanced(base, max, attrs) {
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute("position", base.getAttribute("position"));
    const out = { geo: g };
    for (const [name, size] of attrs) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      out[name] = a;
    }
    g.instanceCount = 0;
    return out;
  }

  const uLight = { value: new THREE.Vector3(0, 0, 1) };
  function shaderMat(vert, frag) {
    return new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uLight },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide, // a decal's winding depends on which way it was laid
    });
  }
  function addMesh(pool, mat, order, name) {
    const mesh = new THREE.Mesh(pool.geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.name = name;
    scene.add(mesh);
    owned.push([mesh, pool.geo, mat]);
    pool.mesh = mesh;
    pool.n = 0;
    pool.sent = -1;
    return pool;
  }

  const BB_ATTRS = [["iPos", 3], ["iSize", 2], ["iCol", 4], ["iMisc", 2]];
  const FLAT_ATTRS = [["iPos", 3], ["iDir", 2], ["iExt", 2], ["iCol", 4], ["iMisc", 2]];
  // flat things on and over the water: ball trails, musket streaks, rings of foam
  const flat = addMesh(instanced(quad, MAX_FLAT, FLAT_ATTRS), shaderMat(FLAT_VERT, FLAT_FRAG), 5, "fx-flat");
  // smoke and water columns
  const puffs = addMesh(instanced(quad, MAX_PUFFS, BB_ATTRS), shaderMat(BB_VERT, BB_FRAG), 10, "fx-smoke");
  // every flash, over all of it
  const flames = addMesh(instanced(quad, MAX_FLASH, FLAT_ATTRS), shaderMat(FLAT_VERT, FLAT_FRAG), 20, "fx-flame");
  const glows = addMesh(instanced(quad, MAX_FLASH, BB_ATTRS), shaderMat(BB_VERT, BB_FRAG), 21, "fx-glow");

  // the balls: cast iron, lit like everything else, so the light off the top of one is the sun's.
  // Lit in the toon bands the palette's iron came out nearly black, and a first rate's broadside
  // read as a swarm of flies over the hull it was landing on; held a shade up off it, the top band
  // comes out near `C.ballLit` and the ball reads as shot.
  const ballGeo = new THREE.SphereGeometry(1, 12, 8);
  const ballMat = ctx.toon.material({ color: "#56606a" }).clone();
  ballMat.emissive = new THREE.Color(C.ball).multiplyScalar(0.35);
  const balls = new THREE.InstancedMesh(ballGeo, ballMat, MAX_BALLS);
  balls.name = "fx-balls";
  balls.count = 0;
  balls.frustumCulled = false;
  balls.castShadow = !!quality.shadows;
  scene.add(balls);
  owned.push([balls, ballGeo, ballMat]);

  // splinters and spray: little solids that tumble, coloured per instance
  function shardMesh(geo, name) {
    const mat = ctx.toon.material({ color: "#ffffff" }).clone();
    const m = new THREE.InstancedMesh(geo, mat, MAX_SHARDS);
    m.name = name;
    m.count = 0;
    m.frustumCulled = false;
    m.setColorAt(0, new THREE.Color(1, 1, 1)); // so the shader is built with a colour per instance
    scene.add(m);
    owned.push([m, geo, mat]);
    return m;
  }
  const splinters = shardMesh(new THREE.BoxGeometry(1, 1, 1), "fx-splinters");
  const drops = shardMesh(new THREE.IcosahedronGeometry(1, 0), "fx-drops");

  // ---- colours ----

  const COLS = new Map();
  // a palette string as linear rgb and an alpha: hex, or the rgba() the spray is written in
  function rgba(s) {
    let c = COLS.get(s);
    if (c) return c;
    const m = /^rgba?\(([^)]+)\)$/.exec(s || "");
    const col = new THREE.Color();
    let a = 1;
    if (m) {
      const [r, g, b, al] = m[1].split(",").map(Number);
      col.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
      if (al !== undefined && !Number.isNaN(al)) a = al;
    } else {
      col.set(s || "#ffffff");
    }
    c = { r: col.r, g: col.g, b: col.b, a, light: !!m };
    COLS.set(s, c);
    return c;
  }
  const SMOKE = rgba(C.smoke);
  const FOAM = rgba(C.foam);
  const PELLET = rgba(C.pellet);
  const FLAME = rgba("#ffe9a8");
  const GLOW = rgba("#fff3cc");

  // ---- writers ----

  function bb(pool, max, x, y, z, w, h, col, a, shape, seed) {
    if (pool.n >= max) return;
    const i = pool.n++;
    pool.iPos.setXYZ(i, x, z, y);
    pool.iSize.setXY(i, w, h);
    pool.iCol.setXYZW(i, col.r, col.g, col.b, a);
    pool.iMisc.setXY(i, shape, seed);
  }
  function decal(pool, max, x, y, z, dx, dy, len, wid, col, a, shape, param = 0) {
    if (pool.n >= max) return;
    const i = pool.n++;
    pool.iPos.setXYZ(i, x, z, y);
    pool.iDir.setXY(i, dx, dy);
    pool.iExt.setXY(i, len, wid);
    pool.iCol.setXYZW(i, col.r, col.g, col.b, a);
    pool.iMisc.setXY(i, shape, param);
  }
  // Only what was written goes up, and nothing at all when the pool was empty last frame too: a
  // pool sent whole every frame was over a megabyte a frame across the layer whatever was live.
  function sendRange(attr, n) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, n * attr.itemSize);
    attr.needsUpdate = true;
  }
  function flush(pool) {
    pool.geo.instanceCount = pool.n;
    if (pool.n === 0 && pool.sent === 0) return;
    pool.sent = pool.n;
    if (pool.n === 0) return;
    for (let i = 0; i < POOL_KEYS.length; i++) {
      const a = pool[POOL_KEYS[i]];
      if (a) sendRange(a, pool.n);
    }
  }
  function flushMesh(mesh) {
    const n = mesh.count;
    if (n === 0 && mesh.userData.sent === 0) return;
    mesh.userData.sent = n;
    if (n === 0) return;
    sendRange(mesh.instanceMatrix, n);
    if (mesh.instanceColor) sendRange(mesh.instanceColor, n);
  }

  // ---- each particle's third dimension, kept off the particle itself ----

  const extra = new WeakMap();
  function stateOf(p) {
    let st = extra.get(p);
    if (!st) {
      const light = p.kind === "spark" && rgba(p.col).light;
      st = {
        keep: Math.random() < share,
        seed: Math.random(),
        z: p.kind === "puff" ? GUN_Z - 0.5 + Math.random() * 1.5 : light ? 0.6 + Math.random() : 1.5 + Math.random() * 3,
        vz: light ? 6 + Math.random() * 12 : 8 + Math.random() * 16,
        rise: 2 + Math.random() * 3,
        ax: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
        spin: (Math.random() - 0.5) * 30,
        ang: Math.random() * 6.283,
        light,
      };
      extra.set(p, st);
    }
    return st;
  }

  // ---- what the 3D sea adds: a ball coming down in the water ----

  const local = []; // { kind: "column" | "drop", x, y, z, vx, vy, vz, life, max, size, ... }
  let lastWorld = null;

  function splashAt(x, y, big = true) {
    // A broadside that misses together lands in one patch of water: a dozen columns and rings
    // stacked there read as a white tower. A ball coming down where another just did feeds that
    // splash instead, a little taller and wider, and throws a little spray of its own.
    for (let i = local.length - 1; i >= 0; i--) {
      const l = local[i];
      if (l.kind !== "column" || l.max - l.life > SPLASH_JOIN_T) continue;
      if ((l.x - x) * (l.x - x) + (l.y - y) * (l.y - y) > SPLASH_JOIN * SPLASH_JOIN) continue;
      l.h = Math.min(SPLASH_MAX_H, l.h * 1.08);
      l.w = Math.min(5.5, l.w * 1.06);
      if (Math.random() < 0.5 * share) {
        const a = Math.random() * 6.283, sp = 6 + Math.random() * 14, life = 0.45 + Math.random() * 0.3;
        local.push({ kind: "drop", x, y, z: 1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 12 + Math.random() * 14, life, max: life, size: 0.55 + Math.random() * 0.35 });
      }
      return;
    }
    const s = big ? 1 : 0.6;
    const life = 0.55 + Math.random() * 0.2;
    local.push({ kind: "column", x, y, life, max: life, h: (9 + Math.random() * 4) * s, w: (2.6 + Math.random()) * s, seed: Math.random() });
    local.push({ kind: "ring", x, y, life: 0.7, max: 0.7, r0: 1.5 * s, r1: 11 * s });
    const n = Math.max(1, Math.round(5 * share * s));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, sp = 6 + Math.random() * 14;
      const l = 0.45 + Math.random() * 0.3;
      local.push({ kind: "drop", x, y, z: 1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 12 + Math.random() * 14, life: l, max: l, size: 0.55 + Math.random() * 0.35 });
    }
  }

  /**
   * A ball that was in the air last frame and is not now either bit something or came down. A hit
   * on a hull is the hit's own burst, so a ball that went out near a ship makes nothing here; one
   * that went out anywhere else came down in the sea or on a shoal and throws up its column. A
   * world that is not the one drawn last frame (a new round, or a copy to watch out the rest of
   * one) starts the watch afresh rather than splashing every ball in the air.
   */
  const recs = new WeakMap(); // ball -> where it was last frame
  const now = new Set();
  let last = [];
  function watchShots(world) {
    now.clear();
    for (const b of world.shots) {
      now.add(b);
      let r = recs.get(b);
      if (!r) { r = {}; recs.set(b, r); }
      r.x = b.x; r.y = b.y; r.vx = b.vx; r.vy = b.vy; r.life = b.life; r.kind = b.kind;
    }
    if (world === lastWorld) {
      for (const b of last) {
        if (now.has(b) || b.kind === "musket") continue;
        const was = recs.get(b);
        if (!was) continue;
        const t = Math.max(0, Math.min(was.life, TICK));
        const x = was.x + was.vx * t, y = was.y + was.vy * t;
        let nearHull = false;
        for (const s of world.ships) {
          const reach = (s.hullA || 18) + 4;
          if ((s.x - x) * (s.x - x) + (s.y - y) * (s.y - y) < reach * reach) { nearHull = true; break; }
        }
        if (!nearHull) splashAt(x, y);
      }
    }
    lastWorld = world;
    last.length = 0;
    for (let i = 0; i < world.shots.length; i++) last.push(world.shots[i]);
  }

  // ---- the frame ----

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p3 = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const tint = new THREE.Color();
  const sunDir = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  function shard(mesh, x, y, z, ax, ang, sx, sy, sz, col) {
    const i = mesh.count;
    if (i >= MAX_SHARDS) return;
    mesh.count++;
    q.setFromAxisAngle(ax, ang);
    p3.set(x, z, y);
    sc.set(sx, sy, sz);
    mesh.setMatrixAt(i, m4.compose(p3, q, sc));
    mesh.setColorAt(i, tint.setRGB(col.r, col.g, col.b));
  }

  function update(world, fx, alpha, dt = 0) {
    dt = Math.min(dt || 0, 0.05);
    // the key light, in view space, for the smoke's bands
    sunDir.copy(ctx.sun.position).sub(ctx.sun.target.position).normalize().transformDirection(ctx.camera.matrixWorldInverse);
    uLight.value.copy(sunDir);

    flat.n = puffs.n = flames.n = glows.n = 0;
    splinters.count = drops.count = 0;

    // the balls, back along their flight by the share of the step not yet drawn
    const back = TICK * (1 - alpha);
    let nb = 0;
    for (const b of world.shots) {
      const x = b.x - b.vx * back, y = b.y - b.vy * back;
      const sp = Math.hypot(b.vx, b.vy) || 1;
      const dx = b.vx / sp, dy = b.vy / sp;
      if (b.kind === "musket") {
        const len = sp * 0.012;
        decal(flat, MAX_FLAT, x - dx * len * 0.5, y - dy * len * 0.5, SHOT_Z, dx, dy, len * 0.5, 0.55, PELLET, 1, 3);
        continue;
      }
      const dr = b.r * (WP[b.kind]?.draw ?? SHOT_DRAW);
      // her smoke first, a long faint wedge and a short brighter one, so the ball sits on its head;
      // the 2D wedges' figures
      const len1 = sp * TAIL, len2 = sp * TAIL * 0.45;
      decal(flat, MAX_FLAT, x - dx * len1 * 0.5, y - dy * len1 * 0.5, SHOT_Z, dx, dy, len1 * 0.5, dr * 0.85, SMOKE, 0.2, 2);
      decal(flat, MAX_FLAT, x - dx * len2 * 0.5, y - dy * len2 * 0.5, SHOT_Z, dx, dy, len2 * 0.5, dr * 0.62, SMOKE, 0.28, 2);
      if (nb < MAX_BALLS) {
        ctx.toThree(x, y, SHOT_Z, p3);
        const br = dr * BALL_DRAW;
        sc.set(br, br, br);
        q.identity();
        balls.setMatrixAt(nb++, m4.compose(p3, q, sc));
      }
    }
    balls.count = nb;
    flushMesh(balls);

    watchShots(world);

    // the picture's own particles
    for (const p of fx.parts) {
      const k = 1 - p.life / p.max;
      if (p.kind === "puff") {
        const st = stateOf(p);
        if (!st.keep) continue;
        const kk = Math.max(0, Math.min(1, p.life > 0 ? 1 - p.life / p.max : 1));
        const rr = p.r0 + (p.r1 - p.r0) * Math.sqrt(kk);
        const fade = (1 - kk) * Math.min(1, kk * 5);
        bb(puffs, MAX_PUFFS, p.x, p.y, st.z + st.rise * kk, rr, rr, SMOKE, 0.72 * fade, 0, st.seed);
      } else if (p.kind === "muzzle") {
        const a = Math.max(0, p.life / p.max);
        const dx = Math.cos(p.ang), dy = Math.sin(p.ang);
        decal(flames, MAX_FLASH, p.x + dx * 13, p.y + dy * 13, GUN_Z, dx, dy, 7, 3, FLAME, a, 1);
        bb(glows, MAX_FLASH, p.x + dx * 5, p.y + dy * 5, GUN_Z, 6, 6, GLOW, 0.8 * a, 2, 0);
      } else if (p.kind === "ring") {
        const rr = 3 + k * 16;
        const c = rgba(p.col);
        decal(flat, MAX_FLAT, p.x, p.y, 0.25, 1, 0, rr + 0.8, rr + 0.8, c, (1 - k) * 0.85 * c.a, 0, 1.6 / (rr + 0.8));
      } else {
        // splinters, and spray (the picture writes spray in rgba, wood and the rest in hex)
        const st = stateOf(p);
        if (!st.keep) continue;
        st.vz -= GRAVITY * dt;
        st.z = Math.max(-1, st.z + st.vz * dt);
        st.ang += st.spin * dt;
        if (st.z <= -0.5) continue;
        const c = rgba(p.col);
        const life = Math.max(0, p.life / p.max);
        if (st.light) {
          const s = 0.8 * (0.4 + 0.6 * life);
          shard(drops, p.x, p.y, st.z, st.ax, st.ang, s, s, s, c);
        } else {
          const s = 0.4 + 0.6 * life;
          shard(splinters, p.x, p.y, st.z, st.ax, st.ang, 2.6 * s, 0.8 * s, 0.8 * s, c);
        }
      }
    }

    // and the 3D sea's own: columns, their rings and their spray
    for (let i = local.length - 1; i >= 0; i--) {
      const l = local[i];
      l.life -= dt;
      if (l.life <= 0) { local.splice(i, 1); continue; }
      const k = 1 - l.life / l.max;
      if (l.kind === "column") {
        const h = l.h * Math.sin(Math.PI * Math.min(1, k * 1.15));
        if (h > 0.2) bb(puffs, MAX_PUFFS, l.x, l.y, 0, l.w * (1 + k * 0.6), h * 0.5, FOAM, 0.9 * (1 - k * k), 1, l.seed);
      } else if (l.kind === "ring") {
        const rr = l.r0 + (l.r1 - l.r0) * Math.sqrt(k);
        decal(flat, MAX_FLAT, l.x, l.y, 0.25, 1, 0, rr + 0.8, rr + 0.8, FOAM, (1 - k) * 0.8, 0, 1.4 / (rr + 0.8));
      } else {
        l.x += l.vx * dt; l.y += l.vy * dt;
        l.vz -= GRAVITY * dt;
        l.z += l.vz * dt;
        if (l.z < 0) { local.splice(i, 1); continue; }
        shard(drops, l.x, l.y, l.z, UP, 0, l.size, l.size, l.size, FOAM);
      }
    }

    flush(flat); flush(puffs); flush(flames); flush(glows);
    flushMesh(splinters); flushMesh(drops);
  }

  function dispose() {
    for (const [obj, geo, mat] of owned) {
      obj.removeFromParent();
      if (obj.isInstancedMesh) obj.dispose();
      geo.dispose();
      if (mat) mat.dispose();
    }
    quad.dispose();
    local.length = 0;
    last.length = 0;
    now.clear();
    lastWorld = null;
  }

  return { update, dispose };
}

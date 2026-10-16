/**
 * THE WATER ON THE 3D SEA. Owned by the water layer (see the module contract in
 * docs/superpowers/specs/2026-10-15-three-renderer-design.md).
 *
 * One plane of water, never bigger than the screen: it is laid under the patch of sea the camera
 * shows each frame and everything on it is worked out per pixel from the world position, so the sea
 * is the same water wherever the camera goes and costs the same whatever the size of the map.
 *
 *   - The surface is the toon material every hull is lit with, with its colour and normal written
 *     by the shader. A few slow crossing swells tilt the normal, so where they pile up facing away
 *     from the sun the water drops a band of the ramp, and where they face it squarely (full tier)
 *     a glint comes off them. Flat water lands on `C.water` exactly: the base colour is divided by
 *     what the lights put on a level surface, so the palette is the sea's colour and not a starting
 *     point for it.
 *   - Outside the map the water runs `C.waterEdge`, with the rope and its buoys every 400 floating
 *     on the line, a wet dark band under the rope and the dashed line inside it as the 2D sea drew.
 *   - The caps are the 2D sea's: one breaking crest in each 130-unit cell, two peaked humps with the
 *     tails rolling out, in the beach-rim tone, each whitening on its own cycle as a function of its
 *     cell and the clock alone, so a cap scrolling into view arrives mid-cycle. The full tier adds a
 *     second, finer scatter of small caps.
 *   - The storm darkens the sea outside its ring and rains on it, on the water as the 2D sea did, so
 *     the ships stand clear of the weather and keep their colours.
 *   - The wakes are instanced foam discs off `fx.wakes`, breaking up as they age.
 *   - Each island has surf where the water meets her: a lapping wash on the beach rim and a broken
 *     line where the deep water comes up onto the shallows.
 *
 * Overlays (caps, the grid, the storm, the rain, the rope's lines) are blended in sRGB, the way the
 * 2D canvas blended them, so their alphas are the 2D figures and mean what they meant there.
 */

import { WORLD } from "../sim/index.js";
import { TILT, ZUP } from "../render/view.js";
import { TOON_STEPS } from "./toon.js";

// the boundary
const BUOY_STEP = 400;
const BUOY_R = 4;
const ROPE_R = 1.5;
const ROPE_Y = 0.7;

// The storm's darkening and the rain, as the 2D sea had them: rgba(7,34,33,0.5) over the water and
// streaks of rgb(190,215,225) at 0.175 falling 340 view units a second.
const STORM_DARK = [7 / 255, 34 / 255, 33 / 255];
const RAIN = [190 / 255, 215 / 255, 225 / 255];

/** A palette hex as sRGB components 0..1, for blending the way the canvas did. */
function srgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const GLSL_COMMON = /* glsl */ `
uniform float uTime;
uniform float uWorld;
uniform float uPx;        // view units per device pixel
uniform vec4 uStorm;      // centre x, centre y, radius, on
varying vec2 vSea;        // engine x, y of this point on the water

float wHash(vec2 c) { return fract(sin(c.x * 127.1 + c.y * 311.7) * 43758.5453); }
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

export function createWaterLayer(scene, ctx) {
  const { THREE, palette: C, toon, quality } = ctx;
  const simple = quality.water === "simple";
  const root = new THREE.Group();
  root.name = "water";
  scene.add(root);
  const owned = []; // geometries and materials this layer made, for dispose

  // ---- what the lights put on a level sea, so flat water comes out the palette's colour ----
  const L = toon.LIGHTING;
  const keyDir = ctx.toThree(...L.keyDir).normalize();
  const up = keyDir.y; // a level surface faces straight up
  const level = TOON_STEPS[Math.min(TOON_STEPS.length - 1, Math.floor((up * 0.5 + 0.5) * TOON_STEPS.length))];
  const key = new THREE.Color(L.keyColor), sky = new THREE.Color(L.skyColor);
  const lit = new THREE.Vector3(
    key.r * (L.keyIntensity / Math.PI) * level + sky.r * (L.fillIntensity / Math.PI),
    key.g * (L.keyIntensity / Math.PI) * level + sky.g * (L.fillIntensity / Math.PI),
    key.b * (L.keyIntensity / Math.PI) * level + sky.b * (L.fillIntensity / Math.PI),
  );
  const base = (hex) => {
    const c = new THREE.Color(hex);
    return new THREE.Vector3(c.r / lit.x, c.g / lit.y, c.b / lit.z);
  };
  const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  // the half vector between the sun and the eye, for the glints (the camera is orthographic, so the
  // eye is one direction for the whole sea)
  const eye = new THREE.Vector3(0, TILT, ZUP);
  const half = keyDir.clone().add(eye).normalize();

  const uniforms = {
    uTime: { value: 0 },
    uWorld: { value: WORLD },
    uPx: { value: 1 },
    uStorm: { value: new THREE.Vector4(WORLD / 2, WORLD / 2, 1e9, 0) },
    uWater: { value: base(C.water) },
    uWaterEdge: { value: base(C.waterEdge) },
    uDeep: { value: base(C.deep) },
    uShallow: { value: base(C.shallows) },
    uRim: { value: v3(srgb(C.beachRim)) },
    uFoam: { value: v3(srgb(C.foam)) },
    uGold: { value: v3(srgb(C.boundary)) },
    uStormDark: { value: v3(STORM_DARK) },
    uRain: { value: v3(RAIN) },
    uHalf: { value: half },
    uKey: { value: keyDir.clone() },
  };

  // ---------------- the sea ----------------

  const seaGeo = new THREE.PlaneGeometry(1, 1);
  seaGeo.rotateX(-Math.PI / 2); // lie it on the water, facing up
  owned.push(seaGeo);
  const seaMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toon.ramp() });
  owned.push(seaMat);
  seaMat.defines = { ...seaMat.defines, ...(simple ? { WATER_SIMPLE: "" } : {}) };
  seaMat.customProgramCacheKey = () => (simple ? "sea-simple" : "sea-full");
  seaMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vSea;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSea = (modelMatrix * vec4(transformed, 1.0)).xz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\n" + GLSL_COMMON + SEA_PARS)
      .replace("#include <color_fragment>", "#include <color_fragment>\n" + SEA_COLOUR)
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n" + SEA_NORMAL)
      .replace("#include <opaque_fragment>", SEA_OVERLAY + "\n#include <opaque_fragment>");
  };
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.name = "sea";
  sea.receiveShadow = true;
  sea.frustumCulled = false;
  sea.renderOrder = -10;
  root.add(sea);

  // ---------------- the boundary: rope and buoys ----------------

  const ropeMat = toon.material({ color: C.boundary });
  const ropeGeo = new THREE.CylinderGeometry(ROPE_R, ROPE_R, WORLD + ROPE_R * 2, 8, 1, false);
  owned.push(ropeGeo);
  // along x on the top and bottom, along z (engine y) on the left and right
  for (const [x, z, alongX] of [[WORLD / 2, 0, true], [WORLD / 2, WORLD, true], [0, WORLD / 2, false], [WORLD, WORLD / 2, false]]) {
    const m = new THREE.Mesh(ropeGeo, ropeMat);
    m.position.set(x, ROPE_Y, z);
    if (alongX) m.rotation.z = Math.PI / 2;
    else m.rotation.x = Math.PI / 2;
    m.castShadow = quality.shadows;
    root.add(m);
  }
  const buoyAt = [];
  for (let X = 0; X <= WORLD; X += BUOY_STEP) { buoyAt.push([X, 0], [X, WORLD]); }
  for (let Y = BUOY_STEP; Y < WORLD; Y += BUOY_STEP) { buoyAt.push([0, Y], [WORLD, Y]); }
  const buoyGeo = new THREE.SphereGeometry(BUOY_R, simple ? 10 : 16, simple ? 8 : 12);
  owned.push(buoyGeo);
  const buoyMat = toon.material({ color: "#ffffff" });
  const buoys = new THREE.InstancedMesh(buoyGeo, buoyMat, buoyAt.length);
  buoys.name = "buoys";
  buoys.castShadow = quality.shadows;
  buoys.frustumCulled = false;
  // the 2D sea counted them in this order and coloured the odd ones white
  const cA = new THREE.Color(C.buoyA), cB = new THREE.Color(C.buoyB);
  buoyAt.forEach((_, i) => buoys.setColorAt(i, (i + 1) % 2 ? cB : cA));
  buoys.instanceColor.needsUpdate = true;
  root.add(buoys);
  const bm = new THREE.Matrix4();

  // ---------------- the wakes ----------------

  let wakeCap = 0;
  let wakeGeo = null;
  let wakeData = null;
  const quad = new THREE.PlaneGeometry(2, 2);
  quad.rotateX(-Math.PI / 2);
  owned.push(quad);
  const wakeMat = new THREE.ShaderMaterial({
    uniforms: { uFoamLin: { value: new THREE.Color("#eefaf6") } },
    vertexShader: /* glsl */ `
      attribute vec4 aWake;   // x, y, radius, how much life is left (1 fresh, 0 gone)
      varying vec2 vUv;
      varying float vK;
      varying float vSeed;
      void main() {
        vUv = position.xz;
        vK = aWake.w;
        vSeed = fract(aWake.x * 0.137 + aWake.y * 0.311);
        vec3 p = vec3(aWake.x + position.x * aWake.z, 0.12, aWake.y + position.z * aWake.z);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uFoamLin;
      varying vec2 vUv;
      varying float vK;
      varying float vSeed;
      float h1(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        float d = length(vUv);
        float a = atan(vUv.y, vUv.x);
        // a ragged edge, and as it ages the middle opens up so a trail breaks into lace
        float rag = 0.12 * sin(a * 5.0 + vSeed * 40.0) + 0.08 * sin(a * 9.0 - vSeed * 17.0);
        float body = smoothstep(1.0, 0.82, d + rag);
        float hole = mix(1.0, smoothstep(0.15, 0.62, d - rag * 0.6), 1.0 - vK);
        float alpha = body * hole * vK * 0.55;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(uFoamLin, alpha);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
  owned.push(wakeMat);
  const wakes = new THREE.Mesh(new THREE.BufferGeometry(), wakeMat);
  wakes.name = "wakes";
  wakes.frustumCulled = false;
  wakes.renderOrder = 1;
  root.add(wakes);

  function sizeWakes(n) {
    if (n <= wakeCap) return;
    wakeCap = Math.max(256, 2 ** Math.ceil(Math.log2(n)));
    wakes.geometry.dispose();
    wakeGeo = new THREE.InstancedBufferGeometry();
    wakeGeo.index = quad.index;
    wakeGeo.setAttribute("position", quad.getAttribute("position"));
    wakeData = new Float32Array(wakeCap * 4);
    const attr = new THREE.InstancedBufferAttribute(wakeData, 4);
    attr.setUsage(THREE.DynamicDrawUsage);
    wakeGeo.setAttribute("aWake", attr);
    wakeGeo.instanceCount = 0;
    wakes.geometry = wakeGeo;
  }

  // ---------------- the surf round each island ----------------

  let surfFor = null;
  const surfGeos = [];
  const surfMat = new THREE.ShaderMaterial({
    uniforms: { ...uniforms },
    vertexShader: /* glsl */ `
      attribute vec2 aSurf;   // across the band (0 inside, 1 out), which band (0 beach, 1 reef)
      varying vec2 vSurf;
      varying vec2 vSea;
      void main() {
        vSurf = aSurf;
        vSea = position.xz;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: GLSL_COMMON + /* glsl */ `
      uniform vec3 uFoam;
      varying vec2 vSurf;
      void main() {
        float across = vSurf.x;
        float n = wNoise(vSea * 0.16 + vec2(uTime * 0.3, -uTime * 0.2));
        float n2 = wNoise(vSea * 0.05 - uTime * 0.1);
        float alpha;
        if (vSurf.y < 0.5) {
          // the beach: a wash runs up the rim and draws back, its leading edge whiter than its body
          float edge = 0.42 + 0.26 * sin(uTime * 1.25 + n2 * 6.283) + (n - 0.5) * 0.22;
          float body = smoothstep(edge + 0.05, edge - 0.05, across);
          float lip = smoothstep(0.09, 0.0, abs(across - edge));
          alpha = body * 0.32 + lip * 0.5;
          alpha *= smoothstep(0.0, 0.08, across); // fade under the sand rather than cut
        } else {
          // the reef line: where the deep water comes up onto the bank, broken into lengths
          float mid = 0.5 + 0.12 * sin(uTime * 0.9 + n2 * 6.283);
          float line = smoothstep(0.32, 0.0, abs(across - mid));
          float gaps = smoothstep(0.35, 0.6, n);
          alpha = line * gaps * 0.36;
        }
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(sRGBTransferEOTF(vec4(uFoam, 1.0)).rgb, alpha);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  owned.push(surfMat);
  const surfRoot = new THREE.Group();
  surfRoot.name = "surf";
  root.add(surfRoot);

  // A band round an island's outline from `s0` to `s1` of her radius, lying at `y`. The outline is
  // smoothed between her bearings with a cosine blend at four samples a bearing, so the band rolls
  // round her rather than stepping at each vertex.
  function band(isl, s0, s1, y, which, pos, attr, idx) {
    const n = isl.verts.length;
    const N = n * 4;
    const first = pos.length / 3;
    for (let k = 0; k <= N; k++) {
      const t = (k % N) / 4;
      const i0 = Math.floor(t) % n, i1 = (i0 + 1) % n, f = t - Math.floor(t);
      const w = (1 - Math.cos(f * Math.PI)) / 2;
      const rv = isl.verts[i0] * (1 - w) + isl.verts[i1] * w;
      const a = (k / N) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      for (const [s, across] of [[s0, 0], [s1, 1]]) {
        const r = isl.r * rv * s;
        pos.push(isl.x + ca * r, y, isl.y + sa * r);
        attr.push(across, which);
      }
    }
    for (let k = 0; k < N; k++) {
      const a = first + k * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d); // counter-clockwise seen from above
    }
  }

  function buildSurf(world) {
    for (const g of surfGeos) g.dispose();
    surfGeos.length = 0;
    surfRoot.clear();
    const pos = [], attr = [], idx = [];
    for (const isl of world.islands) {
      band(isl, 0.97, 1.17, 0.12, 0, pos, attr, idx);
      band(isl, 1.25, 1.42, 0.06, 1, pos, attr, idx);
    }
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("aSurf", new THREE.Float32BufferAttribute(attr, 2));
    geo.setIndex(idx);
    surfGeos.push(geo);
    const mesh = new THREE.Mesh(geo, surfMat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    surfRoot.add(mesh);
  }

  // ---------------- each frame ----------------

  function update(world, fx, alpha, dt, clock) {
    const t = typeof clock === "number" ? clock : clock?.t ?? ctx.clock.t;
    uniforms.uTime.value = t;
    uniforms.uPx.value = 1 / (ctx.view.zoom * ctx.renderer.getPixelRatio());

    // the plane under exactly the water the camera shows
    const g = ctx.ground(60);
    sea.position.set(g.cx, 0, g.cy);
    sea.scale.set(g.x1 - g.x0, 1, g.y1 - g.y0);

    const storm = !!world?.rules?.storm;
    uniforms.uStorm.value.set(WORLD / 2, WORLD / 2, storm ? world.stormR : 1e9, storm ? 1 : 0);

    // buoys ride the swell as the 2D ones bobbed
    buoyAt.forEach(([wx, wy], i) => {
      const bob = (Math.sin(t * 2 + wx * 0.01 + wy * 0.01) * 1.5) / ZUP;
      bm.makeTranslation(wx, BUOY_R * 0.45 + bob * 0.5, wy);
      buoys.setMatrixAt(i, bm);
    });
    buoys.instanceMatrix.needsUpdate = true;

    // the wakes
    const list = fx?.wakes ?? [];
    sizeWakes(list.length);
    if (wakeGeo) {
      let n = 0;
      for (const w of list) {
        const k = Math.max(0, w.life / w.max);
        wakeData[n * 4] = w.x;
        wakeData[n * 4 + 1] = w.y;
        wakeData[n * 4 + 2] = 1.6 + (1 - k) * 4.5;
        wakeData[n * 4 + 3] = k;
        n++;
      }
      wakeGeo.instanceCount = n;
      const a = wakeGeo.getAttribute("aWake");
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * 4);
      a.needsUpdate = true;
    }

    if (world && world.islands !== surfFor) {
      surfFor = world.islands;
      buildSurf(world);
    }
  }

  function dispose() {
    for (const g of surfGeos) g.dispose();
    surfGeos.length = 0;
    wakes.geometry.dispose();
    buoys.dispose();
    for (const o of owned) o.dispose();
    root.removeFromParent();
  }

  return { update, dispose };
}

// ---------------- the sea's shader, in three pieces spliced into the toon material ----------------

const SEA_PARS = /* glsl */ `
uniform vec3 uWater;
uniform vec3 uWaterEdge;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uRim;
uniform vec3 uFoam;
uniform vec3 uGold;
uniform vec3 uStormDark;
uniform vec3 uRain;
uniform vec3 uHalf;
uniform vec3 uKey;
vec3 seaN = vec3(0.0, 1.0, 0.0); // the swell's normal in world axes, kept for the glints

// One swell: its slope (the gradient of its height) at p. d is its heading, k its wavenumber, a
// its height, w how fast it runs.
vec2 swell(vec2 p, vec2 d, float k, float a, float w) {
  return d * (a * k * cos(dot(d, p) * k + uTime * w));
}

// The shape of a cap across its width, as a height over its baseline: u runs -1 to 1, the crests
// are at 0.45 and sharp, the notch between them sits at the baseline and is round, and the tails
// dip a little under it before rolling out at 0.1, which is the 2D cap's curve in a function.
// Returns the height and its slope in u.
vec2 capShape(float u) {
  float s = abs(u), sg = sign(u);
  if (s < 0.45) {
    float a = s / 0.45;
    return vec2(0.7 * a * a, sg * 0.7 * 2.0 * a / 0.45);
  }
  float t = (s - 0.45) / 0.55;
  float g = 0.7 * (1.0 - t) * (1.0 - t) + 0.1 * t * t - 0.9 * t * (1.0 - t);
  float dg = -1.4 * (1.0 - t) + 0.2 * t - 0.9 * (1.0 - 2.0 * t);
  return vec2(g, sg * dg / 0.55);
}

// A cycle of whitening a cap runs on its own: it snaps white and falls back over about a second,
// every 9 to 19 seconds, out of step with every other cap. The 2D capFlare, as is.
float capFlare(float cell, float phase) {
  float period = 9.0 + cell * 10.0;
  float u = fract(uTime / period + phase);
  float win = 0.9 / period;
  if (u >= win) return 0.0;
  float s = u / win;
  if (s < 0.18) return s / 0.18;
  float fall = (1.0 - s) / 0.82;
  return fall * fall;
}

// The caps in cells of 'cs' world units, each scale times the size of the 2D cap. Blends into col
// (sRGB) and returns it.
vec3 caps(vec3 col, vec2 p, float cs, float scale, float seed, float strength) {
  vec2 cell = floor(p / cs);
  float h1 = wHash(cell + seed), h2 = wHash(cell + vec2(9.0, 4.0) + seed);
  vec2 at = cell * cs + 10.0 + vec2(h1, h2) * (cs - 20.0);
  float w = 5.5 * scale, h = 4.0 * scale;
  float bob = sin(uTime * 1.3 + h1 * 6.283) * 1.4 * scale;
  float u = (p.x - at.x) / w;
  float v = (p.y - at.y) * ${TILT.toFixed(6)} - bob; // view units, down the screen
  if (abs(u) > 1.0) return col;
  vec2 g = capShape(u);
  float F = -v - g.x * h;                      // above (+) or below (-) the curve, in view units
  float dist = abs(F) / sqrt(1.0 + (g.y * h / w) * (g.y * h / w));
  float hw = 0.7 * scale;
  float cover = clamp((hw - dist) / uPx + 0.5, 0.0, 1.0);
  cover *= smoothstep(1.0, 0.85, abs(u));      // the tails thin out rather than stop
  if (cover <= 0.0) return col;
  if (at.x < 6.0 || at.x > uWorld - 6.0 || at.y < 6.0 || at.y > uWorld - 6.0) return col;
  float a = (0.2 + 0.12 * (0.5 + 0.5 * sin(uTime + h2 * 6.283))) * strength;
  col = mix(col, uRim, cover * a);
  float flare = capFlare(wHash(cell + vec2(5.0, 17.0) + seed), h1);
  col = mix(col, uFoam, cover * flare * 0.55 * strength);
  return col;
}

// A line halfw view units either side of 0, antialiased: how much of this pixel it covers.
float lineCover(float d, float halfw) {
  return clamp((halfw - abs(d)) / uPx + 0.5, 0.0, 1.0);
}
`;

// the colour of the water before the light: open sea in the arena, deep beyond it, a slow tint
const SEA_COLOUR = /* glsl */ `
{
  vec2 p = vSea;
  float inside = step(0.0, p.x) * step(p.x, uWorld) * step(0.0, p.y) * step(p.y, uWorld);
  vec3 c = mix(uWaterEdge, uWater, inside);
  #ifndef WATER_SIMPLE
    // a slow drift of deeper and paler water, so the sea is not one flat sheet
    float tint = wNoise(p * 0.0045 + vec2(uTime * 0.01, 0.0)) * 0.6 + wNoise(p * 0.011 - uTime * 0.008) * 0.4;
    c = mix(c, uDeep, 0.07 * smoothstep(0.45, 0.85, tint) * inside);
    c = mix(c, uShallow, 0.08 * smoothstep(0.55, 0.15, tint) * inside);
  #endif
  diffuseColor.rgb = c;
}
`;

// the swell, tilting the normal the light falls on
const SEA_NORMAL = /* glsl */ `
#ifndef WATER_SIMPLE
{
  vec2 p = vSea;
  // one long swell running with the sun's bearing, so its lee faces fall a band in rows, and three
  // shorter ones across it that break the rows into lengths
  vec2 s = swell(p, normalize(vec2(0.64, 0.77)), 6.283 / 190.0, 7.2, 0.5)
         + swell(p, normalize(vec2(0.97, 0.24)), 6.283 / 118.0, 2.3, 0.75)
         + swell(p, normalize(vec2(-0.30, 0.95)), 6.283 / 74.0, 1.05, 1.0)
         + swell(p, normalize(vec2(0.80, -0.60)), 6.283 / 47.0, 0.45, 1.3);
  // and two long, slow ones at odd bearings, so the rows wander rather than run in stripes (a value
  // noise did this first, and its lattice put straight edges on the bands)
  s += swell(p, normalize(vec2(-0.83, 0.56)), 6.283 / 330.0, 4.2, 0.23)
     + swell(p, normalize(vec2(0.21, -0.98)), 6.283 / 270.0, 3.0, 0.31);
  seaN = normalize(vec3(-s.x, 1.0, -s.y));
  normal = normalize((viewMatrix * vec4(seaN, 0.0)).xyz);
}
#endif
`;

// what sits on the water over the light: glints, the grid, the caps, the rope's lines, the weather
const SEA_OVERLAY = /* glsl */ `
{
  vec2 p = vSea;
  float vy = p.y * ${TILT.toFixed(6)}; // view units down the screen
  float inside = step(0.0, p.x) * step(p.x, uWorld) * step(0.0, p.y) * step(p.y, uWorld);
  vec3 col = sRGBTransferOETF(vec4(outgoingLight, 1.0)).rgb;

  #ifndef WATER_SIMPLE
    // a glint where the swell turns its face square between the sun and the eye
    float nh = dot(seaN, uHalf);
    col = mix(col, uFoam, 0.22 * smoothstep(0.9988, 0.9996, nh));
    // and a lighter band on the faces turned to the sun, the ramp's step the other way: the toon
    // ramp can only darken a level sea, so the bright side of the swell is drawn here
    float nl = dot(seaN, uKey);
    col = mix(col, uFoam, 0.06 * smoothstep(0.905, 0.915, nl));
  #endif

  // the grid every 80, as faint as the 2D one, inside the rope
  vec2 gm = mod(p + 40.0, 80.0) - 40.0;
  float grid = max(lineCover(gm.x, 0.5), lineCover(gm.y * ${TILT.toFixed(6)}, 0.5)) * inside;
  col = mix(col, vec3(9.0, 52.0, 50.0) / 255.0, 0.10 * grid);

  // the caps
  col = caps(col, p, 130.0, 1.0, 0.0, 1.0);
  #ifndef WATER_SIMPLE
    col = caps(col, p, 57.0, 0.6, 31.0, 0.7);
  #endif

  // the boundary: a dark wet band under the rope, and the dashed line 8 inside it
  vec2 toEdge = min(p, uWorld - p);                      // world units to the nearer edge, each way
  vec2 edgeView = vec2(toEdge.x, toEdge.y * ${TILT.toFixed(6)});
  vec2 within = vec2(step(-3.5, p.y) * step(p.y, uWorld + 3.5 / ${TILT.toFixed(6)}),
                     step(-3.5, p.x) * step(p.x, uWorld + 3.5));
  float dark = max(lineCover(edgeView.x, 3.5) * within.x, lineCover(edgeView.y, 3.5) * within.y);
  col = mix(col, vec3(0.0), 0.3 * dark);
  vec2 inner = toEdge - 8.0;
  float onX = step(8.0, toEdge.y) * step(0.0, p.x) * step(p.x, uWorld);
  float onY = step(8.0, toEdge.x) * step(0.0, p.y) * step(p.y, uWorld);
  float dashX = step(mod(vy - 8.0 * ${TILT.toFixed(6)}, 17.0), 9.0); // along a side running down the screen
  float dashY = step(mod(p.x - 8.0, 17.0), 9.0);                       // along the top and bottom
  float dashed = max(lineCover(inner.x, 0.75) * onY * dashX, lineCover(inner.y * ${TILT.toFixed(6)}, 0.75) * onX * dashY);
  col = mix(col, uGold, 0.5 * dashed * inside);

  // the weather: darker water outside the ring, and rain on it
  if (uStorm.w > 0.5) {
    float out_ = step(uStorm.z, length(p - uStorm.xy));
    col = mix(col, uStormDark, 0.5 * out_);
    if (out_ > 0.5) {
      float cell = 46.0;
      float vx = p.x;
      float fy = vy - uTime * 340.0;
      vec2 rc = floor(vec2(vx, fy) / cell);
      float h = wHash(rc + 3.0);
      vec2 a = vec2(rc.x * cell + 5.0 + h * (cell - 10.0), rc.y * cell + fract(h * 19.7) * (cell - 13.0));
      vec2 b = a + vec2(-3.0, 11.0);
      vec2 pa = vec2(vx, fy) - a, ba = b - a;
      float tt = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
      float d = length(pa - ba * tt);
      col = mix(col, uRain, 0.175 * lineCover(d, 0.5));
    }
  }

  outgoingLight = sRGBTransferEOTF(vec4(col, 1.0)).rgb;
}
`;

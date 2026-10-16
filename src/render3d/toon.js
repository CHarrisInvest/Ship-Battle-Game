/**
 * THE SOFT TOON LOOK: one gradient ramp and the few materials every layer of the 3D sea is lit with.
 *
 * Light falls on everything in a handful of gentle bands rather than a smooth roll-off, which is
 * what keeps the hand-painted palette reading as itself with depth under it: the lit side of a hull
 * is the palette's own brown, the shaded side a step or two down it, and nothing in between goes
 * muddy. The ramp is the one statement of those bands, so a layer that wants the look takes a
 * material from here rather than building its own `MeshToonMaterial` with a ramp of its own.
 *
 * Colours are written as the palette writes them, sRGB hex, and three converts them to linear on
 * the way in (`THREE.Color` does this under the default colour management), so `toonMaterial(C.sand)`
 * is the sand of the 2D sea under the same light.
 *
 * Materials are cached by their options and shared, so asking twice costs nothing; a caller that
 * needs one of its own to change (a flash, a fade) clones it and disposes the clone itself.
 * `disposeToon()` releases the cache and the ramp, and is for the renderer's teardown only.
 */

import * as THREE from "three";
import { C, AI_COLORS } from "../render/palette.js";

/**
 * The bands, darkest first, as the share of full light each one passes. Four steps: core shadow,
 * the turn, the lit face, and a soft top light. The darkest is held well off black because the
 * hemisphere fill is added under it; the steps are close together, which is what makes it soft.
 */
export const TOON_STEPS = [0.42, 0.62, 0.84, 1.0];

let ramp = null;
/** The shared gradient map: a 4-texel ramp, nearest-filtered so the bands stay bands. */
export function toonRamp() {
  if (ramp) return ramp;
  const data = new Uint8Array(TOON_STEPS.length * 4);
  TOON_STEPS.forEach((k, i) => {
    const v = Math.round(k * 255);
    data.set([v, v, v, 255], i * 4);
  });
  ramp = new THREE.DataTexture(data, TOON_STEPS.length, 1, THREE.RGBAFormat);
  ramp.minFilter = THREE.NearestFilter;
  ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

/**
 * Shadows in the toon look are a band, not a grain. three's PCF turns its five taps by a noise per
 * pixel, which on a sea drawn this flat comes out as a grey stipple: palm shadows on the sand read
 * as dirt and a rig's shadow on the water as speckle. Here the taps hold still (with the hardware's
 * own filtering that is twenty smooth taps) and the result is pressed into one soft-edged step, so
 * a shadow is one clean shape with a narrow soft rim. Patched into three's shader chunk once, before
 * anything compiles; if three ever changes the text, the patch simply does not apply.
 */
(function bandedShadows() {
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  if (!chunk || chunk.includes("/* sternchase banded */")) return;
  let out = chunk.replace("float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;", "float phi = 0.0; /* sternchase banded */");
  out = out.replace(
    /\) \* 0\.2;(\s*)\}(\s*)return mix\( 1\.0, shadow, shadowIntensity \);/,
    (m, a, b) => `) * 0.2;${a}shadow = smoothstep( 0.2, 0.8, shadow );${a}}${b}return mix( 1.0, shadow, shadowIntensity );`,
  );
  THREE.ShaderChunk.shadowmap_pars_fragment = out;
})();

const MATS = new Map();

/**
 * A shared toon material.
 *
 *   color         sRGB hex or a THREE.Color; ignored (white) when `vertexColors` is set
 *   vertexColors  true to take the colour per vertex, as the ship model does
 *   side          THREE.FrontSide (default) or THREE.DoubleSide
 *   emissive      sRGB hex of a light floor added to every band, for cloth lit through from behind
 *   transparent, opacity, depthWrite   as on any three material
 *
 * Returns the same instance for the same options. Clone it to change it for one object.
 */
export function toonMaterial(opts = {}) {
  const o = typeof opts === "string" || opts instanceof THREE.Color ? { color: opts } : opts;
  const key = JSON.stringify({
    c: o.vertexColors ? null : o.color instanceof THREE.Color ? o.color.getHexString() : o.color ?? "#ffffff",
    v: !!o.vertexColors, s: o.side ?? THREE.FrontSide, e: o.emissive ?? null,
    t: !!o.transparent, op: o.opacity ?? 1, d: o.depthWrite ?? true,
  });
  let m = MATS.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({
      color: o.vertexColors ? 0xffffff : new THREE.Color(o.color ?? "#ffffff"),
      vertexColors: !!o.vertexColors,
      gradientMap: toonRamp(),
      side: o.side ?? THREE.FrontSide,
      transparent: !!o.transparent,
      opacity: o.opacity ?? 1,
      depthWrite: o.depthWrite ?? true,
    });
    if (o.emissive) m.emissive = new THREE.Color(o.emissive);
    MATS.set(key, m);
  }
  return m;
}

/** An unlit flat colour, for foam, flashes and the like that should not take the bands. Shared. */
export function flatMaterial(opts = {}) {
  const o = typeof opts === "string" ? { color: opts } : opts;
  const key = "flat" + JSON.stringify({ c: o.color ?? "#ffffff", t: !!o.transparent, op: o.opacity ?? 1, d: o.depthWrite ?? true, v: !!o.vertexColors });
  let m = MATS.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: o.vertexColors ? 0xffffff : new THREE.Color(o.color ?? "#ffffff"),
      vertexColors: !!o.vertexColors,
      transparent: !!o.transparent,
      opacity: o.opacity ?? 1,
      depthWrite: o.depthWrite ?? true,
    });
    MATS.set(key, m);
  }
  return m;
}

/** A palette colour as a THREE.Color (linear, ready for a uniform or a vertex buffer). */
export const color = (hex) => new THREE.Color(hex);

/** The lighting the toon look is tuned under. The renderer builds its lights from these. */
export const LIGHTING = {
  // a warm key, high and from the upper left of the screen, so shadows fall down and to the right
  // the way the 2D sea always offset them; in engine axes (x across, y down the screen, z up)
  keyDir: [-0.42, -0.5, 0.76],
  keyColor: "#fff1d8",
  keyIntensity: 0.62 * Math.PI,
  // the soft fill: sky blue-white from above, the sea's own colour bounced up from below
  skyColor: "#eaf6ff",
  groundColor: C.water,
  fillIntensity: 0.6 * Math.PI,
};

export { C, AI_COLORS };

/** Release every cached material and the ramp. The renderer's teardown calls this. */
export function disposeToon() {
  for (const m of MATS.values()) m.dispose();
  MATS.clear();
  if (ramp) { ramp.dispose(); ramp = null; }
}

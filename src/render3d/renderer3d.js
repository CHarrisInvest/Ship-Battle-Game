/**
 * THE SEA IN THREE DIMENSIONS: one viewer's WebGL canvas, the overlay canvas over it, and the
 * layers that fill the scene.
 *
 * `createRenderer3d(webglCanvas, overlayCanvas)` hands back exactly what `createRenderer` in
 * `src/render/renderer.js` does: `resize`, `follow`, `render`, `under` and `tick`, plus `dispose`.
 * The frame loop in `SternchaseIso.jsx` cannot tell them apart, and falls back to the 2D one when
 * this throws, which it does at once when the browser has no WebGL. That is a test of what the
 * device can draw and nothing else: every visitor whose browser can run it gets the same picture.
 *
 * What it owns: the WebGLRenderer, the scene, the lights (a warm key with the shadow camera
 * following the view, and a soft hemisphere fill), the camera (`camera.js`, which places the sea
 * where the 2D renderer did, to the pixel), the quality tier, and the overlay: the bars, guides,
 * words, storm edge, vignette and radar, drawn flat over the scene by `overlay.js`, which the 2D
 * renderer draws them with too. What fills the scene is the layers', each its own module, each
 * created with the scene and the shared `ctx` below and updated once a frame:
 *
 *   islands   islands.js    createIslandLayer(scene, ctx)  -> { update(world), dispose() }
 *   water     water.js      createWaterLayer(scene, ctx)   -> { update(world, fx, alpha, dt, clock), dispose() }
 *   ships     ships.js      createShipLayer(scene, ctx)    -> { update(world, fx, alpha, dt), labelOf(s, alpha), dispose() }
 *   effects   effects3d.js  createEffectsLayer(scene, ctx) -> { update(world, fx, alpha, dt), dispose() }
 *
 * The engine is never touched from here or from a layer: they read the world and `fx` and draw.
 * `docs/superpowers/specs/2026-10-15-three-renderer-design.md` is the design note and the contract.
 */

import * as THREE from "three";
import { C, AI_COLORS } from "../render/palette.js";
import { lookOf } from "../render/effects.js";
import { createView, sizeView, followView, blend, shipUnder } from "../render/view.js";
import { createCamera, syncCamera, toThree, viewGround } from "./camera.js";
import { toonMaterial, flatMaterial, toonRamp, color, LIGHTING, disposeToon } from "./toon.js";
import { shipModel, clearShipModels } from "./shipmodel.js";
import { drawOverlay } from "./overlay.js";
import { createIslandLayer } from "./islands.js";
import { createWaterLayer } from "./water.js";
import { createShipLayer } from "./ships.js";
import { createEffectsLayer } from "./effects3d.js";

/**
 * Whether this browser can give a canvas WebGL 2, asked of a throwaway canvas. three.js draws on
 * nothing older, so a browser with only WebGL 1 is a browser without it here.
 */
export function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * The quality tier, from what the device says it can do: how many cores, how much memory, and
 * whether it is driven by touch. A phone without much of either draws the low tier: no shadows,
 * the simpler water, half the particles, no antialiasing, and at most 1.5 device pixels to a CSS
 * pixel. Everything else draws the high tier. Nothing about where the visitor is or what browser
 * they use enters into it.
 *
 *   { tier: "high" | "low", shadows, shadowMapSize, antialias, pixelRatio, particles, water: "full" | "simple" }
 *
 * `particles` is the share of particles a layer should draw (1 or 0.5). `pixelRatio` is the cap
 * the WebGL canvas is drawn at; the overlay keeps the 2D renderer's own cap of 2 so text stays sharp.
 */
export function pickQuality() {
  let coarse = false;
  try { coarse = !!window.matchMedia?.("(pointer: coarse)").matches; } catch { /* no media queries */ }
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  const low = (coarse && cores < 6) || mem < 4;
  return low
    ? { tier: "low", shadows: false, shadowMapSize: 0, antialias: false, pixelRatio: 1.5, particles: 0.5, water: "simple" }
    : { tier: "high", shadows: true, shadowMapSize: 2048, antialias: true, pixelRatio: 2, particles: 1, water: "full" };
}

export function createRenderer3d(webglCanvas, overlayCanvas, { quality = pickQuality() } = {}) {
  if (!webglCanvas || !overlayCanvas) throw new Error("the 3D sea needs both canvases");
  if (!webglAvailable()) throw new Error("no WebGL");

  // The WebGL canvas first: if anything is going to fail it is this, and the overlay canvas is
  // left untouched until it has not, so the 2D renderer can still take it over.
  const renderer = new THREE.WebGLRenderer({ canvas: webglCanvas, antialias: quality.antialias, alpha: false, powerPreference: "high-performance" });
  renderer.setClearColor(new THREE.Color(C.water), 1);
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const onLost = (e) => e.preventDefault(); // let the browser give the context back when it can
  webglCanvas.addEventListener("webglcontextlost", onLost);

  const scene = new THREE.Scene();
  const camera = createCamera();
  const view = createView();

  // the light: a soft fill from sky and sea, and a warm key whose shadow camera follows the view
  const fill = new THREE.HemisphereLight(new THREE.Color(LIGHTING.skyColor), new THREE.Color(LIGHTING.groundColor), LIGHTING.fillIntensity);
  scene.add(fill);
  const sun = new THREE.DirectionalLight(new THREE.Color(LIGHTING.keyColor), LIGHTING.keyIntensity);
  const keyDir = toThree(...LIGHTING.keyDir).normalize();
  sun.castShadow = quality.shadows;
  if (quality.shadows) {
    sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.25;
    sun.shadow.radius = 3;
  }
  scene.add(sun);
  scene.add(sun.target);

  const clock = { t: 0 };
  /**
   * What every layer is handed: the shared pieces of the 3D sea. Read it, do not replace its
   * members; `view` and `dt` change every frame in place.
   */
  const ctx = {
    THREE, scene, renderer, camera, view, quality, sun, clock, dt: 0,
    palette: C, aiColors: AI_COLORS,
    toon: { material: toonMaterial, flat: flatMaterial, ramp: toonRamp, color, LIGHTING },
    shipModel, lookOf, blend, toThree,
    ground: (pad = 0) => viewGround(view, pad),
  };

  // A layer that cannot stand is a sea that cannot be drawn: let go of what was built before saying
  // so, and the 2D renderer takes the overlay canvas.
  let islands, water, ships, effects;
  try {
    islands = createIslandLayer(scene, ctx);
    water = createWaterLayer(scene, ctx);
    ships = createShipLayer(scene, ctx);
    effects = createEffectsLayer(scene, ctx);
  } catch (err) {
    for (const layer of [effects, ships, water, islands]) layer?.dispose();
    webglCanvas.removeEventListener("webglcontextlost", onLost);
    renderer.dispose();
    throw err;
  }

  // only now, with the WebGL side standing, is the overlay canvas taken
  const octx = overlayCanvas.getContext("2d");

  function resize(hud) {
    const rect = webglCanvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    sizeView(view, rect, hud, dpr);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
    renderer.setSize(view.Wd, view.Hd, false);
    overlayCanvas.width = Math.round(view.Wd * dpr);
    overlayCanvas.height = Math.round(view.Hd * dpr);
    syncCamera(camera, view);
  }

  function follow(ship, alpha = 1) {
    followView(view, ship, alpha);
  }

  // The key light stands off the middle of the view along its own direction, and its shadow camera
  // covers the whole patch of water on the screen. The middle is snapped to the shadow map's texel
  // so the shadows do not crawl as the camera follows her.
  const mid = new THREE.Vector3();
  function placeSun() {
    const g = ctx.ground(40);
    const half = 0.5 * Math.hypot(g.x1 - g.x0, g.y1 - g.y0);
    if (quality.shadows) {
      const texel = (2 * half) / quality.shadowMapSize;
      g.cx = Math.round(g.cx / texel) * texel;
      g.cy = Math.round(g.cy / texel) * texel;
      const sc = sun.shadow.camera;
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      sc.near = 1; sc.far = 2 * half + 400;
      sc.updateProjectionMatrix();
    }
    toThree(g.cx, g.cy, 0, mid);
    sun.target.position.copy(mid);
    sun.position.copy(mid).addScaledVector(keyDir, half + 200);
    sun.target.updateMatrixWorld();
  }

  function render(world, fx, opts) {
    if (!world) {
      renderer.clear();
      drawOverlay(octx, view, null, fx, opts, clock.t, null);
      return;
    }
    syncCamera(camera, view);
    placeSun();
    const alpha = opts.alpha ?? 1;
    islands.update(world);
    water.update(world, fx, alpha, ctx.dt, clock.t);
    ships.update(world, fx, alpha, ctx.dt);
    effects.update(world, fx, alpha, ctx.dt);
    renderer.render(scene, camera);
    drawOverlay(octx, view, world, fx, opts, clock.t, (s) => ships.labelOf(s, alpha));
  }

  function dispose() {
    for (const layer of [effects, ships, water, islands]) layer.dispose();
    webglCanvas.removeEventListener("webglcontextlost", onLost);
    clearShipModels();
    disposeToon();
    // Not forced lost: React's StrictMode mounts the effect twice in development and the second
    // mount takes the same canvas, whose context is the one this let go of. The canvas holds one
    // context for the life of the page either way, so nothing leaks round to round.
    renderer.dispose();
  }

  return {
    resize,
    follow,
    render,
    under: (rect, w) => shipUnder(view, rect, w),
    tick: (dt) => { clock.t += dt; ctx.dt = dt; },
    dispose,
    kind: "3d",
  };
}

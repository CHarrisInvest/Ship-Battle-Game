/**
 * THE SHIP ON THE MENU, IN THREE DIMENSIONS. Owned by the menu layer (see the module contract in
 * docs/superpowers/specs/2026-10-15-three-renderer-design.md).
 *
 * The plate on the menu, the yard's ship and the generated art (`npm run icon`, `npm run promo`) all
 * turn the one ship model, `shipModel(spec, { units: "menu" })`, the same geometry that sails at sea,
 * toon-lit under a light that stays put while she turns under it, the way drawGalleon has always lit
 * her.
 *
 * FRAMING. drawGalleon projects a menu point (x toward the bow, y abeam, z up), turned by the bearing,
 * to `(W/2 + (X - Y) * 0.866 * s, 0.71 H + ((X + Y) * 0.5 - z) * s)` with `s = W / span`. That is an
 * exact isometric view from (1, 1, 1), magnified by sqrt(3/2): the orthographic camera here looks
 * from there, and its frustum is the box divided by `s * sqrt(3/2)` pixels to a unit, hung so the
 * pivot (amidships at the waterline) lands at the same spot. Menu axes are three (x, z, y) (see
 * shipmodel.js), and a turn of the bearing is a turn of `-deg` about three's Y. Nothing about where
 * she sits or how large she is drawn changes between the two paths.
 *
 * ONE CONTEXT. Browsers allow a page a handful of WebGL contexts, and the sea already holds one, so
 * every menu ship draws through one shared WebGLRenderer on a canvas nobody sees and copies the
 * frame into her own 2D canvas. The canvas a component holds is therefore always a 2D one, which is
 * also the whole of the fallback: when WebGL cannot be had, or the context is lost, the same canvas
 * is painted by `drawGalleon`, through the plate's lighter painter (`platePainter` in galleon.js).
 * The shared renderer is kept for the life of the page. Releasing it after every plate (as each voyage did) leaked a whole dead renderer a time:
 * three's `dispose()` leaves its listeners on the materials and geometry it drew, which are the
 * app-long shared caches, so each one kept its lost context and program cache reachable, and every
 * return to the menu compiled the shaders again. One idle context costs nothing while it waits.
 */

import * as THREE from "three";
import { platePainter } from "../galleon.js";
import { hullForm } from "../hullform.js";
import { shipModel } from "./shipmodel.js";
import { WIND } from "./flags.js";

const ISO = Math.sqrt(1.5); // drawGalleon's projection is isometric magnified by this
const PIVOT_Y = 0.71; // where the waterline amidships sits, as a share of the box's height

// The light, fixed to the view as drawGalleon's is: its LIGHT vector in menu axes is
// (-0.42, 0.46, 0.78), which is three (-0.42, 0.78, 0.46). The intensities are tuned so the lit side
// of a hull is the palette's own colour and the shaded side falls a few bands down it.
const KEY_DIR = new THREE.Vector3(-0.42, 0.78, 0.46).normalize();
const KEY = { color: "#fff8ee", intensity: 0.85 * Math.PI };
const FILL = { sky: "#eef0f2", ground: "#5a4c3c", intensity: 0.36 * Math.PI };

/* ---- the one shared WebGL renderer ------------------------------------------------------------ */

let shared = null; // { renderer, canvas, users, lost }
let failed = false; // WebGL was asked for and refused: every menu ship paints in 2D from then on

function acquire() {
  if (failed) return null;
  if (shared) {
    shared.users++;
    return shared;
  }
  try {
    // asked of the canvas first, so a browser without WebGL falls back quietly rather than with
    // three's console error
    const canvas = document.createElement("canvas");
    const attrs = { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true };
    const context = canvas.getContext("webgl2", attrs);
    if (!context) { failed = true; return null; }
    const renderer = new THREE.WebGLRenderer({ canvas, context, ...attrs });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const s = { renderer, canvas, users: 1, lost: false };
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); s.lost = true; });
    canvas.addEventListener("webglcontextrestored", () => { s.lost = false; });
    shared = s;
    return s;
  } catch {
    failed = true;
    return null;
  }
}

function letGo(s) {
  if (!s || s !== shared) return;
  s.users = Math.max(0, s.users - 1);
}

/* ---- the contact shadow ---------------------------------------------------------------------- */

let blobTex = null;
function blobTexture() {
  if (blobTex) return blobTex;
  const n = 64, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (x + 0.5) / n * 2 - 1, dy = (y + 0.5) / n * 2 - 1;
    const r = Math.min(1, Math.hypot(dx, dy));
    const a = Math.pow(1 - r, 1.6); // soft all the way out, darkest under her keel
    data.set([0, 0, 0, Math.round(a * 255)], (y * n + x) * 4);
  }
  blobTex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  blobTex.magFilter = THREE.LinearFilter;
  blobTex.minFilter = THREE.LinearFilter;
  blobTex.needsUpdate = true;
  return blobTex;
}

/**
 * A turning ship drawn into `canvas`, which is a 2D canvas the caller owns.
 *
 *   resize(w, h, dpr)   the box in CSS pixels and the device pixel ratio to draw it at
 *   draw(spec, deg, how)  one frame of `spec` (a rigSpec, or null for the galleon) at bearing `deg`,
 *                       framed the way drawGalleon frames it: bearing 0 has the bow to the lower
 *                       right, and the waterline amidships sits at 0.71 of the height
 *   dispose()           release what it holds
 *   kind                "3d" while drawn through WebGL, "2d" when painted by drawGalleon
 *
 * Her flags fly from the menu's wind (`WIND.menu` in flags.js), which is fixed to the viewer, so as
 * the plate turns her they hold their line on screen and she swings under them. `how` is optional:
 * `speed` sails her at that speed in the engine's units, so her flags stream astern as they would at
 * sea; `wind` turns the wind to that many radians in the menu's frame; and `time` holds the flags
 * still at that moment of their wave, for a picture that must come out the same every time (the
 * icons, the Ship Lab's sheet). Without `time` they wave on the page's own clock.
 *
 * `opts.shadow` (default true) lays a soft contact shadow under her keel; the generated art turns it
 * off, because it trims to what the ship covers.
 */
export function createMenuShip(canvas, { shadow = true } = {}) {
  const ctx = canvas.getContext("2d");
  let w = canvas.width, h = canvas.height, dpr = 1;
  const gl = acquire();

  let scene = null, camera = null, model = null, modelKey = null, blob = null, blobMat = null;
  if (gl) {
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
    camera.position.set(1, 1, 1).normalize().multiplyScalar(1500);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    const key = new THREE.DirectionalLight(KEY.color, KEY.intensity);
    key.position.copy(KEY_DIR).multiplyScalar(100);
    scene.add(key, key.target);
    scene.add(new THREE.HemisphereLight(FILL.sky, FILL.ground, FILL.intensity));
    if (shadow) {
      blobMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.45 });
      blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), blobMat);
      blob.rotation.x = -Math.PI / 2;
      blob.renderOrder = -1;
    }
  }

  const flat = platePainter();
  const paint2d = (spec, deg) => flat(ctx, w, h, dpr, deg, spec);

  let lastSpec; // the spec placed last: a plate redraws the same object every frame
  let lastT = 0; // the page's clock at the last frame, for her flags
  const size = new THREE.Vector2();
  const place = (spec) => {
    if (spec === lastSpec && model) return;
    lastSpec = spec;
    const key = spec ? JSON.stringify(spec) : "galleon";
    if (key === modelKey) return;
    if (model) model.dispose();
    model = shipModel(spec || null, { units: "menu" });
    modelKey = key;
    for (const m of model.group.children) { m.castShadow = false; m.receiveShadow = false; }
    if (blob) {
      // under her keel, her length and a little over her beam, turning with her
      const hb = model.parts.hull?.geometry.boundingBox;
      blob.scale.set(model.length * 1.08, model.beam * 1.7, 1);
      blob.position.set(0, (hb ? hb.min.y : 0) - 0.5, 0);
      model.group.add(blob);
    }
    scene.add(model.group);
  };

  const api = {
    kind: gl ? "3d" : "2d",
    resize(cw, ch, r = 1) {
      w = cw; h = ch; dpr = r;
      canvas.width = Math.round(cw * r);
      canvas.height = Math.round(ch * r);
      flat.reset();
    },
    draw(spec, deg, how = {}) {
      if (!gl || gl.lost || shared !== gl) return paint2d(spec, deg);
      place(spec);
      flat.reset(); // this frame is painted over whatever the flat painter left
      // the wind, turned into her own frame: the plate turns her by `deg`, the wind stays put
      const rel = (how.wind ?? WIND.menu) - (deg * Math.PI) / 180;
      const speed = how.speed || 0;
      if (how.time != null) model.flags.pose(rel, speed, how.time);
      else {
        const now = performance.now() / 1000;
        model.flags.blow(rel, speed, lastT ? Math.min(0.1, now - lastT) : 0);
        lastT = now;
      }
      // her size in the box is drawGalleon's: the class's span fills the width
      const span = spanOf(spec);
      const px = (w / span) * ISO; // CSS pixels to a model unit
      const uw = w / px, uh = h / px;
      camera.left = -uw / 2; camera.right = uw / 2;
      camera.top = uh * PIVOT_Y; camera.bottom = -uh * (1 - PIVOT_Y);
      camera.updateProjectionMatrix();
      model.group.rotation.set(0, (-deg * Math.PI) / 180, 0);

      const W = canvas.width, H = canvas.height;
      const r = gl.renderer;
      r.getSize(size);
      if (size.x !== W || size.y !== H || r.getPixelRatio() !== 1) {
        r.setPixelRatio(1);
        r.setSize(W, H, false);
      }
      r.render(scene, camera);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(gl.canvas, 0, 0, W, H, 0, 0, W, H);
    },
    dispose() {
      if (model) model.dispose();
      model = null;
      if (blob) { blob.geometry.dispose(); blobMat.dispose(); }
      scene = null;
      letGo(gl);
    },
  };
  return api;
}

/** The class's menu span, the width drawGalleon fits her into. */
function spanOf(spec) {
  return hullForm(spec?.hull).menu.span;
}

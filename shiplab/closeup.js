/**
 * THE SHIP LAB'S CLOSE-UPS, drawn for `npm run shiplab -- --closeup` (see tools/shiplab.mjs).
 *
 * The plate frames a ship whole, at a size where her decks are a few pixels across, which is too
 * small to see whether a gun clears a ladder or a chimney a pin rail. These are the same ship, the
 * game's own `shipModel` in the plate's own two lights, seen close from the places where things
 * collide: her stern and quarterdeck, her waist, her forecastle and her bow. A translucent sea is laid
 * at her waterline so a hull's height over it reads. It is a dev page's module and the game never
 * imports it.
 */

import * as THREE from "three";
import { shipModel } from "../src/render3d/shipmodel.js";
import { PLATE_LIGHTS } from "../src/render3d/menuship.js";
import { tickSails } from "../src/render3d/bespoke/kit.js";
import { bespokeIds } from "../src/render3d/bespoke/index.js";
import { fitOut, emptyLoadout, rigSpec } from "../src/shipyard.js";

/**
 * The views, each an eye and the point it looks at, as shares of her length: x toward her bow, y up
 * from the waterline, z to starboard. They were set on the third rate and hold for any class, since
 * a ship's decks stand about the same share of her length over the water.
 */
export const VIEWS = {
  stern: { eye: [-1.04, 0.16, 0.48], at: [-0.48, 0.06, 0], fov: 30 },
  astern: { eye: [-1.24, 0.12, 0], at: [-0.48, 0.06, 0], fov: 24 },
  quarterdeck: { eye: [-0.02, 0.24, 0.16], at: [-0.32, 0.1, -0.02], fov: 50 },
  waist: { eye: [0.26, 0.22, 0.18], at: [0.08, 0.09, -0.06], fov: 55 },
  forecastle: { eye: [0.18, 0.21, 0.15], at: [0.36, 0.13, 0], fov: 50 },
  bow: { eye: [0.84, 0.16, 0.44], at: [0.42, 0.08, 0], fov: 38 },
  side: { eye: [0, 0.09, 0.95], at: [0, 0.08, 0], fov: 40 },
};

/** The classes drawn when none are named: the ones modelled by hand, which the close-ups are for. */
export const defaultIds = () => bespokeIds();

let renderer = null;
const scene = new THREE.Scene();
scene.background = new THREE.Color("#7fb3c8");
const key = new THREE.DirectionalLight(PLATE_LIGHTS.key.color, PLATE_LIGHTS.key.intensity);
scene.add(key, key.target, new THREE.HemisphereLight(PLATE_LIGHTS.fill.sky, PLATE_LIGHTS.fill.ground, PLATE_LIGHTS.fill.intensity));
const sea = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: "#2e6f86", transparent: true, opacity: 0.55, depthWrite: false }));
sea.rotation.x = -Math.PI / 2;
scene.add(sea);

/**
 * One class drawn from each of `views` (names in VIEWS), `w` by `h`, as PNG data URLs. `fit` is a
 * stock quality from 0 to 1, or null for her bare hull.
 */
export function drawCloseups({ id, fit = 1, views = Object.keys(VIEWS), w = 560, h = 380 }) {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas: document.createElement("canvas"), antialias: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  const spec = rigSpec(fit == null ? emptyLoadout(id) : fitOut(id, fit));
  const m = shipModel(spec, { units: "sea" });
  // her flags and sails at one fixed moment, so two runs of the same tree come out the same
  m.flags.pose(0.6, 0, 0.6);
  tickSails(0.6);
  const L = m.length;
  key.position.copy(PLATE_LIGHTS.keyDir).multiplyScalar(4 * L);
  sea.scale.set(6 * L, 6 * L, 1);
  scene.add(m.group);
  const out = views.map((name) => {
    const v = VIEWS[name];
    const cam = new THREE.PerspectiveCamera(v.fov, w / h, 0.01 * L, 20 * L);
    cam.position.set(...v.eye.map((k) => k * L));
    cam.lookAt(...v.at.map((k) => k * L));
    renderer.render(scene, cam);
    return renderer.domElement.toDataURL("image/png");
  });
  m.dispose();
  return out;
}

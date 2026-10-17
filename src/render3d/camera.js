/**
 * THE 3D CAMERA, PLACED SO THE SEA LANDS WHERE IT ALWAYS DID.
 *
 * The 2D sea is a tilted orthographic view: across is one to one, down the screen is the ground
 * squashed by TILT, and a height rises by ZUP of itself, with TILT² + ZUP² = 1. That is exactly an
 * orthographic camera looking up the screen and down at asin(TILT), about 37°, below the horizon:
 * its up vector on the screen is (0, ZUP, -TILT) in three's axes and it looks along
 * (0, -TILT, -ZUP). Its frustum is the view in
 * world units, `Vw` across and `Vh` down, hung from the camera's own position, which stands over the
 * ground point at the top left of the screen (`view.cam`) and backed off along the line of sight.
 * Backing off along the line of sight moves nothing on the screen, so the projection is the 2D
 * one to the pixel: world (x, y, z) lands at ((x - cam.x) * zoom, ((y - cam.y) * TILT - z * ZUP) *
 * zoom) CSS pixels from the top left. `npm run camera-check` holds it to that.
 *
 * The follow, the edge clamping and the square are not ported but shared: `sizeView` and
 * `followView` in `src/render/view.js` are the same functions the 2D renderer runs, so the camera
 * holds a ship off the boundary by the same figures in both.
 *
 * AXES. Engine (x, y, z), x across and y down the screen on the water and z up, is three (x, z, y):
 * three Y is up and three Z runs toward the viewer, which keeps three right handed with the sea the
 * way the engine lays it out. `toThree` is the one place that swap is written.
 */

import * as THREE from "three";
import { TILT, ZUP, createView, sizeView, followView, blend, toScreen, SX, SY } from "../render/view.js";

export { TILT, ZUP, createView, sizeView, followView, blend, toScreen, SX, SY };

/** Engine (x, y, z) as a three.js point. Writes into `out` when given one. */
export function toThree(x, y, z = 0, out = new THREE.Vector3()) {
  return out.set(x, z, y);
}

/** The pitch that makes the 2D projection: the camera's up is (0, ZUP, -TILT), its back (0, TILT, ZUP). */
export const PITCH = -Math.asin(TILT);
const BACK = new THREE.Vector3(0, TILT, ZUP);

/** A fresh orthographic camera at the sea's pitch. `syncCamera` sizes and places it. */
export function createCamera() {
  const camera = new THREE.OrthographicCamera(0, 1, 0, -1, 1, 1000);
  camera.rotation.set(PITCH, 0, 0, "XYZ");
  return camera;
}

/**
 * The camera brought onto a view: its frustum `Vw` by `Vh` world units hung from the top left of
 * the screen, and the camera stood back along its line of sight far enough that nothing tall on the
 * nearest water is cut by the near plane and the farthest water on the screen is inside the far one.
 */
export function syncCamera(camera, v) {
  const groundDeep = v.Vh / TILT; // the most ground the screen can show, top to bottom
  const back = 400 + groundDeep; // well clear of any mast on the nearest water
  camera.left = 0;
  camera.right = v.Vw;
  camera.top = 0;
  camera.bottom = -v.Vh;
  camera.near = 1;
  camera.far = back + groundDeep * ZUP + 400;
  camera.position.set(v.cam.x, 0, v.cam.y).addScaledVector(BACK, back);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

/**
 * The patch of water the view shows, in engine units, padded by `pad` on every side: what a layer
 * culls against and the shadow camera covers. `{ x0, y0, x1, y1, cx, cy }`; the far edge allows
 * for things standing `pad` high at the bottom of the screen.
 */
export function viewGround(v, pad = 0) {
  const x0 = v.cam.x - pad, x1 = v.cam.x + v.Vw + pad;
  const y0 = v.cam.y - pad, y1 = v.cam.y + v.Vh / TILT + pad;
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/**
 * Where a three.js point lands on the canvas through this camera, in CSS pixels from its top left.
 * The check against `toScreen` is the proof the two projections are one.
 */
export function projectThree(camera, v, p) {
  const q = p.clone().project(camera);
  return [((q.x + 1) / 2) * v.Wd, ((1 - q.y) / 2) * v.Hd];
}

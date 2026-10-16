/**
 * THE CAMERA CHECK — `npm run camera-check`
 *
 * The three.js sea has to land on the screen exactly where the 2D sea did, or the aiming guides, the
 * bars over each ship, the radar's box and the rail's fade (all drawn or tested in 2D) stop lining
 * up with what they mark. This sizes a few screens, follows a ship to the middle of the map and to
 * each edge, and projects points on the water and up a mast through the 3D camera
 * (`src/render3d/camera.js`), against the 2D projection (`toScreen` in `src/render/view.js`, which
 * is the formula the Canvas 2D renderer draws with). It fails on any point more than a hundredth of
 * a pixel apart. Plain Node; three.js's maths needs no WebGL.
 */

import * as THREE from "three";
import { WORLD } from "../src/sim/index.js";
import { createView, sizeView, followView, toScreen } from "../src/render/view.js";
import { createCamera, syncCamera, toThree, projectThree } from "../src/render3d/camera.js";

const screens = [
  [390, 844], [844, 390], [1280, 800], [360, 640], [2048, 1536],
];
const spots = [
  [WORLD / 2, WORLD / 2], [20, 20], [WORLD - 20, WORLD - 20], [WORLD / 2, 10], [WORLD - 5, WORLD / 3],
];
let worst = 0, n = 0;
const fails = [];
for (const [Wd, Hd] of screens) {
  const v = sizeView(createView(), { width: Wd, height: Hd, left: 0, top: 0, right: Wd, bottom: Hd }, null, 2);
  const camera = createCamera();
  for (const [sx, sy] of spots) {
    followView(v, { x: sx, y: sy, px: sx - 1, py: sy, heading: 0.3, pHeading: 0.2 }, 0.5);
    syncCamera(camera, v);
    for (const [dx, dy, z] of [[0, 0, 0], [37, -12, 0], [-80, 55, 0], [0, 0, 30], [12, 4, 8.5], [-150, -90, 0]]) {
      const x = sx + dx, y = sy + dy;
      const want = toScreen(v, x, y, z);
      const got = projectThree(camera, v, toThree(x, y, z));
      const d = Math.hypot(want[0] - got[0], want[1] - got[1]);
      worst = Math.max(worst, d);
      n++;
      if (!(d < 0.01)) fails.push(`${Wd}x${Hd} ship at ${sx},${sy}: (${x}, ${y}, ${z}) 2D ${want.map((a) => a.toFixed(3))} 3D ${got.map((a) => a.toFixed(3))}`);
      // and it must be in front of the camera, between the planes
      const ndc = toThree(x, y, z).project(camera);
      if (!(ndc.z > -1 && ndc.z < 1)) fails.push(`${Wd}x${Hd}: (${x}, ${y}, ${z}) outside the depth range (${ndc.z.toFixed(3)})`);
    }
  }
}
void THREE;
if (fails.length) {
  for (const f of fails) console.log("  FAIL  " + f);
  console.log(`camera check: ${fails.length} of ${n} points off`);
  process.exit(1);
}
console.log(`camera check: ${n} points land where the 2D sea puts them (worst ${worst.toExponential(2)} px)`);

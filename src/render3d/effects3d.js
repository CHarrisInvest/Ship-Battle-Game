/**
 * THE SHOT AND THE SMOKE ON THE 3D SEA. Owned by the effects layer (see the module contract in
 * docs/superpowers/specs/2026-10-15-three-renderer-design.md).
 *
 * MINIMAL STUB: every ball and musket shot in the air as one dark sphere of an instanced mesh, back
 * along its flight by the share of the step not yet drawn, at the height the 2D sea drew it. The
 * effects layer replaces this with the shot's light and trail, the musket streaks, and `fx.parts`
 * as smoke, flashes, rings and splinters.
 */

import { TICK, WP } from "../sim/index.js";
import { SHOT_DRAW, ZUP } from "../render/view.js";

const MAX_SHOTS = 4096;
// the 2D sea drew a ball three view units over the water, which is this high in the world
const SHOT_Z = 3 / ZUP;

export function createEffectsLayer(scene, ctx) {
  const { THREE, palette: C } = ctx;
  const geo = new THREE.SphereGeometry(1, 10, 8);
  const shots = new THREE.InstancedMesh(geo, ctx.toon.material({ color: C.ball }), MAX_SHOTS);
  shots.name = "shots";
  shots.count = 0;
  shots.frustumCulled = false;
  scene.add(shots);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();

  function update(world, fx, alpha) {
    const back = TICK * (1 - alpha);
    let n = 0;
    for (const b of world.shots) {
      if (n >= MAX_SHOTS) break;
      const r = b.kind === "musket" ? 0.5 : b.r * (WP[b.kind]?.draw ?? SHOT_DRAW);
      ctx.toThree(b.x - b.vx * back, b.y - b.vy * back, SHOT_Z, p);
      sc.set(r, r, r);
      shots.setMatrixAt(n++, m.compose(p, q, sc));
    }
    shots.count = n;
    shots.instanceMatrix.needsUpdate = true;
  }

  function dispose() {
    shots.removeFromParent();
    shots.dispose();
    geo.dispose();
  }

  return { update, dispose };
}

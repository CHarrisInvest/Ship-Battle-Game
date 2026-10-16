/**
 * THE WATER ON THE 3D SEA. Owned by the water layer (see the module contract in
 * docs/superpowers/specs/2026-10-15-three-renderer-design.md).
 *
 * MINIMAL STUB: the arena as one flat plane of open water, the sea beyond the buoys a plane of the
 * deeper colour under it, both taking the shadows. The water layer replaces this with the sea
 * shader, the swell and foam caps, the boundary rope and buoys, the weather, the wakes and the
 * foam round the shore.
 */

import { WORLD } from "../sim/index.js";

export function createWaterLayer(scene, ctx) {
  const { THREE, palette: C } = ctx;
  const root = new THREE.Group();
  root.name = "water";
  scene.add(root);

  // planes are built in three's XY and laid flat onto the water (XZ), facing up
  const flat = (w, h, color, y) => {
    const geo = new THREE.PlaneGeometry(w, h);
    const mesh = new THREE.Mesh(geo, ctx.toon.material({ color }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(WORLD / 2, y, WORLD / 2);
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };
  const beyond = flat(WORLD * 6, WORLD * 6, C.waterEdge, -0.05);
  const arena = flat(WORLD, WORLD, C.water, 0);

  function update() {}

  function dispose() {
    beyond.geometry.dispose();
    arena.geometry.dispose();
    root.removeFromParent();
  }

  return { update, dispose };
}

/**
 * THE ISLANDS ON THE 3D SEA. Owned by the islands layer (see the module contract in
 * docs/superpowers/specs/2026-10-15-three-renderer-design.md).
 *
 * MINIMAL STUB: each island as three stacked flat rings off her outline, the shallows, the sand and
 * the grass, built once per world. The islands layer replaces this with the relief, the beach, and
 * the planting from `genFoliage`.
 */

export function createIslandLayer(scene, ctx) {
  const { THREE, palette: C } = ctx;
  const root = new THREE.Group();
  root.name = "islands";
  scene.add(root);
  let builtFor = null;
  const geos = [];

  // One ring of an island's outline at `scale`, fanned from her middle (her outline is a radius per
  // bearing, so a fan from the centre always fills it), lying at height `y`.
  function ring(isl, scale, y) {
    const n = isl.verts.length;
    const pos = [isl.x, y, isl.y];
    for (let k = 0; k <= n; k++) {
      const a = ((k % n) / n) * Math.PI * 2;
      const r = isl.r * isl.verts[k % n] * scale;
      pos.push(isl.x + Math.cos(a) * r, y, isl.y + Math.sin(a) * r);
    }
    const idx = [];
    // counter-clockwise seen from above (three +Y), so the face is up
    for (let k = 1; k <= n; k++) idx.push(0, k + 1, k);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geos.push(geo);
    return geo;
  }

  function build(world) {
    for (const g of geos) g.dispose();
    geos.length = 0;
    root.clear();
    for (const isl of world.islands) {
      for (const [scale, y, color] of [[1.3, 0.04, C.shallows], [1.08, 0.08, C.beachRim], [1, 0.4, C.sand], [0.72, 0.8, C.grass]]) {
        const mesh = new THREE.Mesh(ring(isl, scale, y), ctx.toon.material({ color }));
        mesh.receiveShadow = true;
        root.add(mesh);
      }
    }
  }

  function update(world) {
    if (world.islands !== builtFor) {
      builtFor = world.islands;
      build(world);
    }
  }

  function dispose() {
    for (const g of geos) g.dispose();
    geos.length = 0;
    root.removeFromParent();
  }

  return { update, dispose };
}

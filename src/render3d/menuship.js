/**
 * THE SHIP ON THE MENU, IN THREE DIMENSIONS. Owned by the menu layer (see the module contract in
 * docs/superpowers/specs/2026-10-15-three-renderer-design.md).
 *
 * MINIMAL STUB: the contract's shape, drawn the old way. `createMenuShip` paints `drawGalleon` into
 * the canvas it is given, so anything wired to it now shows the plate exactly as it was. The menu
 * layer replaces the inside with `shipModel(spec, { units: "menu" })` under an orthographic camera
 * at drawGalleon's own iso angle, and moves tools/icon.mjs and tools/promo.mjs onto it.
 */

import { drawGalleon } from "../galleon.js";

/**
 * A turning ship drawn into `canvas`.
 *
 *   resize(w, h, dpr)   the box in CSS pixels and the device pixel ratio to draw it at
 *   draw(spec, deg)     one frame of `spec` (a rigSpec, or null for the galleon) at bearing `deg`,
 *                       framed the way drawGalleon frames it: bearing 0 has the bow to the lower
 *                       right, and the waterline amidships sits at 0.71 of the height
 *   dispose()           release what it holds
 */
export function createMenuShip(canvas) {
  const ctx = canvas.getContext("2d");
  let w = canvas.width, h = canvas.height, dpr = 1;
  return {
    resize(cw, ch, r = 1) {
      w = cw; h = ch; dpr = r;
      canvas.width = Math.round(cw * r);
      canvas.height = Math.round(ch * r);
    },
    draw(spec, deg) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawGalleon(ctx, w, h, deg, spec || undefined);
    },
    dispose() {},
  };
}

/**
 * The 3D sea and the 3D menu ship, as one chunk the screen loads after it has painted. three.js is
 * most of the game's weight, so it is not in the first chunk: the menu paints at once with the 2D
 * sea and `drawGalleon`, and both are taken over by these as soon as this chunk arrives. Every
 * visitor loads it and runs the same code; a browser without WebGL keeps the 2D picture because
 * `createRenderer3d` and `createMenuShip` say so, not because anything chose for it.
 */
export { createRenderer3d } from "./renderer3d.js";
export { createMenuShip } from "./menuship.js";

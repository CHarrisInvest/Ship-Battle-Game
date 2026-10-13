import { rigSpec } from "../shipyard.js";

/**
 * THE RIG SHE CARRIES, AT SEA. Every ship afloat used to draw the same three hard-coded masts, so a
 * gundalow and a first rate were told apart only by their health bars. The masts and sails drawn on the
 * water now come off the ship's own loadout, through the same `rigSpec()` the menu ship reads:
 * a mast stands where its station is on HER hull, as tall as the mast bought for it, and carries one
 * band of canvas per sail actually bent on, in the shape of its category. Square canvas is the
 * bellied band the fight has always drawn; triangular, gaff and lug canvas are fore-and-aft panels;
 * headsails run from the bowsprit up toward the foremost masthead.
 *
 * Worked out once per ship at `makeShip`, because nothing about her rig changes at sea short of the
 * whole thing coming down.
 */
export const SEA_FOREAFT = new Set(["TRI", "LAT", "GAF", "LUG"]);
export function buildSeaRig(loadout, sea) {
  const spec = rigSpec(loadout);
  const masts = [];
  for (const m of spec.masts) {
    const u = sea.masts[m.station];
    if (u === undefined) continue;
    const top = Math.max(8, sea.tops[m.station] * (m.height || 1));
    const wB = sea.wBase[m.station];
    const n = m.sails.length;
    // bands from the deck up: each sail keeps about three quarters of the height of the one below
    // it and narrows the same way, with a little air between bands
    const zb0 = 0.18 * top, gap = 1.6;
    const room = Math.max(4, top - 3 - zb0 - gap * (n - 1));
    const weights = Array.from({ length: n }, (_, i) => Math.pow(0.74, i));
    const wsum = weights.reduce((a, b) => a + b, 0) || 1;
    let z = zb0;
    const sails = m.sails.map((sail, i) => {
      const h = room * (weights[i] / wsum);
      // a studdingsail is the band run out sideways, so the band just carries the extra beam
      const band = { kind: sail.kind, sb: z, st: z + h, w: wB * Math.pow(0.82, i) * (sail.stud ? 1.45 : 1) };
      z += h + gap;
      return band;
    });
    masts.push({ u, h: top, sails });
  }
  // what the bowsprit carries: headsails run up toward the foremost masthead, and square canvas
  // under the spar is a spritsail
  const fore = masts.reduce((a, m) => (!a || m.u > a.u ? m : a), null);
  const heads = [];
  const sprits = [];
  const bowTip = 0.61 * sea.L;
  for (const m of spec.masts) {
    if (m.station !== "bowsprit") continue;
    m.sails.forEach((sail, i) => {
      if (SEA_FOREAFT.has(sail.kind)) {
        if (fore) heads.push({ tack: bowTip * (0.72 + 0.11 * i), mastU: fore.u, mastZ: fore.h * (0.55 + 0.14 * i) });
      } else {
        // slung further out along the spar per sail, the way the menu spreads them, so a second
        // spritsail is a sail and not a repaint of the first
        sprits.push({ kind: sail.kind, sb: -1.5, st: 3, w: 0.54 * sea.W * (1 - 0.18 * i), u: sea.L * (0.46 + 0.12 * i) });
      }
    });
  }
  const topmost = masts.reduce((a, m) => Math.max(a, m.h), 0);
  return { masts, heads, sprits, top: Math.max(topmost, 14) };
}

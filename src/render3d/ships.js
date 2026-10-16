/**
 * THE SHIPS ON THE 3D SEA. Owned by the ships layer (see the module contract in
 * docs/superpowers/specs/2026-10-15-three-renderer-design.md).
 *
 * MINIMAL STUB: each ship afloat is her own `shipModel` at sea, placed where she is drawn `alpha` of
 * the way through the last step, on her blended heading, heeled by her look's roll with the idle
 * swell on it, and with her masts struck when she is dismasted. The ships layer replaces this
 * with the real thing: livery, hit flash, the sinking, the bow wave and the rest.
 */

import { SX, SY } from "../render/view.js";
import { rigSpec } from "../shipyard.js";

export function createShipLayer(scene, ctx) {
  const { THREE } = ctx;
  const root = new THREE.Group();
  root.name = "ships";
  scene.add(root);
  /** id -> { model, spec key } */
  const live = new Map();
  let lastFx = null;

  // her heel as drawn: the look's roll into a turn, and a gentle idle heel on the swell
  const rollOf = (look) => (look ? look.roll + Math.sin(look.rollPhase * 1.2) * 0.05 : 0);

  function update(world, fx, alpha) {
    lastFx = fx;
    const seen = new Set();
    for (const s of world.ships) {
      if (!s.alive) continue;
      seen.add(s.id);
      let entry = live.get(s.id);
      if (!entry) {
        const model = ctx.shipModel(rigSpec(s.loadout), { units: "sea" });
        root.add(model.group);
        entry = { model };
        live.set(s.id, entry);
      }
      const pos = ctx.blend(s, alpha);
      const look = ctx.lookOf(fx, s);
      const g = entry.model.group;
      g.position.set(pos.x, 0, pos.y);
      g.rotation.set(-rollOf(look), -pos.h, 0, "YXZ");
      const up = !s.mastDown;
      for (const m of entry.model.parts.masts) m.visible = up;
      if (entry.model.parts.sprit) entry.model.parts.sprit.visible = up;
    }
    for (const [id, entry] of live) {
      if (seen.has(id)) continue;
      entry.model.dispose();
      live.delete(id);
    }
  }

  /** Where the overlay hangs a ship's bars: her keel in view space, her heading, heel and rig top. */
  function labelOf(s, alpha) {
    const pos = ctx.blend(s, alpha);
    const entry = live.get(s.id);
    const look = lastFx ? ctx.lookOf(lastFx, s) : null;
    return {
      gx: SX(pos.x, ctx.view), gy: SY(pos.y, ctx.view), h: pos.h, roll: rollOf(look),
      topZ: (entry ? entry.model.height : 24) + 6,
    };
  }

  function dispose() {
    for (const entry of live.values()) entry.model.dispose();
    live.clear();
    root.removeFromParent();
  }

  return { update, labelOf, dispose };
}

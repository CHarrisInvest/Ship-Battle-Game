/**
 * THE ENGINE'S DICE: every random number a round uses, from one generator seeded when it starts.
 *
 * It is mulberry32, a few lines, and its whole state is one 32-bit number kept on the world as
 * `world.rng`. So the same seed and the same inputs give the same round on a phone, a laptop or a
 * server, and the dice go wherever a copy of the world goes. What only decorates the sea, the smoke
 * and the spray and the splinters, keeps `Math.random()` in the renderer: each viewer's smoke may
 * differ, and nothing that happens in the round depends on it.
 */

/** A seed as the generator holds it: any number, brought to an unsigned 32-bit integer. */
export const seedOf = (seed) => (Number(seed) || 0) >>> 0;

/** The next number in [0, 1) from whatever carries the dice, which is a world, and moves them on. */
export function random(holder) {
  let t = (holder.rng = (holder.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * A seed made from a handful of figures, the same figures always giving the same seed. It is how
 * something placed in the world carries dice of its own without drawing on the round's: an island's
 * planting is seeded from where it stands, so every player sees the same palms on the same island,
 * and drawing them never moves the round's dice on.
 */
export function seedFrom(...figures) {
  let h = 0x811c9dc5;
  for (const f of figures) {
    h = Math.imul(h ^ Math.round(f * 1000), 0x01000193);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

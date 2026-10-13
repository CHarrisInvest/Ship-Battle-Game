/** Two small helpers every part of the engine uses. */

/** An angle brought into -PI..PI, so the difference between two headings is the short way round. */
export function norm(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

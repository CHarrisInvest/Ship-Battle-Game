/**
 * A fingerprint of the engine: everything that decides how a round plays out, hashed in a fixed
 * order. The server reports it, and refuses to start a round for a browser running a different
 * engine, because a replay of a round sailed under other rules would bank something the captain never
 * saw. The browser's build carries the same figure (step 4).
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

export function engineFiles() {
  const sim = readdirSync(join(src, "sim")).filter((f) => f.endsWith(".js")).sort().map((f) => join("sim", f));
  return [...sim, "shipyard.js", "shipref.js", "hullform.js", "exact.js"];
}

export function engineHash() {
  const h = createHash("sha256");
  for (const f of engineFiles()) {
    h.update(f + "\n");
    h.update(readFileSync(join(src, f)));
  }
  return h.digest("hex").slice(0, 16);
}

/**
 * THE EXACT MATHS TEST — `npm run exact-test`
 *
 * `src/exact.js` is what lets every engine step a round to the same bits, and it is only any use if
 * it is also right. This holds each function to the built-in `Math` one it replaces, in Node, over a
 * few hundred thousand inputs across the ranges a round uses: within 1 unit in the last place for the
 * fdlibm ports, which are correctly rounded nearly always and never further out than that, and
 * within a few for pow and hypot, which are built from the others. It also pins the inputs a round
 * meets at its edges: a ship dead in the water (zeros, and their signs), a value that has gone bad
 * (NaN and the infinities), an angle that has wound up large, and pow's corners.
 *
 * It does not prove the engines agree. `npm run determinism` does that.
 */

import * as exact from "../src/exact.js";

const failures = [];
const fail = (what) => { failures.push(what); console.log("  FAIL  " + what); };
const ok = (what) => console.log("  ok    " + what);

// Distance in units in the last place, by laying the doubles out on one integer line.
const view = new DataView(new ArrayBuffer(8));
const line = (x) => { view.setFloat64(0, x); const b = view.getBigInt64(0); return b < 0n ? -(b & 0x7fffffffffffffffn) : b; };
function ulps(a, b) {
  if (Object.is(a, b) || (a !== a && b !== b)) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  const d = line(a) - line(b);
  return Number(d < 0n ? -d : d);
}

// A fixed stream of inputs, so a failure is the same failure every run.
let s = 12345;
const next = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;

const N = 200000;
// [function, ulps allowed, a draw of arguments]. pow's error grows with |y ln x|, so it is held over
// the range the catalogue uses: bases from 0.01 to 10, exponents within 3 either way.
const CASES = [
  ["sin", 1, () => [(next() - 0.5) * 2e4]],
  ["cos", 1, () => [(next() - 0.5) * 2e4]],
  ["atan", 1, () => [(next() - 0.5) * 100]],
  ["asin", 1, () => [next() * 2 - 1]],
  ["exp", 1, () => [(next() - 0.5) * 1400]],
  ["log", 1, () => [next() ** 6 * 1e6]],
  ["atan2", 1, () => [(next() - 0.5) * 2000, (next() - 0.5) * 2000]],
  ["pow", 32, () => [0.01 + next() * 10, (next() - 0.5) * 6]],
  ["hypot", 2, () => [(next() - 0.5) * 2e4, (next() - 0.5) * 2e4]],
];

for (const [name, bound, draw] of CASES) {
  let worst = 0, at = null;
  for (let i = 0; i < N; i++) {
    const args = draw();
    const u = ulps(exact[name](...args), Math[name](...args));
    if (u > worst) { worst = u; at = args; }
  }
  if (worst > bound) fail(`${name} is ${worst} ulp from Math.${name} at (${at.join(", ")}), allowed ${bound}`);
  else ok(`${name} within ${worst} ulp of Math.${name} over ${N} inputs`);
}

// The edges, each to the exact value, signed zeros included.
const { PI } = Math;
const EDGES = [
  ["sin", [0], 0], ["sin", [-0], -0], ["cos", [0], 1], ["sin", [NaN], NaN], ["sin", [Infinity], NaN],
  ["cos", [-Infinity], NaN],
  ["atan2", [0, 0], 0], ["atan2", [-0, 0], -0], ["atan2", [0, -0], PI], ["atan2", [-0, -0], -PI],
  ["atan2", [0, -1], PI], ["atan2", [-0, -1], -PI], ["atan2", [1, 0], PI / 2], ["atan2", [-1, 0], -PI / 2],
  ["atan2", [Infinity, Infinity], PI / 4], ["atan2", [NaN, 1], NaN], ["atan2", [1, 1], PI / 4],
  ["asin", [1], PI / 2], ["asin", [-1], -PI / 2], ["asin", [2], NaN], ["asin", [-0], -0],
  ["exp", [0], 1], ["exp", [-Infinity], 0], ["exp", [Infinity], Infinity], ["exp", [800], Infinity],
  ["exp", [-800], 0], ["exp", [NaN], NaN],
  ["log", [1], 0], ["log", [0], -Infinity], ["log", [-1], NaN], ["log", [Infinity], Infinity],
  ["pow", [0, 0.6], 0], ["pow", [2, 0], 1], ["pow", [NaN, 0], 1], ["pow", [-2, 3], -8], ["pow", [-2, 0.5], NaN],
  ["pow", [0, -1], Infinity], ["pow", [0.5, Infinity], 0], ["pow", [2, -Infinity], 0], ["pow", [1, Infinity], NaN],
  ["pow", [0.9, 3], 0.9 * 0.9 * 0.9], ["pow", [3, 2], 9],
  ["hypot", [0, 0], 0], ["hypot", [3, 4], 5], ["hypot", [-3, -4], 5],
];
let edgeFails = 0;
for (const [name, args, want] of EDGES) {
  const got = exact[name](...args);
  if (!(Object.is(got, want) || (got !== got && want !== want))) { edgeFails++; fail(`${name}(${args.join(", ")}) is ${got}, wanted ${want}`); }
}
if (!edgeFails) ok(`${EDGES.length} edge values exact`);

// An angle wound up far past a turn still gives a sine, not NaN.
for (const x of [1e6, -1e9, 1e15, 1e300]) {
  const v = [exact.sin(x), exact.cos(x)];
  if (!v.every((y) => Number.isFinite(y) && Math.abs(y) <= 1)) fail(`sin and cos of ${x} are ${v.join(", ")}`);
}
if (!failures.some((f) => f.startsWith("sin and cos"))) ok("sin and cos of huge angles stay on the unit circle");

if (failures.length) {
  console.log(`\n${failures.length} FAILURE${failures.length === 1 ? "" : "S"}`);
  process.exit(1);
}
console.log("\nThe exact maths are right.\n");

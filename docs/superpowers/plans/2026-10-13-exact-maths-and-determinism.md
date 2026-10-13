# Exact maths and the determinism test: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the engine step a round to the same bits in Node, Chromium, WebKit and Firefox, and prove it with `npm run determinism`, so the server can later replay a captain's voyage and bank what really happened.

**Architecture:** A new leaf module, `src/exact.js`, gives `sin`, `cos`, `atan`, `atan2`, `asin`, `exp`, `log` (ports of fdlibm 5.3), `pow` and `hypot`, built from `+ - * /`, `%` and `Math.sqrt` alone, which IEEE 754 fixes in every engine. The engine and the two catalogue modules it reads (`shipyard.js`, `hullform.js`) call it as `exact.sin(...)` instead of `Math.sin(...)`, and `npm run purity` bans the built-ins there. A shared module of recorded rounds (`tools/rounds.js`) runs unchanged in Node and in a browser page, and `tools/determinism.mjs` serves the source as plain ES modules, sails the rounds in all three browsers through `playwright-core`, and compares fingerprints with Node's.

**Tech Stack:** Plain ES modules, Node 20+ (`node:http`, `node:zlib`), `playwright-core` (already a dev dependency), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-13-accounts-and-server-hold-design.md`, section "Making the round replay identically everywhere", and step 1 of "The order of work".

## Global Constraints

- The engine stays pure: nothing under `src/sim/` imports anything but itself, `shipyard.js`, `shipref.js`, `hullform.js` and, new, `exact.js`. `npm run purity` must pass after every task.
- `src/exact.js` imports nothing and touches nothing of the page, so it can be imported by `shipyard.js`, which otherwise imports nothing (`CLAUDE.md`).
- Under `src/sim/`, `src/shipyard.js`, `src/hullform.js` and `src/exact.js`, no `Math.sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`, `exp`, `expm1`, `log`, `log1p`, `log2`, `log10`, `pow`, `hypot`, `cbrt`, and no `**` operator. `Math.sqrt`, `abs`, `floor`, `ceil`, `round`, `trunc`, `min`, `max`, `sign`, `imul` are exact and stay.
- The renderer (`src/render/`, `src/galleon.js`, the component) keeps the built-in `Math`. Only what decides a round is held to the rule.
- `npm run sim-test` passes before and after every engine change (`CLAUDE.md`, "Checking work").
- The generated blocks in `shipyard.js` (`/* generated:... */` to `/* end:... */`) are not edited by hand. None of the `Math.pow` calls is inside one (they are at lines 1363, 2025 and 2031, after `/* end:guns */` at 1234).
- Browsers are installed with `npx playwright-core install ...`, never `npx playwright install ...`: the latter fetches the newest `playwright` package, whose browser builds do not match the `playwright-core` version in `package-lock.json`.
- Commit messages follow the repo's style (a sentence in the imperative, no prefix) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **A browser that will not start** must fail `npm run determinism`, never be skipped quietly. A missing WebKit is the likeliest way for the test to pass while proving nothing. Pinned in Task 2, Step 5.
- **The comparison must be able to fail.** A harness that compares a result with itself, or compares the wrong fields, passes forever. `determinism.mjs` tampers with a copy of Node's result and fails if it cannot see the change. Pinned in Task 2, Step 3.
- **A ship dead in the water.** Distances of zero, `atan2(0, 0)`, `atan2(-0, -x)`, `pow(0, curve)` for a rudder at rest: the signs of zero and the exact values must match `Math`, or a stationary ship turns a different way. Pinned in Task 1's edge table.
- **An angle wound up large.** If a heading ever escapes `norm()` and grows, `sin` and `cos` must stay finite and on the unit circle rather than going NaN and poisoning the world. Pinned in Task 1.
- **The menu's hull art.** `hullform.js` also draws the menu's ship. Moving it to `exact.pow` changes results in the last bit only, which must not visibly move the galleon. Pinned in Task 3, Step 8 (the smoke test's screenshots and a look at the menu).

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `src/exact.js` | Create | The exact maths. Imports nothing. |
| `tools/exact-test.mjs` | Create | `npm run exact-test`: `exact.js` against `Math` in Node, and its edge values. |
| `tools/rounds.js` | Create | The recorded rounds, `dump`, `fingerprint`, the scripted captains. Loads in Node and in a page. |
| `tools/determinism.mjs` | Create | `npm run determinism`: serves the source, sails `rounds.js` in each browser, compares with Node. |
| `tools/sim-test.mjs` | Modify | Imports `dump`, `idle`, `drive`, `SHIPS`, `MODES`, `LIMIT` from `rounds.js` instead of defining them. |
| `tools/purity.mjs` | Modify | Allows `exact.js`, checks it, bans the inexact `Math` functions and `**`. |
| `src/sim/ai.js`, `ram.js`, `ships.js`, `storm.js`, `weapons.js`, `world.js` | Modify | `Math.x(` becomes `exact.x(`. |
| `src/shipyard.js`, `src/hullform.js` | Modify | The same, for `pow`. |
| `tools/inputlog.mjs` | Create | Measures what a 20-minute round's input log weighs, for the spec's open question. |
| `package.json` | Modify | `exact-test`, `determinism`, `inputlog` scripts. |
| `.github/workflows/deploy.yml` | Modify | Runs `exact-test` and `determinism` before the build. |
| `CLAUDE.md`, `docs/ENGINE.md` | Modify | The purity rule, the `shipyard.js` import rule, and "Checking work". |
| `docs/superpowers/specs/2026-10-13-accounts-and-server-hold-design.md` | Modify | Corrects two lines (see Task 3, Step 10) and fills in the input log figure (Task 5). |

---

### Task 1: The exact maths

**Files:**
- Create: `src/exact.js`
- Create: `tools/exact-test.mjs`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces: `src/exact.js` exporting `sin(x)`, `cos(x)`, `atan(x)`, `atan2(y, x)`, `asin(x)`, `exp(x)`, `log(x)`, `pow(x, y)`, `hypot(a, b)`, every one `(number...) => number`. `hypot` takes exactly two arguments. Callers import it as a namespace: `import * as exact from "../exact.js"`.

- [ ] **Step 1: Write the failing test**

Create `tools/exact-test.mjs`:

```js
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
```

In `package.json`, add to `"scripts"` after `"sim-test"`:

```json
    "exact-test": "node tools/exact-test.mjs",
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run exact-test`
Expected: FAIL with `Cannot find module '.../src/exact.js'`.

- [ ] **Step 3: Write `src/exact.js`**

```js
/**
 * EXACT MATHS: the functions JavaScript lets every engine round its own way, done one way.
 *
 * `+ - * /`, `%` and `Math.sqrt` give the same bits in every JavaScript engine, because IEEE 754 fixes
 * them. `Math.sin`, `cos`, `atan2`, `asin`, `exp`, `log`, `pow` and `hypot` are only required to be
 * close, and Safari, Chrome, Firefox and Node are free to differ in the last bit. One differing bit
 * in a heading is a different round twenty seconds later, and a round the server replays has to end
 * where the captain saw it end. So the engine, and the catalogue maths it reads, call these instead,
 * and `npm run purity` keeps them off the built-ins.
 *
 * sin, cos, atan, atan2, asin, exp and log are ports of Sun's fdlibm 5.3, the library most engines'
 * maths descend from, within 1 unit in the last place of the built-ins. Two simplifications, both
 * deterministic: sin and cos reduce their argument with the three-part Cody-Waite slices of pi/2 at
 * every size, wrapping by a whole turn first past 2^19 quarter turns, where fdlibm switches to a
 * table no angle in a round reaches; and pow multiplies out a small whole power and is
 * `exp(y * log(x))` otherwise. hypot is `sqrt(a*a + b*b)`, for two arguments only: the engine measures
 * distances on a flat sea, and nowhere near the size where the plain formula overflows.
 *
 * It imports nothing and touches nothing of the page, so the catalogue can import it.
 */

const view = new DataView(new ArrayBuffer(8));
const hiWord = (x) => { view.setFloat64(0, x); return view.getInt32(0); };
const loWord = (x) => { view.setFloat64(0, x); return view.getUint32(4); };
const fromWords = (h, l) => { view.setInt32(0, h); view.setUint32(4, l); return view.getFloat64(0); };
const withHi = (x, h) => { view.setFloat64(0, x); view.setInt32(0, h); return view.getFloat64(0); };
const clearLo = (x) => { view.setFloat64(0, x); view.setUint32(4, 0); return view.getFloat64(0); };

const HUGE = 1e300;
const TINY = 1e-300;

// ---- sin and cos ----------------------------------------------------------------------------------

const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04;
const S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;

function kernelSin(x, y, iy) {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix < 0x3e400000 && (x | 0) === 0) return x;
  const z = x * x, v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05;
const C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;

function kernelCos(x, y) {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix < 0x3e400000 && (x | 0) === 0) return 1;
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));
  const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0);
  const hz = 0.5 * z - qx;
  const a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

const INVPIO2 = 6.36619772367581382433e-01;
const PIO2_1 = 1.57079632673412561417e+00, PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11, PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21, PIO2_3T = 8.47842766036889956997e-32;
const TWO_PI = 6.28318530717958647692e+00;

// x reduced by a whole number n of quarter turns, as y0 + y1 with |y0 + y1| <= pi/4. Returns n.
let y0 = 0, y1 = 0;
function remPio2(x) {
  const hx = hiWord(x), ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) { y0 = x; y1 = 0; return 0; }
  if (ix < 0x4002d97c) { // |x| < 3pi/4, one quarter turn either way
    if (hx > 0) {
      let z = x - PIO2_1;
      if (ix !== 0x3ff921fb) { y0 = z - PIO2_1T; y1 = (z - y0) - PIO2_1T; }
      else { z -= PIO2_2; y0 = z - PIO2_2T; y1 = (z - y0) - PIO2_2T; }
      return 1;
    }
    let z = x + PIO2_1;
    if (ix !== 0x3ff921fb) { y0 = z + PIO2_1T; y1 = (z - y0) + PIO2_1T; }
    else { z += PIO2_2; y0 = z + PIO2_2T; y1 = (z - y0) + PIO2_2T; }
    return -1;
  }
  // Past 2^19 quarter turns the slices of pi/2 run out of bits; wrap by a whole turn first. `%` is
  // exact in every engine, so this is deterministic, and no angle in a round comes near it.
  const t0 = ix > 0x413921fb ? Math.abs(x) % TWO_PI : Math.abs(x);
  const n = Math.floor(t0 * INVPIO2 + 0.5);
  let r = t0 - n * PIO2_1;
  let w = n * PIO2_1T;
  const j = hiWord(t0) >> 20;
  y0 = r - w;
  let i = j - ((hiWord(y0) >> 20) & 0x7ff);
  if (i > 16) { // cancellation: a second, finer slice of pi/2
    let t = r;
    w = n * PIO2_2; r = t - w; w = n * PIO2_2T - ((t - r) - w); y0 = r - w;
    i = j - ((hiWord(y0) >> 20) & 0x7ff);
    if (i > 49) { // and a third
      t = r;
      w = n * PIO2_3; r = t - w; w = n * PIO2_3T - ((t - r) - w); y0 = r - w;
    }
  }
  y1 = (r - y0) - w;
  if (hx < 0) { y0 = -y0; y1 = -y1; return -n; }
  return n;
}

export function sin(x) {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelSin(x, 0, 0);
  if (ix >= 0x7ff00000) return x - x;
  switch (remPio2(x) & 3) {
    case 0: return kernelSin(y0, y1, 1);
    case 1: return kernelCos(y0, y1);
    case 2: return -kernelSin(y0, y1, 1);
    default: return -kernelCos(y0, y1);
  }
}

export function cos(x) {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelCos(x, 0);
  if (ix >= 0x7ff00000) return x - x;
  switch (remPio2(x) & 3) {
    case 0: return kernelCos(y0, y1);
    case 1: return -kernelSin(y0, y1, 1);
    case 2: return -kernelCos(y0, y1);
    default: return kernelSin(y0, y1, 1);
  }
}

// ---- atan and atan2 -------------------------------------------------------------------------------

const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01,
  -1.11111104054623557880e-01, 9.09088713343650656196e-02, -7.69187620504482999495e-02,
  6.66107313738753120669e-02, -5.83357013379057348645e-02, 4.97687799461593236017e-02,
  -3.65315727442169155270e-02, 1.62858201153657823623e-02,
];

export function atan(x) {
  const hx = hiWord(x), ix = hx & 0x7fffffff;
  let id;
  if (ix >= 0x44100000) { // |x| >= 2^66
    if (ix > 0x7ff00000 || (ix === 0x7ff00000 && loWord(x) !== 0)) return x + x;
    return hx > 0 ? ATANHI[3] + ATANLO[3] : -ATANHI[3] - ATANLO[3];
  }
  if (ix < 0x3fdc0000) { // |x| < 0.4375
    if (ix < 0x3e200000 && HUGE + x > 1) return x;
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) { id = 0; x = (2 * x - 1) / (2 + x); }
      else { id = 1; x = (x - 1) / (x + 1); }
    } else if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (1 + 1.5 * x); }
    else { id = 3; x = -1 / x; }
  }
  const z = x * x, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const r = ATANHI[id] - ((x * (s1 + s2) - ATANLO[id]) - x);
  return hx < 0 ? -r : r;
}

const PI = 3.1415926535897931160e+00, PI_LO = 1.2246467991473531772e-16;
const PI_O_2 = 1.5707963267948965580e+00, PI_O_4 = 7.8539816339744827900e-01;

export function atan2(y, x) {
  const hx = hiWord(x), ix = hx & 0x7fffffff, lx = loWord(x);
  const hy = hiWord(y), iy = hy & 0x7fffffff, ly = loWord(y);
  if (x !== x || y !== y) return x + y;
  if (((hx - 0x3ff00000) | lx) === 0) return atan(y); // x is 1
  const m = ((hy >> 31) & 1) | ((hx >> 30) & 2); // 2 * sign(x) + sign(y)
  if ((iy | ly) === 0) {
    if (m < 2) return y;
    return m === 2 ? PI + TINY : -PI - TINY;
  }
  if ((ix | lx) === 0) return hy < 0 ? -PI_O_2 - TINY : PI_O_2 + TINY;
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) return [PI_O_4 + TINY, -PI_O_4 - TINY, 3 * PI_O_4 + TINY, -3 * PI_O_4 - TINY][m];
    return [0, -0, PI + TINY, -PI - TINY][m];
  }
  if (iy === 0x7ff00000) return hy < 0 ? -PI_O_2 - TINY : PI_O_2 + TINY;
  const k = (iy - ix) >> 20;
  let z;
  if (k > 60) z = PI_O_2 + 0.5 * PI_LO;
  else if (hx < 0 && k < -60) z = 0;
  else z = atan(Math.abs(y / x));
  switch (m) {
    case 0: return z;
    case 1: return -z;
    case 2: return PI - (z - PI_LO);
    default: return (z - PI_LO) - PI;
  }
}

// ---- asin -----------------------------------------------------------------------------------------

const PIO2_HI = 1.57079632679489655800e+00, PIO2_LO = 6.12323399573676603587e-17, PIO4_HI = 7.85398163397448278999e-01;
const PS0 = 1.66666666666666657415e-01, PS1 = -3.25565818622400915405e-01, PS2 = 2.01212532134862925881e-01;
const PS3 = -4.00555345006794114027e-02, PS4 = 7.91534994289814532176e-04, PS5 = 3.47933107596021167570e-05;
const QS1 = -2.40339491173441421878e+00, QS2 = 2.02094576023350569471e+00, QS3 = -6.88283971605453293030e-01;
const QS4 = 7.70381505559019352791e-02;

export function asin(x) {
  const hx = hiWord(x), ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) { // |x| >= 1
    if (((ix - 0x3ff00000) | loWord(x)) === 0) return x * PIO2_HI + x * PIO2_LO;
    return NaN;
  }
  if (ix < 0x3fe00000) { // |x| < 0.5
    if (ix < 0x3e400000 && HUGE + x > 1) return x;
    const t = x * x;
    const p = t * (PS0 + t * (PS1 + t * (PS2 + t * (PS3 + t * (PS4 + t * PS5)))));
    const q = 1 + t * (QS1 + t * (QS2 + t * (QS3 + t * QS4)));
    return x + x * (p / q);
  }
  const t = (1 - Math.abs(x)) * 0.5;
  const p = t * (PS0 + t * (PS1 + t * (PS2 + t * (PS3 + t * (PS4 + t * PS5)))));
  const q = 1 + t * (QS1 + t * (QS2 + t * (QS3 + t * QS4)));
  const s = Math.sqrt(t);
  let r;
  if (ix >= 0x3fef3333) { // |x| > 0.975
    r = PIO2_HI - (2 * (s + s * (p / q)) - PIO2_LO);
  } else {
    const w = clearLo(s);
    const c = (t - w * w) / (s + w);
    const pp = 2 * s * (p / q) - (PIO2_LO - 2 * c);
    const qq = PIO4_HI - 2 * w;
    r = PIO4_HI - (pp - qq);
  }
  return hx > 0 ? r : -r;
}

// ---- exp and log ----------------------------------------------------------------------------------

const O_THRESHOLD = 7.09782712893383973096e+02, U_THRESHOLD = -7.45133219101941108420e+02;
const LN2_HI = 6.93147180369123816490e-01, LN2_LO = 1.90821492927058770002e-10, INVLN2 = 1.44269504088896338700e+00;
const P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05;
const P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08;
const TWOM1000 = 9.33263618503218878990e-302;

export function exp(x) {
  let hx = hiWord(x);
  const xsb = (hx >>> 31) & 1;
  hx &= 0x7fffffff;
  if (hx >= 0x40862e42) { // |x| >= 709.78
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | loWord(x)) !== 0) return x + x;
      return xsb === 0 ? x : 0;
    }
    if (x > O_THRESHOLD) return Infinity;
    if (x < U_THRESHOLD) return 0;
  }
  let hi = 0, lo = 0, k = 0;
  if (hx > 0x3fd62e42) { // |x| > 0.5 ln2
    if (hx < 0x3ff0a2b2) { // and < 1.5 ln2
      hi = xsb ? x + LN2_HI : x - LN2_HI;
      lo = xsb ? -LN2_LO : LN2_LO;
      k = xsb ? -1 : 1;
    } else {
      k = (INVLN2 * x + (xsb ? -0.5 : 0.5)) | 0;
      hi = x - k * LN2_HI;
      lo = k * LN2_LO;
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) { // |x| < 2^-28
    if (HUGE + x > 1) return 1 + x;
  }
  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2) - x);
  const y = 1 - ((lo - (x * c) / (2 - c)) - hi);
  if (k >= -1021) return withHi(y, hiWord(y) + (k << 20));
  return withHi(y, hiWord(y) + ((k + 1000) << 20)) * TWOM1000;
}

const TWO54 = 1.80143985094819840000e+16;
const LG1 = 6.666666666666735130e-01, LG2 = 3.999999999940941908e-01, LG3 = 2.857142874366239149e-01;
const LG4 = 2.222219843214978396e-01, LG5 = 1.818357216161805012e-01, LG6 = 1.531383769920937332e-01;
const LG7 = 1.479819860511658591e-01;

export function log(x) {
  let hx = hiWord(x);
  const lx = loWord(x);
  let k = 0;
  if (hx < 0x00100000) { // x < 2^-1022
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54; x *= TWO54; hx = hiWord(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  x = withHi(x, hx | (i ^ 0x3ff00000)); // x or x/2 brought into [sqrt(2)/2, sqrt(2))
  k += i >> 20;
  const f = x - 1;
  const dk = k;
  if ((0x000fffff & (2 + hx)) < 3) { // -2^-20 <= f < 2^-20
    if (f === 0) return k === 0 ? 0 : dk * LN2_HI + dk * LN2_LO;
    const R = f * f * (0.5 - 0.33333333333333333 * f);
    if (k === 0) return f - R;
    return dk * LN2_HI - ((R - dk * LN2_LO) - f);
  }
  const s = f / (2 + f);
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * LN2_HI - ((hfsq - (s * (hfsq + R) + dk * LN2_LO)) - f);
  }
  if (k === 0) return f - s * (f - R);
  return dk * LN2_HI - ((s * (f - R) - dk * LN2_LO) - f);
}

// ---- pow and hypot --------------------------------------------------------------------------------

/**
 * x to the y. A small whole power is multiplied out, which is both closer and the common case in the
 * catalogue (a sail's fade by berth, a port's taper by tier); everything else is exp(y log x), whose
 * error grows with |y ln x| and is a few units in the last place over the range the catalogue uses.
 * A negative x is defined only for a whole y, as `Math.pow` has it.
 */
export function pow(x, y) {
  if (y === 0) return 1;
  if (x !== x || y !== y) return NaN;
  if (y === 1) return x;
  if (y === Infinity || y === -Infinity) {
    const a = Math.abs(x);
    if (a === 1) return NaN;
    return (a > 1) === (y > 0) ? Infinity : 0;
  }
  if (Number.isInteger(y) && Math.abs(y) <= 64) {
    let n = Math.abs(y), b = x, r = 1;
    while (n > 0) { if (n & 1) r *= b; b *= b; n >>= 1; }
    return y < 0 ? 1 / r : r;
  }
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (x < 0) {
    if (!Number.isInteger(y)) return NaN;
    const r = exp(y * log(-x));
    return y % 2 === 0 ? r : -r;
  }
  return exp(y * log(x));
}

/** The length of (a, b). Two arguments only: the engine measures distances on a flat sea. */
export const hypot = (a, b) => Math.sqrt(a * a + b * b);
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npm run exact-test`
Expected: every line `ok`, ending `The exact maths are right.` The worst figures seen while this plan was written were 1 ulp for the seven fdlibm ports, under 32 for `pow` and 2 for `hypot`.

- [ ] **Step 5: Commit**

```bash
git add src/exact.js tools/exact-test.mjs package.json
git commit -m "Add exact maths that every JavaScript engine computes to the same bits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The recorded rounds and the determinism test

**Files:**
- Create: `tools/rounds.js`
- Create: `tools/determinism.mjs`
- Modify: `tools/sim-test.mjs:26-68` (the imports, `LIMIT`, `MODES`, `SHIPS`, `idle`, `drive` and `dump` move to `rounds.js`)
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `src/exact.js` from Task 1 (`exact.sin`, `exact.cos` for the wandering captain; all nine in `vectors()`).
- Produces: `tools/rounds.js` exporting `LIMIT`, `MODES`, `SHIPS`, `idle`, `drive`, `wander`, `ROUNDS`, `dump(value) => string`, `fingerprint(text) => string` (8 hex digits), `playRound(round, index) => { name, ticks, checkpoints: string[], final: string }`, `vectors() => string`, `playAll() => { vectors, rounds }`. `npm run determinism [engine...]` exits 0 only when every named engine (all three by default) matches Node.

- [ ] **Step 1: Write `tools/rounds.js`**

```js
/**
 * THE RECORDED ROUNDS — what `npm run determinism` sails in every engine, and `sim-test` in Node.
 *
 * A round the server replays has to come out of the replay exactly as the captain sailed it, in
 * whichever browser she sailed it. This file is the set of rounds that proves it: every mode, in the
 * starter's gundalow and in the fully found first rate, under three pairs of hands (none, the stick
 * held hard over with every gun going, and a stick that wanders the whole compass), and one
 * free-for-all with four captains. Each is fingerprinted every ten seconds of round and once whole
 * at the end, so two engines that part company can say when they did.
 *
 * It runs unchanged in Node and in a browser page, so it imports only the engine, the catalogue and
 * the exact maths, and every file it reaches has to load as a plain ES module.
 */

import { createWorld, step, NO_INPUT } from "../src/sim/index.js";
import { STARTER, resolve, ladder } from "../src/shipyard.js";
import * as exact from "../src/exact.js";

// Seconds of round before one that has not ended is given up on. An hour, because the ladder is
// the longest round in the game and a fully found first rate can take twenty minutes to climb
// part of it, and a round in Node costs about a second for every twenty minutes of it.
export const LIMIT = 3600;
export const MODES = ["ffa", "derby", "wave", "ladder"];
// Ticks between fingerprints: ten seconds of round.
const CHECK = 600;

export const SHIPS = {
  gundalow: resolve(STARTER),
  "first rate": ladder()[ladder().length - 1].loadout,
};

/** The scripted captains: hands off; hard over with every gun going and a repair now and then; adrift on a wandering stick. */
export const idle = () => NO_INPUT;
export const drive = (tick) => ({
  joyMag: 1, joyAng: -0.8, broadside: true, bow: true, musket: true,
  repair: tick % 160 === 0 ? (tick % 320 === 0 ? "hull" : "mast") : null,
});
export const wander = (tick) => ({
  joyMag: 0.5 + 0.5 * exact.cos(tick / 61),
  joyAng: 3 * exact.sin(tick / 97),
  broadside: tick % 240 < 30, bow: tick % 420 < 20, musket: tick % 90 < 10,
  repair: tick % 900 === 450 ? "hull" : null,
});
const HANDS = { idle, driven: drive, wandering: wander };

export const ROUNDS = [
  ...MODES.flatMap((mode) => Object.keys(SHIPS).flatMap((ship) => Object.keys(HANDS).map((hands) => ({ mode, ship, hands, captains: 1 })))),
  { mode: "ffa", ship: "gundalow", hands: "wandering", captains: 4 },
];

/**
 * A world written out in full, the same way every time it is written: a ship or anything else met
 * a second time is written as a reference to where it was first met, and a Map as its entries. Two
 * worlds that write out the same are the same world down to the last bit of every float, because
 * JavaScript writes a number as the shortest text that reads back as exactly that number.
 */
export function dump(value) {
  const seen = new Map();
  const walk = (v, path) => {
    if (v === null || typeof v !== "object") return typeof v === "number" && !Number.isFinite(v) ? String(v) : v;
    if (seen.has(v)) return { ref: seen.get(v) };
    seen.set(v, path);
    if (v instanceof Map) return { map: [...v.entries()].map(([k, x], i) => [walk(k, `${path}.k${i}`), walk(x, `${path}.v${i}`)]) };
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`));
    const out = {};
    for (const k of Object.keys(v)) out[k] = walk(v[k], `${path}.${k}`);
    return out;
  };
  return JSON.stringify(walk(value, "$"));
}

/** 32-bit FNV-1a of a string, as eight hex digits. Short enough to print, and any changed bit changes it. */
export function fingerprint(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** One recorded round, sailed to its end: its name, how long it ran, and its fingerprints. */
export function playRound(round, index) {
  const players = Array.from({ length: round.captains }, (_, i) => ({ id: `p${i + 1}`, loadout: SHIPS[round.ship] }));
  const world = createWorld({ mode: round.mode, seed: 1000 + index * 37, players });
  const hands = HANDS[round.hands];
  const checkpoints = [];
  while (!world.result.over && world.time < LIMIT) {
    const inputs = {};
    players.forEach((p, i) => { inputs[p.id] = hands(world.tick + i * 211); });
    step(world, inputs);
    if (world.tick % CHECK === 0) checkpoints.push(fingerprint(dump(world.ships)));
  }
  const name = `${round.mode} ${round.ship} ${round.hands}${round.captains > 1 ? `, ${round.captains} captains` : ""}`;
  return { name, ticks: world.tick, checkpoints, final: fingerprint(dump(world)) };
}

/** The exact maths alone, over a fixed stream of inputs, as one fingerprint. */
export function vectors() {
  let s = 7;
  const next = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
  const out = [];
  for (let i = 0; i < 20000; i++) {
    const x = (next() - 0.5) * 2000, y = (next() - 0.5) * 2000, u = next();
    out.push(exact.sin(x), exact.cos(x), exact.atan2(y, x), exact.asin(u * 2 - 1), exact.exp(x / 3),
      exact.log(u * 1e4), exact.pow(u * 9, x / 400), exact.hypot(x, y));
  }
  return fingerprint(out.join(","));
}

/** Everything `npm run determinism` compares between engines. */
export function playAll() {
  return { vectors: vectors(), rounds: ROUNDS.map(playRound) };
}
```

- [ ] **Step 2: Point `sim-test` at it**

In `tools/sim-test.mjs`, replace the two import lines (26-27) and delete the definitions that moved: `LIMIT` and its comment (28-32), `MODES` (33), `SHIPS` (38-41), `idle` and `drive` with their doc comment (43-48), and `dump` with its doc comment (50-68). Keep `failures`, `fail`, `ok`, `FIGURES` and everything from `sail` down. The new imports:

```js
import { createWorld, step, voyageStats, repairQuote, shipOf, NO_INPUT, TICK } from "../src/sim/index.js";
import { LIMIT, MODES, SHIPS, idle, drive, dump } from "./rounds.js";
```

Line numbers are as of commit `796a9ea`; check them against the file before deleting, and delete by content.

Run: `npm run sim-test`
Expected: the same `ok` lines as before the change, ending `A world takes several captains.`

- [ ] **Step 3: Write `tools/determinism.mjs`**

```js
/**
 * THE DETERMINISM TEST — `npm run determinism`
 *
 * The server will replay a captain's voyage from its seed and her inputs and bank what its own
 * replay says, so a round has to come out the same, to the last bit, in Node and in every browser
 * she might sail it in. This sails the recorded rounds in `tools/rounds.js` in Node, then in
 * Chromium, WebKit (Safari's engine) and Firefox through `playwright-core`, and fails unless every
 * engine's fingerprints match Node's. When a round parts company it says at which ten seconds.
 *
 * It fails as well if a browser will not start, because a test that skips the engine most likely to
 * differ has told nobody anything. Name engines to run only those: `npm run determinism webkit`.
 * The browsers come from `npx playwright-core install chromium-headless-shell webkit firefox`.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit, firefox } from "playwright-core";
import { playAll } from "./rounds.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINES = { chromium, webkit, firefox };
const asked = process.argv.slice(2);
for (const name of asked) if (!ENGINES[name]) { console.log(`no engine called ${name}; there are ${Object.keys(ENGINES).join(", ")}`); process.exit(1); }

const failures = [];
const fail = (what) => { failures.push(what); console.log("  FAIL  " + what); };
const ok = (what) => console.log("  ok    " + what);

/** Every way `theirs` differs from Node's run, as lines; none means the same. */
function differences(mine, theirs) {
  const out = [];
  if (mine.vectors !== theirs.vectors) out.push("the exact maths give different bits");
  mine.rounds.forEach((m, i) => {
    const t = theirs.rounds[i];
    if (!t) { out.push(`${m.name}: not sailed`); return; }
    if (m.final === t.final && m.ticks === t.ticks) return;
    const at = m.checkpoints.findIndex((c, k) => c !== t.checkpoints[k]);
    const when = at < 0 ? `in the last ten seconds (ended at tick ${t.ticks}, Node at ${m.ticks})` : `by ${(at + 1) * 10} s`;
    out.push(`${m.name}: parts company with Node ${when}`);
  });
  return out;
}

// The page the rounds run in, and the engine's own files served as they are, as plain ES modules.
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (path === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end("<!doctype html><title>determinism</title>"); return; }
  if (!/^\/(src|tools)\/[\w/.-]+\.js$/.test(path) || path.includes("..")) { res.writeHead(404); res.end(); return; }
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

let t0 = Date.now();
const mine = playAll();
console.log(`node ${process.version}: ${mine.rounds.length} rounds in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// The comparison has to be able to fail, or a pass means nothing: a copy with one fingerprint
// changed must come out different.
const tampered = structuredClone(mine);
tampered.rounds[0].final = "00000000";
if (!differences(mine, tampered).length) fail("the comparison cannot see a changed fingerprint");

for (const [name, type] of Object.entries(ENGINES)) {
  if (asked.length && !asked.includes(name)) continue;
  let browser;
  try {
    browser = await type.launch({ headless: true });
  } catch (e) {
    fail(`${name} would not start: ${e.message.split("\n")[0]}`);
    continue;
  }
  try {
    const page = await browser.newPage();
    await page.goto(origin + "/");
    t0 = Date.now();
    const theirs = await page.evaluate(async () => (await import("/tools/rounds.js")).playAll());
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const diff = differences(mine, theirs);
    if (diff.length) for (const d of diff) fail(`${name} ${browser.version()}: ${d}`);
    else ok(`${name} ${browser.version()}: all ${mine.rounds.length} rounds and the maths match Node, to the bit (${secs} s)`);
  } catch (e) {
    fail(`${name}: ${e.message.split("\n")[0]}`);
  } finally {
    await browser.close();
  }
}
server.close();

if (failures.length) {
  console.log(`\n${failures.length} FAILURE${failures.length === 1 ? "" : "S"}`);
  process.exit(1);
}
console.log("\nEvery engine sails the same round.\n");
```

In `package.json`, add to `"scripts"`:

```json
    "determinism": "node tools/determinism.mjs",
```

- [ ] **Step 4: Install the browsers and run it against today's engine**

Run: `npx playwright-core install chromium-headless-shell webkit firefox`, then `npm run determinism`.

Expected: `node v...: 25 rounds in ...`, then FAIL lines: **every one of the 25 rounds parts company with Node by 10 s, in all three browsers, Chromium included** (75 failures). That is what this plan found when it was written, with Node 22.17 against Chromium 153, WebKit 26.6 and Firefox 155: Chromium's V8 is not Node's V8, and the engine still calls the built-in `Math`. **The exact maths must match in all three** (no `the exact maths give different bits` line); if they do not, stop and report it, because Task 3 cannot fix that. Summarise the result in the commit message (for example "before the engine moves: all 25 rounds part with Node in Chromium 153, WebKit 26.6 and Firefox 155 by 10 s; the exact maths match in all three").

- [ ] **Step 5: Check that a missing browser fails**

Run: `PLAYWRIGHT_BROWSERS_PATH=/nonexistent npm run determinism webkit; echo "exit $?"`
Expected: `FAIL  webkit would not start: ...` and `exit 1`.

- [ ] **Step 6: Commit**

```bash
git add tools/rounds.js tools/determinism.mjs tools/sim-test.mjs package.json
git commit -m "Sail recorded rounds in Chromium, WebKit and Firefox and compare them with Node

<the one-line summary of Step 4's result>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Move the engine onto the exact maths

**Files:**
- Modify: `tools/purity.mjs`
- Modify: `src/sim/ai.js`, `src/sim/ram.js`, `src/sim/ships.js`, `src/sim/storm.js`, `src/sim/weapons.js`, `src/sim/world.js`
- Modify: `src/shipyard.js`, `src/hullform.js`
- Modify: `CLAUDE.md`, `docs/ENGINE.md`
- Modify: `docs/superpowers/specs/2026-10-13-accounts-and-server-hold-design.md`

**Interfaces:**
- Consumes: `src/exact.js` (Task 1) and `npm run determinism` (Task 2).
- Produces: an engine whose `npm run determinism` passes in all three browsers, and a purity check that keeps it that way.

- [ ] **Step 1: Make purity refuse the inexact functions**

In `tools/purity.mjs`:

Replace the `PURE` line with:

```js
const PURE = ["shipyard.js", "shipref.js", "hullform.js", "exact.js"].map((f) => join(root, "src", f));
```

Add two entries at the end of `FORBIDDEN`:

```js
  [/\bMath\s*\.\s*(?:sin|cos|tan|asin|acos|atan2?|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log1p|log2|log10|pow|hypot|cbrt)\b/, "a Math function engines may round differently (use src/exact.js)"],
  [/\*\*/, "the ** operator (use exact.pow)"],
```

`check()` reports only the first match of each pattern in a file, which is enough to fail; to list every site at once, change the loop over `FORBIDDEN` in `check()` to:

```js
  for (const [re, name] of FORBIDDEN) {
    for (const m of text.matchAll(new RegExp(re.source, "g"))) failures.push(`${at(file, text, m.index)} mentions ${name}`);
  }
```

Update the doc comment at the top of the file: in the first rule, the allowed imports become "another file under `src/sim/` or one of the modules that are already pure (`shipyard.js`, `shipref.js`, `hullform.js` and `exact.js`)"; add a third rule after the second:

```
 *   calls a `Math` function that JavaScript lets each engine round its own way (`sin`, `cos`,
 *   `atan2`, `exp`, `log`, `pow`, `hypot` and the rest) or uses `**`, because the server replays a
 *   round and has to get the bits the captain's browser got. `src/exact.js` has them done one way.
```

and change "The three catalogue modules are held to the same two rules" to "The catalogue modules and the exact maths are held to the same rules".

- [ ] **Step 2: Run purity to see it fail**

Run: `npm run purity`
Expected: FAIL, listing every `Math.sin`, `cos`, `atan2`, `asin`, `exp`, `log`, `pow` and `hypot` in `src/sim/ai.js`, `ram.js`, `ships.js`, `storm.js`, `weapons.js`, `world.js`, `src/shipyard.js` and `src/hullform.js` (about 90 lines), and nothing in `src/exact.js` (its comments mention `Math.sin`, and comments are skipped).

- [ ] **Step 3: Replace the calls**

Run, from the repo root:

```bash
perl -pi -e 's/\bMath\.(sin|cos|atan2|asin|exp|log|pow|hypot)\(/exact.$1(/g' \
  src/sim/ai.js src/sim/ram.js src/sim/ships.js src/sim/storm.js src/sim/weapons.js src/sim/world.js \
  src/shipyard.js src/hullform.js
```

Then add the import to each of those files. In the six under `src/sim/`, put it after the file's last `import` line:

```js
import * as exact from "../exact.js";
```

In `src/hullform.js`, after `import { HULL_REF } from "./shipref.js";`:

```js
import * as exact from "./exact.js";
```

`src/shipyard.js` has no imports today. Put this as the first line after its opening doc comment, before the first declaration:

```js
import * as exact from "./exact.js";
```

Check that nothing in those files already uses `exact` as a name: `grep -nwE "(const|let|var|function) exact|exact =" src/sim/*.js src/shipyard.js src/hullform.js` must print nothing.

- [ ] **Step 4: Run purity to see it pass**

Run: `npm run purity`
Expected: `purity: 13 engine files and 4 catalogue modules are clean`.

- [ ] **Step 5: Run the engine's own tests**

Run: `npm run sim-test`
Expected: every line `ok`. Rounds end at different times and in different ways from before this task, because headings now differ in the last bit; that is expected. What must not happen is a `FAIL`.

Run: `npm run catalogue`
Expected: it passes. Figures printed to a few decimals should be unchanged or move in the last digit at most.

- [ ] **Step 6: Run the determinism test**

Run: `npm run determinism`
Expected: three `ok` lines, `all 25 rounds and the maths match Node, to the bit`, and `Every engine sails the same round.` (This plan's code was run this way on a copy of the repo before it was written down, and all three matched.)

If a browser still parts company, the engine reaches an inexact operation that purity does not catch. Find it by printing the first differing checkpoint's ships from Node and that browser (temporarily return `dump(world.ships)` rather than its fingerprint from `playRound` for that round) and diffing the two. Fix it at its source in the same way, and add its pattern to `FORBIDDEN` in `purity.mjs` so it cannot come back.

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: Vite builds with no errors.

- [ ] **Step 8: Look at the menu's ship**

`hullform.js` draws the menu's rotating ship as well, and its `pow` calls now come from `exact.js`. Run `npm run smoke` (it needs the Chromium installed in Task 2) and look at its menu screenshots, and open the game with `npm run dev` to look at the menu plate with the galleon and with a first rate. The ships must look exactly as they did. Any visible change means a call was replaced wrongly, not that the maths moved.

- [ ] **Step 9: Write the rule down**

In `CLAUDE.md`, in the bullet that begins "**The engine is pure, and `npm run purity` says so.**", replace its first two sentences with:

```
- **The engine is pure, and `npm run purity` says so.** Nothing under `src/sim/` imports anything but
  itself, `shipyard.js`, `shipref.js`, `hullform.js` and `exact.js`, or mentions `window`, `document`,
  `localStorage`, a canvas, `Math.random`, `Date.now` or `performance`. Nor does it, or the catalogue
  modules it reads, call a `Math` function JavaScript lets each engine round its own way (`sin`,
  `cos`, `atan2`, `asin`, `exp`, `log`, `pow`, `hypot` and the rest) or use `**`: those come from
  `src/exact.js`, built from operations IEEE 754 fixes, so Node, Chromium, WebKit and Firefox step a
  round to the same bits, which is what will let the server replay a voyage and bank what really
  happened. `npm run determinism` sails the recorded rounds in all four and fails on a difference.
```

Keep the rest of that bullet ("That is what lets it run unchanged in Node, ...") as it is.

In the `shipyard.js` bullet, change "It holds no state, touches no storage and imports nothing, and it should stay that way." to "It holds no state, touches no storage and imports nothing but `exact.js`, and it should stay that way."

In "## Checking work", change the first paragraph's opening to: "A change to the engine runs `npm run sim-test` and `npm run determinism` before and after: the first plays every mode ..." and add, at the end of that paragraph: "The second sails the recorded rounds in `tools/rounds.js` in Node, Chromium, WebKit and Firefox and fails unless all four end every round on the same bits."

In `docs/ENGINE.md`, "## Purity": add `exact.js` to the allowed imports in the first paragraph, and add a paragraph after it:

```
Nor does the engine, or a catalogue module it imports, call `Math.sin`, `cos`, `atan2`, `asin`,
`exp`, `log`, `pow`, `hypot` or any other `Math` function JavaScript lets each engine round its own
way, or use `**`. `src/exact.js` has them built from `+ - * /`, `%` and `Math.sqrt`, which IEEE 754
fixes, so a round steps to the same bits in every browser and in Node. That is what lets the server
replay a voyage from its seed and its inputs. The renderer keeps the built-in `Math`: nothing it draws
is read back.
```

In "## Tests", add a bullet:

```
- `npm run determinism` sails the recorded rounds in `tools/rounds.js` (every mode, two ships, three
  pairs of hands, and a four-captain free-for-all) in Node, Chromium, WebKit and Firefox, and fails
  unless every engine's fingerprints match Node's, or if a browser will not start. `npm run
  exact-test` holds `src/exact.js` to the built-in `Math` it replaces.
```

- [ ] **Step 10: Correct the spec**

In `docs/superpowers/specs/2026-10-13-accounts-and-server-hold-design.md`, section "Making the round replay identically everywhere":

Replace the first bullet's parenthesis "(a port of the fdlibm routines V8 already uses, so Node's results do not move)" with "(ports of fdlibm, within 1 unit in the last place of the built-ins; current V8 no longer uses fdlibm for all of them, so Node's own results move in the last bit for under 1% of calls, and nothing depends on matching it)".

Replace "and in any function of `shipyard.js` or `hullform.js` the engine reaches" with "and in `shipyard.js` and `hullform.js` whole, which the engine imports".

- [ ] **Step 11: Commit**

```bash
git add tools/purity.mjs src/sim src/shipyard.js src/hullform.js CLAUDE.md docs/ENGINE.md docs/superpowers/specs/2026-10-13-accounts-and-server-hold-design.md
git commit -m "Step the round on exact maths, so every engine sails it to the same bits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Run both tests in CI

**Files:**
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: `npm run exact-test` (Task 1) and `npm run determinism` (Task 2), passing (Task 3).

- [ ] **Step 1: Add the steps**

In `.github/workflows/deploy.yml`, after the `- run: npm run sim-test` step and before `- run: npm run build`:

```yaml
      # the exact maths agree with the built-in ones they replace
      - run: npm run exact-test
      # every round ends on the same bits in Chromium, WebKit and Firefox as in Node, which is what
      # lets the server replay a voyage
      - run: npx playwright-core install --with-deps chromium-headless-shell webkit firefox
      - run: npm run determinism
```

- [ ] **Step 2: Check the workflow reads**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/deploy.yml','utf8'); if(!/npm run determinism/.test(y)||!/npm run exact-test/.test(y)) process.exit(1); console.log('ok')"`
Expected: `ok`.

Do not run this workflow by hand from the branch (`gh workflow run deploy.yml`): its deploy job would publish the branch to the live site. It is proved by the first run after merge. Until then, run the CI's exact commands locally on a clean install: `rm -rf node_modules && npm ci && npm run purity && npm run sim-test && npm run exact-test && npm run determinism && npm run build`. Expected: all pass. After the merge, check the run with `gh run watch` and look for `Every engine sails the same round.` in the determinism step's log.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "Run the exact maths test and the determinism test before every deploy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Measure what an input log weighs

The spec leaves open whether rounding the joystick keeps a 20-minute round's input log small enough to post. This measures it, so step 4 starts from a figure.

**Files:**
- Create: `tools/inputlog.mjs`
- Modify: `package.json` (scripts)
- Modify: `docs/superpowers/specs/2026-10-13-accounts-and-server-hold-design.md` ("Open questions")

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `npm run inputlog`, printing gzipped sizes. The rounding constant here is a figure for the spec; it moves into `src/input/controls.js` in step 4, not now.

- [ ] **Step 1: Write the measurement**

```js
/**
 * WHAT AN INPUT LOG WEIGHS — `npm run inputlog`
 *
 * The server will replay a voyage from the inputs the browser recorded, one entry for each tick the
 * input changed. This measures what a 20-minute round's log comes to, gzipped, under three captains:
 * one who holds a course and fires now and then, one who steers all the time, and the worst case,
 * a stick that moves every tick. The stick's angle and magnitude are rounded to 1/1024 of their
 * range first, which is the rounding the spec proposes for `controls.js`.
 */

import { gzipSync } from "node:zlib";

const TICKS = 20 * 60 * 60;
const STEPS = 1024;
const roundTo = (v, range) => Math.round((v / range) * STEPS) * (range / STEPS);

let s = 99;
const next = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;

// Each captain gives the stick and buttons at a tick; the log keeps only the ticks they change.
const CAPTAINS = {
  "holds a course": (t, prev) => ({ joyMag: t % 1800 < 1700 ? 1 : 0.6, joyAng: prev.joyAng + (t % 600 === 0 ? next() - 0.5 : 0), broadside: t % 300 < 6, bow: false, musket: false }),
  "steers all the time": (t, prev) => ({ joyMag: 1, joyAng: prev.joyAng + (t % 4 === 0 ? (next() - 0.5) * 0.05 : 0), broadside: t % 200 < 6, bow: t % 500 < 4, musket: t % 120 < 3 }),
  "moves every tick": (t, prev) => ({ joyMag: next(), joyAng: prev.joyAng + (next() - 0.5) * 0.1, broadside: next() < 0.05, bow: next() < 0.02, musket: next() < 0.05 }),
};

for (const [name, hands] of Object.entries(CAPTAINS)) {
  let prev = { joyMag: 0, joyAng: 0, broadside: false, bow: false, musket: false };
  let last = "";
  const log = [];
  for (let t = 0; t < TICKS; t++) {
    const raw = hands(t, prev);
    prev = raw;
    const input = { ...raw, joyMag: roundTo(Math.min(1, Math.max(0, raw.joyMag)), 1), joyAng: roundTo(raw.joyAng, 2 * Math.PI) };
    const key = JSON.stringify(input);
    if (key !== last) { log.push([t, input]); last = key; }
  }
  const json = JSON.stringify(log);
  const gz = gzipSync(json).length;
  console.log(`${name.padEnd(20)} ${String(log.length).padStart(6)} entries, ${(json.length / 1024).toFixed(0).padStart(5)} KB raw, ${(gz / 1024).toFixed(0).padStart(4)} KB gzipped`);
}
```

In `package.json`, add to `"scripts"`:

```json
    "inputlog": "node tools/inputlog.mjs",
```

- [ ] **Step 2: Run it**

Run: `npm run inputlog`
Expected: three lines of sizes. Copy them.

- [ ] **Step 3: Answer the open question in the spec**

In the spec's "Open questions", replace the "Input log size" bullet with what was measured, in the same voice, for example:

```
- **Input log size.** Measured with `npm run inputlog`: a 20-minute round under a captain who
  steers all the time logs <N> entries, <K> KB gzipped, and the worst case, a stick that moves
  every tick, <K> KB. <One sentence: whether that is fine to post at the end of a round, or whether
  the rounding should be coarser or the log sent in pieces during the round.>
```

Fill in the figures and the sentence from Step 2's output. When this plan was written the figures were 4 KB, 99 KB and 709 KB: the worst case is too heavy for one request at the end of a round, so the sentence should say the log goes up in pieces during the round (which also lets the server see the round's pace as it is played), with the rounding left at 1/1024. If your figures differ much from these, say what you found instead.

- [ ] **Step 4: Commit**

```bash
git add tools/inputlog.mjs package.json docs/superpowers/specs/2026-10-13-accounts-and-server-hold-design.md
git commit -m "Measure what a 20-minute round's input log weighs, and write it into the spec

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

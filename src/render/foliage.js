/**
 * THE PLANTING ON AN ISLAND: palms and bushes, how they are spaced, and how they are drawn.
 */

import { TILT } from "./view.js";
import { C } from "./palette.js";
import { random } from "../sim/rng.js";

// ---------------- island foliage ----------------
// Two species built from one blade primitive. Every fraction below is of the plant's canopy radius,
// and that radius is itself a fraction of the island radius — so a plant scales with the island it
// stands on, and an island is never a scaled-up version of a smaller one only because of its plants.
//
// These values are tuned, not derived. Keep them here rather than inline in the draw code.
export const PLANT = {
  // Canopy radius in screen px, the same on every island. It used to be a fraction of the island
  // radius, which made a palm on the biggest island four times the size of one on the smallest —
  // islands differed in the size of their trees rather than in how many they had. A fixed size says
  // a tree is a tree; the island is what changes.
  canopy: 9,
  scaleMin: 0.75,      // so an individual plant still varies: 6.75 to 12.15 px
  scaleMax: 1.35,

  fronds: 7,           // blades per crown
  frondLen: 1.06,
  frondWidth: 0.20,    // at the blade's widest
  arch: 0.20,          // rise at mid-blade, x blade length
  droop: 0.26,         // tip drop below the crown, x blade length
  wind: 0.20,          // bend amplitude

  trunkH: 1.85,
  trunkW: 0.30,        // base width; floored at 1.1 device px so it survives the small end
  taper: 0.58,         // top width / base width
  bow: 0.50,           // lean and curve, signed per plant

  palmRatio: 0.85,     // the rest are bushes
  minGap: 0.75,        // spacing, as a fraction of the two footprints summed
  scatter: 0.67,       // x island r

  // Count goes as the square of the radius, i.e. with island area, which is what holds the planting
  // at one density now that a plant is a fixed size. Linear count was right only while plants grew
  // with the island; against a fixed size it would leave a small island twice as densely planted as
  // a large one. countRef is the count at countRefR: 12 plants at r=58, 40 at r=105, 55 at r=124.
  countRef: 36,
  countRefR: 100,

  shadowSize: 0.42,
  shadowLean: 0.55,    // how far the shadow tracks the crown's offset from the base
  shadowOpa: 0.10,     // the soft outer pass is 0.40 of this
};

// quadratic bezier point and tangent
export function qp(t, a, b, c) {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]];
}
export function qd(t, a, b, c) {
  const u = 1 - t;
  return [2 * u * (b[0] - a[0]) + 2 * t * (c[0] - b[0]), 2 * u * (b[1] - a[1]) + 2 * t * (c[1] - b[1])];
}

// One tapered blade swept along a bezier that rises out of the crown and droops at the tip. `a` is
// the plan bearing; its y component is squashed by TILT so the crown foreshortens like everything
// else. bx/by bend the blade downwind and scale along t, so the root stays pinned at the crown and
// only the outer half travels — the trunk and the crown point never move.
export function frond(ctx, cx, cy, a, L, wMax, arch, droop, notch, steps, bx = 0, by = 0) {
  const dx = Math.cos(a) * L, dy = Math.sin(a) * L * TILT;
  const p0 = [cx, cy];
  const p1 = [cx + dx * 0.5 + bx * 0.30, cy + dy * 0.5 - arch * L + by * 0.30];
  const p2 = [cx + dx + bx, cy + dy + droop * L + by];
  const side = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = qp(t, p0, p1, p2), d = qd(t, p0, p1, p2);
    const m = Math.hypot(d[0], d[1]) || 1;
    let w = wMax * Math.sin(Math.PI * Math.pow(t, 0.8));
    if (notch && i % 2) w *= 0.52; // leaflet notches
    side.push([p, [-d[1] / m * w, d[0] / m * w]]);
  }
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  for (let i = 0; i <= steps; i++) ctx.lineTo(side[i][0][0] + side[i][1][0], side[i][0][1] + side[i][1][1]);
  for (let i = steps; i >= 0; i--) ctx.lineTo(side[i][0][0] - side[i][1][0], side[i][0][1] - side[i][1][1]);
  ctx.closePath();
  ctx.fill();
}

// tapered, bowed trunk outline
export function trunkPath(ctx, bx, by, tx, ty, wb, wt, bow) {
  const p0 = [bx, by], p2 = [tx, ty];
  const p1 = [(bx + tx) / 2 + bow, (by + ty) / 2];
  const N = 9, L = [], R = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = qp(t, p0, p1, p2), d = qd(t, p0, p1, p2);
    const m = Math.hypot(d[0], d[1]) || 1;
    const w = (wb + (wt - wb) * t) / 2;
    L.push([p[0] - d[1] / m * w, p[1] + d[0] / m * w]);
    R.push([p[0] + d[1] / m * w, p[1] - d[0] / m * w]);
  }
  ctx.beginPath();
  ctx.moveTo(L[0][0], L[0][1]);
  for (let i = 1; i <= N; i++) ctx.lineTo(L[i][0], L[i][1]);
  for (let i = N; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
  ctx.closePath();
}

// Plan-space radius a plant's crown covers on the ground, before TILT. Spacing is tested in plan
// rather than on screen so the vertical squash is handled for free and front-to-back gaps match
// side-to-side ones.
export function footprint(s, isPalm) {
  const tr = PLANT.canopy * s;
  return isPalm ? tr * PLANT.frondLen : tr * 0.62 * 1.05;
}

// A palm. The trunk carries the silhouette: the crown sits at trunkH x the canopy radius rather
// than one radius up, so at a 5px canopy the plant still reads as a leaning stick with a splayed
// head. Detail switches itself off by size below — those gates are what stop small plants
// turning to mush.
export function drawPalm(ctx, f, clock) {
  const fx = f.x, fy = f.y * TILT;
  const tr = PLANT.canopy * f.s;
  const lean = f.k * PLANT.bow * tr;      // static: wind never moves the trunk
  const cx = fx + lean, cy = fy - tr * PLANT.trunkH;
  const L = tr * PLANT.frondLen;

  const wb = Math.max(1.1, tr * PLANT.trunkW), wt = wb * PLANT.taper;
  ctx.fillStyle = C.wood;
  trunkPath(ctx, fx, fy, cx, cy, wb, wt, lean * 0.9);
  ctx.fill();
  if (wb > 2.2) {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = C.woodLit;
    trunkPath(ctx, fx - wb * 0.28, fy, cx - wt * 0.28, cy, wb * 0.34, wt * 0.34, lean * 0.9);
    ctx.fill();
    ctx.restore();
  }

  const n = tr < 6 ? Math.max(4, PLANT.fronds - 2) : PLANT.fronds;
  const step = Math.PI * 2 / n;
  const notch = tr > 7;
  const steps = notch ? (tr > 13 ? 14 : 10) : 8;
  const order = [];
  for (let i = 0; i < n; i++) {
    const a = f.a + i * step + Math.sin(f.ph + i * 2.4) * step * 0.18;
    order.push({ a, i, back: Math.sin(a) < -0.1 });
  }
  order.sort((u, v) => Math.sin(u.a) - Math.sin(v.a)); // back to front
  for (const o of order) {
    const jitter = 1 + Math.sin(f.ph * 3 + o.a * 2) * 0.14;

    // depth: 0 pointing straight away from the camera, 1 straight toward it. TILT squashes a back
    // frond to about a third of its drawn length, so it must also travel less, droop less and sit
    // narrower — otherwise its tip swings further than the blade is visibly long and smears across
    // its neighbours and the crown.
    const depth = (Math.sin(o.a) + 1) / 2;
    const seen = 0.55 + 0.45 * depth;
    const len = L * jitter * (0.80 + 0.20 * depth);
    const wid = tr * PLANT.frondWidth * (0.74 + 0.26 * depth);
    const arch = PLANT.arch * (1.26 - 0.26 * depth);   // back blades arc up behind the crown
    const droop = PLANT.droop * (0.30 + 0.70 * depth); // instead of drooping down onto it

    // Amplitude stays positive, so blades stream downwind and gust rather than swinging
    // symmetrically through vertical. -cos(bearing) presses upwind blades down and lifts downwind
    // ones, so the crown flexes instead of turning like a rigid fan.
    const gust = Math.sin(clock * 1.5 + f.ph + o.i * 0.9);
    const amp = PLANT.wind * tr * (0.55 + 0.45 * gust) * seen;
    const press = -Math.cos(o.a) * amp * 0.20;

    ctx.fillStyle = o.back ? C.frondDk : C.frond;
    frond(ctx, cx, cy, o.a, len, wid, arch, droop, notch, steps, amp, amp * 0.18 + press);
  }
  ctx.fillStyle = C.frondDk; // crown core hides the seam where every frond meets
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1, tr * 0.15), 0, Math.PI * 2);
  ctx.fill();

  if (tr > 9 && f.nuts > 0.45) {
    ctx.fillStyle = C.coconut;
    const rN = Math.max(1, tr * 0.085);
    for (let i = 0; i < 3; i++) {
      const a = f.ph + i * 2.1;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * tr * 0.17, cy + tr * 0.14 + Math.sin(a) * tr * 0.06, rN, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// A low shrub, so an island is not a row of identical palms. Same frond() — short, wide, steeply
// arched blades springing from just above the ground — so the two species share a drawing language
// instead of one being circles and the other geometry. Below ~4px it collapses to two lobes,
// because at that size blades are indistinguishable from noise.
export function drawBush(ctx, f, clock) {
  const fx = f.x, fy = f.y * TILT;
  const tr = PLANT.canopy * f.s * 0.62;

  if (tr < 4) {
    ctx.fillStyle = C.frondDk;
    ctx.beginPath(); ctx.arc(fx, fy - tr * 0.30, tr * 0.86, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.frond;
    ctx.beginPath(); ctx.arc(fx - tr * 0.16, fy - tr * 0.55, tr * 0.62, 0, Math.PI * 2); ctx.fill();
    return;
  }

  const oy = fy - tr * 0.28;
  ctx.fillStyle = C.frondDk; // dark mass at the base, so the blades read as growing out of something
  ctx.beginPath();
  ctx.ellipse(fx, fy - tr * 0.20, tr * 0.66, tr * 0.50, 0, 0, Math.PI * 2);
  ctx.fill();

  const n = tr < 8 ? 5 : 7, step = Math.PI * 2 / n;
  const order = [];
  for (let i = 0; i < n; i++) order.push({ a: f.a + i * step + Math.sin(f.ph + i * 1.7) * step * 0.22, i });
  order.sort((u, v) => Math.sin(u.a) - Math.sin(v.a));
  for (const o of order) {
    const depth = (Math.sin(o.a) + 1) / 2;
    const seen = 0.55 + 0.45 * depth;
    const gust = Math.sin(clock * 1.9 + f.ph + o.i * 1.1);
    const amp = PLANT.wind * tr * 0.75 * (0.5 + 0.5 * gust) * seen;
    const jitter = 1 + Math.sin(f.ph * 2 + o.a * 3) * 0.18;
    ctx.fillStyle = Math.sin(o.a) < -0.1 ? C.frondDk : C.frond;
    frond(ctx, fx, oy, o.a, tr * 0.98 * jitter * (0.82 + 0.18 * depth), tr * 0.30 * (0.78 + 0.22 * depth),
      0.44 * (1.20 - 0.20 * depth), 0.06, false, 8, amp, amp * 0.16);
  }
  if (tr > 9 && f.nuts > 0.62) {
    ctx.fillStyle = C.coconut;
    for (let i = 0; i < 3; i++) {
      const a = f.ph + i * 2.4;
      ctx.beginPath();
      ctx.arc(fx + Math.cos(a) * tr * 0.30, oy + Math.sin(a) * tr * 0.18, Math.max(1, tr * 0.10), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// A small patch at the base, not a cast shadow: at this camera angle a long projected shadow reads
// as a separate object, where a tight one just says "this touches the ground here". It leans toward
// wherever the crown actually is — the trunk bows, so the mass overhead is off-centre from the base,
// and tracking that is what makes a leaning palm look like it is leaning rather than drawn crooked.
export function shadowShape(ctx, f, clock, grow) {
  const fx = f.x, fy = f.y * TILT;
  const tr = PLANT.canopy * f.s * (f.isPalm ? 1 : 0.62);
  const lean = f.isPalm ? f.k * PLANT.bow * tr : 0;
  const drift = Math.sin(clock * 1.5 + f.ph) * PLANT.wind * tr * 0.30;
  const r = tr * PLANT.shadowSize * grow;
  const ox = fx + (lean + drift) * PLANT.shadowLean;
  const oy = fy + tr * 0.08; // a touch forward of the base, so it sits under the plant
  ctx.moveTo(ox + r, oy);
  ctx.ellipse(ox, oy, r, r * TILT, 0, 0, Math.PI * 2);
}

// Every shadow on the island goes into ONE path and gets ONE fill. With a fill per plant, two
// overlapping shadows composite twice and the intersection goes darker — wrong, since a crown
// cannot block light that is already blocked. Nonzero winding unions them, and it is cheaper than
// the per-plant ellipse it replaces.
export const SHADOW_SOFT = `rgba(0,0,0,${(PLANT.shadowOpa * 0.40).toFixed(3)})`;
export const SHADOW_CORE = `rgba(0,0,0,${PLANT.shadowOpa})`;
export function drawShadows(ctx, list, clock) {
  ctx.fillStyle = SHADOW_SOFT;
  ctx.beginPath();
  for (const f of list) shadowShape(ctx, f, clock, 1.45); // wider, fainter: a penumbra
  ctx.fill();
  ctx.fillStyle = SHADOW_CORE;
  ctx.beginPath();
  for (const f of list) shadowShape(ctx, f, clock, 1);
  ctx.fill();
}

// The drawn shoreline is a spline through the midpoints of the vertex polygon, not the polygon
// itself — it cuts the corners, so a plain point-in-polygon test would call a corner land when the
// sand has already curved away from it. Sample the same curve ring() draws and test against that.
export function islandOutline(r, verts, scale, steps = 4) {
  const n = verts.length, pts = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2, rr = r * verts[k] * scale;
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr * TILT]);
  }
  const out = [];
  for (let k = 0; k < n; k++) {
    const p = pts[k], q = pts[(k + 1) % n], prev = pts[(k + n - 1) % n];
    const m0 = [(prev[0] + p[0]) / 2, (prev[1] + p[1]) / 2];
    const m1 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    for (let i = 0; i < steps; i++) out.push(qp(i / steps, m0, p, m1));
  }
  return out;
}

export function inOutline(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > py) !== (b[1] > py) && px < (b[0] - a[0]) * (py - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// Plants for one island. Positions are rejection-sampled so crowns cannot pile up: a candidate is
// kept only if it clears every plant already placed by minGap x the two footprints summed. The
// requirement relaxes every ten tries so a crowded island always terminates rather than hanging.
// `dice` is the island's own generator, seeded from where it stands, so the same island always
// grows the same plants.
export function genFoliage(r, verts, dice) {
  const k = r / PLANT.countRefR;
  const count = Math.max(1, Math.round(PLANT.countRef * k * k));
  const Rs = r * PLANT.scatter;
  const span = PLANT.scaleMax - PLANT.scaleMin;
  const plants = [];

  for (let f = 0; f < count; f++) {
    let placed = null, relax = 1;
    for (let t = 0; t < 60; t++) {
      // sqrt spreads plants evenly over the disc. Uniform radius crowds the middle, which nothing
      // noticed at the old two-to-four plants but is obvious at twenty.
      const a = random(dice) * Math.PI * 2, rr = Rs * Math.sqrt(random(dice));
      const s = PLANT.scaleMin + random(dice) * span;
      const isPalm = random(dice) < PLANT.palmRatio;
      const c = { x: Math.cos(a) * rr, y: Math.sin(a) * rr, s, isPalm };
      const fc = footprint(s, isPalm);
      let ok = true;
      for (const o of plants) {
        const need = (fc + footprint(o.s, o.isPalm)) * PLANT.minGap * relax;
        if (Math.hypot(c.x - o.x, c.y - o.y) < need) { ok = false; break; }
      }
      if (ok) { placed = c; break; }
      if (t % 10 === 9) relax *= 0.86;
    }
    if (!placed) {
      const a = random(dice) * Math.PI * 2, rr = Rs * Math.sqrt(random(dice));
      placed = { x: Math.cos(a) * rr, y: Math.sin(a) * rr,
                 s: PLANT.scaleMin + random(dice) * span, isPalm: random(dice) < PLANT.palmRatio };
    }
    plants.push({
      ...placed,
      a: random(dice) * Math.PI * 2,   // crown rotation
      k: random(dice) * 2 - 1,         // lean / bow direction
      ph: random(dice) * Math.PI * 2,  // wind phase
      nuts: random(dice),
    });
  }

  // Height is added in unsquashed screen px, so a tall plant near the back of the disc can push its
  // crown out over the water. Walk those south until the crown clears the shoreline and bake the
  // offset back into the plan position, so nothing downstream has to know it happened. Doing this
  // here rather than per frame is the whole point — the alternative is isPointInPath every frame.
  const shore = islandOutline(r, verts, 0.94);
  for (const p of plants) {
    const tr = PLANT.canopy * p.s;
    const top = p.isPalm ? tr * (PLANT.trunkH + PLANT.arch * PLANT.frondLen + PLANT.frondWidth)
                         : tr * 0.62 * 1.5;
    const px = p.x + (p.isPalm ? p.k * PLANT.bow * tr : 0);
    for (let i = 0; i < 30 && !inOutline(px, p.y * TILT - top, shore); i++) {
      p.y += Math.max(0.6, tr * 0.10) / TILT;
    }
  }

  // Sorted once, here: plants never move — wind only bends blades — so the draw loop has no reason
  // to re-sort them every frame.
  plants.sort((a, b) => a.y - b.y);
  return plants;
}

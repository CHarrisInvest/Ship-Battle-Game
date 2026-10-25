/**
 * THE SEA ON THE SCREEN: one viewer's canvas, and everything drawn on it.
 *
 * It reads a world and draws it, and it never changes one: the water and its whitecaps, the boundary
 * and its buoys, the weather, the islands and their planting, every hull and her rig, the balls in
 * the air, the smoke and the words from `fx`, the red at the edge of the screen and the radar. The
 * camera is the screen's too, held on the viewer's own ship by `follow`.
 *
 * `createRenderer(canvas)` hands back the few things the frame loop needs: `resize` when the page
 * does, `tick` to move the clock that sets the waves and the wind going, `follow` and `render` each
 * frame, and `under` for the one DOM panel that needs to know whether a ship is beneath it.
 *
 * THE ENGINE STEPS SIXTY TIMES A SECOND AND THE SCREEN DRAWS AS OFTEN AS IT LIKES. So a frame
 * rarely lands on a step, and drawing each ship where the last step left her would stutter on any
 * screen that is not running at exactly sixty: a 120 Hz phone would show every position twice. Each
 * ship is drawn instead between where the last step found her and where it left her, `alpha` of the
 * way, which is the share of a step the frame loop has banked and not yet spent; her heading is
 * blended the short way round. A ball goes the same way back along its flight, and the camera
 * follows her blended position, so the sea, her and her shot all move together. The picture runs
 * a step behind the round, which is a sixtieth of a second and the price of it being smooth.
 */

import { WORLD, WP, TICK, clamp, seedFrom } from "../sim/index.js";
import { C, UI } from "./palette.js";
import { TILT, ZUP, SHOT_DRAW, SHOT_LIT_MIN, createView, sizeView, followView, blend, shipUnder } from "./view.js";
import { genFoliage, drawShadows, drawPalm, drawBush } from "./foliage.js";
import { SEA_FOREAFT } from "./searig.js";
import { lookOf } from "./effects.js";
import { arcGuides, shipLabel, floatTexts, stormEllipse as stormRing, stormEdge, vignette, radar } from "../render3d/overlay.js";

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  let Wd = 0, // the canvas, in screen pixels: what the buttons and the radar are placed against
    Hd = 0,
    dpr = 1,
    zoom = 1, // screen pixels per unit of view space
    Vw = 0, // and the same canvas in view space, which is where the sea is drawn
    Vh = 0,
    clock = 0; // seconds of drawing, which sets the swell, the wind and the caps going
  // The view's figures live in one object both renderers place the sea by (`view.js`); the names
  // above are this file's own copies of them, refreshed on every resize. The phone's notch, corners
  // and home bar are in it as `safe`, read off the HUD's wrapper, which is inset by the same amounts.
  const vs = createView();
  const cam = vs.cam; // the world point at the top left of the screen
  // what the frame being drawn is drawing: the world, this viewer's effects, and how she is looking
  let world = null, fx = null, view = { live: false, input: {}, alpha: 1 };

  // Where a ship is drawn, `alpha` of the way through the last step: her position and her heading.
  const at = blend;

  // An island's planting, grown the first time she is drawn from dice seeded where she stands, so
  // the same island grows the same palms on every screen and drawing them never touches the round.
  const plantings = new WeakMap();
  const plantingOf = (isl) => {
    let p = plantings.get(isl);
    if (!p) plantings.set(isl, (p = genFoliage(isl.r, isl.verts, { rng: seedFrom(isl.x, isl.y, isl.r) })));
    return p;
  };

  // View space is world space seen from the camera: across is one to one, and down is squashed by
  // TILT. `zoom` is the only thing between it and the screen, so every distance the sea is drawn
  // with — a hull, a range, a whitecap — stays in world units and the square decides how big they
  // come out. Screen pixels are wanted for two things only, the radar and the vignette.
  const worldSpace = () => ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
  const screenSpace = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // `hud` is the HUD's safe-area box on the page, whose insets from the canvas are the phone's notch,
  // corners and home bar; the radar is placed inside them, by the same edges the DOM controls use.
  function resize(hud) {
    const rect = canvas.getBoundingClientRect();
    sizeView(vs, rect, hud, Math.min(window.devicePixelRatio || 1, 2));
    ({ Wd, Hd, dpr, zoom, Vw, Vh } = vs);
    canvas.width = Math.round(Wd * dpr);
    canvas.height = Math.round(Hd * dpr);
    screenSpace();
  }

  const SX = (x, cam) => x - cam.x;
  const SY = (y, cam) => (y - cam.y) * TILT;

  function hash(i, j) {
    const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return v - Math.floor(v);
  }

  // the camera brought round onto `me`, the viewer's own ship, where she is drawn `alpha` of the
  // way through the last step; how it holds her off the boundary is `followView`'s, in view.js
  function follow(ship, alpha = 1) {
    followView(vs, ship, alpha);
  }

  // ---------------- rendering ----------------

  // One breaking crest: two peaked humps with the outer legs rolling away from the shape, the way
  // foam spills off either shoulder of a cap. Drawn wide and low, because a cap lies flat on the
  // water and the water is seen at a tilt.
  //
  // The troughs are rounded but the crests are not, and that asymmetry is the whole shape. On each
  // descent the control on the crest side sits on the crest itself, so the curve leaves it steeply
  // and the peak stays sharp; the control on the trough side sits out to the side at trough height,
  // which flattens the tangent there and rolls the bottom out. Round both ends and it stops reading
  // as a breaking wave and starts reading as a sine squiggle.
  //
  // The notch between the two crests rides HIGHER than the troughs the tails fall into, so the low
  // points of the shape are its two outside ends and the water only dips a little in the middle.
  // Each tail is a quadratic from (-w, -0.1h) through (-0.8w, 0.6h) to the crest, which puts its y
  // at -0.1 + 1.4t - 2t² and bottoms out at t = 0.35, i.e. 0.145h below the baseline. CAP_MID has
  // to stay clear of that figure — push it past 0.145 and the middle becomes the lowest point of the
  // cap again; drop it much below about -0.05 and the notch flattens until the two crests read as
  // one broad hump.
  //
  // Path only: the caller owns beginPath/stroke, so each cap can carry its own alpha.
  const CAP_W = 5.5, CAP_H = 4, CAP_LW = 1.4;
  const CAP_MID = 0; // centre notch, as a fraction of CAP_H below the baseline
  const CAP_TROUGH = 0.3; // how far the trough controls sit to the side — 0 would cusp the bottom

  // A cap breaking: it whitens fast, then falls back to its own colour over about a second. Every
  // cap runs its own cycle, so a few are always going off somewhere in view and no two are in step.
  //
  // This is a function of the cap's cell and the clock and nothing else — there is no list of live
  // flares, nothing is spawned, and nothing is stored per cap. That is what makes it free at the
  // edges of the screen: caps keep their rhythm whether or not they are being drawn, so one that
  // scrolls into view arrives already mid-cycle instead of starting over or popping.
  const CAP_CYCLE_MIN = 9, CAP_CYCLE_MAX = 19; // seconds between one cap's breaks
  const CAP_FLARE_LEN = 0.9;   // how long a break lasts
  const CAP_FLARE_RISE = 0.18; // fraction of that spent whitening — small, so it snaps and then fades
  const CAP_FLARE_ALPHA = 0.55;
  function capFlare(cell, phase) {
    const period = CAP_CYCLE_MIN + cell * (CAP_CYCLE_MAX - CAP_CYCLE_MIN);
    const u = (clock / period + phase) % 1;      // where this cap is in its own cycle
    const win = CAP_FLARE_LEN / period;
    if (u >= win) return 0;
    const s = u / win;
    if (s < CAP_FLARE_RISE) return s / CAP_FLARE_RISE;
    const fall = (1 - s) / (1 - CAP_FLARE_RISE); // squared, so it drops away and then lingers
    return fall * fall;
  }
  function whitecap(x, y) {
    const w = CAP_W, h = CAP_H, d = CAP_TROUGH;
    const px = 0.45 * w, py = y - 0.7 * h, ty = y + CAP_MID * h;
    ctx.moveTo(x - w, y - 0.1 * h);
    ctx.quadraticCurveTo(x - 0.8 * w, y + 0.6 * h, x - px, py);        // tail rolls out, up into the crest
    ctx.bezierCurveTo(x - px, py, x - d * w, ty, x, ty);               // down into the shallow notch
    ctx.bezierCurveTo(x + d * w, ty, x + px, py, x + px, py);          // and back up to the far crest
    ctx.quadraticCurveTo(x + 0.8 * w, y + 0.6 * h, x + w, y - 0.1 * h); // then rolls out again
  }

  function drawWater(cam) {
    ctx.fillStyle = C.water;
    ctx.fillRect(0, 0, Vw, Vh);
    const x0 = SX(0, cam), x1 = SX(WORLD, cam), y0 = SY(0, cam), y1 = SY(WORLD, cam);
    ctx.fillStyle = C.waterEdge;
    if (y0 > 0) ctx.fillRect(0, 0, Vw, y0);
    if (y1 < Vh) ctx.fillRect(0, y1, Vw, Vh - y1);
    if (x0 > 0) ctx.fillRect(0, 0, x0, Vh);
    if (x1 < Vw) ctx.fillRect(x1, 0, Vw - x1, Vh);
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = 80;
    const gy0 = Math.max(0, y0), gy1 = Math.min(Vh, y1), gx0 = Math.max(0, x0), gx1 = Math.min(Vw, x1);
    for (let X = Math.ceil(cam.x / step) * step; X <= WORLD; X += step) { const sx = SX(X, cam); if (sx > Vw) break; if (sx < 0) continue; ctx.moveTo(sx, gy0); ctx.lineTo(sx, gy1); }
    for (let Y = Math.ceil(cam.y / step) * step; Y <= WORLD; Y += step) { const sy = SY(Y, cam); if (sy > Vh) break; if (sy < 0) continue; ctx.moveTo(gx0, sy); ctx.lineTo(gx1, sy); }
    ctx.stroke();
    const cs = 130;
    const ci0 = Math.floor(cam.x / cs) - 1, ci1 = Math.floor((cam.x + Vw) / cs) + 1;
    const cj0 = Math.floor(cam.y / cs) - 1, cj1 = Math.floor((cam.y + Vh / TILT) / cs) + 1;
    ctx.strokeStyle = C.beachRim;
    ctx.lineWidth = CAP_LW;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let ci = ci0; ci <= ci1; ci++) {
      for (let cj = cj0; cj <= cj1; cj++) {
        const h1 = hash(ci, cj), h2 = hash(ci + 9, cj + 4);
        const wx = (ci + h1) * cs, wy = (cj + h2) * cs;
        if (wx < 6 || wx > WORLD - 6 || wy < 6 || wy > WORLD - 6) continue;
        const sx = SX(wx, cam), sy = SY(wy, cam) + Math.sin(clock * 1.3 + h1 * 6.283) * 1.4;
        // beach-rim tone on open water: a lighter hue than the old caps, and a shape with detail in
        // it rather than a bare tick, so it needs more of itself showing through to read as a cap
        ctx.globalAlpha = 0.2 + 0.12 * (0.5 + 0.5 * Math.sin(clock + h2 * 6.283));
        ctx.beginPath();
        whitecap(sx, sy);
        ctx.stroke();
        // A break is painted over the top rather than swapped in, so the cap keeps its own colour
        // underneath and the white simply fades off it. Same path, so there is nothing to rebuild.
        const flare = capFlare(hash(ci + 5, cj + 17), h1);
        if (flare > 0.01) {
          ctx.strokeStyle = C.foam;
          ctx.globalAlpha = flare * CAP_FLARE_ALPHA;
          ctx.stroke();
          ctx.strokeStyle = C.beachRim;
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    drawBoundary(cam, x0, y0, x1, y1);
  }

  function drawBoundary(cam, x0, y0, x1, y1) {
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 7;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = C.boundary;
    ctx.lineWidth = 4;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = "rgba(232,200,119,0.5)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([9, 8]);
    ctx.strokeRect(x0 + 8, y0 + 8 * TILT, x1 - x0 - 16, y1 - y0 - 16 * TILT);
    ctx.setLineDash([]);
    const step = 400;
    let n = 0;
    const buoy = (wx, wy) => {
      const sx = SX(wx, cam), sy = SY(wy, cam) + Math.sin(clock * 2 + wx * 0.01 + wy * 0.01) * 1.5;
      n++;
      if (sx < -10 || sx > Vw + 10 || sy < -10 || sy > Vh + 10) return;
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, Math.PI * 2);
      ctx.fillStyle = n % 2 ? C.buoyB : C.buoyA;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.stroke();
    };
    for (let X = 0; X <= WORLD; X += step) { buoy(X, 0); buoy(X, WORLD); }
    for (let Y = step; Y < WORLD; Y += step) { buoy(0, Y); buoy(WORLD, Y); }
  }

  // The weather is painted in two passes so it never costs readability: the sea outside the ring
  // darkens under the ships, and the edge itself is drawn over the top of everything, because the
  // one thing a captain must always be able to find is the line between fair water and foul.
  function stormEllipse() {
    return stormRing(vs, world);
  }

  function drawStormWater(cam) {
    if (!world.rules.storm) return;
    const { cx, cy, r } = stormEllipse();
    const outside = () => {
      ctx.beginPath();
      ctx.rect(0, 0, Vw, Vh);
      ctx.ellipse(cx, cy, r, r * TILT, 0, 0, Math.PI * 2);
    };
    outside();
    ctx.fillStyle = "rgba(7,34,33,0.5)";
    ctx.fill("evenodd");
    // rain, drawn only where the weather is
    ctx.save();
    outside();
    ctx.clip("evenodd");
    ctx.strokeStyle = "rgba(190,215,225,0.5)";
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    const cell = 46;
    for (let i = 0; i < Math.ceil(Vw / cell) + 1; i++) {
      for (let j = 0; j < Math.ceil(Vh / cell) + 1; j++) {
        const h1 = hash(i + Math.floor(cam.x / cell), j + Math.floor(cam.y / cell));
        const px = i * cell + h1 * cell;
        const py = ((j * cell + h1 * 900 + clock * 340) % (Vh + cell)) - cell / 2;
        ctx.moveTo(px, py);
        ctx.lineTo(px - 3, py + 11);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawWakes(cam) {
    for (const w of fx.wakes) {
      const k = w.life / w.max;
      ctx.globalAlpha = k * 0.55;
      ctx.fillStyle = "#eefaf6";
      const rr = 1.6 + (1 - k) * 4.5;
      ctx.beginPath();
      ctx.ellipse(SX(w.x, cam), SY(w.y, cam), rr, rr * TILT, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawIslands(cam) {
    for (const isl of world.islands) {
      const cx = SX(isl.x, cam), cy = SY(isl.y, cam);
      // cull on the shallows, not the sand: the bank reaches well outside isl.r, and culling on the
      // land radius would pop a whole ring of shallow water in and out at the edge of the screen
      const vr = isl.r * 1.45 + 8;
      if (cx < -vr || cx > Vw + vr || cy < -vr * TILT - 60 || cy > Vh + vr * TILT + 60) continue;
      const n = isl.verts.length;
      ctx.save();
      ctx.translate(cx, cy);
      // One closed ring of the island's outline at `scale`, optionally rolling on the swell.
      //
      // The roll has to close on itself, which is why it is given as a whole number of `waves` round
      // the ring rather than as a phase that advances per vertex. An advancing phase leaves the last
      // vertex and the first at different radii even though they are neighbours, and the ring then
      // shuts with a straight chord across the gap — a hard step that reads as a notch bitten out of
      // the band. Taking the phase from the vertex angle makes that unrepresentable.
      //
      // The vertices are joined by a closed quadratic spline through the midpoint of each edge: the
      // curve passes through every midpoint and is tangent to the outline there, so the facets round
      // off and the bands roll instead of stepping. It cuts the corners slightly, so the drawn shape
      // sits a touch inside the polygon — far less than the 0.78-1.08 spread of verts already puts
      // between the drawn sand and the isl.r circle that shots and hulls actually test against.
      const ring = (scale, waves = 0, amp = 0, speed = 0) => {
        const pts = [];
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          const rr = isl.r * isl.verts[k] * scale + (amp ? Math.sin(clock * speed + a * waves) * amp : 0);
          pts.push([Math.cos(a) * rr, Math.sin(a) * rr * TILT]);
        }
        ctx.beginPath();
        ctx.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
        for (let k = 0; k < n; k++) {
          const p = pts[k], q = pts[(k + 1) % n];
          ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
        }
        ctx.closePath();
      };
      // The bottom comes up in two steps before it breaks the surface: a broad bank of shallows, then
      // a thin beach rim right at the sand. Both roll on the swell — the outer one wider and slower,
      // over fewer crests — so the two edges never march in step and the island keeps a moving
      // waterline.
      ring(1.30, 2, 3, 1.6);
      ctx.fillStyle = C.shallows;
      ctx.fill();
      ring(1.08, 3, 2, 2);
      ctx.fillStyle = C.beachRim;
      ctx.fill();
      // just a hairline of shade under the sand edge — any wider and it eats the beach rim
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = "#000";
      ring(1.015);
      ctx.fill();
      ctx.globalAlpha = 1;
      ring(1);
      ctx.fillStyle = C.sand;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = C.sandDark;
      ctx.stroke();
      // One flat green, not two: the interior stays a single colour and the only darker green on the
      // island is the foliage, which reads as canopy rather than as another contour line inland.
      ring(0.72);
      ctx.fillStyle = C.grass;
      ctx.fill();
      // Shadows first, as one batched pass under every plant. The list is already sorted back to
      // front from generation, so near plants overdraw far ones without sorting again here.
      const plants = plantingOf(isl);
      drawShadows(ctx, plants, clock);
      for (const f of plants) (f.isPalm ? drawPalm : drawBush)(ctx, f, clock);
      ctx.restore();
    }
  }

  function drawShip(s, cam) {
    const pos = at(s, view.alpha);
    const H = pos.h, cH = Math.cos(H), sH = Math.sin(H);
    const look = lookOf(fx, s);
    const roll = look.roll + Math.sin(look.rollPhase * 1.2) * 0.05; // bank into turns + gentle idle heel
    const cR = Math.cos(roll), sR = Math.sin(roll);
    const gx = SX(pos.x, cam), gy = SY(pos.y, cam);
    const sea = look.sea;
    const deckH = sea.deckH;
    // local (u=fore, v=starboard, z=up) -> screen, via roll about keel, yaw, then iso projection
    const P3 = (u, v, z) => {
      const v2 = v * cR - z * sR;
      const z2 = v * sR + z * cR;
      const ox = u * cH - v2 * sH;
      const oy = u * sH + v2 * cH;
      return [gx + ox, gy + oy * TILT - z2 * ZUP];
    };
    const line = (a, b, col, wLine) => { ctx.strokeStyle = col; ctx.lineWidth = wLine; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };

    // shadow on the water
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(gx, gy + 2, s.hullA, s.hullB * TILT + 2, H, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // V-shaped bow wave — subtle at cruise, pronounced on a charge
    const sf = clamp((s.spdCur - 28) / 110, 0, 1);
    if (sf > 0.03) {
      const apex = P3(s.hullA + 2 * sf, 0, 0);
      const spread = (6 + 6 * sf) * (s.hullB / 6.5), len = (10 + 10 * sf) * (s.hullA / 18);
      const lft = P3(s.hullA + 2 - len, -spread, 0), rgt = P3(s.hullA + 2 - len, spread, 0);
      ctx.strokeStyle = `rgba(232,246,244,${0.18 + 0.4 * sf})`;
      ctx.lineWidth = 1.3 + 1.4 * sf;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(lft[0], lft[1]);
      ctx.quadraticCurveTo(apex[0], apex[1], rgt[0], rgt[1]);
      ctx.stroke();
      ctx.globalAlpha = 0.22 + 0.35 * sf;
      ctx.fillStyle = "#eaf6f4";
      const cap = 2 + 1.5 * sf;
      ctx.beginPath();
      ctx.ellipse(apex[0], apex[1], cap, cap * TILT, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // ship colour reads as TRIM; the hull itself is brown wood
    const trim = look.trim;

    // hull: dark waterline body + brown deck, trimmed in the ship's colour. The outline is the
    // class's own: her length, her beam, her entry and her stern.
    const hull = sea.outline;
    const tracePoly = (z) => {
      ctx.beginPath();
      hull.forEach(([u, v], i) => { const [X, Y] = P3(u, v, z); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); });
      ctx.closePath();
    };
    tracePoly(0); ctx.fillStyle = look.cols.dark; ctx.fill();
    tracePoly(deckH);
    ctx.fillStyle = look.cols.deck; ctx.fill();
    if (look.flash > 0) { ctx.globalAlpha = look.flash; ctx.fillStyle = "#fff"; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.lineWidth = s.id === fx.me ? 2 : 1.6; ctx.strokeStyle = trim; ctx.stroke(); // gunwale trim
    // painted trim stripe around the hull side
    tracePoly(deckH * 0.5); ctx.lineWidth = 1.6; ctx.strokeStyle = trim; ctx.globalAlpha = 0.85; ctx.stroke(); ctx.globalAlpha = 1;
    // bowsprit, on the hulls that have one
    if (s.loadout.hull.bowsprit) line(P3(-0.11 * sea.L, 0, deckH + 1), P3(0.61 * sea.L, 0, deckH + 2), look.cols.spar, 1.4);

    // raised stern castle (quarterdeck cabin) on the back quarter, on the classes built up
    // enough to carry one: an open boat has no cabin at all
    if (sea.castle) {
      const { fx, bx, hw, h } = sea.castle;
      const cf = [[fx, -hw], [fx, hw], [bx - 1, hw * 0.76], [bx - 1, -hw * 0.76]]; // FL, FR, BR, BL — overhangs the stern slightly
      const baseC = cf.map(([u, v]) => P3(u, v, deckH));
      const topC = cf.map(([u, v]) => P3(u, v, deckH + h));
      const walls = [];
      for (let k = 0; k < 4; k++) {
        const a = k, b = (k + 1) % 4;
        walls.push({ q: [baseC[a], baseC[b], topC[b], topC[a]], d: (baseC[a][1] + baseC[b][1]) / 2, edge: k });
      }
      walls.sort((x, y) => x.d - y.d); // far walls first
      for (const w of walls) {
        ctx.beginPath();
        w.q.forEach((p, i) => { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
        ctx.closePath();
        ctx.fillStyle = look.cols.wood; ctx.fill();
        ctx.globalAlpha = 0.2; ctx.fillStyle = "#000"; ctx.fill(); ctx.globalAlpha = 1;
        ctx.lineWidth = 1; ctx.strokeStyle = look.cols.dark; ctx.stroke();
        if (w.edge === 2) { // cabin windows on the aft wall (BR -> BL)
          for (const t of [0.32, 0.68]) {
            const bx2 = baseC[2][0] + (baseC[3][0] - baseC[2][0]) * t, by2 = baseC[2][1] + (baseC[3][1] - baseC[2][1]) * t;
            const tx2 = topC[2][0] + (topC[3][0] - topC[2][0]) * t, ty2 = topC[2][1] + (topC[3][1] - topC[2][1]) * t;
            ctx.fillStyle = "#2a1c10";
            ctx.fillRect(bx2 + (tx2 - bx2) * 0.5 - 1.4, by2 + (ty2 - by2) * 0.5 - 1.4, 2.8, 2.8);
          }
        }
      }
      ctx.beginPath();
      topC.forEach((p, i) => { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
      ctx.closePath();
      ctx.fillStyle = look.cols.deck; ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = trim; ctx.stroke();
    }

    // masts and canvas, off her own loadout: each mast at its station, each band of sail in the
    // shape of its category. Square canvas bellies on the BOW side of the pole as it always has;
    // fore-and-aft canvas stands along the keel line.
    const rig = look.rig;
    const masts = s.mastDown ? [] : rig.masts;
    const fwd = 1.5, belly = 3, MINW = 4, N = 6;
    // a mast stands on the quarterdeck only if she has one and it's aft of its front wall
    const mz = (u) => (sea.castle && u <= sea.castle.fx ? deckH + sea.castle.h : deckH);
    const drawSail = (u, m) => {
      const bz = mz(u);
      const topZ = bz + m.st, botZ = bz + m.sb;
      // sample the bellied cloth across the beam into columns
      const cols = [];
      for (let k = 0; k <= N; k++) {
        const t = k / N, v = -m.w / 2 + m.w * t, nrm = v / (m.w / 2);
        const uu = u + fwd + belly * (1 - nrm * nrm); // bellies forward toward the bow
        cols.push({ top: P3(uu, v, topZ), bot: P3(uu, v, botZ), nrm });
      }
      // keep a small minimum on-screen width so she never vanishes edge-on
      let minX = Infinity, maxX = -Infinity;
      for (const c of cols) for (const p of [c.top, c.bot]) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; }
      const wpx = maxX - minX;
      if (wpx > 0 && wpx < MINW) {
        const cx = (minX + maxX) / 2, sc = MINW / wpx;
        for (const c of cols) for (const p of [c.top, c.bot]) p[0] = cx + (p[0] - cx) * sc;
      }
      // fill the belly as white cloth, one convex quad-strip at a time so the
      // whole surface reads white on every face (front and back of the belly),
      // never leaving a hole for the hull/mast to show through.
      for (let k = 0; k < N; k++) {
        const a = cols[k], b = cols[k + 1];
        ctx.beginPath();
        ctx.moveTo(a.top[0], a.top[1]); ctx.lineTo(b.top[0], b.top[1]); ctx.lineTo(b.bot[0], b.bot[1]); ctx.lineTo(a.bot[0], a.bot[1]); ctx.closePath();
        ctx.fillStyle = C.sail; ctx.fill();
        const shade = 0.2 * ((a.nrm * a.nrm + b.nrm * b.nrm) / 2); // soft rounding toward the edges
        if (shade > 0.01) { ctx.globalAlpha = shade; ctx.fillStyle = "#000"; ctx.fill(); ctx.globalAlpha = 1; }
        ctx.globalAlpha = 0.09; ctx.fillStyle = trim; ctx.fill(); ctx.globalAlpha = 1;
      }
      // silhouette outline + yard across the head
      ctx.beginPath();
      cols.forEach((c, i) => { if (i === 0) ctx.moveTo(c.top[0], c.top[1]); else ctx.lineTo(c.top[0], c.top[1]); });
      for (let k = N; k >= 0; k--) ctx.lineTo(cols[k].bot[0], cols[k].bot[1]);
      ctx.closePath();
      ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,0,0,0.28)"; ctx.stroke();
      line(cols[0].top, cols[N].top, look.cols.spar, 1.3);
    };
    const drawPole = (m, base, top) => {
      line(base, top, look.cols.spar, 1.7);
      const bz = mz(m.u);
      const f2 = P3(m.u - 5, 0, bz + m.h - 0.6), f3 = P3(m.u, 0, bz + m.h - 2.4);
      ctx.fillStyle = trim;
      ctx.beginPath(); ctx.moveTo(top[0], top[1]); ctx.lineTo(f2[0], f2[1]); ctx.lineTo(f3[0], f3[1]); ctx.closePath(); ctx.fill();
    };
    // a fore-and-aft panel: cloth standing along the keel line, filled from its outline. Kept to
    // a small on-screen minimum the same way the square bands are, so it never quite vanishes
    // when she sails straight up or down the screen.
    const drawPanel = (pts) => {
      const proj = pts.map(([uu, zz]) => P3(uu, 0, zz));
      let minX = Infinity, maxX = -Infinity;
      for (const p of proj) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; }
      const wpx = maxX - minX;
      if (wpx > 0 && wpx < MINW) {
        const cx = (minX + maxX) / 2, sc = MINW / wpx;
        for (const p of proj) p[0] = cx + (p[0] - cx) * sc;
      }
      ctx.beginPath();
      proj.forEach((p, i) => { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
      ctx.closePath();
      ctx.fillStyle = C.sail; ctx.fill();
      ctx.globalAlpha = 0.09; ctx.fillStyle = trim; ctx.fill(); ctx.globalAlpha = 1;
      ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,0,0,0.28)"; ctx.stroke();
    };
    // the outline of one fore-and-aft band, by its category: a gaff sail peaks high and aft of
    // the mast, a lug hangs from its raking yard with some cloth forward of the pole, and
    // triangular canvas is the lateen's fin, tacked forward and peaked aft
    const drawFin = (u, band) => {
      const bz = mz(u), sb = bz + band.sb, st = bz + band.st, h = band.st - band.sb;
      if (band.kind === "GAF") {
        const r = 0.85 * h + 3;
        drawPanel([[u, sb], [u, st - 0.24 * h], [u - 0.72 * r, st], [u - r, sb + 0.1 * h]]);
      } else if (band.kind === "LUG") {
        drawPanel([[u + 0.34 * h, sb], [u + 0.42 * h, st - 0.3 * h], [u - 0.58 * h, st], [u - 0.5 * h, sb + 0.06 * h]]);
      } else {
        drawPanel([[u + 0.45 * h, sb + 0.12 * h], [u - 0.55 * h, st], [u - 0.42 * h, sb]]);
      }
    };
    // a headsail: tacked on the bowsprit, hoisted toward the foremost masthead, clewed down aft
    const drawHead = (hd) => {
      const bz = mz(hd.mastU);
      drawPanel([[hd.tack, deckH + 2], [hd.mastU, bz + hd.mastZ], [hd.tack - 7, deckH + 2.5]]);
    };
    // depth-sort every pole and sail together: whichever is farther from the
    // camera is painted first, so the mast sits behind its bow-side sail when
    // she sails toward you and in front of it when she sails away.
    const prims = [];
    for (const m of masts) {
      prims.push({ d: m.u * sH, kind: "pole", m, base: P3(m.u, 0, mz(m.u)), top: P3(m.u, 0, mz(m.u) + m.h) });
      for (const band of m.sails) {
        if (SEA_FOREAFT.has(band.kind)) prims.push({ d: m.u * sH, kind: "fin", u: m.u, band });
        else prims.push({ d: (m.u + fwd + belly * 0.5) * sH, kind: "sail", u: m.u, band });
      }
    }
    if (!s.mastDown) {
      for (const hd of rig.heads) prims.push({ d: hd.tack * sH, kind: "head", hd });
      for (const sp of rig.sprits) prims.push({ d: sp.u * sH, kind: "sail", u: sp.u, band: sp });
    }
    prims.sort((a, b) => a.d - b.d);
    for (const p of prims) {
      if (p.kind === "pole") drawPole(p.m, p.base, p.top);
      else if (p.kind === "fin") drawFin(p.u, p.band);
      else if (p.kind === "head") drawHead(p.hd);
      else drawSail(p.u, p.band);
    }
    if (s.mastDown) line(P3(-2, 0, deckH), P3(-2, 3, deckH + 8), look.cols.spar, 1.8);

    // health bars + rank, above the rig
    shipLabel(ctx, vs, s, { gx, gy, h: H, roll, topZ: deckH + rig.top + 6 }, world, fx);
  }

  function drawShots(cam) {
    for (const b of world.shots) {
      // back along its flight by the share of the step not yet drawn
      const back = TICK * (1 - view.alpha);
      const sx = SX(b.x - b.vx * back, cam), sy = SY(b.y - b.vy * back, cam) - 3;
      if (b.kind === "musket") {
        ctx.strokeStyle = C.pellet;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - b.vx * 0.012, sy - b.vy * 0.012 * TILT);
        ctx.stroke();
      } else {
        // The smoke she drags comes first, so the ball sits on the head of it. It is drawn as a
        // wedge tapering to nothing astern rather than a line: a stroke this thin goes grey the
        // moment it lands under a pixel, where a shape narrowing to a point keeps its weight at
        // the ball and simply runs out. Two wedges, a long faint one and a short bright one,
        // give it a falling-off without a gradient per ball per frame.
        const dr = b.r * (WP[b.kind].draw ?? SHOT_DRAW); // what it looks like, which is not always what it bites
        const tail = 0.06; // seconds of her flight lie behind her
        const px = -b.vx * tail, py = -b.vy * tail * TILT; // astern, in screen terms
        const nx = -py, ny = px; // across the trail, to give the wedge its width at the ball
        const nl = Math.hypot(nx, ny) || 1;
        for (const [reach, wide, alpha] of [[1, 0.85, 0.2], [0.45, 0.62, 0.28]]) {
          ctx.globalAlpha = alpha;
          ctx.fillStyle = C.smoke;
          ctx.beginPath();
          ctx.moveTo(sx + (nx / nl) * dr * wide, sy + (ny / nl) * dr * wide);
          ctx.lineTo(sx + px * reach, sy + py * reach);
          ctx.lineTo(sx - (nx / nl) * dr * wide, sy - (ny / nl) * dr * wide);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        // cast iron, with the light off the top of it. No outline: a dark ball on this sea has
        // the contrast to stand on its own, and a hairline round something this small is a
        // smudge rather than an edge
        ctx.beginPath();
        ctx.arc(sx, sy, dr, 0, Math.PI * 2);
        ctx.fillStyle = C.ball;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(sx - dr * 0.3, sy - dr * 0.34, Math.max(SHOT_LIT_MIN, dr * 0.42), 0, Math.PI * 2);
        ctx.fillStyle = C.ballLit;
        ctx.fill();
      }
    }
  }

  /**
   * Smoke first and every flash over it, in two passes rather than in the order they were made.
   *
   * A gun's flash is pale yellow and its own smoke is white, so drawn in order the flash went
   * under the bank the next gun down the side put up: fifty guns going off left a bank with
   * nothing in it, which is a ship in a fog rather than a ship firing. The flash is the shortest
   * lived thing on the water and the one that says a gun is going off HERE, so it is drawn last.
   */
  function drawParts(cam) {
    for (const p of fx.parts) {
      if (p.kind === "muzzle") continue;
      const sx = SX(p.x, cam), sy = SY(p.y, cam);
      if (p.kind === "puff") {
        // It swells the whole way and thins as it goes, so what fades out is a wide soft bank
        // rather than a hard dot winking out. Squashed like everything else lying on the water.
        //
        // Three rings of the one puff, each drawn over the last, in place of a soft-edged brush.
        // A single flat disc has a hard rim, and a dozen hard rims over a hull read as spots on
        // the water rather than as smoke; stacking them thickens the middle and lets the edge go
        // off gradually, which is the whole difference between a cloud and a blob. Three fills
        // beat building a gradient for every puff of every frame.
        const k = 1 - p.life / p.max;
        const rr = p.r0 + (p.r1 - p.r0) * Math.sqrt(k);
        const fade = (1 - k) * Math.min(1, k * 5); // a beat to bloom, then away
        ctx.fillStyle = C.smoke;
        for (const step of [1, 0.7, 0.44]) {
          ctx.globalAlpha = 0.26 * fade;
          ctx.beginPath();
          ctx.ellipse(sx, sy, rr * step, rr * step * TILT, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else if (p.kind === "ring") {
        const k = 1 - p.life / p.max;
        ctx.globalAlpha = (1 - k) * 0.8;
        ctx.strokeStyle = p.col;
        ctx.lineWidth = 1.4;
        const rr = 3 + k * 16;
        ctx.beginPath();
        ctx.ellipse(sx, sy, rr, rr * TILT, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.col;
        ctx.fillRect(sx - 1, sy - 1, 2, 2);
        ctx.globalAlpha = 1;
      }
    }

    // and now every flash, over all of it
    for (const p of fx.parts) {
      if (p.kind !== "muzzle") continue;
      ctx.save();
      ctx.translate(SX(p.x, cam), SY(p.y, cam));
      ctx.scale(1, TILT);
      ctx.rotate(p.ang);
      ctx.globalAlpha = p.life / p.max;
      ctx.fillStyle = "#ffe9a8";
      ctx.beginPath();
      ctx.moveTo(6, 0); ctx.lineTo(14, -3); ctx.lineTo(20, 0); ctx.lineTo(14, 3);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    floatTexts(ctx, vs, fx);
  }

  function render(w, f, v) {
    world = w;
    fx = f;
    view = v;
    if (!world) return;
    worldSpace();
    drawWater(cam);
    drawStormWater(cam);
    drawWakes(cam);
    drawIslands(cam);
    const me = world.ships.find((s) => s.id === fx.me);
    if (view.live && me) arcGuides(ctx, vs, me, view.alpha, view.input);
    drawShots(cam);
    const order = world.ships.filter((s) => s.alive).slice().sort((a, b) => a.y - b.y);
    for (const s of order) drawShip(s, cam);
    drawParts(cam);
    stormEdge(ctx, vs, world, clock);
    screenSpace(); // the two that belong to the screen rather than to the sea
    vignette(ctx, vs, fx);
    if (view.radar !== false) radar(ctx, vs, world, fx, clock); // the replay's window wants none
  }

  // whether any ship afloat lies under a box on the page; see `shipUnder` in view.js
  const under = (rect, w) => shipUnder(vs, rect, w);

  return {
    resize,
    follow,
    render,
    under,
    tick: (dt) => { clock += dt; },
  };
}

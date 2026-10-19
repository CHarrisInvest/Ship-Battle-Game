/**
 * WHAT IS DRAWN OVER THE SEA RATHER THAN ON IT: the aiming guides, the bars and rank over each ship,
 * the words that rise off a sinking, the storm's edge, the red at the edge of the screen and the
 * radar.
 *
 * These are marks for the captain to read, not things floating on the water, so they stay flat and
 * crisp whatever draws the sea under them. Both renderers use the one copy: the Canvas 2D renderer
 * (`src/render/renderer.js`) draws them into its own canvas between the sea's layers, and the
 * three.js renderer draws them on a transparent canvas stacked over the WebGL one. Either way they
 * are placed by the same `view` (`src/render/view.js`), so a bar sits over the same hull in both.
 *
 * Every function takes the 2D context and the view. The ones that mark the water expect the
 * world-space transform (`worldSpace`), in which a unit is a world unit across and down is
 * foreshortened by TILT; the vignette and the radar expect `screenSpace`, in CSS pixels.
 */

import { WORLD, WP, musketArc } from "../sim/index.js";
import { C, UI } from "../render/palette.js";
import { TILT, ZUP, SX, SY, blend } from "../render/view.js";
import { HUD, radarRight } from "../render/hud.js";
import { lookOf } from "../render/effects.js";

export const worldSpace = (ctx, v) => ctx.setTransform(v.dpr * v.zoom, 0, 0, v.dpr * v.zoom, 0, 0);
export const screenSpace = (ctx, v) => ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);

/** The aiming guides off the viewer's own ship, for whichever guns she is holding down. World space. */
export function arcGuides(ctx, v, p, alpha, inp) {
  if (!p.alive) return;
  ctx.save();
  const pos = blend(p, alpha);
  ctx.translate(SX(pos.x, v), SY(pos.y, v));
  ctx.scale(1, TILT);
  ctx.rotate(pos.h);
  ctx.lineWidth = 1.4;
  if (inp.broadside) {
    ctx.strokeStyle = "rgba(217,154,60,0.28)";
    const R = WP.broadside.speed * WP.broadside.life;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, s * 6); ctx.lineTo(0, s * R); ctx.stroke(); }
  }
  if (inp.bow) {
    ctx.strokeStyle = "rgba(122,156,198,0.32)";
    const R = WP.bow.speed * WP.bow.life;
    ctx.beginPath(); ctx.moveTo(p.hullA, 0); ctx.lineTo(R, -R * 0.09); ctx.moveTo(p.hullA, 0); ctx.lineTo(R, R * 0.09); ctx.stroke();
  }
  if (inp.musket) {
    ctx.strokeStyle = "rgba(223,239,255,0.28)";
    const R = WP.musket.speed * WP.musket.life;
    // the guide cone follows the volley's own scatter, so better swivels visibly narrow it
    const arc = 0.875 * musketArc(p);
    ctx.beginPath(); ctx.moveTo(p.hullA, 0); ctx.lineTo(Math.cos(arc) * R, Math.sin(arc) * R); ctx.moveTo(p.hullA, 0); ctx.lineTo(Math.cos(-arc) * R, Math.sin(-arc) * R); ctx.stroke();
  }
  ctx.restore();
}

/**
 * The bars, rank and name over a rival's ship, above her own rig so a boat's sit close over her and
 * a tall ship's clear the royals. `gx, gy` is where her keel is in view space, `h` her heading, `roll`
 * her heel and `topZ` how high over the water the bars should clear. World space. Nothing is drawn
 * over the viewer's own ship, whose bars are the HUD's.
 */
export function shipLabel(ctx, v, s, { gx, gy, h, roll, topZ }, world, fx) {
  if (s.id === fx.me) return;
  const sH = Math.sin(h), cH = Math.cos(h), cR = Math.cos(roll), sR = Math.sin(roll);
  // the point one unit forward of her keel at `topZ`, through her heel, the way her rig is drawn
  const v2 = -topZ * sR, z2 = topZ * cR;
  const byT = gy + (sH + v2 * cH) * TILT - z2 * ZUP - 14;
  const bw = 26, bxL = gx - bw / 2;
  if (world.rules.ranked && s.rank) {
    ctx.font = `700 10px ${UI}`;
    ctx.textAlign = "right";
    ctx.fillStyle = s.rank === 1 ? C.gold : "rgba(238,244,242,0.8)";
    ctx.fillText("#" + s.rank, bxL - 4, byT + 8);
    ctx.textAlign = "left";
  }
  // a friend's ship carries her name over her bars, so she is told apart from the AI at a glance
  const name = s.playerId && fx.names && fx.names[s.playerId];
  if (name) {
    ctx.font = `700 11px ${UI}`;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillText(name, gx + 1, byT - 5);
    ctx.fillStyle = C.gold;
    ctx.fillText(name, gx, byT - 6);
    ctx.textAlign = "left";
  }
  const rows = [[s.hull / s.maxHull, C.hull], [s.mast / s.maxMast, C.mast], [s.crew / s.maxCrew, C.crew]];
  rows.forEach((r, i) => {
    const yy = byT + i * 4;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(bxL, yy, bw, 2.6);
    ctx.fillStyle = r[1];
    ctx.fillRect(bxL, yy, bw * Math.max(0, r[0]), 2.6);
  });
}

/**
 * SUNK and MAST DOWN, rising off the water. White, outlined in a dark halo so they carry on open
 * water, which is a mid tone where plain white would sit too close to it. Halo first: the stroke is
 * centred on the glyph edge and eats half its width into the letter, so the fill goes down over it.
 * World space.
 */
export function floatTexts(ctx, v, fx) {
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  for (const t of fx.texts) {
    ctx.globalAlpha = Math.min(1, t.life);
    ctx.font = `600 10px ${UI}`;
    const tx = SX(t.x, v), ty = SY(t.y, v);
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = "rgba(6,32,31,0.7)";
    ctx.strokeText(t.t, tx, ty);
    ctx.fillStyle = C.ink;
    ctx.fillText(t.t, tx, ty);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = "left";
  ctx.lineJoin = "miter";
}

/** The storm's ring in view space: its centre and its radius across (down is `r * TILT`). */
export const stormEllipse = (v, world) => ({ cx: SX(WORLD / 2, v), cy: SY(WORLD / 2, v), r: world.stormR });

/**
 * The line between fair water and foul, drawn over everything, because it is the one thing a
 * captain must always be able to find. It pulses harder once it is actually closing in. World space.
 */
export function stormEdge(ctx, v, world, clock) {
  if (!world.rules.storm) return;
  const { cx, cy, r } = stormEllipse(v, world);
  const ring = (w, style, dash, off) => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * TILT, 0, 0, Math.PI * 2);
    ctx.lineWidth = w;
    ctx.strokeStyle = style;
    ctx.setLineDash(dash);
    ctx.lineDashOffset = off;
    ctx.stroke();
    ctx.setLineDash([]);
  };
  ring(6, "rgba(0,0,0,0.35)", [], 0);
  const closing = world.time > world.rules.storm.grace ? 1 : 0.45;
  ring(2.4, `rgba(209,91,91,${0.45 + 0.35 * closing * (0.5 + 0.5 * Math.sin(clock * 3))})`, [16, 12], -clock * 26);
}

/** The red at the edge of the screen when she is hit or out in the weather. Screen space. */
export function vignette(ctx, v, fx) {
  const k = fx.vign;
  if (k <= 0) return;
  const { Wd, Hd } = v;
  const grd = ctx.createRadialGradient(Wd / 2, Hd / 2, Math.min(Wd, Hd) * 0.3, Wd / 2, Hd / 2, Math.max(Wd, Hd) * 0.7);
  grd.addColorStop(0, "rgba(209,91,91,0)");
  grd.addColorStop(1, `rgba(209,91,91,${0.38 * k})`);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, Wd, Hd);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * The radar, placed against the HUD's own figures inside the safe area the DOM controls sit in, so
 * sideways it lands to the left of the fire buttons rather than under them. Screen space.
 */
export function radar(ctx, v, world, fx, clock) {
  const { Wd, Hd, safe, cam, Vw, Vh } = v;
  const size = HUD.radar, rx = Wd - safe.r - radarRight(Wd - safe.l - safe.r, Hd - safe.t - safe.b, world.rules.guns) - size, ry = safe.t + HUD.pad;
  ctx.save();
  ctx.fillStyle = "rgba(11,51,49,0.92)";
  ctx.strokeStyle = C.hair;
  ctx.lineWidth = 1;
  roundRect(ctx, rx, ry, size, size, 8);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  roundRect(ctx, rx, ry, size, size, 8);
  ctx.clip();
  const sc = size / WORLD;
  ctx.fillStyle = "rgba(111,174,92,0.85)";
  for (const isl of world.islands) { ctx.beginPath(); ctx.arc(rx + isl.x * sc, ry + isl.y * sc, Math.max(1.5, isl.r * sc), 0, Math.PI * 2); ctx.fill(); }
  const ang = clock * 1.4;
  ctx.strokeStyle = "rgba(95,168,160,0.25)";
  ctx.beginPath();
  ctx.moveTo(rx + size / 2, ry + size / 2);
  ctx.lineTo(rx + size / 2 + Math.cos(ang) * size, ry + size / 2 + Math.sin(ang) * size);
  ctx.stroke();
  ctx.strokeStyle = "rgba(236,226,204,0.3)";
  ctx.strokeRect(rx + cam.x * sc, ry + cam.y * sc, Vw * sc, (Vh / TILT) * sc);
  if (world.rules.storm) {
    ctx.strokeStyle = "rgba(209,91,91,0.85)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(rx + (WORLD / 2) * sc, ry + (WORLD / 2) * sc, world.stormR * sc, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const s of world.ships) {
    if (!s.alive || s.id === fx.me) continue;
    ctx.fillStyle = world.rules.ranked && s.rank === 1 ? C.gold : lookOf(fx, s).fill;
    ctx.beginPath();
    ctx.arc(rx + s.x * sc, ry + s.y * sc, world.rules.ranked && s.rank === 1 ? 3 : 2.3, 0, Math.PI * 2);
    ctx.fill();
  }
  const me = world.ships.find((s) => s.id === fx.me);
  if (me && me.alive) {
    ctx.fillStyle = C.player;
    ctx.beginPath();
    ctx.arc(rx + me.x * sc, ry + me.y * sc, 3, 0, Math.PI * 2);
    ctx.fill();
    // ringed dark, so her own dot is told from a side's yellow ones beside it
    ctx.strokeStyle = "rgba(6,32,31,0.9)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The whole overlay for the three.js renderer, on its own transparent canvas: cleared, then the
 * guides, every rival's bars, the rising words and the storm's edge in world space, then the
 * vignette and the radar in screen space.
 *
 * `opts` is the frame's `{ live, input, alpha }`, as `render` is given it. `labelOf(s)` says where a
 * ship's bars go, as `{ gx, gy, h, roll, topZ }` (see `shipLabel`); the 3D renderer answers it from
 * her model's height and her drawn heel.
 */
export function drawOverlay(ctx, v, world, fx, opts, clock, labelOf) {
  screenSpace(ctx, v);
  ctx.clearRect(0, 0, v.Wd, v.Hd);
  if (!world) return;
  worldSpace(ctx, v);
  const me = world.ships.find((s) => s.id === fx.me);
  if (opts.live && me) arcGuides(ctx, v, me, opts.alpha, opts.input);
  for (const s of world.ships) if (s.alive && s.id !== fx.me) shipLabel(ctx, v, s, labelOf(s), world, fx);
  floatTexts(ctx, v, fx);
  stormEdge(ctx, v, world, clock);
  screenSpace(ctx, v);
  vignette(ctx, v, fx);
  radar(ctx, v, world, fx, clock);
}

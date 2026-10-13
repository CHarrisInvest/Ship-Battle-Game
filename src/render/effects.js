/**
 * ONE VIEWER'S PICTURE OF THE ROUND: the smoke and the sparks, the wakes, the words that rise off a
 * sinking, the red at the edge of the screen, and how each ship looks.
 *
 * None of it is the round. The engine says what happened, as events: a gun fired here, a ball
 * struck there, a ship went down. This turns them into what a captain sees, and none of it is ever
 * read back by the engine, so it can be as random and as frame-rate bound as looks best, and two
 * viewers of the same round may see different smoke. It lives in `fx`, which the screen owns and
 * starts afresh each round.
 */

import { hullForm, tintTimber } from "../hullform.js";
import { clamp, speedCap, outInWeather, STORM_RAMP } from "../sim/index.js";
import { C, AI_COLORS } from "./palette.js";
import { buildSeaRig } from "./searig.js";

/**
 * A fresh picture for the viewer whose ship is `me`: no smoke on the water and no ship yet seen. Her
 * own ship is drawn in her own colours and the screen reddens for her hits rather than anyone's.
 */
export function createFx(me) {
  return { me, parts: [], wakes: [], texts: [], vign: 0, ships: new Map() };
}

/**
 * How one ship looks, worked out the first time she is drawn and kept by her id: her colours, her
 * hull's outline and timber, her rig as it stands at sea, and the few things about her that move
 * only on the screen, which are the white of a fresh hit, her heel into a turn, and when she last
 * left a wake. Nothing about her rig changes at sea short of the whole thing coming down, so it is
 * worked out once.
 */
export function lookOf(fx, s) {
  let look = fx.ships.get(s.id);
  if (!look) {
    const pal = AI_COLORS[(s.livery || 0) % AI_COLORS.length];
    // her hull's own size and shape, from the class's form, and her timber with it, so a pine
    // boat sits pale on the water beside an oak brig
    const form = hullForm(s.loadout.hull.id);
    look = {
      fill: s.id === fx.me ? C.player : pal.fill,
      stroke: s.id === fx.me ? C.playerStroke : pal.stroke,
      sea: form.sea,
      rig: buildSeaRig(s.loadout, form.sea),
      cols: {
        dark: tintTimber(C.hullDark, form.timber),
        deck: tintTimber(C.hullDeck, form.timber),
        wood: tintTimber(C.hullWood, form.timber),
        spar: tintTimber(C.wood, form.timber),
      },
      flash: 0, roll: 0, rollPhase: Math.random() * Math.PI * 2, wakeT: 0, sprayT: 0,
    };
    fx.ships.set(s.id, look);
  }
  return look;
}

function pushText(fx, x, y, t) {
  fx.texts.push({ x, y: y - 26, t, life: 1.3 });
}
function muzzle(fx, x, y, ang) {
  fx.parts.push({ x, y, ang, life: 0.12, max: 0.12, kind: "muzzle" });
}
// A gun going off leaves a bank of smoke hanging where it fired. It is thrown out along the
// barrel, slows almost at once, and then swells and thins where it stands, which is why the
// puffs carry heavy drag rather than a short life: what says "a gun fired here" is the smoke
// still sitting there a second later, well after the flash has gone.
//
// It has to stay on her rail to read as her smoke. Thrown any harder than this the puffs end up
// a full beam off the hull, where they stop looking like gunsmoke and start looking like the
// foam on a shoal. Drag being what it is, a puff settles about a third of its starting speed
// away from the gun, so these numbers put the bank within a few paces of her side.
function smoke(fx, x, y, ang, n, power) {
  for (let i = 0; i < n; i++) {
    const a = ang + (Math.random() - 0.5) * 1.1;
    const sp = (11 + Math.random() * 15) * power;
    const life = (0.55 + Math.random() * 0.45) * power;
    fx.parts.push({
      x: x + (Math.random() - 0.5) * 2.5, y: y + (Math.random() - 0.5) * 2.5,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 3.4,
      life, max: life, r0: 1.2 * power, r1: (5.6 + Math.random() * 3) * power, kind: "puff",
    });
  }
}
function burst(fx, x, y, bar) {
  const col = bar === "hull" ? C.splinter : bar === "mast" ? "#d8e6e0" : C.crew;
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 90;
    fx.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4, max: 0.6, col, kind: "spark" });
  }
  fx.parts.push({ x, y, life: 0.3, max: 0.3, col, kind: "ring" });
}
function splash(fx, x, y) {
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 60;
    fx.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.3, max: 0.4, col: "rgba(240,252,249,0.9)", kind: "spark" });
  }
}
function sinkFx(fx, x, y, col) {
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 120;
    fx.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.6, max: 0.9, col: C.splinter, kind: "spark" });
  }
  fx.parts.push({ x, y, life: 0.5, max: 0.5, col, kind: "ring" });
}

/**
 * What a step's events look like, to the viewer this picture is for.
 *
 * A gun's flash and smoke stand where it fired: a broadside gun's at the rail it fired over, just
 * outside it, and a chaser's or the muskets' off the bow. A ball breaks where it bit, in splinters
 * the colour of what it hit, or in spray where it found the sea or a shoal. Two bows meeting land
 * two blows at one point, and that is one crash to look at, so the second burst at the same point
 * in the same batch is not drawn twice. A sinking throws up her wreckage and, for a rival, the word
 * for how she went; the viewer's own ship going down, or taking a hit to her hull or her crew,
 * reddens the edge of the screen.
 */
export function fxEvents(fx, events) {
  const me = fx.me;
  let rammedAt = null;
  for (const e of events) {
    if (e.type === "fired") {
      if (e.weapon === "broadside") {
        // The bank stands just OUTSIDE the rail, and each puff is small enough that fifty of them
        // make a band down her side rather than one cloud sitting on her. A puff as wide as she is
        // long is a ship in a fog bank: her hull, her flashes and the first few paces of her shot
        // all disappear into it, which is the opposite of what the smoke is there to show.
        smoke(fx, e.x + Math.cos(e.dir) * 2.5, e.y + Math.sin(e.dir) * 2.5, e.dir, 1, 0.9);
        muzzle(fx, e.x, e.y, e.dir);
      } else if (e.weapon === "bow") {
        muzzle(fx, e.x, e.y, e.dir);
        smoke(fx, e.x, e.y, e.dir, 4, 0.92);
      } else {
        muzzle(fx, e.x, e.y, e.dir);
        smoke(fx, e.x, e.y, e.dir, 2, 0.45); // muskets make little enough of it, and fire often
      }
    } else if (e.type === "hit") {
      const at = `${e.x},${e.y}`;
      if (e.cause !== "ram" || at !== rammedAt) burst(fx, e.x, e.y, e.bar);
      if (e.cause === "ram") rammedAt = at;
      if (e.bar !== "mast") {
        const look = fx.ships.get(e.targetId);
        if (look) look.flash = 0.35;
        if (e.targetId === me) fx.vign = Math.min(1, fx.vign + 0.45);
      }
    } else if (e.type === "splash") {
      splash(fx, e.x, e.y);
    } else if (e.type === "sunk") {
      const look = fx.ships.get(e.shipId);
      sinkFx(fx, e.x, e.y, look ? look.fill : C.splinter);
      if (e.shipId === me) fx.vign = 1;
      else pushText(fx, e.x, e.y, e.cause === "storm" ? "LOST" : "SUNK");
      fx.ships.delete(e.shipId);
    } else if (e.type === "dismasted") {
      pushText(fx, e.x, e.y, e.shipId === me ? "OUR MAST!" : "MAST DOWN");
    }
  }
}

/**
 * The picture moved on by `dt` of real time: smoke drifting and thinning, sparks falling, words
 * rising, the red fading, and each ship's wake, bow spray and heel worked out from how she is
 * sailing. The viewer's own time out in the weather tints the screen.
 */
export function stepFx(fx, world, dt) {
  // a steady tint that deepens with her exposure while she is out in the weather, rather than the
  // jolt a hit gives
  const mine = world.ships.find((s) => s.id === fx.me);
  if (mine && outInWeather(world, mine)) {
    fx.vign = Math.max(fx.vign, 0.2 + 0.55 * (mine.exposure / STORM_RAMP));
  }
  for (let i = fx.parts.length - 1; i >= 0; i--) {
    const p = fx.parts[i];
    p.life -= dt;
    // Smoke says how fast it slows in its own terms, so a bank of it stands the same on a phone
    // dropping frames as on a screen holding sixty. The sparks keep the old per-frame damping,
    // which is brief enough that nobody was ever going to catch it drifting.
    if (p.vx !== undefined) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      const k = p.drag !== undefined ? Math.exp(-dt * p.drag) : 0.9;
      p.vx *= k; p.vy *= k;
    }
    if (p.life <= 0) fx.parts.splice(i, 1);
  }
  for (let i = fx.texts.length - 1; i >= 0; i--) {
    const t = fx.texts[i]; t.life -= dt; t.y -= 14 * dt; if (t.life <= 0) fx.texts.splice(i, 1);
  }
  for (let i = fx.wakes.length - 1; i >= 0; i--) { fx.wakes[i].life -= dt; if (fx.wakes[i].life <= 0) fx.wakes.splice(i, 1); }
  for (const look of fx.ships.values()) look.flash = Math.max(0, look.flash - dt);
  fx.vign = Math.max(0, fx.vign - dt * 1.6);

  for (const s of world.ships) {
    if (!s.alive) continue;
    const look = lookOf(fx, s);
    look.rollPhase += dt;
    const target = clamp(-s.turnVel * 0.16, -0.4, 0.4);
    look.roll += (target - look.roll) * Math.min(1, dt * 6);
    if (s.spdCur < 22) continue;
    look.wakeT -= dt;
    if (look.wakeT <= 0) {
      look.wakeT = 0.05;
      const sf = clamp(s.spdCur / 130, 0, 1); // longer trail only when she's really moving
      const wlife = 0.24 + 0.42 * sf;
      const h = s.heading;
      const bx = s.x - Math.cos(h) * s.hullA, by = s.y - Math.sin(h) * s.hullA;
      const px = Math.cos(h + Math.PI / 2), py = Math.sin(h + Math.PI / 2);
      for (const sd of [-1, 1]) fx.wakes.push({ x: bx + px * sd * 4, y: by + py * sd * 4, life: wlife, max: wlife });
    }
    if (s.spdCur > speedCap(s) * 0.82) {
      look.sprayT -= dt;
      if (look.sprayT <= 0) {
        look.sprayT = 0.05;
        const h = s.heading;
        const fx0 = s.x + Math.cos(h) * (s.hullA + 2), fy0 = s.y + Math.sin(h) * (s.hullA + 2);
        for (const sd of [-1, 1]) {
          const a = h + sd * 0.28 + (Math.random() - 0.5) * 0.18, sp = 35 + Math.random() * 45;
          fx.parts.push({ x: fx0, y: fy0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.28, max: 0.38, col: "rgba(232,246,244,0.9)", kind: "spark" });
        }
      }
    }
  }
}

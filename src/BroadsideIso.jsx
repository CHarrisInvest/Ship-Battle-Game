import React, { useRef, useState, useEffect, useCallback } from "react";
import { drawGalleon } from "./galleon.js";

/**
 * BROADSIDE — pirate battles at sea, on a tilted (isometric-ish) sea with tall wooden ships.
 * ARENA: endless survival. One hunter to start, matched to the player gun for gun; kills bring
 * reinforcements in from the edge of the map, well clear of your bow, 1-2-1-2 and then two a kill.
 * They never get stronger, there just get to be more of them, and only you upgrade.
 * FREE-FOR-ALL: up to 10 rival captains, equal start, they upgrade too, hunt whoever's weakest,
 * and turn on a runaway leader. Last afloat wins.
 */

const WORLD = 2000;
const TILT = 0.6; // vertical squash -> high-angle / isometric feel
const ZUP = Math.sqrt(1 - TILT * TILT); // how world-height maps to screen-up
const BASE = { hull: 100, mast: 55, crew: 70 };
const HP_GAIN = { hull: 30, mast: 25, crew: 25 };
const FFA_AI = 10;
const ISLAND_COUNT = 4;

// ARENA: the swarm grows instead of the ships. Reinforcements sail in from the map edge.
const ARENA_START = 1; // hunters afloat when the round opens
const ARENA_RAMP = [1, 2, 1, 2]; // reinforcements for the first four kills, then 2 every kill
const ARENA_SPAWN_CLEAR = 620; // keep a respawn at least this far from the player
const ARENA_MAX_ENEMIES = 14; // ceiling so the fleet stays drawable
const ARENA_SPAWN_GAP = 5; // the second ship of a wave holds off this long
const ARENA_START_COINS = 50; // opening purse, enough for one upgrade before first contact

// nth kill (1-indexed) -> how many ships sail in to replace the one that sank
const arenaReinforcements = (n) => ARENA_RAMP[n - 1] ?? 2;

const C = {
  water: "#0a2830",
  waterEdge: "#04141a",
  grid: "rgba(126,196,190,0.06)",
  player: "#ece2cc",
  playerStroke: "#b3a684",
  ball: "#f2c14e",
  ballEdge: "#3a2c1a",
  pellet: "#dfefff",
  hull: "#d99a3c",
  mast: "#5fa8a0",
  crew: "#d15b5b",
  side: "#e8c877",
  front: "#7a9cc6",
  splinter: "#b98a4a",
  gold: "#e8c877",
  panel: "rgba(10,40,48,0.78)",
  hair: "rgba(150,210,205,0.16)",
  ink: "#eef4f2",
  sand: "#cbb98a",
  sandDark: "#a8935f",
  grass: "#6fae5c",
  grassDark: "#4f8a45",
  tree: "#3f7a3a",
  sail: "#f4ecd8",
  wood: "#6b4a2b",
  hullWood: "#7c5a37",
  hullDeck: "#8c6a44",
  hullDark: "#48331f",
  boundary: "#e8c877",
  buoyA: "#d15b5b",
  buoyB: "#eef4f2",
};

const AI_COLORS = [
  { fill: "#c15236", stroke: "#8a3722" },
  { fill: "#c98a3b", stroke: "#8f5f22" },
  { fill: "#a6584f", stroke: "#743833" },
  { fill: "#7a9c8f", stroke: "#4d6a5f" },
  { fill: "#9c7ab0", stroke: "#5f4d6a" },
  { fill: "#b0a24f", stroke: "#6a5f2a" },
  { fill: "#6f93b4", stroke: "#425a70" },
  { fill: "#c76b8e", stroke: "#7f3f57" },
  { fill: "#5fa27f", stroke: "#356050" },
  { fill: "#b8794f", stroke: "#7a4b2c" },
];

const DISPLAY = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
const UI = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const WP = {
  broadside: { cd: 1.6, speed: 250, life: 0.88, r: 3, bar: "hull" },
  bow: { cd: 1.1, speed: 270, life: 1.4, r: 2.6, bar: "mast" },
  musket: { cd: 0.75, speed: 320, life: 0.4, r: 1.6, bar: "crew" },
};

const SHIP_R = 17;
const HULL_L = 36;
const HULL_W = 13;
const RAM_MIN_CLOSE = 32; // must be charging forward this fast to ram
const RAM_KNOCK = 150; // recoil impulse thrown on a ram (scaled by closing speed)
const RAM_CD = 0.9; // seconds before a ship can ram again

const TRACKS = [
  { key: "mast", label: "MAST", sub: "spd·turn·hp", color: C.mast },
  { key: "hull", label: "HULL", sub: "ram·hp", color: C.hull },
  { key: "crew", label: "CREW", sub: "musket·hp", color: C.crew },
  { key: "side", label: "SIDE", sub: "cannon dmg", color: C.side },
  { key: "front", label: "FRONT", sub: "cannon dmg", color: C.front },
];

const COST = (lvl) => Math.round(45 * Math.pow(1.55, lvl));

function norm(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

const maxHP = (up) => ({
  hull: BASE.hull + up.hull * HP_GAIN.hull,
  mast: BASE.mast + up.mast * HP_GAIN.mast,
  crew: BASE.crew + up.crew * HP_GAIN.crew,
});
const speedCap = (s) => (94 + s.up.mast * 13) * (0.5 + 0.5 * (s.mast / s.maxMast));
const turnCap = (s) => (2.4 + s.up.mast * 0.28) * (0.22 + 0.78 * (s.mast / s.maxMast));
const sideDmg = (s) => 9 + s.up.side * 4;
const frontDmg = (s) => 9 + s.up.front * 4;
const musketDmg = (s) => 3.2 + s.up.crew * 1.4;
const ramDmg = (s) => 15 + s.up.hull * 8;
const shipPower = (s) => s.up.mast + s.up.hull + s.up.crew + s.up.side + s.up.front;

function applyUpgrade(s, track) {
  s.up[track] += 1;
  if (track === "hull") {
    s.maxHull += HP_GAIN.hull;
    s.hull = Math.min(s.maxHull, s.hull + HP_GAIN.hull);
  } else if (track === "mast") {
    s.maxMast += HP_GAIN.mast;
    s.mast = Math.min(s.maxMast, s.mast + HP_GAIN.mast);
  } else if (track === "crew") {
    s.maxCrew += HP_GAIN.crew;
    s.crew = Math.min(s.maxCrew, s.crew + HP_GAIN.crew);
  }
}

export default function App() {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const startRef = useRef(() => {});
  const syncRef = useRef(() => {});
  const inputRef = useRef({ joyMag: 0, joyAng: 0, broadside: false, bow: false, musket: false });

  const knobRef = useRef(null);
  const joyState = useRef({ id: null, cx: 0, cy: 0, R: 34 });
  const btnRefs = { broadside: useRef(null), bow: useRef(null), musket: useRef(null) };

  const [phase, setPhase] = useState("start");
  const [mode, setMode] = useState("arena");
  const [result, setResult] = useState("");
  const [place, setPlace] = useState({ rank: 0, total: 0 });
  const [stats, setStats] = useState({ time: 0, kills: 0, dmg: 0, coins: 0, upgrades: 0 });
  const [coins, setCoins] = useState(0);
  const [sunk, setSunk] = useState(0);
  const [left, setLeft] = useState(0);
  const [rank, setRank] = useState({ rank: 1, total: 1 });
  const [up, setUp] = useState({ mast: 0, hull: 0, crew: 0, side: 0, front: 0 });
  const [ph, setPh] = useState({ ...BASE });
  const [phMax, setPhMax] = useState({ ...BASE });

  const syncHUD = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    const p = g.player;
    setCoins(Math.floor(p.coins));
    setSunk(g.sunk);
    const aliveCount = g.ships.filter((s) => s.alive).length;
    setLeft(aliveCount);
    setRank({ rank: p.rank || 1, total: g.aliveCount || aliveCount });
    setUp({ ...p.up });
    setPh({ hull: p.hull, mast: p.mast, crew: p.crew });
    setPhMax({ hull: p.maxHull, mast: p.maxMast, crew: p.maxCrew });
  }, []);
  syncRef.current = syncHUD;

  const buy = useCallback(
    (track) => {
      const g = gameRef.current;
      if (!g || !g.running) return;
      const p = g.player;
      const cost = COST(p.up[track]);
      if (p.coins < cost) return;
      p.coins -= cost;
      applyUpgrade(p, track);
      syncHUD();
    },
    [syncHUD]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let Wd = 0,
      Hd = 0,
      dpr = 1,
      raf = 0,
      last = 0,
      clock = 0;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      Wd = rect.width;
      Hd = rect.height;
      canvas.width = Math.round(Wd * dpr);
      canvas.height = Math.round(Hd * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const SX = (x, cam) => x - cam.x;
    const SY = (y, cam) => (y - cam.y) * TILT;

    function makeShip(x, y, heading, opts) {
      const up = opts.up || { mast: 0, hull: 0, crew: 0, side: 0, front: 0 };
      const m = maxHP(up);
      const pal = AI_COLORS[opts.ci % AI_COLORS.length];
      const s = {
        x, y, heading, spdCur: 0, alive: true,
        isPlayer: !!opts.isPlayer,
        up: { ...up }, coins: 0, earned: 0, rank: 0, kills: 0, dmgDealt: 0,
        maxHull: m.hull, maxMast: m.mast, maxCrew: m.crew,
        hull: m.hull, mast: m.mast, crew: m.crew,
        cd: { broadside: Math.random() * 0.5, bow: Math.random() * 0.5, musket: Math.random() * 0.5 },
        mastDown: false, flash: 0, ramCd: 0, wakeT: 0, sprayT: 0,
        roll: 0, rollPhase: Math.random() * Math.PI * 2, turnVel: 0, kx: 0, ky: 0,
        fill: opts.isPlayer ? C.player : pal.fill,
        stroke: opts.isPlayer ? C.playerStroke : pal.stroke,
      };
      if (!opts.isPlayer) {
        s.wander = Math.random() * Math.PI * 2;
        s.wanderT = 0;
        s.aiUpT = 1 + Math.random() * 2;
        s.retargetT = 0;
        s.target = null;
        s.bias = TRACKS[Math.floor(Math.random() * TRACKS.length)].key;
      }
      return s;
    }

    function farPos(g, minFromPlayer) {
      let x, y, ok, tries = 0;
      do {
        x = 180 + Math.random() * (WORLD - 360);
        y = 180 + Math.random() * (WORLD - 360);
        ok = true;
        if (g.player && Math.hypot(x - g.player.x, y - g.player.y) < minFromPlayer) ok = false;
        if (ok && g.islands) for (const isl of g.islands) if (Math.hypot(x - isl.x, y - isl.y) < isl.r + 55) { ok = false; break; }
        tries++;
      } while (!ok && tries < 40);
      return { x, y };
    }

    function hash(i, j) {
      const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
      return v - Math.floor(v);
    }

    function genIslands(g) {
      const isl = [];
      let tries = 0;
      while (isl.length < ISLAND_COUNT && tries < 400) {
        tries++;
        const r = 58 + Math.random() * 66;
        const x = r + 90 + Math.random() * (WORLD - 2 * (r + 90));
        const y = r + 90 + Math.random() * (WORLD - 2 * (r + 90));
        if (Math.hypot(x - WORLD / 2, y - WORLD / 2) < 320) continue;
        if (isl.some((o) => Math.hypot(x - o.x, y - o.y) < r + o.r + 170)) continue;
        const n = 12;
        const verts = [];
        for (let k = 0; k < n; k++) verts.push(0.78 + Math.random() * 0.3);
        const foliage = [];
        const fc = 2 + Math.floor(Math.random() * 3);
        for (let f = 0; f < fc; f++) {
          const a = Math.random() * Math.PI * 2, rr = Math.random() * r * 0.4;
          foliage.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr, s: 0.75 + Math.random() * 0.6 });
        }
        isl.push({ x, y, r, verts, foliage });
      }
      g.islands = isl;
    }

    function avoidIslands(s, desired) {
      const g = gameRef.current;
      if (!g.islands) return desired;
      let near = null, nd = 1e9;
      for (const isl of g.islands) {
        const d = Math.hypot(isl.x - s.x, isl.y - s.y) - isl.r;
        if (d < nd) { nd = d; near = isl; }
      }
      if (near && nd < 130) {
        const toI = Math.atan2(near.y - s.y, near.x - s.x);
        const rel = norm(toI - desired);
        if (Math.abs(rel) < 1.0) desired += (rel > 0 ? -1 : 1) * (1.0 - Math.abs(rel) + 0.3);
      }
      return desired;
    }

    function splash(x, y) {
      const parts = gameRef.current.parts;
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 60;
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.3, max: 0.4, col: "rgba(150,210,205,0.85)", kind: "spark" });
      }
    }

    // A point on the map edge, as far from the player as we can manage and clear of islands.
    function edgePos(g, minFromPlayer) {
      const inset = 70;
      let best = null, bestD = -1;
      for (let t = 0; t < 60; t++) {
        const side = t % 4;
        const u = 120 + Math.random() * (WORLD - 240);
        const x = side === 0 ? u : side === 1 ? u : side === 2 ? inset : WORLD - inset;
        const y = side === 0 ? inset : side === 1 ? WORLD - inset : u;
        let blocked = false;
        if (g.islands) for (const isl of g.islands) if (Math.hypot(x - isl.x, y - isl.y) < isl.r + 55) { blocked = true; break; }
        if (blocked) continue;
        const d = g.player ? Math.hypot(x - g.player.x, y - g.player.y) : 1e9;
        if (d >= minFromPlayer) return { x, y };
        if (d > bestD) { bestD = d; best = { x, y }; }
      }
      return best || { x: inset, y: inset };
    }

    function spawnArenaEnemy() {
      const g = gameRef.current;
      const p = edgePos(g, ARENA_SPAWN_CLEAR);
      // bow pointed inland so a fresh hunter sails into the fight, not into the boundary
      const heading = Math.atan2(WORLD / 2 - p.y, WORLD / 2 - p.x) + (Math.random() - 0.5) * 0.8;
      return makeShip(p.x, p.y, heading, { ci: g.ships.length });
    }

    function reset(m) {
      gameRef.current = {
        mode: m, player: null, ships: [], shots: [], parts: [], wakes: [], islands: [], texts: [],
        cam: { x: 0, y: 0 }, sunk: 0, ffaTotal: 0, aliveCount: 0, leader: null, avgEarned: 0,
        _lastRank: 0, spawnT: 0, spawnQueue: 0, vign: 0, running: false, hudDirty: false, hudAcc: 0, time: 0,
      };
      const g = gameRef.current;
      const player = makeShip(WORLD / 2, WORLD / 2, -Math.PI / 2, { isPlayer: true });
      g.player = player;
      g.ships.push(player);
      genIslands(g);
      if (m === "arena") {
        player.coins = ARENA_START_COINS; // a purse, not earnings — keeps it out of the end tally
        for (let i = 0; i < ARENA_START; i++) g.ships.push(spawnArenaEnemy());
      } else {
        for (let i = 0; i < FFA_AI; i++) {
          const pos = farPos(g, 440);
          g.ships.push(makeShip(pos.x, pos.y, Math.random() * Math.PI * 2, { ci: i }));
        }
        g.ffaTotal = g.ships.length;
      }
    }

    function pushText(x, y, t, col) {
      gameRef.current.texts.push({ x, y: y - 26, t, life: 1.3, col });
    }
    function muzzle(x, y, ang) {
      gameRef.current.parts.push({ x, y, ang, life: 0.12, max: 0.12, kind: "muzzle" });
    }
    function burst(x, y, bar) {
      const col = bar === "hull" ? C.splinter : bar === "mast" ? "#d8e6e0" : C.crew;
      const parts = gameRef.current.parts;
      for (let i = 0; i < 7; i++) {
        const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 90;
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4, max: 0.6, col, kind: "spark" });
      }
      parts.push({ x, y, life: 0.3, max: 0.3, col, kind: "ring" });
    }
    function sinkFx(x, y, col) {
      const parts = gameRef.current.parts;
      for (let i = 0; i < 16; i++) {
        const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 120;
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.6, max: 0.9, col: C.splinter, kind: "spark" });
      }
      parts.push({ x, y, life: 0.5, max: 0.5, col, kind: "ring" });
    }

    function finalStats() {
      const g = gameRef.current, p = g.player;
      return {
        time: g.time || 0,
        kills: p.kills || 0,
        dmg: Math.round(p.dmgDealt || 0),
        coins: Math.round(p.earned || 0),
        upgrades: p.up.mast + p.up.hull + p.up.crew + p.up.side + p.up.front,
      };
    }

    function endWin() {
      const g = gameRef.current;
      g.running = false;
      if (g.mode === "ffa") setPlace({ rank: 1, total: g.ffaTotal });
      setStats(finalStats());
      setResult("You are the last hull afloat.");
      setPhase("won");
      syncRef.current();
    }
    function playerDied(bar) {
      const g = gameRef.current;
      g.running = false;
      g.vign = 1;
      g.player.alive = false;
      if (g.mode === "ffa") setPlace({ rank: g.ships.filter((s) => s.alive).length + 1, total: g.ffaTotal });
      setStats(finalStats());
      setResult(bar === "hull" ? "Your hull is breached — she goes under." : "Your crew is routed — you strike your colors.");
      setPhase("dead");
      syncRef.current();
    }

    function killShip(s, attacker) {
      const g = gameRef.current;
      if (attacker && attacker.alive) {
        attacker.coins += 25;
        attacker.earned += 25;
        attacker.kills = (attacker.kills || 0) + 1;
        if (attacker.isPlayer) g.hudDirty = true;
      }
      sinkFx(s.x, s.y, s.fill);
      if (s.isPlayer) { playerDied(s._deathBar || "hull"); return; }
      const i = g.ships.indexOf(s);
      if (i >= 0) g.ships.splice(i, 1);
      pushText(s.x, s.y, "SUNK", C.gold);
      if (g.mode === "arena") {
        g.sunk += 1;
        g.spawnQueue = Math.min(g.spawnQueue + arenaReinforcements(g.sunk), ARENA_MAX_ENEMIES);
        g.spawnT = 0; // lead ship of the wave sails in at once, the next one waits out the gap
      }
      g.hudDirty = true;
      if (g.mode === "ffa" && g.player.alive && g.ships.filter((x) => x.alive).length === 1) endWin();
    }

    function canHit(owner, target) {
      if (!target.alive || target === owner) return false;
      if (gameRef.current.mode === "ffa") return true;
      return owner.isPlayer !== target.isPlayer;
    }

    function applyHit(target, bar, amt, attacker) {
      const g = gameRef.current;
      const before = target[bar];
      target[bar] = Math.max(0, before - amt);
      if (bar !== "mast") target.flash = 0.35;
      if (attacker && attacker.alive) {
        attacker.coins += amt;
        attacker.earned += amt;
        attacker.dmgDealt = (attacker.dmgDealt || 0) + amt;
        if (attacker.isPlayer) g.hudDirty = true;
      }
      if (target.isPlayer) {
        g.hudDirty = true;
        if (bar !== "mast") g.vign = Math.min(1, g.vign + 0.45);
      }
      if (bar === "mast" && before > 0 && target[bar] <= 0 && !target.mastDown) {
        target.mastDown = true;
        pushText(target.x, target.y, target.isPlayer ? "OUR MAST!" : "MAST DOWN", C.mast);
      }
      if ((bar === "hull" || bar === "crew") && target[bar] <= 0 && target.alive) {
        target._deathBar = bar;
        killShip(target, attacker);
      }
    }

    function fire(s, weapon) {
      const g = gameRef.current;
      const w = WP[weapon];
      const h = s.heading;
      const dmg = weapon === "broadside" ? sideDmg(s) : weapon === "bow" ? frontDmg(s) : musketDmg(s);
      const bx = s.x + Math.cos(h) * (HULL_L / 2);
      const by = s.y + Math.sin(h) * (HULL_L / 2);
      const noise = s.isPlayer ? 0 : 0.14;
      const push = (px, py, ang) =>
        g.shots.push({ x: px, y: py, vx: Math.cos(ang) * w.speed, vy: Math.sin(ang) * w.speed, life: w.life, r: w.r, bar: w.bar, dmg, owner: s, kind: weapon });
      if (weapon === "broadside") {
        // 4 guns a side at full hull, down to 3 once she's holed below half
        const offs = s.hull < s.maxHull * 0.5 ? [-10, 0, 10] : [-13, -5, 5, 13];
        const FAN = 0.011; // whole volley fans out along the hull as it travels
        for (const sd of [-1, 1]) {
          const dir = h + (sd * Math.PI) / 2;
          for (const off of offs) push(s.x + Math.cos(h) * off, s.y + Math.sin(h) * off, dir - sd * FAN * off + (Math.random() - 0.5) * (0.05 + noise));
        }
        muzzle(s.x, s.y, h + Math.PI / 2);
        muzzle(s.x, s.y, h - Math.PI / 2);
      } else if (weapon === "bow") {
        // 3 bow chasers at full hull, down to 2 below half
        const angs = s.hull < s.maxHull * 0.5 ? [-0.06, 0.06] : [-0.09, 0, 0.09];
        for (const o of angs) push(bx, by, h + o + (Math.random() - 0.5) * noise);
        muzzle(bx, by, h);
      } else {
        for (let i = 0; i < 6; i++) push(bx, by, h + (Math.random() - 0.5) * (0.8 + noise));
        muzzle(bx, by, h);
      }
    }

    function moveShip(s, dt, desired, throttle) {
      let dH = 0;
      if (throttle > 0.03) {
        const d = norm(desired - s.heading);
        const step = turnCap(s) * dt;
        dH = clamp(d, -step, step);
        s.heading += dH;
      }
      s.turnVel = dt > 0 ? dH / dt : 0;
      const tgt = throttle * speedCap(s);
      s.spdCur += (tgt - s.spdCur) * Math.min(1, dt * 3);
      s.x += Math.cos(s.heading) * s.spdCur * dt;
      s.y += Math.sin(s.heading) * s.spdCur * dt;
      s.x += s.kx * dt;
      s.y += s.ky * dt;
      const kf = Math.exp(-dt * 3.5);
      s.kx *= kf;
      s.ky *= kf;
      s.x = clamp(s.x, 28, WORLD - 28);
      s.y = clamp(s.y, 28, WORLD - 28);
      const g = gameRef.current;
      if (g.islands)
        for (const isl of g.islands) {
          const dx = s.x - isl.x, dy = s.y - isl.y;
          const d = Math.hypot(dx, dy) || 1;
          const minD = isl.r + SHIP_R * 0.8;
          if (d < minD) { s.x = isl.x + (dx / d) * minD; s.y = isl.y + (dy / d) * minD; s.spdCur *= 0.5; }
        }
    }

    function stepPlayer(dt) {
      const g = gameRef.current;
      const p = g.player;
      if (!p.alive) return;
      const inp = inputRef.current;
      const desired = inp.joyMag > 0.08 ? inp.joyAng : p.heading;
      moveShip(p, dt, desired, inp.joyMag);
      p.ramCd = Math.max(0, p.ramCd - dt);
      for (const wk of ["broadside", "bow", "musket"]) {
        p.cd[wk] = Math.max(0, p.cd[wk] - dt);
        if (inp[wk] && p.cd[wk] <= 0) { fire(p, wk); p.cd[wk] = WP[wk].cd; }
      }
    }

    function pickTarget(s) {
      const g = gameRef.current;
      if (g.mode === "arena") return g.player.alive ? g.player : null;
      const leaderSnow = g.leader && g.leader !== s && g.leader.earned > g.avgEarned * 1.6 && g.aliveCount > 2;
      let best = null, bestScore = -1e9, nearest = null, nd = 1e9;
      for (const c of g.ships) {
        if (c === s || !c.alive) continue;
        const dist = Math.hypot(c.x - s.x, c.y - s.y);
        if (dist < nd) { nd = dist; nearest = c; }
        if (dist > 1500) continue;
        let score = -dist * 0.01;
        const isLead = leaderSnow && c === g.leader;
        if (isLead) score += 130;
        const dP = shipPower(c) - shipPower(s);
        if (!isLead && dP > 2) score -= dP * 18;
        if (dP < 0) score += -dP * 7;
        const hpR = Math.min(c.hull / c.maxHull, c.crew / c.maxCrew);
        if (hpR < 0.5) score += (0.5 - hpR) * 120;
        if (score > bestScore) { bestScore = score; best = c; }
      }
      return best || nearest;
    }

    function aiUpgrade(s, dt) {
      s.aiUpT -= dt;
      if (s.aiUpT > 0) return;
      s.aiUpT = 1.4 + Math.random() * 1.2;
      const hpR = Math.min(s.hull / s.maxHull, s.crew / s.maxCrew);
      let best = null, bestScore = 1e9;
      for (const t of ["mast", "hull", "crew", "side", "front"]) {
        let score = s.up[t] * 10 + Math.random() * 4;
        if (t === s.bias) score -= 6;
        if (hpR < 0.45 && (t === "hull" || t === "crew")) score -= 16;
        if (score < bestScore) { bestScore = score; best = t; }
      }
      const cost = COST(s.up[best]);
      if (s.coins >= cost) { s.coins -= cost; applyUpgrade(s, best); }
    }

    function stepAI(s, dt) {
      const g = gameRef.current;
      if (!s.alive) return;
      s.retargetT -= dt;
      if (!s.target || !s.target.alive || s.retargetT <= 0) {
        s.target = pickTarget(s);
        s.retargetT = 0.7 + Math.random() * 0.6;
      }
      const tgt = s.target;
      for (const wk of ["broadside", "bow", "musket"]) s.cd[wk] = Math.max(0, s.cd[wk] - dt);
      s.ramCd = Math.max(0, s.ramCd - dt);
      const nearWall = s.x < 140 || s.x > WORLD - 140 || s.y < 140 || s.y > WORLD - 140;

      if (!tgt) {
        s.wanderT -= dt;
        if (s.wanderT <= 0) { s.wander += (Math.random() - 0.5) * 1.2; s.wanderT = 1.5 + Math.random(); }
        moveShip(s, dt, avoidIslands(s, nearWall ? Math.atan2(WORLD / 2 - s.y, WORLD / 2 - s.x) : s.wander), 0.4);
        if (g.mode === "ffa") aiUpgrade(s, dt);
        return;
      }

      const dx = tgt.x - s.x, dy = tgt.y - s.y;
      const dist = Math.hypot(dx, dy);
      const toT = Math.atan2(dy, dx);
      const bearing = norm(toT - s.heading);
      const hpR = Math.min(s.hull / s.maxHull, s.crew / s.maxCrew);
      const scary = shipPower(tgt) - shipPower(s) > 2;
      const fleeing = g.mode === "ffa" && (hpR < 0.3 || (scary && hpR < 0.55));

      if (fleeing) {
        let away = Math.atan2(s.y - tgt.y, s.x - tgt.x);
        if (nearWall) away = Math.atan2(WORLD / 2 - s.y, WORLD / 2 - s.x);
        moveShip(s, dt, avoidIslands(s, away), 0.95);
        aiUpgrade(s, dt);
        return;
      }

      let desired, throttle;
      if (nearWall && dist > 260) { desired = Math.atan2(WORLD / 2 - s.y, WORLD / 2 - s.x); throttle = 0.7; }
      else if (dist > 900) {
        s.wanderT -= dt;
        if (s.wanderT <= 0) { s.wander = toT + (Math.random() - 0.5) * 0.8; s.wanderT = 1.2 + Math.random(); }
        desired = s.wander; throttle = 0.6;
      } else if ((tgt.hull < tgt.maxHull * 0.4 || tgt.crew < tgt.maxCrew * 0.4) && dist < 520) {
        desired = toT; throttle = 1; // line up and charge a wounded ship to ram it down
      } else if (dist < 150 && Math.abs(bearing) < 0.35) {
        desired = toT; throttle = 1; // opportunistic ram when already bow-on and close
      } else if (dist > 225) { desired = toT; throttle = 0.9; }
      else { const sign = bearing >= 0 ? 1 : -1; desired = toT - (sign * Math.PI) / 2; throttle = 0.5; }
      moveShip(s, dt, avoidIslands(s, desired), throttle);

      const ab = Math.abs(bearing);
      // arena hunters reload exactly as fast as the player; ffa rivals keep their handicap
      const cdMul = g.mode === "arena" ? 1 : 1.25;
      if (dist < 220 && Math.abs(ab - Math.PI / 2) < 0.4 && s.cd.broadside <= 0) { fire(s, "broadside"); s.cd.broadside = WP.broadside.cd * cdMul; }
      if (dist < 360 && ab < 0.28 && s.cd.bow <= 0) { fire(s, "bow"); s.cd.bow = WP.bow.cd * cdMul; }
      if (dist < 130 && ab < 0.45 && s.cd.musket <= 0) { fire(s, "musket"); s.cd.musket = WP.musket.cd * (g.mode === "arena" ? 1 : 1.2); }
      if (g.mode === "ffa") aiUpgrade(s, dt);
    }

    function stepRam() {
      const g = gameRef.current;
      const ships = g.ships;
      for (let i = 0; i < ships.length; i++) {
        for (let j = i + 1; j < ships.length; j++) {
          const a = ships[i], b = ships[j];
          if (!a.alive || !b.alive) continue;
          if (!(g.mode === "ffa" || a.isPlayer !== b.isPlayer)) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d >= SHIP_R * 1.7) continue;
          const nx = dx / d, ny = dy / d; // unit vector a -> b
          // always de-overlap so hulls never sit inside each other
          const ov = SHIP_R * 1.7 - d;
          a.x -= nx * ov * 0.5; a.y -= ny * ov * 0.5;
          b.x += nx * ov * 0.5; b.y += ny * ov * 0.5;
          // closing speed = each ship's forward velocity aimed at the other
          const closeA = (Math.cos(a.heading) * nx + Math.sin(a.heading) * ny) * a.spdCur;
          const closeB = -(Math.cos(b.heading) * nx + Math.sin(b.heading) * ny) * b.spdCur;
          let hit = false;
          if (a.ramCd <= 0 && closeA > RAM_MIN_CLOSE) {
            applyHit(b, "hull", ramDmg(a) * clamp(closeA / 80, 0.6, 1.5), a);
            a.ramCd = RAM_CD;
            hit = true;
          }
          if (b.alive && b.ramCd <= 0 && closeB > RAM_MIN_CLOSE) {
            applyHit(a, "hull", ramDmg(b) * clamp(closeB / 80, 0.6, 1.5), b);
            b.ramCd = RAM_CD;
            hit = true;
          }
          if (hit) {
            // recoil scaled by how hard the charge landed; kills forward drive
            // so they can't grind ram damage back and forth after impact
            const impulse = RAM_KNOCK * clamp(Math.max(closeA, closeB) / 90, 0.4, 1.2);
            a.kx -= nx * impulse; a.ky -= ny * impulse;
            b.kx += nx * impulse; b.ky += ny * impulse;
            a.spdCur *= 0.12; b.spdCur *= 0.12;
            burst((a.x + b.x) / 2, (a.y + b.y) / 2, "hull");
          } else {
            // incidental touch, nobody charging bow-first: gentle nudge, no recoil, no damage
            a.kx -= nx * 32; a.ky -= ny * 32;
            b.kx += nx * 32; b.ky += ny * 32;
          }
        }
      }
    }

    function stepShots(dt) {
      const g = gameRef.current;
      const s = g.shots;
      for (let i = s.length - 1; i >= 0; i--) {
        const b = s[i];
        b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
        let hit = false;
        for (const isl of g.islands) {
          if (Math.hypot(b.x - isl.x, b.y - isl.y) < isl.r) { splash(b.x, b.y); hit = true; break; }
        }
        if (!hit)
          for (const target of g.ships) {
            if (!canHit(b.owner, target)) continue;
            if (Math.hypot(b.x - target.x, b.y - target.y) < SHIP_R) {
              applyHit(target, b.bar, b.dmg, b.owner);
              burst(b.x, b.y, b.bar);
              hit = true;
              break;
            }
          }
        if (hit || b.life <= 0 || b.x < 0 || b.x > WORLD || b.y < 0 || b.y > WORLD) s.splice(i, 1);
      }
    }

    function stepParts(dt) {
      const g = gameRef.current;
      for (let i = g.parts.length - 1; i >= 0; i--) {
        const p = g.parts[i];
        p.life -= dt;
        if (p.vx !== undefined) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9; }
        if (p.life <= 0) g.parts.splice(i, 1);
      }
      for (let i = g.texts.length - 1; i >= 0; i--) {
        const t = g.texts[i]; t.life -= dt; t.y -= 14 * dt; if (t.life <= 0) g.texts.splice(i, 1);
      }
      for (let i = g.wakes.length - 1; i >= 0; i--) { g.wakes[i].life -= dt; if (g.wakes[i].life <= 0) g.wakes.splice(i, 1); }
      for (const s of g.ships) s.flash = Math.max(0, s.flash - dt);
      g.vign = Math.max(0, g.vign - dt * 1.6);
    }

    function maintain(dt) {
      const g = gameRef.current;
      if (g.mode !== "arena") return;
      g.spawnT -= dt;
      const enemies = g.ships.filter((s) => !s.isPlayer).length;
      if (enemies === 0 && g.spawnQueue <= 0) g.spawnQueue = 1; // never leave the sea empty
      if (g.spawnQueue > 0 && enemies < ARENA_MAX_ENEMIES && g.spawnT <= 0) {
        g.ships.push(spawnArenaEnemy());
        g.spawnQueue -= 1;
        g.spawnT = ARENA_SPAWN_GAP;
      }
    }

    function computeMeta() {
      const g = gameRef.current;
      if (g.mode !== "ffa") return;
      const alive = g.ships.filter((s) => s.alive);
      alive.sort((a, b) => b.earned - a.earned || b.coins - a.coins);
      alive.forEach((s, i) => (s.rank = i + 1));
      g.leader = alive[0] || null;
      g.aliveCount = alive.length;
      g.avgEarned = alive.reduce((t, s) => t + s.earned, 0) / Math.max(1, alive.length);
      if (g.player.alive && g.player.rank !== g._lastRank) { g._lastRank = g.player.rank; g.hudDirty = true; }
    }

    function camUpdate() {
      const g = gameRef.current;
      const viewH = Hd / TILT;
      g.cam.x = clamp(g.player.x - Wd / 2, 0, Math.max(0, WORLD - Wd));
      g.cam.y = clamp(g.player.y - viewH / 2, 0, Math.max(0, WORLD - viewH));
    }

    function update(dt) {
      const g = gameRef.current;
      g.time += dt;
      computeMeta();
      stepPlayer(dt);
      for (const s of g.ships) if (!s.isPlayer) stepAI(s, dt);
      stepRam();
      stepShots(dt);
      stepParts(dt);
      maintain(dt);
      for (const s of g.ships) {
        if (!s.alive || s.spdCur < 22) continue;
        s.wakeT -= dt;
        if (s.wakeT <= 0) {
          s.wakeT = 0.05;
          const sf = clamp(s.spdCur / 130, 0, 1); // longer trail only when she's really moving
          const wlife = 0.24 + 0.42 * sf;
          const h = s.heading;
          const bx = s.x - Math.cos(h) * (HULL_L / 2), by = s.y - Math.sin(h) * (HULL_L / 2);
          const px = Math.cos(h + Math.PI / 2), py = Math.sin(h + Math.PI / 2);
          for (const sd of [-1, 1]) g.wakes.push({ x: bx + px * sd * 4, y: by + py * sd * 4, life: wlife, max: wlife });
        }
        if (s.spdCur > speedCap(s) * 0.82) {
          s.sprayT -= dt;
          if (s.sprayT <= 0) {
            s.sprayT = 0.05;
            const h = s.heading;
            const fx = s.x + Math.cos(h) * (HULL_L / 2 + 2), fy = s.y + Math.sin(h) * (HULL_L / 2 + 2);
            for (const sd of [-1, 1]) {
              const a = h + sd * 0.28 + (Math.random() - 0.5) * 0.18, sp = 35 + Math.random() * 45;
              g.parts.push({ x: fx, y: fy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.28, max: 0.38, col: "rgba(232,246,244,0.9)", kind: "spark" });
            }
          }
        }
      }
      for (const s of g.ships) {
        if (!s.alive) continue;
        s.rollPhase += dt;
        const target = clamp(-s.turnVel * 0.16, -0.4, 0.4);
        s.roll += (target - s.roll) * Math.min(1, dt * 6);
      }
      camUpdate();
      updateButtons();
      g.hudAcc += dt;
      if (g.hudDirty && g.hudAcc > 0.09) { syncRef.current(); g.hudDirty = false; g.hudAcc = 0; }
    }

    function updateButtons() {
      const p = gameRef.current.player;
      for (const wk of ["broadside", "bow", "musket"]) {
        const el = btnRefs[wk].current;
        if (!el) continue;
        const ratio = 1 - p.cd[wk] / WP[wk].cd;
        const fill = el.querySelector(".cd-fill");
        if (fill) fill.style.transform = `scaleX(${clamp(ratio, 0, 1)})`;
        el.style.opacity = p.cd[wk] > 0 ? "0.55" : "1";
      }
    }

    // ---------------- rendering ----------------
    function drawWater(cam) {
      ctx.fillStyle = C.water;
      ctx.fillRect(0, 0, Wd, Hd);
      const x0 = SX(0, cam), x1 = SX(WORLD, cam), y0 = SY(0, cam), y1 = SY(WORLD, cam);
      ctx.fillStyle = C.waterEdge;
      if (y0 > 0) ctx.fillRect(0, 0, Wd, y0);
      if (y1 < Hd) ctx.fillRect(0, y1, Wd, Hd - y1);
      if (x0 > 0) ctx.fillRect(0, 0, x0, Hd);
      if (x1 < Wd) ctx.fillRect(x1, 0, Wd - x1, Hd);
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const step = 80;
      const gy0 = Math.max(0, y0), gy1 = Math.min(Hd, y1), gx0 = Math.max(0, x0), gx1 = Math.min(Wd, x1);
      for (let X = Math.ceil(cam.x / step) * step; X <= WORLD; X += step) { const sx = SX(X, cam); if (sx > Wd) break; if (sx < 0) continue; ctx.moveTo(sx, gy0); ctx.lineTo(sx, gy1); }
      for (let Y = Math.ceil(cam.y / step) * step; Y <= WORLD; Y += step) { const sy = SY(Y, cam); if (sy > Hd) break; if (sy < 0) continue; ctx.moveTo(gx0, sy); ctx.lineTo(gx1, sy); }
      ctx.stroke();
      const cs = 130;
      const ci0 = Math.floor(cam.x / cs) - 1, ci1 = Math.floor((cam.x + Wd) / cs) + 1;
      const cj0 = Math.floor(cam.y / cs) - 1, cj1 = Math.floor((cam.y + Hd / TILT) / cs) + 1;
      ctx.strokeStyle = "#bfe4de";
      ctx.lineWidth = 1.4;
      for (let ci = ci0; ci <= ci1; ci++) {
        for (let cj = cj0; cj <= cj1; cj++) {
          const h1 = hash(ci, cj), h2 = hash(ci + 9, cj + 4);
          const wx = (ci + h1) * cs, wy = (cj + h2) * cs;
          if (wx < 6 || wx > WORLD - 6 || wy < 6 || wy > WORLD - 6) continue;
          const sx = SX(wx, cam), sy = SY(wy, cam) + Math.sin(clock * 1.3 + h1 * 6.283) * 1.4;
          ctx.globalAlpha = 0.05 + 0.03 * (0.5 + 0.5 * Math.sin(clock + h2 * 6.283));
          ctx.beginPath();
          ctx.moveTo(sx - 3, sy);
          ctx.lineTo(sx + 3, sy);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
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
        if (sx < -10 || sx > Wd + 10 || sy < -10 || sy > Hd + 10) return;
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

    function drawWakes(cam) {
      const g = gameRef.current;
      for (const w of g.wakes) {
        const k = w.life / w.max;
        ctx.globalAlpha = k * 0.5;
        ctx.fillStyle = "#dcf0ee";
        const rr = 1.6 + (1 - k) * 4.5;
        ctx.beginPath();
        ctx.ellipse(SX(w.x, cam), SY(w.y, cam), rr, rr * TILT, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function drawIslands(cam) {
      const g = gameRef.current;
      for (const isl of g.islands) {
        const cx = SX(isl.x, cam), cy = SY(isl.y, cam);
        if (cx < -isl.r - 40 || cx > Wd + isl.r + 40 || cy < -isl.r * TILT - 60 || cy > Hd + isl.r * TILT + 60) continue;
        const n = isl.verts.length;
        ctx.save();
        ctx.translate(cx, cy);
        const ring = (scale, extra) => {
          ctx.beginPath();
          for (let k = 0; k <= n; k++) {
            const a = ((k % n) / n) * Math.PI * 2;
            const rr = isl.r * isl.verts[k % n] * scale + extra(k);
            const X = Math.cos(a) * rr, Y = Math.sin(a) * rr * TILT;
            if (k === 0) ctx.moveTo(X, Y);
            else ctx.lineTo(X, Y);
          }
          ctx.closePath();
        };
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = "#000";
        ring(1.02, () => 0);
        ctx.fill();
        ctx.globalAlpha = 1;
        ring(1.14, (k) => Math.sin(clock * 2 + k) * 2);
        ctx.fillStyle = "rgba(255,255,255,0.14)";
        ctx.fill();
        ring(1, () => 0);
        ctx.fillStyle = C.sand;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = C.sandDark;
        ctx.stroke();
        ring(0.72, () => 0);
        ctx.fillStyle = C.grass;
        ctx.fill();
        ctx.globalAlpha = 0.5;
        ring(0.5, () => 0);
        ctx.fillStyle = C.grassDark;
        ctx.fill();
        ctx.globalAlpha = 1;
        for (const f of isl.foliage) {
          const fx = f.x, fy = f.y * TILT;
          const tr = isl.r * 0.12 * f.s;
          ctx.fillStyle = "rgba(0,0,0,0.2)";
          ctx.beginPath();
          ctx.ellipse(fx + 1, fy + 2, tr, tr * TILT, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = C.wood;
          ctx.fillRect(fx - 1, fy - tr, 2, tr);
          ctx.fillStyle = C.tree;
          ctx.beginPath();
          ctx.arc(fx, fy - tr, tr, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    function drawArcGuides(p, cam) {
      if (!p.alive) return;
      const inp = inputRef.current;
      ctx.save();
      ctx.translate(SX(p.x, cam), SY(p.y, cam));
      ctx.scale(1, TILT);
      ctx.rotate(p.heading);
      ctx.lineWidth = 1.4;
      if (inp.broadside) {
        ctx.strokeStyle = "rgba(217,154,60,0.28)";
        const R = WP.broadside.speed * WP.broadside.life;
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, s * 6); ctx.lineTo(0, s * R); ctx.stroke(); }
      }
      if (inp.bow) {
        ctx.strokeStyle = "rgba(122,156,198,0.32)";
        const R = WP.bow.speed * WP.bow.life;
        ctx.beginPath(); ctx.moveTo(HULL_L / 2, 0); ctx.lineTo(R, -R * 0.09); ctx.moveTo(HULL_L / 2, 0); ctx.lineTo(R, R * 0.09); ctx.stroke();
      }
      if (inp.musket) {
        ctx.strokeStyle = "rgba(223,239,255,0.28)";
        const R = WP.musket.speed * WP.musket.life;
        ctx.beginPath(); ctx.moveTo(HULL_L / 2, 0); ctx.lineTo(Math.cos(0.7) * R, Math.sin(0.7) * R); ctx.moveTo(HULL_L / 2, 0); ctx.lineTo(Math.cos(-0.7) * R, Math.sin(-0.7) * R); ctx.stroke();
      }
      ctx.restore();
    }

    function drawShip(s, cam) {
      const g = gameRef.current;
      const H = s.heading, cH = Math.cos(H), sH = Math.sin(H);
      const roll = s.roll + Math.sin(s.rollPhase * 1.2) * 0.05; // bank into turns + gentle idle heel
      const cR = Math.cos(roll), sR = Math.sin(roll);
      const gx = SX(s.x, cam), gy = SY(s.y, cam);
      const deckH = 4, STERN_H = 9;
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
      ctx.ellipse(gx, gy + 2, HULL_L * 0.5, HULL_W * 0.5 * TILT + 2, s.heading, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // V-shaped bow wave — subtle at cruise, pronounced on a charge
      const sf = clamp((s.spdCur - 28) / 110, 0, 1);
      if (sf > 0.03) {
        const apex = P3(18 + 2 * sf, 0, 0);
        const spread = 6 + 6 * sf, len = 10 + 10 * sf;
        const lft = P3(20 - len, -spread, 0), rgt = P3(20 - len, spread, 0);
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
      const trim = s.isPlayer ? C.gold : s.fill;

      // hull: dark waterline body + brown deck, trimmed in the ship's colour
      const hull = [[18, 0], [11, -6], [-13, -6], [-17, 0], [-13, 6], [11, 6]];
      const tracePoly = (z) => {
        ctx.beginPath();
        hull.forEach(([u, v], i) => { const [X, Y] = P3(u, v, z); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); });
        ctx.closePath();
      };
      tracePoly(0); ctx.fillStyle = C.hullDark; ctx.fill();
      tracePoly(deckH);
      ctx.fillStyle = C.hullDeck; ctx.fill();
      if (s.flash > 0) { ctx.globalAlpha = s.flash; ctx.fillStyle = "#fff"; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.lineWidth = s.isPlayer ? 2 : 1.6; ctx.strokeStyle = trim; ctx.stroke(); // gunwale trim
      // painted trim stripe around the hull side
      tracePoly(deckH * 0.5); ctx.lineWidth = 1.6; ctx.strokeStyle = trim; ctx.globalAlpha = 0.85; ctx.stroke(); ctx.globalAlpha = 1;
      // bowsprit
      line(P3(-4, 0, deckH + 1), P3(22, 0, deckH + 2), C.wood, 1.4);

      // raised stern castle (quarterdeck cabin) on the back quarter, like a real ship
      {
        const cf = [[-11, -5], [-11, 5], [-18, 3.8], [-18, -3.8]]; // FL, FR, BR, BL — overhangs the stern slightly
        const baseC = cf.map(([u, v]) => P3(u, v, deckH));
        const topC = cf.map(([u, v]) => P3(u, v, deckH + STERN_H));
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
          ctx.fillStyle = C.hullWood; ctx.fill();
          ctx.globalAlpha = 0.2; ctx.fillStyle = "#000"; ctx.fill(); ctx.globalAlpha = 1;
          ctx.lineWidth = 1; ctx.strokeStyle = C.hullDark; ctx.stroke();
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
        ctx.fillStyle = C.hullDeck; ctx.fill();
        ctx.lineWidth = 1.2; ctx.strokeStyle = trim; ctx.stroke();
      }

      // masts + bellied square sails hung on the BOW side of each pole
      const masts = s.mastDown
        ? []
        : [
            { u: 11, h: 27, w: 14, sb: 7, st: 24 },
            { u: 1, h: 34, w: 18, sb: 9, st: 30 },
            { u: -9, h: 24, w: 13, sb: 6, st: 21 },
          ];
      const fwd = 1.5, belly = 3, MINW = 4, N = 6;
      const mz = (u) => (u <= -11 ? deckH + STERN_H : deckH); // a mast stands on the quarterdeck only if it's aft of its front wall
      const drawSail = (m) => {
        const bz = mz(m.u);
        const topZ = bz + m.st, botZ = bz + m.sb;
        // sample the bellied cloth across the beam into columns
        const cols = [];
        for (let k = 0; k <= N; k++) {
          const t = k / N, v = -m.w / 2 + m.w * t, nrm = v / (m.w / 2);
          const uu = m.u + fwd + belly * (1 - nrm * nrm); // bellies forward toward the bow
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
        line(cols[0].top, cols[N].top, C.wood, 1.3);
      };
      const drawPole = (m, base, top) => {
        line(base, top, C.wood, 1.7);
        const bz = mz(m.u);
        const f2 = P3(m.u - 5, 0, bz + m.h - 0.6), f3 = P3(m.u, 0, bz + m.h - 2.4);
        ctx.fillStyle = trim;
        ctx.beginPath(); ctx.moveTo(top[0], top[1]); ctx.lineTo(f2[0], f2[1]); ctx.lineTo(f3[0], f3[1]); ctx.closePath(); ctx.fill();
      };
      // depth-sort every pole and sail together: whichever is farther from the
      // camera is painted first, so the mast sits behind its bow-side sail when
      // she sails toward you and in front of it when she sails away.
      const prims = [];
      for (const m of masts) {
        prims.push({ d: m.u * sH, kind: "pole", m, base: P3(m.u, 0, mz(m.u)), top: P3(m.u, 0, mz(m.u) + m.h) });
        prims.push({ d: (m.u + fwd + belly * 0.5) * sH, kind: "sail", m });
      }
      prims.sort((a, b) => a.d - b.d);
      for (const p of prims) { if (p.kind === "pole") drawPole(p.m, p.base, p.top); else drawSail(p.m); }
      if (s.mastDown) line(P3(-2, 0, deckH), P3(-2, 3, deckH + 8), C.wood, 1.8);

      // health bars + rank, above the rig
      if (!s.isPlayer) {
        const bw = 26, bxL = gx - bw / 2;
        const byT = P3(1, 0, deckH + 34)[1] - 14;
        if (g.mode === "ffa" && s.rank) {
          ctx.font = `700 10px ${UI}`;
          ctx.textAlign = "right";
          ctx.fillStyle = s.rank === 1 ? C.gold : "rgba(238,244,242,0.8)";
          ctx.fillText("#" + s.rank, bxL - 4, byT + 8);
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
    }

    function drawShots(cam) {
      for (const b of gameRef.current.shots) {
        const sx = SX(b.x, cam), sy = SY(b.y, cam) - 3;
        if (b.kind === "musket") {
          ctx.strokeStyle = C.pellet;
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx - b.vx * 0.012, sy - b.vy * 0.012 * TILT);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(sx, sy, b.r, 0, Math.PI * 2);
          ctx.fillStyle = C.ball;
          ctx.fill();
          ctx.lineWidth = 0.8;
          ctx.strokeStyle = C.ballEdge;
          ctx.stroke();
        }
      }
    }

    function drawParts(cam) {
      const g = gameRef.current;
      for (const p of g.parts) {
        const sx = SX(p.x, cam), sy = SY(p.y, cam);
        if (p.kind === "muzzle") {
          const k = p.life / p.max;
          ctx.save();
          ctx.translate(sx, sy);
          ctx.scale(1, TILT);
          ctx.rotate(p.ang);
          ctx.globalAlpha = k;
          ctx.fillStyle = "#ffe9a8";
          ctx.beginPath();
          ctx.moveTo(6, 0); ctx.lineTo(14, -3); ctx.lineTo(20, 0); ctx.lineTo(14, 3);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.restore();
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
      ctx.textAlign = "center";
      for (const t of g.texts) {
        ctx.globalAlpha = Math.min(1, t.life);
        ctx.fillStyle = t.col;
        ctx.font = `600 12px ${UI}`;
        ctx.fillText(t.t, SX(t.x, cam), SY(t.y, cam));
        ctx.globalAlpha = 1;
      }
      ctx.textAlign = "left";
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function drawRadar() {
      const g = gameRef.current;
      const size = 96, rx = Wd - size - 10, ry = 10;
      ctx.save();
      ctx.fillStyle = "rgba(6,26,32,0.9)";
      ctx.strokeStyle = C.hair;
      ctx.lineWidth = 1;
      roundRect(rx, ry, size, size, 8);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      roundRect(rx, ry, size, size, 8);
      ctx.clip();
      const sc = size / WORLD;
      ctx.fillStyle = "rgba(111,174,92,0.85)";
      for (const isl of g.islands) { ctx.beginPath(); ctx.arc(rx + isl.x * sc, ry + isl.y * sc, Math.max(1.5, isl.r * sc), 0, Math.PI * 2); ctx.fill(); }
      const ang = clock * 1.4;
      ctx.strokeStyle = "rgba(95,168,160,0.25)";
      ctx.beginPath();
      ctx.moveTo(rx + size / 2, ry + size / 2);
      ctx.lineTo(rx + size / 2 + Math.cos(ang) * size, ry + size / 2 + Math.sin(ang) * size);
      ctx.stroke();
      ctx.strokeStyle = "rgba(236,226,204,0.3)";
      ctx.strokeRect(rx + g.cam.x * sc, ry + g.cam.y * sc, Wd * sc, (Hd / TILT) * sc);
      for (const s of g.ships) {
        if (!s.alive || s.isPlayer) continue;
        ctx.fillStyle = g.mode === "ffa" && s.rank === 1 ? C.gold : s.fill;
        ctx.beginPath();
        ctx.arc(rx + s.x * sc, ry + s.y * sc, g.mode === "ffa" && s.rank === 1 ? 3 : 2.3, 0, Math.PI * 2);
        ctx.fill();
      }
      if (g.player.alive) {
        ctx.fillStyle = C.player;
        ctx.beginPath();
        ctx.arc(rx + g.player.x * sc, ry + g.player.y * sc, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    function drawVignette() {
      const v = gameRef.current.vign;
      if (v <= 0) return;
      const grd = ctx.createRadialGradient(Wd / 2, Hd / 2, Math.min(Wd, Hd) * 0.3, Wd / 2, Hd / 2, Math.max(Wd, Hd) * 0.7);
      grd.addColorStop(0, "rgba(209,91,91,0)");
      grd.addColorStop(1, `rgba(209,91,91,${0.38 * v})`);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, Wd, Hd);
    }

    function render() {
      const g = gameRef.current;
      if (!g) return;
      const cam = g.cam;
      drawWater(cam);
      drawWakes(cam);
      drawIslands(cam);
      if (g.running) drawArcGuides(g.player, cam);
      drawShots(cam);
      const order = g.ships.filter((s) => s.alive).slice().sort((a, b) => a.y - b.y);
      for (const s of order) drawShip(s, cam);
      drawParts(cam);
      drawVignette();
      drawRadar();
    }

    function loop(ts) {
      if (!last) last = ts;
      let dt = (ts - last) / 1000;
      last = ts;
      if (dt > 0.05) dt = 0.05;
      clock += dt;
      const g = gameRef.current;
      if (g && g.running) update(dt);
      render();
      raf = requestAnimationFrame(loop);
    }

    function start(m) {
      reset(m);
      camUpdate();
      const g = gameRef.current;
      if (m === "ffa") computeMeta();
      g.running = true;
      inputRef.current = { joyMag: 0, joyAng: 0, broadside: false, bow: false, musket: false };
      last = 0;
      syncRef.current();
      setResult("");
      setMode(m);
      setPhase("playing");
    }
    startRef.current = start;

    resize();
    reset("arena");
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  const joyDown = (e) => {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    joyState.current = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2, R: r.width / 2 - 22 };
    e.currentTarget.setPointerCapture(e.pointerId);
    joyMove(e);
  };
  const joyMove = (e) => {
    const js = joyState.current;
    if (js.id !== e.pointerId) return;
    const dx = e.clientX - js.cx, dy = e.clientY - js.cy;
    const len = Math.hypot(dx, dy) || 1;
    const cl = Math.min(len, js.R);
    if (knobRef.current) knobRef.current.style.transform = `translate(${(dx / len) * cl}px, ${(dy / len) * cl}px)`;
    inputRef.current.joyMag = cl / js.R;
    inputRef.current.joyAng = Math.atan2(dy, dx);
  };
  const joyUp = (e) => {
    if (joyState.current.id !== e.pointerId) return;
    joyState.current.id = null;
    inputRef.current.joyMag = 0;
    if (knobRef.current) knobRef.current.style.transform = "translate(0px,0px)";
  };
  const hold = (key, val) => (e) => { e.preventDefault(); inputRef.current[key] = val; };

  return (
    <div
      style={{ position: "relative", width: "100%", height: "100dvh", overflow: "hidden", background: C.water, userSelect: "none", WebkitUserSelect: "none", touchAction: "none", fontFamily: UI }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />

      {phase === "playing" && (
        <>
          <div style={{ position: "absolute", top: 8, left: 10, display: "flex", gap: 8 }}>
            <Pill>🪙 {coins}</Pill>
            {mode === "arena" ? (
              <>
                <Pill>⚓ {sunk}</Pill>
                <Pill>🚩 {Math.max(0, left - 1)} hunting</Pill>
              </>
            ) : (
              <Pill>🚩 {left} left</Pill>
            )}
          </div>

          <div style={{ position: "absolute", top: 36, left: 10, display: "flex", gap: 6, alignItems: "stretch", width: "min(236px, 72%)" }}>
            {mode === "ffa" && <RankBadge rank={rank.rank} total={rank.total} />}
            <div style={{ flex: 1 }}>
              <HealthPanel ph={ph} phMax={phMax} />
            </div>
          </div>

          <div style={{ position: "absolute", top: 110, left: 8, right: 8, display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
            {TRACKS.map((t) => {
              const lvl = up[t.key];
              const cost = COST(lvl);
              const can = coins >= cost;
              return (
                <button
                  key={t.key}
                  onPointerDown={(e) => { e.preventDefault(); buy(t.key); }}
                  style={{ flex: "1 0 62px", minWidth: 62, borderRadius: 9, border: `1px solid ${t.color}`, background: can ? "rgba(14,45,54,0.9)" : "rgba(14,45,54,0.5)", opacity: can ? 1 : 0.55, color: C.ink, padding: "5px 4px", display: "flex", flexDirection: "column", alignItems: "center", gap: 1, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: t.color }}>{t.label}</span>
                  <span style={{ fontSize: 8, color: "rgba(238,244,242,0.55)" }}>{t.sub}</span>
                  <span style={{ fontSize: 9 }}>Lv{lvl} · 🪙{cost}</span>
                </button>
              );
            })}
          </div>

          <div
            onPointerDown={joyDown}
            onPointerMove={joyMove}
            onPointerUp={joyUp}
            onPointerCancel={joyUp}
            style={{ position: "absolute", left: 24, bottom: 28, width: 120, height: 120, borderRadius: "50%", border: `1px solid ${C.hair}`, background: "rgba(14,45,54,0.55)", touchAction: "none" }}
          >
            <div ref={knobRef} style={{ position: "absolute", left: "50%", top: "50%", width: 52, height: 52, marginLeft: -26, marginTop: -26, borderRadius: "50%", background: "rgba(236,226,204,0.9)", boxShadow: "0 2px 6px rgba(0,0,0,0.4)", pointerEvents: "none" }} />
          </div>

          <div style={{ position: "absolute", right: 20, bottom: 26, display: "flex", flexDirection: "column", gap: 10 }}>
            <FireButton refEl={btnRefs.broadside} name="SIDE" sub="hull" color={C.hull} onDown={hold("broadside", true)} onUp={hold("broadside", false)} />
            <FireButton refEl={btnRefs.bow} name="FRONT" sub="mast" color={C.mast} onDown={hold("bow", true)} onUp={hold("bow", false)} />
            <FireButton refEl={btnRefs.musket} name="MUSKET" sub="crew" color={C.crew} onDown={hold("musket", true)} onUp={hold("musket", false)} />
          </div>
        </>
      )}

      {phase === "start" && <StartOverlay onStart={(m) => startRef.current(m)} />}
      {phase === "won" && <EndOverlay title="LAST AFLOAT" titleColor={C.gold} result={result} stats={stats} mode={mode} place={place} onAgain={() => startRef.current(mode)} onMenu={() => setPhase("start")} />}
      {phase === "dead" && (
        <EndOverlay title="SUNK" titleColor={C.crew} result={result} stats={stats} mode={mode} place={place} onAgain={() => startRef.current(mode)} onMenu={() => setPhase("start")} />
      )}
    </div>
  );
}

function Pill({ children }) {
  return <div style={{ background: C.panel, border: `1px solid ${C.hair}`, borderRadius: 20, padding: "5px 11px", fontSize: 12, color: C.gold, fontWeight: 700 }}>{children}</div>;
}

function RankBadge({ rank, total }) {
  const leader = rank === 1;
  return (
    <div style={{ background: C.panel, border: `1px solid ${leader ? C.gold : C.hair}`, borderRadius: 10, padding: "4px 8px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 44 }}>
      <span style={{ fontSize: 8, letterSpacing: 1, color: "rgba(238,244,242,0.5)" }}>RANK</span>
      <span style={{ fontSize: 20, fontWeight: 800, lineHeight: 1, color: leader ? C.gold : C.ink }}>#{rank}</span>
      <span style={{ fontSize: 8, color: "rgba(238,244,242,0.5)" }}>of {total}</span>
    </div>
  );
}

function HealthPanel({ ph, phMax }) {
  const rows = [["HULL", ph.hull, phMax.hull, C.hull], ["MAST", ph.mast, phMax.mast, C.mast], ["CREW", ph.crew, phMax.crew, C.crew]];
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.hair}`, borderRadius: 10, padding: "7px 9px" }}>
      {rows.map(([label, val, max, col]) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 9, color: "rgba(238,244,242,0.6)", width: 30 }}>{label}</span>
          <div style={{ flex: 1, height: 6, background: "rgba(0,0,0,0.35)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.max(0, (val / max) * 100)}%`, background: col, transition: "width 0.15s" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function FireButton({ refEl, name, sub, color, onDown, onUp }) {
  return (
    <button
      ref={refEl}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      onPointerCancel={onUp}
      style={{ position: "relative", width: 66, height: 56, borderRadius: 12, border: `1px solid ${color}`, background: "rgba(14,45,54,0.88)", color: C.ink, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, overflow: "hidden", touchAction: "none", WebkitTapHighlightColor: "transparent", cursor: "pointer" }}
    >
      <span style={{ fontSize: 12, fontWeight: 700 }}>{name}</span>
      <span style={{ fontSize: 8, color, letterSpacing: 1 }}>{sub}</span>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "rgba(0,0,0,0.4)" }}>
        <div className="cd-fill" style={{ height: "100%", background: color, transformOrigin: "left", transform: "scaleX(1)" }} />
      </div>
    </button>
  );
}

function Shell({ children }) {
  return (
    // `margin:auto` rather than `align-items:center` so a tall menu on a short
    // screen scrolls from the top instead of having its head clipped off.
    <div style={{ position: "absolute", inset: 0, display: "flex", overflowY: "auto", padding: 24, background: "rgba(7,20,24,0.74)", backdropFilter: "blur(4px)" }}>
      <div style={{ margin: "auto", maxWidth: 360, textAlign: "center" }}>{children}</div>
    </div>
  );
}

const GALLEON_W = 268;
const GALLEON_ASPECT = 0.62; // the projection is drawn into a 1 : 0.62 box
const GALLEON_DEG_PER_MS = 0.012; // ~30s per revolution

// The galleon on the menu: a 3-D hull re-projected to isometric every frame, so
// it turns rather than spinning a flat sprite.
function MenuGalleon() {
  const cvs = useRef(null);

  useEffect(() => {
    const c = cvs.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    const w = GALLEON_W;
    const h = Math.round(w * GALLEON_ASPECT);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = w * dpr;
    c.height = h * dpr;

    const paint = (deg) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawGalleon(ctx, w, h, deg);
    };

    // A perpetually turning ship is exactly what reduced-motion asks us to drop,
    // so hold a three-quarter view instead.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      paint(24);
      return;
    }

    let raf = 0;
    let last = 0;
    let deg = 0;
    const frame = (t) => {
      if (last) deg = (deg + (t - last) * GALLEON_DEG_PER_MS) % 360;
      last = t;
      paint(deg);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={cvs}
      aria-hidden="true"
      style={{ display: "block", width: GALLEON_W, height: Math.round(GALLEON_W * GALLEON_ASPECT), margin: "2px auto -6px" }}
    />
  );
}

function StartOverlay({ onStart }) {
  return (
    <Shell>
      <div style={{ fontFamily: DISPLAY, fontSize: 44, color: C.gold, letterSpacing: 2 }}>BROADSIDE</div>
      <MenuGalleon />
      <div style={{ fontFamily: UI, fontSize: 11, color: "rgba(238,244,242,0.55)", letterSpacing: 2, marginTop: 4, marginBottom: 22 }}>CHOOSE YOUR BATTLE</div>
      <ModeCard color={C.side} title="ARENA" desc="Endless survival. One hunter to start, matched to your ship. Sink ships and reinforcements sail in from the horizon. Upgrade your ship. Score by ships sunk." onClick={() => onStart("arena")} />
      <ModeCard color={C.mast} title="FREE-FOR-ALL" desc="Last afloat wins. 10 rival captains, all dead equal at the start. Enemies upgrade like real players and hunt for weak prey." onClick={() => onStart("ffa")} />
      <div style={{ marginTop: 16, fontSize: 11, color: "rgba(238,244,242,0.5)", lineHeight: 1.6 }}>Stick to sail · SIDE→hull · FRONT→mast · MUSKET→crew · ram for hull · islands block fire</div>
    </Shell>
  );
}

function ModeCard({ color, title, desc, onClick }) {
  return (
    <button onClick={onClick} style={{ display: "block", width: "100%", textAlign: "left", borderRadius: 12, border: `1px solid ${color}`, background: "rgba(14,45,54,0.85)", color: C.ink, padding: "14px 16px", marginBottom: 12, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
      <div style={{ fontFamily: DISPLAY, fontSize: 20, color, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: "rgba(238,244,242,0.78)", lineHeight: 1.5 }}>{desc}</div>
    </button>
  );
}

function EndOverlay({ title, titleColor, result, stats, mode, place, onAgain, onMenu }) {
  const rows = [];
  if (mode === "ffa" && place) rows.push(["Placement", `#${place.rank} of ${place.total}`]);
  rows.push(["Time survived", fmtTime(stats.time)]);
  rows.push(["Ships sunk", stats.kills]);
  rows.push(["Damage dealt", stats.dmg]);
  rows.push(["Coins earned", stats.coins]);
  rows.push(["Upgrades bought", stats.upgrades]);
  return (
    <Shell>
      <div style={{ fontFamily: DISPLAY, fontSize: 40, color: titleColor, letterSpacing: 1 }}>{title}</div>
      <div style={{ fontSize: 13, color: "rgba(238,244,242,0.85)", margin: "10px 0 14px", lineHeight: 1.6 }}>{result}</div>
      <div style={{ background: "rgba(10,40,48,0.6)", border: `1px solid ${C.hair}`, borderRadius: 10, padding: "6px 12px", marginBottom: 18, textAlign: "left" }}>
        {rows.map(([l, v], i) => (
          <div key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderTop: i === 0 ? "none" : "1px solid rgba(150,210,205,0.1)" }}>
            <span style={{ fontSize: 11, color: "rgba(238,244,242,0.6)", letterSpacing: 0.5 }}>{l}</span>
            <span style={{ fontSize: 13, color: C.gold, fontWeight: 700 }}>{v}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        <StartButton onClick={onAgain} label="REMATCH" />
        <StartButton onClick={onMenu} label="MENU" ghost />
      </div>
    </Shell>
  );
}

function StartButton({ onClick, label, ghost }) {
  return (
    <button onClick={onClick} style={{ fontFamily: UI, fontSize: 13, letterSpacing: 2, fontWeight: 700, color: ghost ? C.gold : C.water, background: ghost ? "transparent" : C.gold, border: ghost ? `1px solid ${C.gold}` : "none", borderRadius: 10, padding: "12px 22px", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
      {label}
    </button>
  );
}

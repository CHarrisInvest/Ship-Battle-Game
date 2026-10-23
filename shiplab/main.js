/**
 * THE SHIP LAB, its script. See index.html beside it for what the page is.
 *
 * Every ship here is `createMenuShip`, the plate the menu turns, so what the lab draws is what the
 * game draws: the same hull from `hullform.js`, the same rig from `galleon.js`, the same flags blown
 * by the same wind. Nothing here draws a ship of its own.
 *
 * RESHAPING A HULL. The Shape sliders change the reference figures a class is drawn from, the ones
 * `npm run import` writes into `shipref.js` from `data/hulls.tsv`. The game's forms are worked out
 * once per class and cached, so rather than reach into those caches the lab files the changed row
 * under an id of its own (`corvette~lab3`) and draws a spec naming that id: every cache downstream
 * sees a new class and builds her afresh, and the real row is never touched. Nothing a slider does
 * reaches the game; the list of changes is for pasting back into the table.
 */

import { createMenuShip } from "../src/render3d/menuship.js";
import { WIND } from "../src/render3d/flags.js";
import {
  HULL_LIST, HULLS, STANDARDS, MASTS, STATIONS, fitOut, emptyLoadout, rigSpec, rate, rateOf,
  mastsForSocket, mastFitsSocket, berthsOf, sailsForBerth, SAIL_KINDS,
} from "../src/shipyard.js";
import { HULL_REF } from "../src/shipref.js";
import { BASE_SPEED } from "../src/sim/ships.js";
import { CAPTAIN_TIMBER } from "../src/render/palette.js";

/* ---- what can be changed ---------------------------------------------------------------------- */

const FITS = [
  { key: "bare", label: "Bare" },
  ...STANDARDS.map((s) => ({ key: s.key, label: s.label[0].toUpperCase() + s.label.slice(1), quality: s.quality })),
];

// The figures hullform.js draws from, with the ranges the reference's own scales run over.
const SHAPE = [
  { key: "lod", label: "Length on deck", unit: " ft", min: 20, max: 230, step: 1, note: "Also her length at sea, which is her collision ellipse" },
  { key: "beam", label: "Beam", unit: " ft", min: 6, max: 60, step: 0.5, note: "Also her width at sea" },
  { key: "freeboard", label: "Freeboard", unit: " ft", min: 1, max: 14, step: 0.5, note: "Her side above the water" },
  { key: "sheer", label: "Sheer", min: 1, max: 5, step: 1, note: "How her deck sweeps up at the ends, 1 to 5" },
  { key: "tumblehome", label: "Tumblehome", min: 1, max: 5, step: 1, note: "How far her sides roll in above the waterline, 1 to 5" },
  { key: "bowFine", label: "Fine bow", min: 1, max: 5, step: 1, note: "How sharp her entry is, 1 to 5" },
  { key: "castle", label: "Castles", min: 1, max: 5, step: 1, note: "1 is an open boat; higher raises her decks fore and aft" },
  { key: "roomSpace", label: "Room and space", unit: " ft", min: 1.4, max: 2.4, step: 0.05, note: "Her frame spacing, which sizes her gunports" },
  { key: "mastHeight", label: "Mast height", unit: "x", min: 0.5, max: 1.8, step: 0.05, note: "Her masts against the galleon's" },
];
// the choices offered are every value the table already uses, laid-up rows included
const valuesOf = (key) => [...new Set(Object.values(HULL_REF).map((r) => r[key]).filter((v) => typeof v === "string"))].sort();
const PICKS = [
  { key: "stern", label: "Stern", options: valuesOf("stern") },
  { key: "species", label: "Her class's timber, which a rival wears", options: valuesOf("species") },
];
const FIELDS = [...SHAPE.map((f) => f.key), ...PICKS.map((p) => p.key)];

/* ---- state, remembered in this browser ---------------------------------------------------------- */

const STORE = "sternchase.shiplab";
const deg = (r) => (((r * 180) / Math.PI) % 360 + 360) % 360;
const state = {
  view: "one", id: HULL_LIST[0].id, fit: "full", deg: 300, turn: true, speed: 0,
  wind: Math.round(deg(WIND.menu)), edits: {}, captain: true,
  // her rig as set here, class by class: which mast in each socket and which of its berths are
  // filled, starting from the fit above and changed one chip at a time (see "her rig" below)
  rig: {},
};
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || "null");
  if (saved && typeof saved === "object") Object.assign(state, saved);
} catch { /* no storage here: start fresh */ }
if (!HULLS[state.id]) state.id = HULL_LIST[0].id;
if (!FITS.some((f) => f.key === state.fit)) state.fit = "full";
for (const id of Object.keys(state.edits)) if (!HULLS[id]) delete state.edits[id];
if (!state.rig || typeof state.rig !== "object") state.rig = {};
for (const id of Object.keys(state.rig)) if (!HULLS[id]) delete state.rig[id];
const fromHash = () => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (HULLS[id]) { state.id = id; state.view = "one"; return true; }
  return false;
};
fromHash();

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* not kept, which is fine */ }
  }, 250);
}

const reduced = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
if (reduced) state.turn = false;

/* ---- the ship a class is drawn as -------------------------------------------------------------- */

// a reshaped row, filed under an id of its own (see the top of this file)
const labIds = new Map();
let labN = 0;
function hullIdFor(id) {
  const e = state.edits[id];
  if (!e || !Object.keys(e).length) return id;
  const key = id + JSON.stringify(Object.entries(e).sort());
  let lid = labIds.get(key);
  if (!lid) {
    lid = `${id}~lab${++labN}`;
    HULL_REF[lid] = { ...HULL_REF[id], ...e };
    labIds.set(key, lid);
  }
  return lid;
}

/* ---- her rig: what is stepped in each socket and what is bent on it ------------------------- */

// The fit is a preset: it says what her guns are and what her rig starts as. The rig panel then
// changes the rig socket by socket, mast and berth, the way the shipyard lets a captain, and the
// result is drawn through the same `rigSpec` the game draws from.
const fitLoadout = (id) => {
  const fit = FITS.find((f) => f.key === state.fit);
  return fit.quality == null ? emptyLoadout(id) : fitOut(id, fit.quality);
};
const dearest = (list) => list.slice().sort((a, b) => a.price - b.price).pop() || null;
// a loadout's rig in the panel's own terms: a mast id per socket and a flag per berth
function rigFromLoadout(lo) {
  const out = {};
  for (const s of lo.hull.sockets) {
    const e = lo.rig[s.id];
    out[s.id] = { mast: e && e.mast ? e.mast.id : null, sails: e && e.mast ? berthsOf(e.mast).map((_, i) => !!e.sails[i]) : [] };
  }
  return out;
}
const rigOf = (id) => state.rig[id] || (state.rig[id] = rigFromLoadout(fitLoadout(id)));
function loadoutFor(id) {
  const lo = fitLoadout(id); // her guns, from the fit
  const r = rigOf(id);
  for (const s of lo.hull.sockets) {
    const want = r[s.id], mast = want && want.mast ? MASTS[want.mast] : null;
    if (!mast || !mastFitsSocket(mast, s)) { lo.rig[s.id] = { mast: null, sails: [], studs: [] }; continue; }
    // a filled berth carries the best sail of its kind, as the fully found fit does
    lo.rig[s.id] = { mast, sails: berthsOf(mast).map((b, i) => (want.sails[i] ? dearest(sailsForBerth(b)) : null)), studs: [] };
  }
  return lo;
}
const rigKey = (id) => JSON.stringify(rigOf(id));

// one object per class, fit, rig and shape, so a plate redrawn every frame sees the same spec
const specs = new Map();
function specFor(id) {
  const hull = hullIdFor(id);
  const key = `${id}|${state.fit}|${rigKey(id)}|${hull}|${state.captain}`;
  let s = specs.get(key);
  if (!s) {
    // a captain's ship is drawn in the captain's timber, a rival in her class's own
    s = { ...rigSpec(loadoutFor(id)), hull, ...(state.captain ? { timber: CAPTAIN_TIMBER } : {}) };
    specs.set(key, s);
  }
  return s;
}
function topSpeed(id) {
  try { return Math.round(BASE_SPEED * rate(loadoutFor(id)).speed); } catch { return BASE_SPEED; }
}

const windRad = () => (state.wind * Math.PI) / 180;
const edited = (id) => !!state.edits[id] && Object.keys(state.edits[id]).length > 0;

/* ---- a little DOM -------------------------------------------------------------------------------- */

const $ = (sel) => document.querySelector(sel);
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "on") for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
    else if (k === "text") n.textContent = v;
    else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid);
  return n;
}
const fmt = (v, f) => {
  if (typeof v !== "number") return String(v);
  const s = f && f.step < 1 ? v.toFixed(f.step < 0.1 ? 2 : 1).replace(/\.?0+$/, "") : String(Math.round(v));
  return s + (f?.unit || "");
};

/* ---- the one ship ------------------------------------------------------------------------------- */

const shipCanvas = $("#ship");
const plate = createMenuShip(shipCanvas);
function sizePlate() {
  const w = Math.max(1, Math.round(shipCanvas.clientWidth));
  plate.resize(w, Math.round(w * 0.62), Math.min(window.devicePixelRatio || 1, 2));
}
new ResizeObserver(sizePlate).observe(shipCanvas);
sizePlate();

// drag to turn her; a vertical drag still scrolls the page (touch-action: pan-y)
let drag = null;
shipCanvas.addEventListener("pointerdown", (e) => {
  drag = { x: e.clientX, deg: state.deg };
  shipCanvas.setPointerCapture(e.pointerId);
  $("#ship-hint").textContent = "";
});
shipCanvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  state.deg = (((drag.deg - (e.clientX - drag.x) * 0.6) % 360) + 360) % 360;
  syncBearing();
});
const endDrag = () => { if (drag) { drag = null; $("#ship-hint").textContent = "Drag to turn"; save(); } };
shipCanvas.addEventListener("pointerup", endDrag);
shipCanvas.addEventListener("pointercancel", endDrag);

function describe(id) {
  const hull = HULLS[id], ref = HULL_REF[id] || {};
  $("#ship-name").textContent = hull.name;
  const bits = [];
  if (ref.lod) bits.push(`${ref.lod} ft on deck and ${ref.beam} ft in the beam.`);
  const life = [ref.role, ref.region, ref.era].filter(Boolean).join(", ");
  if (life) bits.push(life + ".");
  bits.push(`${rateOf(hull).name}, pierced for ${hull.guns.broadside} guns a side.`);
  $("#facts").textContent = bits.join(" ");
  panelFacts.textContent = bits.join(" ");
}

/* ---- the fleet -------------------------------------------------------------------------------- */

const fleetBox = $("#stage-fleet");
const cards = HULL_LIST.map((hull) => {
  const canvas = el("canvas", { "aria-hidden": "true" });
  const badge = el("span", { class: "edited", text: "Changed", hidden: true });
  const button = el("button", { type: "button", class: "card", "aria-label": `Open ${hull.name}`, on: { click: () => open(hull.id) } },
    el("div", { class: "plate" }, canvas, badge), el("span", { class: "card-name", text: hull.name }));
  fleetBox.append(button);
  return { id: hull.id, canvas, badge, ship: null };
});
let fleetDirty = true;
function drawFleet() {
  for (const c of cards) {
    if (!c.ship) c.ship = createMenuShip(c.canvas);
    const w = Math.max(1, Math.round(c.canvas.clientWidth));
    c.ship.resize(w, Math.round(w * 0.62), Math.min(window.devicePixelRatio || 1, 2));
    c.ship.draw(specFor(c.id), state.deg, { speed: state.speed, wind: windRad(), time: 0.6 });
    c.badge.hidden = !edited(c.id);
  }
  fleetDirty = false;
}
new ResizeObserver(() => { fleetDirty = true; }).observe(fleetBox);

function open(id) {
  state.id = id;
  setView("one");
  refresh();
  window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
}

/* ---- the controls ------------------------------------------------------------------------------ */

const controls = $("#controls");

// the class
const classPick = el("select", { id: "class", "aria-label": "Class", on: { change: (e) => { state.id = e.target.value; refresh(); } } },
  HULL_LIST.map((h) => el("option", { value: h.id, text: h.name })));
const stepClass = (d) => {
  const i = HULL_LIST.findIndex((h) => h.id === state.id);
  state.id = HULL_LIST[(i + d + HULL_LIST.length) % HULL_LIST.length].id;
  refresh();
};
const panelFacts = el("p", { class: "facts" });
const classPanel = el("section", { class: "panel", "aria-label": "Class" },
  el("div", { class: "row" },
    el("label", { for: "class" }, "Class", el("span", { class: "note", text: `${HULL_LIST.length} at sea, smallest first` })),
    el("div", { class: "pick" },
      el("button", { type: "button", class: "step", "aria-label": "Previous class", text: "‹", on: { click: () => stepClass(-1) } }),
      classPick,
      el("button", { type: "button", class: "step", "aria-label": "Next class", text: "›", on: { click: () => stepClass(1) } }))),
  panelFacts);

// her fit: a preset for her guns and her rig, so choosing one starts every class's rig over from it
const fitButtons = FITS.map((f) => el("button", { type: "button", "aria-pressed": "false", text: f.label, on: { click: () => { state.fit = f.key; state.rig = {}; refresh(); } } }));

// whose she is, which decides her timber
const WHOSE = [{ captain: true, label: "Yours" }, { captain: false, label: "A rival's" }];
const whoseButtons = WHOSE.map((w) => el("button", { type: "button", "aria-pressed": "false", text: w.label, on: { click: () => { state.captain = w.captain; refresh(); } } }));

// bearing
const bearing = el("input", { id: "bearing", type: "range", min: 0, max: 359, step: 1, on: { input: (e) => { state.deg = Number(e.target.value); state.turn = false; syncBearing(); fleetDirty = true; save(); } } });
const bearingVal = el("span", { class: "val" });
const turnToggle = el("button", { type: "button", class: "toggle", "aria-pressed": "false", text: "Turn her", on: { click: () => { state.turn = !state.turn; syncBearing(); save(); } } });

// speed
const speed = el("input", { id: "speed", type: "range", min: 0, max: 110, step: 1, on: { input: (e) => { state.speed = Number(e.target.value); syncSailing(); fleetDirty = true; save(); } } });
const speedVal = el("span", { class: "val" });
const topButton = el("button", { type: "button", class: "toggle", text: "Her top speed", on: { click: () => { state.speed = topSpeed(state.id); syncSailing(); fleetDirty = true; save(); } } });
const stopButton = el("button", { type: "button", class: "toggle", text: "Stop", on: { click: () => { state.speed = 0; syncSailing(); fleetDirty = true; save(); } } });

// wind, with an arrow showing which way it blows on screen
const arrowPath = el("span");
arrowPath.innerHTML = '<svg class="arrow" viewBox="0 0 28 28" aria-hidden="true"><path fill="currentColor" d="M4 12.5h13.5V7L25 14l-7.5 7v-5.5H4z"/></svg>';
const arrow = arrowPath.firstChild;
const wind = el("input", { id: "wind", type: "range", min: 0, max: 359, step: 1, on: { input: (e) => { state.wind = Number(e.target.value); syncSailing(); fleetDirty = true; save(); } } });
const windVal = el("span", { class: "val" });
const windReset = el("button", { type: "button", class: "toggle", text: "The game's wind", on: { click: () => { state.wind = Math.round(deg(WIND.menu)); syncSailing(); fleetDirty = true; save(); } } });

const sailPanel = el("section", { class: "panel", "aria-label": "Fit and sailing" },
  el("h2", { text: "Fit and sailing" }),
  el("div", { class: "row" }, el("span", { class: "label" }, "Fit", el("span", { class: "note", text: "What she carries, as the stock ships are fitted" })),
    el("div", { class: "seg", role: "group", "aria-label": "Fit" }, fitButtons)),
  el("div", { class: "row" }, el("span", { class: "label" }, "Whose", el("span", { class: "note", text: `Yours are built of ${CAPTAIN_TIMBER.toLowerCase()}; a rival keeps her class's timber` })),
    el("div", { class: "seg", role: "group", "aria-label": "Whose" }, whoseButtons)),
  el("div", { class: "row" }, el("label", { for: "bearing" }, "Bearing", bearingVal), el("div", { class: "inline" }, bearing, turnToggle)),
  el("div", { class: "row" }, el("label", { for: "speed" }, "Speed", speedVal),
    speed, el("div", { class: "actions" }, stopButton, topButton)),
  el("div", { class: "row" }, el("label", { for: "wind" }, "Wind", windVal),
    el("div", { class: "inline" }, arrow, wind), el("div", { class: "actions" }, windReset)),
  el("p", { class: "lede", text: "Stopped, her flags fly down the wind. Give her way and they swing round to stream astern. The game's wind is fixed; this one is here to try others." }));

// her rig: a mast for each socket and a chip for each berth of it, as the shipyard offers them
const STATION_LABEL = { bowsprit: "Bowsprit", fore: "Fore", main: "Main", mizzen: "Mizzen", bonaventure: "Bonaventure" };
const rigRows = el("div", { class: "rig-rows" });
const rigReset = el("button", { type: "button", class: "ghost", text: "Back to the fit", on: { click: () => { delete state.rig[state.id]; refresh(); } } });
const rigPanel = el("section", { class: "panel", "aria-label": "Her rig" },
  el("div", { class: "shape-head" }, el("h2", { text: "Her rig" }), rigReset),
  el("p", { class: "lede", text: "What is stepped in each socket and what is bent on it. A taller mast carries more sails; a berth switched off is a yard crossed bare. Nothing here changes the game." }),
  rigRows);
function setMast(socketId, mastId) {
  const r = rigOf(state.id);
  const mast = mastId ? MASTS[mastId] : null;
  r[socketId] = { mast: mast ? mast.id : null, sails: mast ? berthsOf(mast).map(() => true) : [] };
  fleetDirty = true;
  save();
  syncRig();
}
function toggleBerth(socketId, i) {
  const r = rigOf(state.id);
  if (!r[socketId]) return;
  r[socketId].sails[i] = !r[socketId].sails[i];
  fleetDirty = true;
  save();
  syncRig();
}
// What a berth is, as a captain names it, from its kind and its place up the mast: square canvas
// course to skysail (the mizzen's lowest a crossjack), headsails staysail to flying jib, the rest
// by their kind.
const SQUARE_NAMES = ["Course", "Topsail", "Topgallant", "Royal", "Skysail"];
const HEAD_NAMES = ["Staysail", "Jib", "Flying jib"];
function berthLabel(socket, mast, i) {
  const berths = berthsOf(mast), b = berths[i];
  const nth = (test) => berths.slice(0, i).filter(test).length;
  if (b.kind === "LSQ" || b.kind === "SSQ") {
    const n = nth((x) => x.kind === "LSQ" || x.kind === "SSQ");
    if (socket.station === "mizzen" && n === 0) return "Crossjack";
    return SQUARE_NAMES[Math.min(n, SQUARE_NAMES.length - 1)];
  }
  if (b.kind === "TRI" && socket.station === "bowsprit") return HEAD_NAMES[Math.min(nth((x) => x.kind === "TRI"), HEAD_NAMES.length - 1)];
  if (b.kind === "GAF") return mast.family === "spanker" ? "Spanker" : nth((x) => x.kind === "GAF") ? "Gaff topsail" : "Gaff mainsail";
  if (b.kind === "LUG") return nth((x) => x.kind === "LUG") ? "Lug topsail" : "Lugsail";
  if (b.kind === "LAT") return mast.family === "bermuda" ? "Bermuda mainsail" : "Lateen";
  const kind = SAIL_KINDS[b.kind];
  return kind ? kind.name : b.kind;
}
function syncRig() {
  const hull = HULLS[state.id], r = rigOf(state.id);
  rigRows.replaceChildren(...hull.sockets.map((s) => {
    const fits = mastsForSocket(s).slice().sort((a, b) => a.price - b.price);
    const chosen = r[s.id] && r[s.id].mast ? MASTS[r[s.id].mast] : null;
    const pick = el("select", { "aria-label": `${STATION_LABEL[s.station] || s.station} mast`, on: { change: (e) => setMast(s.id, e.target.value || null) } },
      el("option", { value: "", text: "Nothing stepped" }),
      fits.map((m) => el("option", { value: m.id, text: `${m.name} (${m.berths.length} ${m.berths.length === 1 ? "sail" : "sails"})` })));
    pick.value = chosen ? chosen.id : "";
    const chips = chosen ? berthsOf(chosen).map((b, i) => {
      const on = !!(r[s.id].sails[i]);
      return el("button", { type: "button", class: "toggle", "aria-pressed": String(on), text: berthLabel(s, chosen, i), on: { click: () => toggleBerth(s.id, i) } });
    }) : [];
    return el("div", { class: "row" },
      el("span", { class: "label" }, `${STATION_LABEL[s.station] || s.station}`, el("span", { class: "note", text: `${s.size} socket, ${s.rigs.length ? s.rigs.join(" or ") : "any"} rig` })),
      pick,
      chips.length ? el("div", { class: "actions" }, chips) : null);
  }));
  rigReset.disabled = !state.rig[state.id];
  syncSailing();
}

// her shape
const shapeRows = new Map();
for (const f of SHAPE) {
  const input = el("input", { id: `f-${f.key}`, type: "range", min: f.min, max: f.max, step: f.step,
    on: { input: (e) => setField(f.key, Number(e.target.value)) } });
  const val = el("span", { class: "val" });
  const row = el("div", { class: "row" },
    el("label", { for: `f-${f.key}` }, el("span", {}, f.label, el("br"), el("span", { class: "note", text: f.note })), val), input);
  shapeRows.set(f.key, { input, val, f, row });
}
for (const p of PICKS) {
  const input = el("select", { id: `f-${p.key}`, on: { change: (e) => setField(p.key, e.target.value) } },
    p.options.map((o) => el("option", { value: o, text: o })));
  const val = el("span", { class: "val" });
  const row = el("div", { class: "row" }, el("label", { for: `f-${p.key}` }, p.label, val), input);
  shapeRows.set(p.key, { input, val, f: null, row });
}
const resetShape = el("button", { type: "button", class: "ghost", text: "Undo her changes", on: { click: () => { delete state.edits[state.id]; refresh(); } } });
const shapePanel = el("section", { class: "panel", "aria-label": "Shape" },
  el("div", { class: "shape-head" }, el("h2", { text: "Her shape" }), resetShape),
  el("p", { class: "lede", text: "The figures her hull is drawn from, out of data/hulls.tsv. Moving one redraws her at once. Nothing here changes the game until it goes back into the table." }),
  [...shapeRows.values()].map((r) => r.row));

function setField(key, value) {
  const original = HULL_REF[state.id][key];
  const e = (state.edits[state.id] ||= {});
  if (value === original) delete e[key];
  else e[key] = value;
  if (!Object.keys(e).length) delete state.edits[state.id];
  syncShape();
  fleetDirty = true;
  save();
}

// the changes, for pasting back
const changes = el("textarea", { id: "changes", class: "changes", readonly: true, rows: 4, "aria-label": "Your changes" });
const said = el("span", { class: "said", role: "status" });
const copy = el("button", { type: "button", class: "primary", text: "Copy changes", on: { click: copyChanges } });
const clearAll = el("button", { type: "button", class: "ghost", text: "Clear all", on: { click: () => { state.edits = {}; refresh(); said.textContent = "Cleared."; } } });
const changePanel = el("section", { class: "panel", "aria-label": "Your changes" },
  el("h2", { text: "Your changes" }),
  el("p", { class: "lede", text: "Every class you have reshaped, as figures for the table. Copy them into the chat and they can be made real." }),
  changes, el("div", { class: "actions" }, copy, clearAll, said));

function changeText() {
  const lines = [];
  for (const hull of HULL_LIST) {
    const e = state.edits[hull.id];
    if (!e) continue;
    const parts = FIELDS.filter((k) => k in e).map((k) => {
      const f = SHAPE.find((s) => s.key === k);
      return `${k} ${fmt(e[k], f && { ...f, unit: "" })} (was ${fmt(HULL_REF[hull.id][k], f && { ...f, unit: "" })})`;
    });
    lines.push(`${hull.id}: ${parts.join(", ")}`);
  }
  return lines.length ? ["Ship Lab changes for data/hulls.tsv", ...lines].join("\n") : "";
}
async function copyChanges() {
  const text = changeText();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    said.textContent = "Copied.";
  } catch {
    changes.focus();
    changes.select();
    said.textContent = "Selected. Copy it from the box.";
  }
}

controls.append(classPanel, sailPanel, rigPanel, shapePanel, changePanel);

/* ---- keeping the page in step with the state ----------------------------------------------------- */

const viewOne = $("#view-one"), viewFleet = $("#view-fleet");
function setView(v) {
  state.view = v;
  viewOne.setAttribute("aria-pressed", String(v === "one"));
  viewFleet.setAttribute("aria-pressed", String(v === "fleet"));
  $("#stage-one").hidden = v !== "one";
  fleetBox.hidden = v !== "fleet";
  classPanel.hidden = v !== "one";
  rigPanel.hidden = v !== "one";
  shapePanel.hidden = v !== "one";
  turnToggle.hidden = v !== "one";
  if (v === "fleet") fleetDirty = true;
  else sizePlate();
  save();
}
viewOne.addEventListener("click", () => setView("one"));
viewFleet.addEventListener("click", () => setView("fleet"));
window.addEventListener("hashchange", () => { if (fromHash()) { setView("one"); refresh(); } });

let hintDeg = -1;
function syncBearing() {
  bearing.value = String(Math.round(state.deg));
  bearingVal.textContent = `${Math.round(state.deg)}°`;
  turnToggle.setAttribute("aria-pressed", String(state.turn));
}
function syncSailing() {
  speed.value = String(state.speed);
  const top = topSpeed(state.id);
  speedVal.textContent = state.speed ? `${state.speed} of her ${top}` : `Stopped, top ${top}`;
  wind.value = String(state.wind);
  windVal.textContent = `${state.wind}°`;
  // the wind's direction on screen: the menu's projection of a level heading
  const w = windRad(), sx = Math.cos(w) - Math.sin(w), sy = (Math.cos(w) + Math.sin(w)) / 2;
  arrow.style.transform = `rotate(${Math.atan2(sy, sx)}rad)`;
}
function syncShape() {
  const e = state.edits[state.id] || {};
  const ref = HULL_REF[state.id];
  for (const [key, r] of shapeRows) {
    const v = key in e ? e[key] : ref[key];
    r.input.value = String(v);
    r.val.textContent = key in e ? `${fmt(v, r.f)} (was ${fmt(ref[key], r.f)})` : fmt(v, r.f);
    r.val.classList.toggle("changed", key in e);
  }
  resetShape.disabled = !edited(state.id);
  const text = changeText();
  changes.value = text || "Nothing changed yet. Move a slider under Her shape.";
  copy.disabled = !text;
  clearAll.disabled = !text;
  // the class in the address, so a link opens on her; a sandboxed frame may refuse, which is fine
  if (location.hash.slice(1) !== state.id && state.view === "one") {
    try { history.replaceState(null, "", `#${state.id}`); } catch { /* the address stays as it was */ }
  }
}
function refresh() {
  classPick.value = state.id;
  for (const [i, f] of FITS.entries()) fitButtons[i].setAttribute("aria-pressed", String(f.key === state.fit));
  for (const [i, w] of WHOSE.entries()) whoseButtons[i].setAttribute("aria-pressed", String(w.captain === state.captain));
  describe(state.id);
  syncBearing();
  syncSailing();
  syncRig();
  syncShape();
  fleetDirty = true;
  save();
}

const stamp = typeof __SHIPLAB_STAMP__ !== "undefined" ? __SHIPLAB_STAMP__ : "Served live from this checkout.";
$("#stamp").textContent = `${stamp} Every ship here is drawn by the game's own code. The sea itself is checked in the game, on the branch's preview.`;

$("#ship-hint").textContent = "Drag to turn";
setView(state.view);
refresh();

/* ---- the frame ----------------------------------------------------------------------------------- */

let last = 0;
function frame(t) {
  const dt = last ? Math.min(0.1, (t - last) / 1000) : 0;
  last = t;
  if (state.view === "one") {
    if (state.turn && !drag) {
      state.deg = (state.deg + dt * 14) % 360;
      if (Math.round(state.deg) !== hintDeg) { hintDeg = Math.round(state.deg); syncBearing(); }
    }
    const how = { speed: state.speed, wind: windRad() };
    if (reduced) how.time = 0.6;
    plate.draw(specFor(state.id), state.deg, how);
  } else if (fleetDirty) {
    drawFleet();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

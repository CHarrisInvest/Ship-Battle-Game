/**
 * THE HOLD — what a captain keeps between voyages.
 *
 * Coins are two different things and it matters which one you mean. The purse a ship carries into a
 * battle is spent at sea on her own upgrades and goes down with her: that lives on the ship object in
 * `SternchaseIso.jsx` and is gone the moment the round ends. The hold is the other one — a record that
 * outlives any single round, holds coins across arena and free-for-all alike, and is written to
 * `localStorage` so it survives a reload. Nothing spends from the hold yet; this is the collection
 * side, and `spendFromHold` is the door the rest of it will come through.
 *
 * Every voyage that reaches an end screen banks into it, win or lose. The reasoning: coins are earned
 * by fighting, and a captain who fought well and sank anyway earned them just the same. Only a round
 * abandoned mid-fight (a reload, a closed tab) banks nothing, because nothing ended.
 *
 * The record is deliberately wider than the coin count. Later mechanics — unlocks, ranks, a shipyard,
 * challenges tied to a mode — want to know what a captain has done, not just what they can afford, and
 * a stat not recorded from the start is a stat that can never be backfilled.
 *
 * THE YARD lives in the same record, and has to: buying a mast moves coins and creates a part in one
 * act, and two files writing the same key would eventually lose one half of it. So `yard` is a field
 * of the hold, written by the same `commit`, and every reader watches the same subscription.
 *
 * What the yard keeps is *instances*, not types. `parts` is a flat table of every spar, sail and gun
 * a captain owns, each with its own id and a catalogue type; `ships` records which instance is in
 * which slot. That is what makes rigging and guns portable between hulls, and it is the reason
 * fitting is a move rather than a copy: an instance is in one slot or in none, never in two, so a
 * captain can carry one good suit of sails between three ships but cannot sail all three at once.
 * Anything no ship references is loose in the hold, which is the inventory.
 */

import {
  HULLS, PARTS, STARTER, gunsForMount, mastFitsSocket, mastsForSocket, resolve, sailFitsBerth,
  sailsForBerth, socketOf, studFitsSail,
} from "./shipyard.js";

const KEY = "sternchase.hold";
const VERSION = 2;

// Share of a voyage's earnings that reaches the hold. At 1 every coin you earn at sea is also logged
// ashore — spending at sea costs you nothing here, so upgrading mid-round is never a tax on progress.
// Drop it below 1 if the meta economy ever needs slowing down without touching the in-round loop.
export const HOLD_SHARE = 1;

const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);

/**
 * What one mode remembers. Running totals first, then the bests.
 *
 * Every total here has a twin in `lifetime`, deliberately: a captain wants to know both what she has
 * done and where she did it, and totalling the modes to get the first would go wrong the moment a
 * voyage is banked under a mode name this build does not have. Adding a field is safe at any time —
 * `sanitize` folds a stored record onto a blank one field by field, so an older record simply reads
 * zero for whatever is new rather than being thrown away.
 *
 * Not every field means something in every mode. There are no guns in the derby, so `dmg` there is
 * all ramming, and nothing is repaired in it at all, so `repaired` and `patches` stay at zero. The
 * screen decides what is worth showing per mode; the record just keeps it.
 */
function blankMode() {
  return {
    runs: 0, wins: 0, earned: 0,
    sunk: 0, dmg: 0, afloat: 0, repaired: 0, rams: 0, patches: 0,
    bestSunk: 0, bestTime: 0, bestRank: 0,
  };
}

function blank() {
  return {
    v: VERSION,
    coins: 0, // unspent, the balance the shipyard draws on
    spent: 0, // taken back out again, so the two sides of the ledger always reconstruct `earned`
    // `repaired` is coins spent at sea that never reached the hold, so it is not reconstructible
    // from `earned` and `spent` the way shore spending is. Recorded from the day the feature exists.
    lifetime: { earned: 0, runs: 0, wins: 0, sunk: 0, dmg: 0, afloat: 0, repaired: 0, rams: 0, patches: 0 },
    modes: {}, // keyed by mode name, created on demand so a new mode needs no schema change
    yard: starterYard(),
  };
}

// A captain always has a ship, including the moment after she scuttles the hold. There is no state
// in which the menu has nothing to turn.
function starterYard() {
  const yard = blankYard();
  grantStarter(yard);
  return yard;
}

// Ids are a counter rather than a random string, because the whole record is one document and a
// counter that only ever goes up is enough to keep two parts apart. `seq` is bumped past anything
// already in the record on load, so a hand-edited or half-written yard cannot hand out a live id.
function blankYard() {
  return { seq: 1, active: null, ships: {}, parts: {} };
}

// Fold whatever was in storage onto a blank record field by field. A missing or junk field takes the
// blank one rather than throwing the whole hold away, so a record written by an older build keeps its
// coins when this one adds a stat, and a half-written record loses only what was actually corrupt.
function sanitize(raw) {
  const rec = blank();
  if (!raw || typeof raw !== "object") return rec;
  rec.coins = num(raw.coins);
  rec.spent = num(raw.spent);
  const lt = raw.lifetime && typeof raw.lifetime === "object" ? raw.lifetime : {};
  for (const k of Object.keys(rec.lifetime)) rec.lifetime[k] = num(lt[k]);
  const modes = raw.modes && typeof raw.modes === "object" ? raw.modes : {};
  for (const [name, m] of Object.entries(modes)) {
    if (!m || typeof m !== "object") continue;
    const dest = blankMode();
    for (const k of Object.keys(dest)) dest[k] = num(m[k]);
    rec.modes[name] = dest;
  }
  rec.yard = sanitizeYard(raw.yard);
  return rec;
}

/**
 * Fold a stored yard onto a blank one, dropping only what is actually wrong.
 *
 * The checks are the same ones the shipyard makes when a captain fits a part, run again on load,
 * because a record can outlive the catalogue that wrote it: a part type that has gone, a mast that no
 * longer fits the socket it was in, a gun port the hull no longer has. Anything that fails a check
 * comes out of its slot rather than out of the record, so a captain keeps the part and can put it
 * somewhere legal. A part fitted in two places at once — which nothing here can produce, but a
 * half-written record can — stays in the first slot found and comes loose from the second.
 *
 * A record with no ships in it at all is a record from before the yard existed. It gets a first ship,
 * which is also what a brand new captain gets: the two paths are the same one on purpose, so the
 * shipyard has exactly one notion of a beginning.
 */
function sanitizeYard(raw) {
  const yard = blankYard();
  const src = raw && typeof raw === "object" ? raw : {};

  const parts = src.parts && typeof src.parts === "object" ? src.parts : {};
  for (const [id, p] of Object.entries(parts)) {
    if (!p || typeof p !== "object" || !PARTS[p.type]) continue;
    yard.parts[id] = { type: p.type };
  }

  const used = new Set();
  const take = (id, sort) => {
    const part = yard.parts[id];
    if (!part || used.has(id)) return null;
    if (PARTS[part.type].part !== sort) return null;
    used.add(id);
    return id;
  };

  const ships = src.ships && typeof src.ships === "object" ? src.ships : {};
  for (const [id, s] of Object.entries(ships)) {
    if (!s || typeof s !== "object") continue;
    const hull = HULLS[s.hull];
    if (!hull) continue; // a class that no longer exists takes its slots with it; the parts stay loose
    const ship = { hull: hull.id, rig: {}, guns: { broadside: [], bow: [], swivel: [] } };

    for (const socket of hull.sockets) {
      const slot = { mast: null, sails: [], studs: [] };
      ship.rig[socket.id] = slot;
      const from = (s.rig && s.rig[socket.id]) || null;
      if (!from) continue;
      const mastId = take(from.mast, "mast");
      if (!mastId || !mastFitsSocket(PARTS[yard.parts[mastId].type], socket)) {
        if (mastId) used.delete(mastId); // it goes back in the hold rather than being lost
        continue;
      }
      slot.mast = mastId;
      const mastType = PARTS[yard.parts[mastId].type];
      const berths = mastType.berths;
      slot.sails = berths.map((berth, i) => {
        const sailId = take((from.sails || [])[i], "sail");
        if (!sailId) return null;
        if (!sailFitsBerth(PARTS[yard.parts[sailId].type], berth)) { used.delete(sailId); return null; }
        return sailId;
      });
      // a studdingsail stands only while the sail it booms out from does, checked with the same
      // rule fitting uses, so one recorded against a bare berth comes loose rather than dangling
      slot.studs = berths.map((berth, i) => {
        const studId = take((from.studs || [])[i], "sail");
        if (!studId) return null;
        const host = slot.sails[i] ? PARTS[yard.parts[slot.sails[i]].type] : null;
        if (!studFitsSail(PARTS[yard.parts[studId].type], mastType, i, host)) { used.delete(studId); return null; }
        return studId;
      });
    }

    for (const mount of ["broadside", "bow", "swivel"]) {
      const want = ((s.guns && s.guns[mount]) || []).slice(0, hull.guns[mount]);
      for (const stored of want) {
        const gunId = take(stored, "gun");
        if (!gunId) continue;
        if (PARTS[yard.parts[gunId].type].mount !== mount) { used.delete(gunId); continue; }
        ship.guns[mount].push(gunId);
      }
    }
    yard.ships[id] = ship;
  }

  // Hand out ids above anything already in the record, so a rewritten `seq` cannot collide.
  const highest = [...Object.keys(yard.parts), ...Object.keys(yard.ships)]
    .reduce((a, k) => Math.max(a, parseInt(String(k).replace(/\D/g, ""), 10) || 0), 0);
  yard.seq = Math.max(num(src.seq, 1), highest + 1);

  if (!Object.keys(yard.ships).length) grantStarter(yard);
  yard.active = yard.ships[src.active] ? src.active : Object.keys(yard.ships)[0];
  return yard;
}

const nextId = (yard, tag) => `${tag}${yard.seq++}`;

/** Put a fresh instance of a catalogue part in the hold, unfitted. Returns its id. */
function mintPart(yard, typeId) {
  const id = nextId(yard, "p");
  yard.parts[id] = { type: typeId };
  return id;
}

/** The first ship, built out of `STARTER`: the one beginning both a new captain and an old record get. */
function grantStarter(yard) {
  const hull = HULLS[STARTER.hull];
  const id = nextId(yard, "s");
  const ship = { hull: hull.id, rig: {}, guns: { broadside: [], bow: [], swivel: [] } };
  for (const socket of hull.sockets) {
    const want = STARTER.rig[socket.id];
    const slot = { mast: null, sails: [], studs: [] };
    ship.rig[socket.id] = slot;
    if (!want || !PARTS[want.mast]) continue;
    slot.mast = mintPart(yard, want.mast);
    slot.sails = PARTS[want.mast].berths.map((_, i) => {
      const typeId = (want.sails || [])[i];
      return PARTS[typeId] ? mintPart(yard, typeId) : null;
    });
  }
  for (const mount of ["broadside", "bow", "swivel"]) {
    for (const typeId of STARTER.guns[mount] || []) {
      if (PARTS[typeId]) ship.guns[mount].push(mintPart(yard, typeId));
    }
  }
  yard.ships[id] = ship;
  yard.active = id;
  return id;
}

// localStorage throws rather than returning null in a few real cases — Safari's private browsing, a
// blocked third-party frame, a full quota. None of them should cost anyone their game, so the hold
// falls back to living in memory for the session and the UI never has to know the difference.
let writable = true;

function store() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function load() {
  const s = store();
  if (!s) return blank();
  try {
    const raw = s.getItem(KEY);
    return raw ? sanitize(JSON.parse(raw)) : blank();
  } catch {
    return blank();
  }
}

function save(rec) {
  const s = store();
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify(rec));
    writable = true;
  } catch {
    writable = false; // out of quota or denied; the in-memory copy carries the session
  }
}

let cache = null;
const listeners = new Set();

function current() {
  if (!cache) cache = load();
  return cache;
}

function publish(rec) {
  cache = rec;
  for (const fn of listeners) fn(rec);
}

function commit(rec) {
  save(rec);
  publish(rec);
  return rec;
}

/** The hold as it stands. Treat the returned record as read-only; every writer here returns a fresh one. */
export function getHold() {
  return current();
}

/** True while the hold is only in memory — storage refused the last write. */
export function holdIsPersistent() {
  return !!store() && writable;
}

export function modeRecord(rec, mode) {
  return rec.modes[mode] || blankMode();
}

/**
 * Coins a voyage would bank, before it is banked. Same rounding the real thing uses.
 *
 * `repaired` is what she paid the carpenter at sea, and it comes off the top. That is the whole of
 * the repair economy: a purse spent staying afloat is a purse that never reaches the hold, so a
 * captain who fought carelessly and patched her way through has less to show for it than one who did
 * not need to. Never below nothing, though. A bad round costs a captain the round, not her savings.
 */
export function voyageValue(earned, repaired = 0) {
  return Math.max(0, Math.round((num(earned) - num(repaired)) * HOLD_SHARE));
}

/**
 * Bank one finished voyage and return the new hold alongside the coins it added.
 *
 * `run` is the end-of-round summary:
 * `{ mode, earned, repaired, kills, dmg, time, won, rank, rams, patches }`.
 * `earned` is what the ship took in at sea, not what she had left; `repaired` is the part of it she
 * handed to the carpenter, and only the difference reaches the hold.
 */
export function bankVoyage(run) {
  const rec = current();
  const mode = typeof run.mode === "string" && run.mode ? run.mode : "unknown";
  const repaired = num(run.repaired);
  const banked = voyageValue(run.earned, repaired);
  const kills = num(run.kills);
  const dmg = num(run.dmg);
  const time = num(run.time);
  const rams = num(run.rams);
  const patches = num(run.patches);
  const won = !!run.won;
  const rank = num(run.rank);

  const next = {
    ...rec,
    coins: rec.coins + banked,
    lifetime: {
      earned: rec.lifetime.earned + banked,
      runs: rec.lifetime.runs + 1,
      wins: rec.lifetime.wins + (won ? 1 : 0),
      sunk: rec.lifetime.sunk + kills,
      dmg: rec.lifetime.dmg + dmg,
      afloat: rec.lifetime.afloat + time,
      repaired: rec.lifetime.repaired + repaired,
      rams: rec.lifetime.rams + rams,
      patches: rec.lifetime.patches + patches,
    },
    modes: { ...rec.modes },
  };

  const m = modeRecord(rec, mode);
  next.modes[mode] = {
    runs: m.runs + 1,
    wins: m.wins + (won ? 1 : 0),
    earned: m.earned + banked,
    sunk: m.sunk + kills,
    dmg: m.dmg + dmg,
    afloat: m.afloat + time,
    repaired: m.repaired + repaired,
    rams: m.rams + rams,
    patches: m.patches + patches,
    bestSunk: Math.max(m.bestSunk, kills),
    bestTime: Math.max(m.bestTime, time),
    // placement counts down, not up, and 0 means "never placed" — so the first finish always takes it
    bestRank: rank > 0 && (m.bestRank === 0 || rank < m.bestRank) ? rank : m.bestRank,
  };

  return { hold: commit(next), banked };
}

/**
 * Draw `amount` out of the hold. Returns the new record on success and `null` if the coins are not
 * there, so a caller can treat it as the whole check — nothing is deducted on a refusal.
 */
export function spendFromHold(amount) {
  const rec = current();
  const cost = Math.max(0, Math.round(num(amount)));
  if (cost > rec.coins) return null;
  return commit({ ...rec, coins: rec.coins - cost, spent: rec.spent + cost });
}

/** Scuttle the hold: back to a captain's first day at sea, first ship and all. */
export function resetHold() {
  return commit(blank());
}

/* ---------------------------------------------------------------------------------------------- */
/* The yard                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Every writer below follows one shape, and it is worth stating once. Each takes the hold as it
 * stands, works on a copy of the yard, and either commits the whole thing or returns `null` having
 * changed nothing — coins short, part missing, mast that does not fit. So a caller can treat the
 * return as the whole check, exactly as `spendFromHold` already asks to be treated, and there is no
 * half-finished purchase to unwind.
 */

const cloneShip = (s) => ({
  hull: s.hull,
  rig: Object.fromEntries(Object.entries(s.rig).map(([k, v]) => [k, { mast: v.mast, sails: v.sails.slice(), studs: (v.studs || []).slice() }])),
  guns: { broadside: s.guns.broadside.slice(), bow: s.guns.bow.slice(), swivel: s.guns.swivel.slice() },
});

function cloneYard(y) {
  return {
    seq: y.seq,
    active: y.active,
    ships: Object.fromEntries(Object.entries(y.ships).map(([k, s]) => [k, cloneShip(s)])),
    parts: Object.fromEntries(Object.entries(y.parts).map(([k, p]) => [k, { ...p }])),
  };
}

/** Write a changed yard back, taking `cost` out of the purse in the same act. */
function commitYard(rec, yard, cost = 0) {
  const price = Math.max(0, Math.round(num(cost)));
  if (price > rec.coins) return null;
  return commit({ ...rec, coins: rec.coins - price, spent: rec.spent + price, yard });
}

export const getYard = () => current().yard;

/** The catalogue type of an owned part, or `null` if that instance is not in the hold. */
export function partOf(rec, partId) {
  const p = rec.yard.parts[partId];
  return p ? PARTS[p.type] : null;
}

/** Every ship a captain owns, as `{ id, ...record }`, oldest first. */
export function ownedShips(rec) {
  return Object.entries(rec.yard.ships).map(([id, ship]) => ({ id, ...ship }));
}

/** Parts no ship is using. This is the inventory: what she can move onto whatever she is sailing. */
export function loosePartIds(rec) {
  const fitted = new Set();
  for (const ship of Object.values(rec.yard.ships)) {
    for (const slot of Object.values(ship.rig)) {
      if (slot.mast) fitted.add(slot.mast);
      for (const s of slot.sails) if (s) fitted.add(s);
      for (const st of slot.studs || []) if (st) fitted.add(st);
    }
    for (const mount of ["broadside", "bow", "swivel"]) for (const g of ship.guns[mount]) fitted.add(g);
  }
  return Object.keys(rec.yard.parts).filter((id) => !fitted.has(id));
}

/**
 * A ship resolved into catalogue objects: the form the stat panel and the renderer both want. Pass no
 * id for whichever ship she is sailing.
 */
export function shipLoadout(rec, shipId) {
  const id = shipId || rec.yard.active;
  const ship = rec.yard.ships[id];
  if (!ship) return resolve(null);
  return resolve(ship, (partId) => {
    const p = rec.yard.parts[partId];
    return p ? p.type : null;
  });
}

/**
 * What a ship still wants, and how much of it the captain already owns.
 *
 * Buying a hull gets you a hull. What turns it into a ship is a mast in every socket, a sail in every
 * berth of every mast, and guns run out to what she bears, and a captain part of the way through that
 * needs to be told two different things: what is missing, and whether it is already lying in the hold
 * off some other ship. A spare topmast she owns costs nothing to step, and the answer to "what does
 * this frigate need" is a different number depending on what is in her inventory.
 *
 * Each gap comes back with `owned`, the loose parts that would go straight in, and `buy`, the cheapest
 * catalogue part that would fill it. `cost` is what the gap costs *her*: nothing when she owns
 * something that fits, the price of the cheapest part when she does not.
 *
 * That total is the cheapest *legal* way to make her a ship, not a good rig and not a recommendation.
 * A pole mast is free and fits any socket, so the quote for a bare frigate's masts is nothing at all,
 * and it would give her three bare poles carrying one small sail each. `fitOut()` in the shipyard is
 * what a decent fit costs. A screen showing both is telling a captain the floor and the ceiling.
 *
 * Berths on a mast she has not stepped yet are not counted. She cannot bend a sail onto a spar that
 * is not there, and quoting for sails on a mast she has not chosen would price a rig she may not
 * build.
 */
export function shortfall(rec, shipId) {
  const id = shipId || rec.yard.active;
  const ship = rec.yard.ships[id];
  if (!ship) return { gaps: [], cost: 0 };
  const hull = HULLS[ship.hull];
  const loose = loosePartIds(rec).map((pid) => ({ pid, type: PARTS[rec.yard.parts[pid].type] }));
  const claimed = new Set(); // a spare fills one gap, not every gap it happens to fit

  const gap = (g, fits, options) => {
    const owned = loose.filter((p) => !claimed.has(p.pid) && fits(p.type)).map((p) => p.pid);
    if (owned.length) claimed.add(owned[0]);
    const buy = options.slice().sort((a, b) => a.price - b.price)[0] || null;
    return { ...g, owned, buy, cost: owned.length ? 0 : buy ? buy.price : 0 };
  };

  const gaps = [];
  for (const socket of hull.sockets) {
    const slot = ship.rig[socket.id] || { mast: null, sails: [] };
    if (!slot.mast) {
      // `spar` rather than a mast on the bowsprit, so a screen can name what is missing correctly
      gaps.push(gap({ part: "mast", spar: !!socket.spar, socket: socket.id, station: socket.station, size: socket.size },
        (t) => mastFitsSocket(t, socket), mastsForSocket(socket)));
      continue;
    }
    const mast = partOf(rec, slot.mast);
    mast.berths.forEach((berth, i) => {
      if (slot.sails[i]) return;
      gaps.push(gap({ part: "sail", socket: socket.id, berth: i, kind: berth.kind },
        (t) => sailFitsBerth(t, berth), sailsForBerth(berth)));
    });
  }

  for (const mount of ["broadside", "bow", "swivel"]) {
    const short = hull.guns[mount] - ship.guns[mount].length;
    for (let i = 0; i < short; i++) {
      gaps.push(gap({ part: "gun", mount }, (t) => t.part === "gun" && t.mount === mount, gunsForMount(mount)));
    }
  }

  return { gaps, cost: gaps.reduce((t, g) => t + g.cost, 0) };
}

/**
 * Pull a part out of whatever slot on whatever ship holds it. Fitting is a move, never a copy.
 *
 * Taking a mast takes its berths with it, so the sails that were in them are emptied out of the slot
 * and become loose. Leaving their ids behind in a slot with no mast would have counted them as
 * fitted and lost them out of the inventory: still owned, on no mast, and invisible.
 */
function pull(yard, partId) {
  if (!partId) return;
  for (const ship of Object.values(yard.ships)) {
    for (const [socketId, slot] of Object.entries(ship.rig)) {
      if (slot.mast === partId) { ship.rig[socketId] = { mast: null, sails: [], studs: [] }; continue; }
      slot.sails = slot.sails.map((s) => (s === partId ? null : s));
      // a studdingsail comes loose with its own id, and also the moment the sail it booms out from
      // leaves the berth: it hangs off that sail, not off the mast
      slot.studs = (slot.studs || []).map((st, i) => (st === partId || !slot.sails[i] ? null : st));
    }
    for (const mount of ["broadside", "bow", "swivel"]) {
      ship.guns[mount] = ship.guns[mount].filter((g) => g !== partId);
    }
  }
}

/** Buy a bare hull. She arrives with no rig and no guns; the parts to fill her are bought separately. */
export function buyShip(hullId) {
  const rec = current();
  const hull = HULLS[hullId];
  if (!hull) return null;
  const yard = cloneYard(rec.yard);
  const id = nextId(yard, "s");
  yard.ships[id] = {
    hull: hull.id,
    rig: Object.fromEntries(hull.sockets.map((s) => [s.id, { mast: null, sails: [], studs: [] }])),
    guns: { broadside: [], bow: [], swivel: [] },
  };
  const next = commitYard(rec, yard, hull.price);
  return next ? { hold: next, ship: id } : null;
}

/** Buy one part. It lands loose in the hold; fitting it is a separate, free act. */
export function buyPart(typeId) {
  const rec = current();
  const type = PARTS[typeId];
  if (!type) return null;
  const yard = cloneYard(rec.yard);
  const id = mintPart(yard, typeId);
  const next = commitYard(rec, yard, type.price);
  return next ? { hold: next, part: id } : null;
}

/** Choose the ship she sails, which is also the ship the menu turns. */
export function setActiveShip(shipId) {
  const rec = current();
  if (!rec.yard.ships[shipId]) return null;
  const yard = cloneYard(rec.yard);
  yard.active = shipId;
  return commitYard(rec, yard);
}

/**
 * Step a mast into a socket, or pass `null` to unstep the one that is there.
 *
 * Unstepping takes her sails down with it: they come loose into the hold rather than disappearing,
 * because a berth only exists while its mast does and a sail with nowhere to be is still a sail she
 * owns. Stepping a different mast does the same to whatever was there before it.
 */
export function fitMast(shipId, socketId, partId) {
  const rec = current();
  const ship = rec.yard.ships[shipId];
  const socket = ship && socketOf(HULLS[ship.hull], socketId);
  if (!socket) return null;
  const yard = cloneYard(rec.yard);
  if (partId) {
    const mast = partOf(rec, partId);
    if (!mast || !mastFitsSocket(mast, socket)) return null;
    pull(yard, partId);
    yard.ships[shipId].rig[socketId] = { mast: partId, sails: mast.berths.map(() => null), studs: mast.berths.map(() => null) };
  } else {
    yard.ships[shipId].rig[socketId] = { mast: null, sails: [], studs: [] };
  }
  return commitYard(rec, yard);
}

/** Bend a sail onto one berth of a stepped mast, or pass `null` to take it off. */
export function fitSail(shipId, socketId, berth, partId) {
  const rec = current();
  const ship = rec.yard.ships[shipId];
  const slot = ship && ship.rig[socketId];
  if (!slot || !slot.mast) return null;
  const mast = partOf(rec, slot.mast);
  const want = mast.berths[berth];
  if (!want) return null;
  const yard = cloneYard(rec.yard);
  if (partId) {
    const sail = partOf(rec, partId);
    if (!sailFitsBerth(sail, want)) return null;
    pull(yard, partId);
  }
  const slot2 = yard.ships[shipId].rig[socketId];
  while (slot2.sails.length < mast.berths.length) slot2.sails.push(null);
  slot2.sails[berth] = partId || null;
  // the studdingsail hangs off the sail: taking the sail off, or changing it for one the stud no
  // longer fits beside, sends the stud loose into the hold with it
  slot2.studs = (slot2.studs || []).map((st, i) => {
    if (!st) return null;
    const host = slot2.sails[i] ? partOf(rec, slot2.sails[i]) : null;
    const hostType = i === berth && partId ? partOf(rec, partId) : host;
    return studFitsSail(partOf(rec, st), mast, i, hostType) ? st : null;
  });
  return commitYard(rec, yard);
}

/**
 * Boom a studdingsail out from the sail in one berth, or pass `null` to take it in.
 *
 * It is an attachment to the sail, never a berth of its own: the host has to be a square sail
 * already set, and the stud has to be of that sail's level up the mast. See `studFitsSail`.
 */
export function fitStud(shipId, socketId, berth, partId) {
  const rec = current();
  const ship = rec.yard.ships[shipId];
  const slot = ship && ship.rig[socketId];
  if (!slot || !slot.mast) return null;
  const mast = partOf(rec, slot.mast);
  const host = slot.sails[berth] ? partOf(rec, slot.sails[berth]) : null;
  const yard = cloneYard(rec.yard);
  if (partId) {
    const stud = partOf(rec, partId);
    if (!studFitsSail(stud, mast, berth, host)) return null;
    pull(yard, partId);
  }
  const slot2 = yard.ships[shipId].rig[socketId];
  slot2.studs = slot2.studs || [];
  while (slot2.studs.length < mast.berths.length) slot2.studs.push(null);
  slot2.studs[berth] = partId || null;
  return commitYard(rec, yard);
}

/** Run a gun out at one of the hull's mounts. She refuses a gun she has no port for. */
export function fitGun(shipId, mount, partId) {
  const rec = current();
  const ship = rec.yard.ships[shipId];
  const hull = ship && HULLS[ship.hull];
  const gun = partOf(rec, partId);
  if (!hull || !gun || gun.mount !== mount) return null;
  if (ship.guns[mount].length >= hull.guns[mount]) return null;
  const yard = cloneYard(rec.yard);
  pull(yard, partId);
  yard.ships[shipId].guns[mount].push(partId);
  return commitYard(rec, yard);
}

/** Take one gun back off her rail and into the hold. */
export function unfitGun(shipId, partId) {
  const rec = current();
  if (!rec.yard.ships[shipId] || !rec.yard.parts[partId]) return null;
  const yard = cloneYard(rec.yard);
  pull(yard, partId);
  return commitYard(rec, yard);
}

/** Watch the hold. Fires on every bank, spend, reset, and on a change made in another tab. */
export function subscribeHold(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Two tabs of the same game share one hold, and whoever writes last would otherwise silently paint
// over the other's voyage. Picking up the write keeps both windows on the same number.
if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY && e.key !== null) return;
    publish(load());
  });
}

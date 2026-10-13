/**
 * THE HOLD, KEPT — where this browser keeps a captain's record, and how the screen reaches it.
 *
 * The rules are not here. What the record is, what a voyage banks, what the shipyard sells and what
 * fits where all live in `holdrules.js`, as pure functions the server runs too. This file is the
 * store: it loads the record out of `localStorage`, runs a rule on it when the captain asks for
 * something, saves what comes back, and tells every screen that is watching. Its exports are the
 * ones the screen has always read, so nothing above it knows the rules moved.
 */

import { blank, sanitize, settle, applyAction, bank, spend } from "./holdrules.js";

export {
  NAME_LIMIT, HOLD_SHARE, REFUND_SHARE, cleanName, refundOf,
  modeRecord, voyageValue, partOf, ownedShips, shipName, spareParts, shipLoadout, shortfall, ownedFill, readiness,
} from "./holdrules.js";

const KEY = "sternchase.hold";

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
  if (!cache) {
    // An old record opened under a longer list is paid for what it already holds, once, here.
    const s = settle(load());
    cache = s.rec;
    if (s.paid > 0) save(cache);
  }
  return cache;
}

function publish(rec) {
  cache = rec;
  for (const fn of listeners) fn(rec);
}

function commit(rec) {
  const settled = settle(rec).rec;
  save(settled);
  publish(settled);
  return settled;
}

/** The hold as it stands. Treat the returned record as read-only; every writer here returns a fresh one. */
export function getHold() {
  return current();
}

/** True while the hold is only in memory — storage refused the last write. */
export function holdIsPersistent() {
  return !!store() && writable;
}

/**
 * Bank one finished voyage and return the new hold alongside the coins it added, and beside them
 * `bounty`, what the achievements the voyage completed paid, with the rungs they were paid for in
 * `rungs`. See `bank` in `holdrules.js` for what `run` carries.
 */
export function bankVoyage(run) {
  const out = bank(current(), run);
  return { hold: commit(out.rec), banked: out.banked, bounty: out.bounty, rungs: out.rungs };
}

/**
 * Draw `amount` out of the hold. Returns the new record on success and `null` if the coins are not
 * there, so a caller can treat it as the whole check — nothing is deducted on a refusal.
 */
export function spendFromHold(amount) {
  const out = spend(current(), amount);
  return out ? commit(out.rec) : null;
}

export const getYard = () => current().yard;

/**
 * Run one shop action on the hold as it stands and keep what it gives. A refusal saves nothing and
 * tells nobody. Every writer below is this, with its answer put back in the shape the screen reads.
 */
function act(name, ...args) {
  const out = applyAction(current(), name, args);
  if (!out) return null;
  return { ...out, rec: commit(out.rec) };
}
const recOf = (out) => (out ? out.rec : null);

/** Buy a bare hull. She arrives with no rig and no guns; the parts to fill her are bought separately. */
export function buyShip(hullId) {
  const out = act("buyShip", hullId);
  return out ? { hold: out.rec, ship: out.ship } : null;
}

/** Name a ship, or pass an empty string to let her go by her class again. */
export const nameShip = (shipId, name) => recOf(act("nameShip", shipId, name));

/** Sell one part back to the yard, off whichever of her ships carry it, for its full price. */
export const sellPart = (partId) => recOf(act("sellPart", partId));

/** Fit everything she owns that fits into one ship. Returns `{ hold, fitted }`, or `null` if nothing fitted. */
export function fitOwned(shipId) {
  const out = act("fitOwned", shipId);
  return out ? { hold: out.rec, fitted: out.fitted } : null;
}

/** Buy one part. It lands loose in the hold; fitting it is a separate, free act. */
export function buyPart(typeId) {
  const out = act("buyPart", typeId);
  return out ? { hold: out.rec, part: out.part } : null;
}

/** Choose the ship she sails, which is also the ship the menu turns. */
export const setActiveShip = (shipId) => recOf(act("setActiveShip", shipId));

/** Step a mast into a socket, or pass `null` to unstep the one that is there. */
export const fitMast = (shipId, socketId, partId) => recOf(act("fitMast", shipId, socketId, partId));

/** Bend a sail onto one berth of a stepped mast, or pass `null` to take it off. */
export const fitSail = (shipId, socketId, berth, partId) => recOf(act("fitSail", shipId, socketId, berth, partId));

/** Boom a studdingsail out from the sail in one berth, or pass `null` to take it in. */
export const fitStud = (shipId, socketId, berth, partId) => recOf(act("fitStud", shipId, socketId, berth, partId));

/** Run a gun out at one of the hull's mounts. She refuses a gun she has no port for or cannot bear. */
export const fitGun = (shipId, mount, partId) => recOf(act("fitGun", shipId, mount, partId));

/** Take one gun back off her rail. She keeps it: it is off this ship, not out of the hold. */
export const unfitGun = (shipId, partId) => recOf(act("unfitGun", shipId, partId));

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

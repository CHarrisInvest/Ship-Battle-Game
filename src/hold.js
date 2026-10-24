/**
 * THE HOLD, AS THIS BROWSER SEES IT — a copy of the server's, and how the screen reaches it.
 *
 * The record lives on the server, which decides every change to it. The rules are `holdrules.js`,
 * the same functions the server runs, so this file can answer a captain the moment she taps: a shop
 * action is applied here at once, shown, and sent; the server's answer then replaces the guess, and a
 * refusal puts the screen back to the record as the server holds it. Actions go one at a time, in
 * order, each against the version the last answer carried. A version gone stale (another tab) is
 * caught by the server, and the action is tried once more on the record it sent back.
 *
 * Until the server has answered, the screens see a blank record and `holdStatus()` says "loading";
 * if it cannot be reached it says "offline", nothing can be bought, no voyage can start, and it keeps
 * trying. A voyage's coins come back from the server with the record they were banked into, through
 * `adoptHold`. The exports the screens have always read are all still here.
 *
 * The record used to live in this browser's localStorage. On the first visit after it moved, that
 * old save is deleted: a local record could have been edited, so nothing in it is carried over.
 */

import { blank, applyAction } from "./holdrules.js";
import { call, ensureSession } from "./net.js";

export {
  NAME_LIMIT, HOLD_SHARE, REFUND_SHARE, cleanName, refundOf,
  modeRecord, voyageValue, partOf, ownedShips, shipName, shipLivery, spareParts, shipLoadout, shortfall, ownedFill, readiness,
} from "./holdrules.js";

const OLD_KEY = "sternchase.hold";
const RETRY_MS = 4000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let confirmed = blank(); // the record as the server last said it is
let version = 0;
let queue = []; // shop actions applied here and not yet answered, oldest first
let shown = confirmed; // `confirmed` with `queue` applied: what the screens see
let status = "loading"; // "loading" | "ready" | "offline" | "blocked" (the browser refuses the cookie)
let hadOldSave = false;
const listeners = new Set();
const statusListeners = new Set();

function publish() {
  shown = queue.reduce((r, q) => { const o = applyAction(r, q.name, q.args); return o ? o.rec : r; }, confirmed);
  for (const fn of listeners) fn(shown);
}

function setStatus(s) {
  if (s === status) return;
  status = s;
  for (const fn of statusListeners) fn(s);
}

function forgetOldSave() {
  try {
    const s = typeof window !== "undefined" ? window.localStorage : null;
    if (s && s.getItem(OLD_KEY) !== null) { s.removeItem(OLD_KEY); hadOldSave = true; }
  } catch { /* storage refused: there is nothing to forget */ }
}

let connecting = null;
/**
 * Sign in (as a guest, if she has no session) and load her hold. Resolves once the hold is in, or
 * once the server is found to be out of reach, in which case it tries again until it is not.
 */
export function connect() {
  if (connecting) return connecting;
  forgetOldSave();
  connecting = (async () => {
    for (;;) {
      if (status !== "ready") setStatus(status === "offline" || status === "blocked" ? status : "loading");
      const session = await ensureSession();
      if (session === "blocked") {
        // her browser will not keep the cookie: another try would only make another account
        setStatus("blocked");
        await wait(60000);
        continue;
      }
      if (session) {
        const r = await call("GET", "/hold");
        if (r.status === 200) {
          confirmed = r.data.hold;
          version = r.data.version;
          publish();
          setStatus("ready");
          connecting = null;
          return true;
        }
      }
      setStatus("offline");
      await wait(RETRY_MS);
    }
  })();
  return connecting;
}

/**
 * Load the hold again from nothing, for whoever the session now says she is: after she signs in,
 * signs out or deletes her account, the record on screen belongs to someone else. Called only once
 * the hold is settled, so no action of the last captain's is still on its way.
 */
export function reconnect() {
  queue = [];
  confirmed = blank();
  version = 0;
  publish();
  setStatus("loading");
  connecting = null;
  return connect();
}

/** The hold as it stands on this screen. Treat it as read-only. */
export function getHold() {
  return shown;
}

/** "loading", "ready" or "offline". */
export const holdStatus = () => status;

/** True once the server's record is in and the hold can be changed. */
export const holdIsPersistent = () => status === "ready";

/** Whether this browser held a save from before the hold moved to the server (deleted on load). */
export const hadLocalSave = () => hadOldSave;

export const getYard = () => shown.yard;

/** Whether the hold has anything in it a fresh one does not: what a guest would lose by switching accounts. */
export const hasProgress = () => JSON.stringify(shown) !== JSON.stringify(blank());

/** Watch the hold. Fires on every change, whether made here or come back from the server. */
export function subscribeHold(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Watch the connection: "loading", "ready" or "offline". */
export function subscribeStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

/** Take a record the server has sent, with the version it is at: a banked voyage, say. */
export function adoptHold({ hold, version: v }) {
  confirmed = hold;
  version = v;
  publish();
}

let sending = false;
/** Send the queued actions, one at a time, each against the version the last answer left. */
async function send() {
  if (sending) return;
  sending = true;
  while (queue.length) {
    const q = queue[0];
    const r = await call("POST", "/hold/actions", { action: q.name, args: q.args, version });
    if (r.status === 200 || r.status === 422 || r.status === 409) {
      // an answer older than the record already here (a voyage banked meanwhile) is not taken
      if (r.data.version >= version) { confirmed = r.data.hold; version = r.data.version; }
      // 409: another tab moved the record on; the action is tried again on the record it sent back.
      // 200 and 422: done, applied or refused, and the record is the server's either way.
      if (r.status !== 409) queue.shift();
      publish();
    } else if (r.status === 401) {
      const session = await ensureSession();
      if (session !== true) setStatus(session === "blocked" ? "blocked" : "offline");
      await wait(RETRY_MS);
    } else if (r.status === 0 || r.status === 429 || r.status >= 500) {
      setStatus("offline");
      await wait(RETRY_MS);
    } else {
      // a request the server could not read: drop it rather than send it for ever
      queue.shift();
      publish();
    }
    if (status === "offline" && r.status !== 0 && r.status < 500) setStatus("ready");
  }
  sending = false;
  if (status === "offline") setStatus("ready");
}

/** Apply one shop action here, show it, and send it. What the rule answered, or null. */
function act(name, ...args) {
  if (status !== "ready") return null;
  const out = applyAction(shown, name, args);
  if (!out) return null;
  queue.push({ name, args });
  publish();
  send();
  return { ...out, rec: shown };
}
const recOf = (out) => (out ? out.rec : null);

/**
 * Ask the server for the tap code's coins. The server alone decides: for an account its
 * `COIN_GRANT` names the record comes back with them added, and otherwise nothing happens at all.
 * Resolves to the coins granted, or 0.
 */
export async function grantCoins() {
  if (status !== "ready") return 0;
  const r = await call("POST", "/hold/grant", {});
  if (r.status !== 200 || !r.data || !r.data.hold) return 0;
  // an answer older than the record already here (a voyage banked meanwhile) is not taken
  if (r.data.version >= version) adoptHold(r.data);
  return r.data.granted || 0;
}

/** Buy a bare hull. She arrives with no rig and no guns; the parts to fill her are bought separately. */
export function buyShip(hullId) {
  const out = act("buyShip", hullId);
  return out ? { hold: out.rec, ship: out.ship } : null;
}

/** Name a ship, or pass an empty string to let her go by her class again. */
export const nameShip = (shipId, name) => recOf(act("nameShip", shipId, name));

/** Paint a ship in one of the liveries in `LIVERY_KEYS`. It costs nothing. */
export const paintShip = (shipId, key) => recOf(act("paintShip", shipId, key));

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

/** Whether every shop action sent so far has been answered: nothing is waiting on the server. */
export const holdSettled = () => queue.length === 0 && !sending;

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
 */

const KEY = "sternchase.hold";
const VERSION = 1;

// Share of a voyage's earnings that reaches the hold. At 1 every coin you earn at sea is also logged
// ashore — spending at sea costs you nothing here, so upgrading mid-round is never a tax on progress.
// Drop it below 1 if the meta economy ever needs slowing down without touching the in-round loop.
export const HOLD_SHARE = 1;

const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);

function blankMode() {
  return { runs: 0, wins: 0, earned: 0, bestSunk: 0, bestTime: 0, bestRank: 0 };
}

function blank() {
  return {
    v: VERSION,
    coins: 0, // unspent, the balance a future shop would draw on
    spent: 0, // taken back out again, so the two sides of the ledger always reconstruct `earned`
    lifetime: { earned: 0, runs: 0, wins: 0, sunk: 0, dmg: 0, afloat: 0 },
    modes: {}, // keyed by mode name, created on demand so a new mode needs no schema change
  };
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
  return rec;
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

/** Coins a voyage would bank, before it is banked. Same rounding the real thing uses. */
export function voyageValue(earned) {
  return Math.max(0, Math.round(num(earned) * HOLD_SHARE));
}

/**
 * Bank one finished voyage and return the new hold alongside the coins it added.
 *
 * `run` is the end-of-round summary: `{ mode, earned, kills, dmg, time, won, rank }`. `earned` is what
 * the ship took in at sea, not what she had left — an upgrade bought at sea is not a coin lost here.
 */
export function bankVoyage(run) {
  const rec = current();
  const mode = typeof run.mode === "string" && run.mode ? run.mode : "unknown";
  const banked = voyageValue(run.earned);
  const kills = num(run.kills);
  const time = num(run.time);
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
      dmg: rec.lifetime.dmg + num(run.dmg),
      afloat: rec.lifetime.afloat + time,
    },
    modes: { ...rec.modes },
  };

  const m = modeRecord(rec, mode);
  next.modes[mode] = {
    runs: m.runs + 1,
    wins: m.wins + (won ? 1 : 0),
    earned: m.earned + banked,
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

/** Scuttle the hold: back to a captain's first day at sea. */
export function resetHold() {
  return commit(blank());
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

/**
 * A VOYAGE, RECORDED FOR THE SERVER.
 *
 * The server banks a voyage only after replaying it, so the browser keeps the log the replay needs:
 * the controls it stepped with, one entry for each tick they changed, `[tick, input]` with the tick
 * read before the step. The log goes up in pieces as the round is sailed, every few seconds, and the
 * rest with the end tick when the round is over. A piece that fails on the network is sent again
 * while the tab is open; one the server refuses means the voyage cannot bank, and the end screen
 * says so. Nothing is kept anywhere but memory: a closed tab banks nothing, as it never did.
 *
 * `send(entries)` and `finish(ticks, entries)` are the two calls, each resolving `{ status, data }`,
 * so the recorder is the same thing in the browser and in the tests.
 */

import { call, ENGINE } from "./net.js";

/** Ticks between pieces of the log: five seconds of round. */
export const PIECE_TICKS = 300;
/** How long to wait before sending a piece again after the network failed it, in milliseconds. */
const RETRY_MS = 2000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function createRecorder({ send, finish, pieceTicks = PIECE_TICKS, retryMs = RETRY_MS }) {
  let pending = [];
  let lastKey = "";
  let lastSent = 0;
  let chain = Promise.resolve(true); // resolves false once a piece has been refused
  let refused = null;

  /** Send `call()` until the network carries it; true if the server took it, false if it refused. */
  async function deliver(call) {
    for (;;) {
      const r = await call();
      // the network, the server busy, or a finish of this voyage still being counted: ask again
      const busy = r.status === 409 && r.data && r.data.error === "busy";
      if (r.status === 0 || r.status === 429 || r.status >= 500 || busy) { await wait(retryMs); continue; }
      if (r.status === 200) return r;
      refused = refused || r;
      return null;
    }
  }

  function flush() {
    if (!pending.length) return;
    const piece = pending;
    pending = [];
    chain = chain.then((ok) => (ok ? deliver(() => send(piece)).then(Boolean) : false));
  }

  return {
    /** The input the step at `tick` is about to be handed, logged if it differs from the last. */
    record(tick, input) {
      const key = JSON.stringify(input);
      if (key !== lastKey) { pending.push([tick, { ...input }]); lastKey = key; }
      if (tick - lastSent >= pieceTicks) { lastSent = tick; flush(); }
    },
    /** The round is over at `ticks`: what the server banked, `{ ok: true, data }`, or `{ ok: false, refused }`. */
    async finish(ticks) {
      const ok = await chain;
      if (!ok) return { ok: false, refused };
      const rest = pending;
      pending = [];
      const r = await deliver(() => finish(ticks, rest));
      return r ? { ok: true, data: r.data } : { ok: false, refused };
    },
  };
}


/**
 * Ask the server for a voyage: `{ ok: true, round: { roundId, seed, loadout, mode } }`, the seed and
 * the ship to build the world from, or `{ ok: false, reason }` with `engine` (this page is older than
 * the server's engine: reload), `busy` (her last voyage is still being banked), `offline`, or
 * `refused`.
 */
export async function startVoyage(mode) {
  const r = await call("POST", "/rounds", { mode, engine: ENGINE });
  if (r.status === 200) return { ok: true, round: r.data };
  if (r.status === 409 && r.data && r.data.error === "engine") return { ok: false, reason: "engine" };
  if (r.status === 409) return { ok: false, reason: "busy" };
  if (r.status === 0 || r.status >= 500) return { ok: false, reason: "offline" };
  return { ok: false, reason: "refused" };
}

/** A recorder for the voyage `roundId`, sending to the server. */
export function recorderFor(roundId) {
  return createRecorder({
    send: (entries) => call("POST", `/rounds/${roundId}/inputs`, { entries }),
    finish: (ticks, entries) => call("POST", `/rounds/${roundId}/finish`, { ticks, entries }),
  });
}

/**
 * VOYAGES — started by the server, fed by the browser, banked by a replay.
 *
 * The browser sails a round exactly as it always did and records its controls. The server picks the
 * seed, resolves the loadout off its own copy of the hold, takes the log in pieces as it is sailed,
 * and at the end replays the round itself and banks what its replay says. Nothing the browser
 * computed is believed. What it can still lie about is its own hands, and a bot's round is a real
 * round played by the rules; what it cannot do is invent coins, sail a round faster than real time,
 * replay a lucky round twice, or sail several at once.
 *
 *   POST /rounds                 { mode, engine }      starts one, abandoning any she had open
 *   POST /rounds/:id/inputs      { entries }           a piece of the log
 *   POST /rounds/:id/finish      { ticks, entries }    the last piece, and the end tick she saw
 *
 * A refusal is 422 with a reason (`pace`, `order`, `input`, `tick`, `ended`), 404 for a round that
 * is not hers, 409 for one already finished or abandoned, one being finished (`busy`), or one started
 * under another engine. A refusal banks nothing; three refused finishes close the round.
 */

import { randomUUID, randomInt } from "node:crypto";
import { Worker } from "node:worker_threads";
import { isInput, MODE_LIST } from "../src/sim/index.js";
import { bank, shipLoadout } from "../src/holdrules.js";
import { HttpError } from "./http.js";
import { lockHold, writeHold } from "./hold.js";
import { transaction } from "./db.js";

/** Steps in the longest round there may be: an hour, as the engine's own tests allow. */
export const MAX_TICKS = 3600 * 60;
/** Entries in one piece of a log, and in a whole round. */
export const MAX_PIECE = 5000;
export const MAX_ENTRIES = MAX_TICKS;
/** How far ahead of real time a log may run, in ticks: five seconds, for a slow clock or a late start. */
export const SLACK_TICKS = 5 * 60;

const refuse = (error) => ({ status: 422, body: { error } });

/** The furthest tick a round started at `startedAt` could honestly have reached by `now`. */
const reachable = (startedAt, now) => {
  if (!Number.isFinite(now)) throw new Error("reachable wants the time, not the clock");
  return Math.floor(((now - startedAt.getTime()) / 1000) * 60) + SLACK_TICKS;
};

/** A piece of log, checked: a list of `[tick, input]`, ticks rising from `from`. Returns a refusal or null. */
function checkPiece(entries, from) {
  if (!Array.isArray(entries)) throw new HttpError(400, "entries");
  if (entries.length > MAX_PIECE) return refuse("size");
  let prev = from - 1;
  for (const e of entries) {
    if (!Array.isArray(e) || e.length !== 2 || !Number.isInteger(e[0])) throw new HttpError(400, "entry");
    if (e[0] <= prev || e[0] >= MAX_TICKS) return refuse("order");
    if (!isInput(e[1])) return refuse("input");
    prev = e[0];
  }
  return null;
}

/**
 * One worker, replays queued to it in turn. A replay that runs past `timeoutMs` (queue wait
 * included) has its worker terminated, and a worker that dies for any reason fails everything
 * waiting on it and is replaced, so a finish is never left hanging. More than `limit` replays
 * waiting is a 503: the queue is a line, not a store.
 */
export function replayer({ limit = 8, timeoutMs = 30000 } = {}) {
  const url = new URL("./replay-worker.js", import.meta.url);
  const waiting = new Map();
  let worker = null, next = 0, closing = false;

  function spawn() {
    const w = new Worker(url);
    w.unref();
    w.on("message", ({ id, out, error }) => {
      const job = waiting.get(id);
      if (!job) return;
      waiting.delete(id);
      clearTimeout(job.timer);
      if (error) job.reject(new Error(error));
      else job.resolve(out);
    });
    w.on("error", (e) => { console.error("replay worker failed:", e.message); });
    w.on("exit", () => {
      if (worker !== w) return;
      for (const job of waiting.values()) { clearTimeout(job.timer); job.reject(new HttpError(503, "replay interrupted")); }
      waiting.clear();
      worker = closing ? null : spawn();
    });
    return w;
  }
  worker = spawn();

  return {
    run(round, entries, maxTicks, ms = timeoutMs) {
      if (waiting.size >= limit) return Promise.reject(new HttpError(503, "busy"));
      return new Promise((resolve, reject) => {
        const id = next++;
        const timer = setTimeout(() => { worker.terminate(); }, ms);
        waiting.set(id, { resolve, reject, timer });
        worker.postMessage({ id, round, entries, maxTicks });
      });
    },
    async close() {
      closing = true;
      if (worker) await worker.terminate();
    },
  };
}

/** Her round, locked, or a 404. */
async function lockRound(client, userId, id) {
  const { rows } = await client.query("select * from rounds where id = $1 and user_id = $2 for update", [id, userId]);
  if (!rows.length) throw new HttpError(404, "no such round");
  const r = rows[0];
  if (r.finished_at || r.abandoned_at) return { round: r, closed: true };
  return { round: r, closed: false };
}

async function append(client, round, entries, now) {
  if (!entries.length) return null;
  const last = entries[entries.length - 1][0];
  if (last > reachable(round.started_at, now())) return refuse("pace");
  if (round.entry_count + entries.length > MAX_ENTRIES) return refuse("size");
  const { rows } = await client.query("select coalesce(max(seq), -1) + 1 as seq from round_inputs where round_id = $1", [round.id]);
  await client.query("insert into round_inputs (round_id, seq, entries) values ($1, $2, $3)", [round.id, rows[0].seq, JSON.stringify(entries)]);
  await client.query("update rounds set next_tick = $2, entry_count = entry_count + $3 where id = $1", [round.id, last + 1, entries.length]);
  round.next_tick = last + 1;
  round.entry_count += entries.length;
  return null;
}

export async function startRound(client, userId, body, { engine, now }) {
  if (!body || typeof body !== "object" || typeof body.mode !== "string" || typeof body.engine !== "string") throw new HttpError(400, "shape");
  if (body.engine !== engine) return { status: 409, body: { error: "engine", engine } };
  if (!MODE_LIST.includes(body.mode)) throw new HttpError(400, "mode");
  // a voyage being banked is not abandoned under it: she waits for the bank, then sails again
  if (finishing.busy(userId)) return { status: 409, body: { error: "busy" } };
  // the hold is locked before any round, here as in a finish, so the two can never wait on each other
  const { hold } = await lockHold(client, userId, now);
  const at = new Date(now());
  // one voyage at a time: whatever she had open is abandoned and can no longer bank
  await client.query("update rounds set abandoned_at = $2 where user_id = $1 and finished_at is null and abandoned_at is null", [userId, at]);
  const round = { id: randomUUID(), mode: body.mode, seed: randomInt(0, 2 ** 32), loadout: JSON.parse(JSON.stringify(shipLoadout(hold))) };
  await client.query(
    "insert into rounds (id, user_id, mode, seed, loadout, engine, started_at) values ($1, $2, $3, $4, $5, $6, $7)",
    [round.id, userId, round.mode, round.seed, JSON.stringify(round.loadout), engine, at],
  );
  return { status: 200, body: { roundId: round.id, seed: round.seed, loadout: round.loadout, mode: round.mode } };
}

export async function addInputs(client, userId, id, body, { now }) {
  if (!body || typeof body !== "object") throw new HttpError(400, "shape");
  const { round, closed } = await lockRound(client, userId, id);
  // a piece already taken, sent again because its answer was lost: answered, and not taken twice
  const e = body.entries;
  if (Array.isArray(e) && e.length && Array.isArray(e[e.length - 1]) && Number.isInteger(e[e.length - 1][0]) && e[e.length - 1][0] < round.next_tick) {
    return { status: 200, body: { nextTick: round.next_tick } };
  }
  const bad = checkPiece(body.entries, round.next_tick);
  if (bad) return bad;
  if (closed) return { status: 409, body: { error: "closed" } };
  return (await append(client, round, body.entries, now)) || { status: 200, body: { nextTick: round.next_tick } };
}

/** The rounds being finished right now, so each is replayed once at a time and never abandoned mid-bank. */
export const finishing = {
  rounds: new Map(), // round id to user id
  busy(userId) { for (const u of this.rounds.values()) if (u === userId) return true; return false; },
};

/** How many refused finishes a round may take before it is closed, so a refusal is not free to repeat. */
export const MAX_REFUSED = 3;

/**
 * Finish a voyage. The replay runs outside any transaction, holding no connection and no lock, so
 * a long or a malicious one costs its own captain time and nobody else anything. Only once the
 * replay has said yes is anything locked: her hold first and then the round, the order every route
 * takes them in, and the round is checked again to be open and fed no further since it was read.
 */
export async function finishRound(pool, userId, id, body, { engine, now, replays }) {
  if (!body || typeof body !== "object" || !Number.isInteger(body.ticks)) throw new HttpError(400, "shape");
  const entries = body.entries === undefined ? [] : body.entries;
  if (finishing.rounds.has(id)) return { status: 409, body: { error: "busy" } };
  finishing.rounds.set(id, userId);
  try {
    const { rows } = await pool.query("select * from rounds where id = $1 and user_id = $2", [id, userId]);
    if (!rows.length) throw new HttpError(404, "no such round");
    const round = rows[0];
    // banked already, and asked again because the answer was lost: told what it banked, once more
    if (round.finished_at) {
      const cur = (await pool.query("select data, version from holds where user_id = $1", [userId])).rows[0];
      return { status: 200, body: { hold: cur.data, version: cur.version, banked: round.banked, bounty: round.bounty || 0, rungs: [], result: round.result, again: true } };
    }
    if (round.abandoned_at) return { status: 409, body: { error: "closed" } };
    if (round.engine !== engine) return { status: 409, body: { error: "engine", engine } };
    const bad = checkPiece(entries, round.next_tick);
    if (bad) return bad;
    const ticks = body.ticks;
    if (ticks < round.next_tick || ticks > MAX_TICKS) return refuse("tick");
    if (ticks > reachable(round.started_at, now())) return refuse("pace");

    const pieces = await pool.query("select entries from round_inputs where round_id = $1 order by seq", [id]);
    const log = pieces.rows.flatMap((r) => r.entries).concat(entries);
    const out = await replays.run({ mode: round.mode, seed: Number(round.seed), loadout: round.loadout }, log, ticks);

    if (!out.over || out.ticks !== ticks || out.unread) {
      // refused: the one thing that changes is the count, and the third closes the round
      await pool.query(
        "update rounds set failed_finishes = failed_finishes + 1, abandoned_at = case when failed_finishes + 1 >= $2 then $3 else abandoned_at end where id = $1",
        [id, MAX_REFUSED, new Date(now())],
      );
      return refuse(out.over ? "tick" : "ended");
    }

    return await transaction(pool, async (client) => {
      const cur = await lockHold(client, userId, now);
      const again = (await client.query("select * from rounds where id = $1 for update", [id])).rows[0];
      if (again.finished_at || again.abandoned_at) return { status: 409, body: { error: "closed" } };
      if (again.next_tick !== round.next_tick || again.entry_count !== round.entry_count) return { status: 409, body: { error: "changed" } };
      const failed = await append(client, again, entries, now);
      if (failed) return failed;
      const banked = bank(cur.hold, out.run);
      const version = cur.version + 1;
      await writeHold(client, userId, banked.rec, version, now);
      await client.query("update rounds set finished_at = $2, ticks = $3, result = $4, banked = $5, bounty = $6 where id = $1",
        [id, new Date(now()), ticks, JSON.stringify(out.result), banked.banked, banked.bounty]);
      return { status: 200, body: { hold: banked.rec, version, banked: banked.banked, bounty: banked.bounty, rungs: banked.rungs, result: out.result } };
    });
  } finally {
    finishing.rounds.delete(id);
  }
}

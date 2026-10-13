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
 * is not hers, 409 for one already finished or abandoned, and it changes nothing.
 */

import { randomUUID, randomInt } from "node:crypto";
import { Worker } from "node:worker_threads";
import { isInput, MODE_LIST } from "../src/sim/index.js";
import { bank, shipLoadout } from "../src/holdrules.js";
import { HttpError } from "./http.js";
import { lockHold, writeHold } from "./hold.js";

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

/** One worker, replays queued to it in turn. */
export function replayer() {
  const worker = new Worker(new URL("./replay-worker.js", import.meta.url));
  worker.unref();
  const waiting = new Map();
  let next = 0;
  worker.on("message", ({ id, out, error }) => {
    const w = waiting.get(id);
    waiting.delete(id);
    if (error) w.reject(new Error(error));
    else w.resolve(out);
  });
  return {
    run: (round, entries, maxTicks) => new Promise((resolve, reject) => {
      const id = next++;
      waiting.set(id, { resolve, reject });
      worker.postMessage({ id, round, entries, maxTicks });
    }),
    close: () => worker.terminate(),
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
  const bad = checkPiece(body.entries, round.next_tick);
  if (bad) return bad;
  if (closed) return { status: 409, body: { error: "closed" } };
  return (await append(client, round, body.entries, now)) || { status: 200, body: { nextTick: round.next_tick } };
}

export async function finishRound(client, userId, id, body, { now, replays }) {
  if (!body || typeof body !== "object" || !Number.isInteger(body.ticks)) throw new HttpError(400, "shape");
  const entries = body.entries === undefined ? [] : body.entries;
  const { round, closed } = await lockRound(client, userId, id);
  if (closed) return { status: 409, body: { error: "closed" } };
  const bad = checkPiece(entries, round.next_tick);
  if (bad) return bad;
  const ticks = body.ticks;
  if (ticks < round.next_tick || ticks > MAX_TICKS) return refuse("tick");
  if (ticks > reachable(round.started_at, now())) return refuse("pace");

  const { rows } = await client.query("select entries from round_inputs where round_id = $1 order by seq", [round.id]);
  const log = rows.flatMap((r) => r.entries).concat(entries);
  const out = await replays.run({ mode: round.mode, seed: Number(round.seed), loadout: round.loadout }, log, ticks);
  if (!out.over || out.ticks !== ticks || out.unread) return refuse(out.over ? "tick" : "ended");

  // only now does anything change: the last piece, the hold, the round
  const failed = await append(client, round, entries, now);
  if (failed) return failed;
  const cur = await lockHold(client, userId, now);
  const banked = bank(cur.hold, out.run);
  const version = cur.version + 1;
  await writeHold(client, userId, banked.rec, version, now);
  await client.query("update rounds set finished_at = $2, ticks = $3, result = $4, banked = $5 where id = $1",
    [round.id, new Date(now()), ticks, JSON.stringify(out.result), banked.banked]);
  return { status: 200, body: { hold: banked.rec, version, banked: banked.banked, bounty: banked.bounty, rungs: banked.rungs, result: out.result } };
}

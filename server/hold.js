/**
 * The hold, kept by the server. The record is the one `holdrules.js` defines and every change to it
 * is one of its actions, applied here under a row lock, so the browser's guess at an answer is only
 * ever a guess and this is the record. `version` moves on every write; a write against any other
 * version is refused with the record as it stands, which is how a second tab learns it is behind.
 */

import { blank, applyAction, grantCoins } from "../src/holdrules.js";
import { HttpError } from "./http.js";

/** The user's hold row, locked for this transaction, made blank at version 1 if she has none. */
export async function lockHold(client, userId, now) {
  await client.query(
    "insert into holds (user_id, data, version, updated_at) values ($1, $2, 1, $3) on conflict (user_id) do nothing",
    [userId, blank(), new Date(now())],
  );
  const { rows } = await client.query("select data, version from holds where user_id = $1 for update", [userId]);
  return { hold: rows[0].data, version: rows[0].version };
}

export async function writeHold(client, userId, hold, version, now) {
  await client.query("update holds set data = $2, version = $3, updated_at = $4 where user_id = $1", [userId, hold, version, new Date(now())]);
}

/** `POST /hold/actions`: `{ action, args, version }`. */
export function parseAction(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "body");
  const { action, args, version } = body;
  if (typeof action !== "string" || !Array.isArray(args) || !Number.isInteger(version)) throw new HttpError(400, "shape");
  return { action, args, version };
}

export async function act(client, userId, { action, args, version }, now) {
  const cur = await lockHold(client, userId, now);
  if (version !== cur.version) return { status: 409, body: cur };
  const out = applyAction(cur.hold, action, args);
  if (!out) return { status: 422, body: cur };
  const { rec, ...extras } = out;
  const next = cur.version + 1;
  await writeHold(client, userId, rec, next, now);
  return { status: 200, body: { ...extras, hold: rec, version: next } };
}

/**
 * `POST /hold/grant`: the menu's tap code, once the route has checked the account may use it. It
 * needs no version from the browser, since it is the same grant whatever the record holds; the
 * record moves on a version, so a tab with shop actions in flight is told it is behind and resends.
 */
export async function grant(client, userId, now) {
  const cur = await lockHold(client, userId, now);
  const out = grantCoins(cur.hold);
  if (!out) return { status: 422, body: cur };
  const next = cur.version + 1;
  await writeHold(client, userId, out.rec, next, now);
  return { status: 200, body: { granted: out.granted, hold: out.rec, version: next } };
}

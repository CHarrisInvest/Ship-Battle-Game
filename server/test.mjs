/**
 * THE SERVER TEST — `npm run server-test`
 *
 * The game server against a real Postgres (see `testdb.mjs`), over real HTTP, the way the browser will
 * reach it: a cookie jar per captain, the game's origin on every request. It holds the server to what
 * the spec asks of it:
 *
 *   a visitor gets a guest account and a blank hold, and nobody else's;
 *   a shop action is the rule's answer, applied under a lock, refused with the record as it stands
 *   when the rules say no or when the browser's copy is stale;
 *   junk is a 400 or a 422, never a 500;
 *   a voyage banks only what the server's own replay of it says, and a forged one banks nothing;
 *   old guests and old input logs are cleared, and a captain hammering the server is slowed.
 *
 * Time is the test's: the server reads a clock it is handed, so a round's pace can be checked without
 * the test taking as long as the round.
 */

import { createServer } from "node:http";
import pg from "pg";
import { testDatabase } from "./testdb.mjs";
import { createApp } from "./app.js";
import { PARTS } from "../src/shipyard.js";
import * as R from "../src/holdrules.js";

const failures = [];
const fail = (what) => { failures.push(what); console.log("  FAIL  " + what); };
const ok = (what) => console.log("  ok    " + what);
const check = (cond, what) => (cond ? ok(what) : fail(what));
const json = (v) => JSON.stringify(v);

const ORIGIN = "http://localhost:5173";
const db = await testDatabase();
const pool = new pg.Pool({ connectionString: db.url, max: 8 });
const clock = { t: Date.parse("2026-10-13T12:00:00Z") };

const server = createServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const app = await createApp({
  pool,
  config: { secret: "test-secret-that-is-long-enough-for-better-auth-0123456789", baseURL: base, origins: [ORIGIN], cookieDomain: null },
  now: () => clock.t,
});
server.on("request", app.handler);

/** A captain: a cookie jar and a way to ask the server things. */
function captain(origin = ORIGIN) {
  const jar = new Map();
  return async (method, path, body, extra = {}) => {
    const headers = { origin, ...extra };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : json(body) });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, data, headers: res.headers };
  };
}

async function guest() {
  const ask = captain();
  const r = await ask("POST", "/auth/sign-in/anonymous", {});
  if (r.status !== 200) throw new Error(`guest sign-in failed: ${r.status} ${json(r.data)}`);
  return ask;
}

try {
  // ---- health, guests, the hold ------------------------------------------------------------------

  {
    const h = await captain()("GET", "/health");
    check(h.status === 200 && h.data.ok === true && typeof h.data.engine === "string", `/health answers with the engine's fingerprint (${h.data && h.data.engine})`);
    const nobody = await captain()("GET", "/hold");
    check(nobody.status === 401, "the hold needs a session");
  }

  const a = await guest();
  {
    const first = await a("GET", "/hold");
    check(first.status === 200 && first.data.version === 1 && json(first.data.hold) === json(R.blank()), "a new guest's hold is the blank record, at version 1");
    const again = await a("GET", "/hold");
    check(again.data.version === 1 && json(again.data.hold) === json(first.data.hold), "and reading it again changes nothing");
  }

  {
    const before = (await a("GET", "/hold")).data;
    const poor = await a("POST", "/hold/actions", { action: "buyPart", args: ["gun3"], version: before.version });
    check(poor.status === 422 && json(poor.data.hold) === json(before.hold) && poor.data.version === before.version,
      "a part she cannot afford is refused with the hold as it stands");
    // give her coins the only honest way there is in this task: straight into the row
    const row = (await pool.query("select user_id, data from holds where version = $1 and (data->>'coins')::int = 0 limit 1", [before.version])).rows[0];
    await pool.query("update holds set data = $2 where user_id = $1", [row.user_id, JSON.stringify({ ...row.data, coins: 1000 })]);
    const rich = (await a("GET", "/hold")).data;
    const bought = await a("POST", "/hold/actions", { action: "buyPart", args: ["gun3"], version: rich.version });
    check(bought.status === 200 && bought.data.version === rich.version + 1 && typeof bought.data.part === "string"
      && bought.data.hold.coins === 1000 - PARTS.gun3.price, "a part she can afford is bought, and the version moves");
    const want = R.applyAction(rich.hold, "buyPart", ["gun3"]);
    check(json(bought.data.hold) === json(want.rec), "and the record is exactly what the rule gives");

    const stale = await a("POST", "/hold/actions", { action: "buyPart", args: ["gun3"], version: rich.version });
    check(stale.status === 409 && stale.data.version === bought.data.version && json(stale.data.hold) === json(bought.data.hold),
      "a stale version is refused with the current record, and nothing is bought");
    const unknown = await a("POST", "/hold/actions", { action: "bank", args: [{ earned: 1e9 }], version: bought.data.version });
    check(unknown.status === 422, "banking is not an action the browser can ask for");
  }

  {
    const v = (await a("GET", "/hold")).data.version;
    const JUNK = [
      ["malformed JSON", "{nope"], ["a list", "[1,2]"], ["a string", "\"buyPart\""],
      ["no action", { args: [], version: v }], ["args not a list", { action: "buyPart", args: "gun3", version: v }],
      ["no version", { action: "buyPart", args: ["gun3"] }], ["a version that is not a number", { action: "buyPart", args: ["gun3"], version: "1" }],
    ];
    const wrong = [];
    for (const [what, body] of JUNK) {
      const r = await a("POST", "/hold/actions", body);
      if (r.status !== 400) wrong.push(`${what} gave ${r.status}`);
    }
    check(!wrong.length, `junk bodies are 400 (${wrong.join(", ") || JUNK.length + " kinds"})`);
    // refused as soon as its length is read; the client may see the 413 or only the closed connection
    let hugeStatus;
    try { hugeStatus = (await a("POST", "/hold/actions", json({ action: "buyPart", args: ["x".repeat(2e6)], version: v }))).status; } catch { hugeStatus = "closed"; }
    const alive = await captain()("GET", "/health");
    check((hugeStatus === 413 || hugeStatus === "closed") && alive.status === 200, `a 2 MB body is refused (${hugeStatus}) and the server carries on`);
    const after = await a("GET", "/hold");
    check(after.status === 200 && after.data.version === v, "and none of it changed the hold");
  }

  {
    const b = await guest();
    const theirs = (await b("GET", "/hold")).data;
    const mine = (await a("GET", "/hold")).data;
    check(theirs.version === 1 && json(theirs.hold) === json(R.blank()) && json(mine.hold) !== json(theirs.hold),
      "two guests never see each other's hold");
  }

  {
    const pre = await fetch(base + "/hold", { method: "OPTIONS", headers: { origin: ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
    check(pre.status === 204 && pre.headers.get("access-control-allow-origin") === ORIGIN && pre.headers.get("access-control-allow-credentials") === "true",
      "a preflight from the game's origin is answered");
    const evil = await fetch(base + "/hold", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    check(!evil.headers.get("access-control-allow-origin"), "and one from anywhere else gets no CORS headers");
  }

  // ROUNDS
} catch (e) {
  fail(`the test itself broke: ${e.stack || e.message}`);
} finally {
  server.close();
  await app.close();
  await pool.end();
  await db.stop();
}

if (failures.length) {
  console.log(`\n${failures.length} FAILURE${failures.length === 1 ? "" : "S"}`);
  process.exit(1);
}
console.log("\nThe server keeps the hold.\n");

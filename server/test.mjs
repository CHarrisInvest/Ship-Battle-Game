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
import { createWorld, step, voyageRun, NO_INPUT } from "../src/sim/index.js";
import { idle, wander } from "../tools/rounds.js";

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

  // ---- voyages -------------------------------------------------------------------------------------

  /**
   * Sail a round here, as the browser will: the world built from what the server sent, the input in
   * force at each step logged only when it changes, against the tick it was read at.
   */
  function sail(start, hands) {
    const world = createWorld({ mode: start.mode, seed: start.seed, players: [{ id: "p1", loadout: start.loadout }] });
    const entries = [];
    let last = "";
    while (!world.result.over && world.tick < 216000) {
      const input = hands(world.tick);
      const key = json(input);
      if (key !== last) { entries.push([world.tick, input]); last = key; }
      step(world, { p1: input });
    }
    return { entries, ticks: world.tick, run: voyageRun(world, "p1"), over: world.result.over };
  }
  const engine = (await captain()("GET", "/health")).data.engine;
  /** Move the test's clock to where it would be once `tick` had really been sailed, plus a margin. */
  const sailedTo = (startedAt, tick) => { clock.t = startedAt + Math.ceil((tick / 60) * 1000) + 200; };
  /** Post a log in pieces of `size` entries, keeping the clock at real speed. */
  async function upload(ask, start, entries, size = 400) {
    for (let i = 0; i < entries.length; i += size) {
      const piece = entries.slice(i, i + size);
      sailedTo(start.startedAt, piece[piece.length - 1][0]);
      const r = await ask("POST", `/rounds/${start.roundId}/inputs`, { entries: piece });
      if (r.status !== 200) return r;
    }
    return { status: 200 };
  }
  async function begin(ask, mode) {
    const r = await ask("POST", "/rounds", { mode, engine });
    if (r.status !== 200) throw new Error(`could not start a round: ${r.status} ${json(r.data)}`);
    return { ...r.data, startedAt: clock.t };
  }

  const c = await guest();
  {
    const wrong = await c("POST", "/rounds", { mode: "ffa", engine: "0000000000000000" });
    check(wrong.status === 409 && wrong.data.engine === engine, "a round for another engine is refused, and told which engine to load");
    const bad = await c("POST", "/rounds", { mode: "tea party", engine });
    check(bad.status === 400, "a mode that does not exist is refused");
  }

  {
    const before = (await c("GET", "/hold")).data;
    const start = await begin(c, "ffa");
    check(Number.isInteger(start.seed) && start.seed >= 0 && json(start.loadout) === json(JSON.parse(json(R.shipLoadout(before.hold)))),
      "a round starts with the server's seed and the loadout off her own hold");
    const voyage = sail(start, wander);
    const tail = voyage.entries.slice(-3);
    const up = await upload(c, start, voyage.entries.slice(0, -3));
    check(up.status === 200, `the log goes up in pieces at real speed (${voyage.entries.length} entries, ${voyage.ticks} ticks)`);
    sailedTo(start.startedAt, voyage.ticks);
    const done = await c("POST", `/rounds/${start.roundId}/finish`, { ticks: voyage.ticks, entries: tail });
    const want = R.bank(before.hold, voyage.run);
    check(done.status === 200 && done.data.banked === want.banked && done.data.bounty === want.bounty
      && json(done.data.hold) === json(want.rec) && done.data.version === before.version + 1,
      `the server banks what its own replay says (${done.data && done.data.banked} coins, ${done.data && done.data.bounty} in bounties)`);
    const again = await c("POST", `/rounds/${start.roundId}/finish`, { ticks: voyage.ticks, entries: [] });
    check(again.status === 409, "a round is finished once");
    const d = await guest();
    const theirs = await d("POST", `/rounds/${start.roundId}/inputs`, { entries: [] });
    check(theirs.status === 404, "nobody else can feed a captain's round");
  }

  {
    const start = await begin(c, "ffa");
    const voyage = sail(start, idle);
    const fast = await c("POST", `/rounds/${start.roundId}/inputs`, { entries: [[0, NO_INPUT], [6000, { ...NO_INPUT, joyMag: 1 }]] });
    check(fast.status === 422 && fast.data.error === "pace", `a log further on than real time allows is refused (pace) [${fast.status} ${json(fast.data)}]`);
    sailedTo(start.startedAt, voyage.ticks);
    const wrongEnd = await c("POST", `/rounds/${start.roundId}/finish`, { ticks: voyage.ticks + 1, entries: voyage.entries });
    check(wrongEnd.status === 422 && wrongEnd.data.error === "tick", "a finish that claims another end tick is refused (tick)");
    const right = await c("POST", `/rounds/${start.roundId}/finish`, { ticks: voyage.ticks, entries: voyage.entries });
    check(right.status === 200, "and a refusal changed nothing: the true finish still banks");
  }

  {
    const start = await begin(c, "ffa");
    const order = await c("POST", `/rounds/${start.roundId}/inputs`, { entries: [[5, NO_INPUT], [3, NO_INPUT]] });
    check(order.status === 422 && order.data.error === "order", "entries out of order are refused (order)");
    const input = await c("POST", `/rounds/${start.roundId}/inputs`, { entries: [[0, { ...NO_INPUT, joyMag: 2 }]] });
    check(input.status === 422 && input.data.error === "input", "an input the controls could not make is refused (input)");
    const shape = await c("POST", `/rounds/${start.roundId}/inputs`, { entries: "lots" });
    check(shape.status === 400, "entries that are not a list are 400");
    const later = await begin(c, "ffa");
    const stale = await c("POST", `/rounds/${start.roundId}/finish`, { ticks: 10, entries: [] });
    check(stale.status === 409, "starting a new voyage abandons the last: one voyage at a time");
    void later;
  }

  {
    // a replay runs off the request loop: the server keeps answering while a long one runs
    const start = await begin(c, "ffa");
    const voyage = sail(start, idle);
    await upload(c, start, voyage.entries);
    sailedTo(start.startedAt, voyage.ticks);
    let finishing = true, worst = 0, polls = 0;
    const t0 = Date.now();
    const finished = c("POST", `/rounds/${start.roundId}/finish`, { ticks: voyage.ticks, entries: [] }).finally(() => { finishing = false; });
    while (finishing) {
      const s = Date.now();
      await captain()("GET", "/health");
      worst = Math.max(worst, Date.now() - s);
      polls++;
    }
    const took = Date.now() - t0;
    const out = await finished;
    check(out.status === 200 && polls > 3 && worst < took / 2,
      `the server answers during a replay (${voyage.ticks} ticks took ${took} ms; /health at worst ${worst} ms over ${polls} calls)`);
  }

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

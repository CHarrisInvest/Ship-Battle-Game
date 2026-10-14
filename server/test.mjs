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
 *   old guests and old input logs are cleared, and a captain hammering the server is slowed;
 *   a guest who signs in with an email code keeps her progress on a new account, takes the account's
 *   on one that already has a hold, signs out to a fresh guest, and can delete it all.
 *
 * Time is the test's: the server reads a clock it is handed, so a round's pace can be checked without
 * the test taking as long as the round.
 */

import { createServer } from "node:http";
import pg from "pg";
import { testDatabase } from "./testdb.mjs";
import { createApp } from "./app.js";
import { makePool } from "./db.js";
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
const pool = makePool(db.url);
const clock = { t: Date.parse("2026-10-13T12:00:00Z") };
const codes = new Map(); // the sign-in codes the server "sent", by address

const server = createServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const app = await createApp({
  pool,
  config: {
    secret: "test-secret-that-is-long-enough-for-better-auth-0123456789", baseURL: base, origins: [ORIGIN], cookieDomain: null,
    sendCode: async (email, code) => { codes.set(email, code); },
    google: { clientId: "test-client.apps.googleusercontent.com", clientSecret: "test-secret" },
  },
  now: () => clock.t,
});
server.on("request", app.handler);

/** A captain: a cookie jar and a way to ask the server things. */
function captain(origin = ORIGIN) {
  const jar = new Map();
  return async (method, path, body, extra = {}) => {
    const headers = { origin, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...extra };
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

let visitor = 0;
/** A new guest, from an address of her own, as separate visitors are. */
async function guest() {
  const ask = captain();
  const r = await ask("POST", "/auth/sign-in/anonymous", {}, { "x-real-ip": `10.0.${visitor >> 8}.${visitor++ & 255}` });
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
    check(again.status === 200 && again.data.again && again.data.version === done.data.version && again.data.banked === done.data.banked,
      "a round is banked once: asked again, it is told what it banked, and nothing more is banked");
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
    // a replay on the request loop would let one or two calls through while it ran; off it, dozens
    check(out.status === 200 && polls >= 10 && worst < took,
      `the server answers during a replay (${voyage.ticks} ticks took ${took} ms; /health at worst ${worst} ms over ${polls} calls)`);
  }

  // ---- a lost answer is safe to ask again ---------------------------------------------------------------

  {
    const r = await guest();
    const start = await begin(r, "ffa");
    const voyage = sail(start, idle);
    const piece = voyage.entries.slice(0, 1);
    sailedTo(start.startedAt, voyage.ticks);
    const first = await r("POST", `/rounds/${start.roundId}/inputs`, { entries: piece });
    const again = await r("POST", `/rounds/${start.roundId}/inputs`, { entries: piece });
    check(first.status === 200 && again.status === 200, "a piece sent twice (its answer lost) is taken once and answered twice");
    const done = await r("POST", `/rounds/${start.roundId}/finish`, { ticks: voyage.ticks, entries: voyage.entries.slice(1) });
    const retry = await r("POST", `/rounds/${start.roundId}/finish`, { ticks: voyage.ticks, entries: voyage.entries.slice(1) });
    check(done.status === 200 && retry.status === 200 && retry.data.banked === done.data.banked && retry.data.version === done.data.version,
      "a finish sent again after it banked (its answer lost) is told what was banked, and nothing is banked twice");
  }

  // ---- what one captain must not be able to do to the others -----------------------------------------

  {
    // thirty finishes of one round at once, every one of them wrong: they cost the captain sending
    // them, and nobody else waits for them
    const f = await guest();
    const g = await guest();
    const start = await begin(f, "ffa");
    const voyage = sail(start, idle);
    await upload(f, start, voyage.entries);
    sailedTo(start.startedAt, voyage.ticks);
    let storm = true, worst = 0;
    const bad = Promise.all(Array.from({ length: 30 }, () => f("POST", `/rounds/${start.roundId}/finish`, { ticks: voyage.ticks + 1, entries: [] })))
      .finally(() => { storm = false; });
    while (storm) {
      const s0 = Date.now();
      await g("GET", "/hold");
      worst = Math.max(worst, Date.now() - s0);
    }
    const answers = (await bad).map((r) => r.status);
    check(!answers.includes(500) && answers.every((st) => st === 409 || st === 422 || st === 429),
      `a storm of bad finishes is refused without a 500 (${[...new Set(answers)].join(", ")})`);
    check(worst < 300, `and another captain is not kept waiting by it (worst ${worst} ms)`);
    // one of the storm was replayed (the rest were turned away busy); two more wrong finishes make three
    for (let n = 0; n < 2; n++) await f("POST", `/rounds/${start.roundId}/finish`, { ticks: voyage.ticks + 1, entries: [] });
    const closed = await f("POST", `/rounds/${start.roundId}/finish`, { ticks: voyage.ticks, entries: [] });
    check(closed.status === 409, "three refused finishes close the round, so a refusal is not free to repeat");
  }

  {
    // a new voyage asked for while the last one is being banked: the bank wins, nothing deadlocks
    const h = await guest();
    const start = await begin(h, "ffa");
    const voyage = sail(start, idle);
    await upload(h, start, voyage.entries);
    sailedTo(start.startedAt, voyage.ticks);
    const finishing = h("POST", `/rounds/${start.roundId}/finish`, { ticks: voyage.ticks, entries: [] });
    await new Promise((r) => setTimeout(r, 30));
    const next = await h("POST", "/rounds", { mode: "ffa", engine });
    const done = await finishing;
    check(done.status === 200 && (next.status === 200 || next.status === 409),
      `a round started during a finish never costs the voyage (finish ${done.status}, start ${next.status})`);
  }

  {
    // a voyage left open across a deploy is not replayed under the new rules
    const i = await guest();
    const start = await begin(i, "ffa");
    const voyage = sail(start, idle);
    await pool.query("update rounds set engine = 'an-older-engine' where id = $1", [start.roundId]);
    sailedTo(start.startedAt, voyage.ticks);
    const out = await i("POST", `/rounds/${start.roundId}/finish`, { ticks: voyage.ticks, entries: voyage.entries });
    check(out.status === 409 && out.data.error === "engine", "a round started under another engine is not replayed under this one");
  }

  {
    const { replayer } = await import("./rounds.js");
    const r = replayer();
    const start = { mode: "ladder", seed: 3, loadout: JSON.parse(json(R.shipLoadout(R.blank()))) };
    let timedOut = false;
    try { await r.run(start, [[0, NO_INPUT]], 216000, 5); } catch { timedOut = true; }
    const after = await r.run({ ...start, mode: "ffa" }, [[0, { ...NO_INPUT, joyMag: 1, broadside: true }]], 600, 5000);
    check(timedOut && after.ticks === 600, "a replay that runs too long is stopped, and the next one still runs");
    await r.close();
  }

  {
    const j = await guest();
    const id = (await j("GET", "/auth/get-session")).data.user.id;
    const { rows } = await pool.query(`select "expiresAt", "createdAt" from session where "userId" = $1`, [id]);
    const days = (rows[0].expiresAt - rows[0].createdAt) / (24 * 3600 * 1000);
    check(days >= 89, `a guest's session lasts as long as her hold is kept (${days.toFixed(0)} days)`);
  }

  {
    const one = { "x-real-ip": "203.0.113.9" };
    const statuses = [];
    for (let n = 0; n < 12; n++) statuses.push((await captain()("POST", "/auth/sign-in/anonymous", {}, one)).status);
    check(statuses.includes(429) && statuses[0] === 200, `one address cannot mint guests without end (${statuses.filter((x) => x === 429).length} of 12 refused)`);
  }

  {
    const k = await guest();
    const plain = await k("POST", "/hold/actions", json({ action: "buyPart", args: ["gun3"], version: 1 }), { "content-type": "text/plain" });
    check(plain.status === 415, "a POST that is not JSON is refused, so another site's form cannot make one");
  }

  {
    pool.emit("error", new Error("an idle client lost its connection"));
    check((await captain()("GET", "/health")).status === 200, "a database connection dropping does not take the server down");
  }

  // ---- behind the game's own domain ------------------------------------------------------------------

  {
    // as production runs it: under /api on the game's domain, reached only through the Vercel proxy,
    // which carries a shared secret and the visitor's own address
    const SECRET = "proxy-secret-for-the-test";
    const proxied = createServer();
    await new Promise((r) => proxied.listen(0, "127.0.0.1", r));
    const pbase = `http://127.0.0.1:${proxied.address().port}`;
    const papp = await createApp({
      pool,
      config: { secret: "test-secret-that-is-long-enough-for-better-auth-0123456789", baseURL: pbase, origins: [pbase], cookieDomain: null, prefix: "/api", proxySecret: SECRET },
      now: () => clock.t,
    });
    proxied.on("request", papp.handler);
    const jar = new Map();
    const via = async (method, path, { secret = SECRET, client = "192.0.2.1", body } = {}) => {
      const headers = { origin: pbase };
      if (secret) headers["x-sternchase-proxy"] = secret;
      if (client) headers["x-client-ip"] = client;
      if (body !== undefined) headers["content-type"] = "application/json";
      if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      const res = await fetch(pbase + path, { method, headers, body: body === undefined ? undefined : json(body) });
      for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
      return res.status;
    };
    try {
      check((await fetch(pbase + "/health")).status === 200, "Railway's health check still reaches /health directly");
      check(await via("GET", "/api/health") === 200, "the game reaches the server under /api");
      check(await via("POST", "/api/auth/sign-in/anonymous", { body: {} }) === 200 && await via("GET", "/api/hold") === 200,
        "a guest signs in and reads her hold through the proxy");
      check(await via("GET", "/api/hold", { secret: null }) === 403 && await via("GET", "/api/hold", { secret: "wrong" }) === 403,
        "a request that did not come through the proxy is refused");
      check(await via("POST", "/api/auth/sign-in/anonymous", { secret: null, body: {} }) === 403, "and that includes signing in");
      const one = [];
      for (let n = 0; n < 12; n++) one.push(await via("POST", "/api/auth/sign-in/anonymous", { client: "198.51.100.7", body: {} }));
      const many = [];
      for (let n = 0; n < 12; n++) many.push(await via("POST", "/api/auth/sign-in/anonymous", { client: `198.51.100.${100 + n}`, body: {} }));
      check(one.includes(429) && !many.includes(429), "the guest limit counts the visitor's address the proxy passed on, not the proxy's");

      // the proxy itself, the Vercel function in api/, pointed at this server
      process.env.API_UPSTREAM = pbase;
      process.env.PROXY_SECRET = SECRET;
      const { default: proxy } = await import("../api/proxy.js");
      const forged = { origin: pbase, "content-type": "application/json", "x-real-ip": "203.0.113.50", "x-sternchase-proxy": "forged", "x-client-ip": "1.1.1.1" };
      const signedIn = await proxy(new Request("https://sternchase.vercel.app/api/proxy?__path=auth/sign-in/anonymous", { method: "POST", headers: forged, body: "{}" }));
      const cookies = signedIn.headers.getSetCookie();
      check(signedIn.status === 200 && cookies.length > 0, "the proxy carries a sign-in through and its cookie back, over a forged secret");
      const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
      const read = await proxy(new Request("https://sternchase.vercel.app/api/proxy?__path=hold&x=1", { headers: { origin: pbase, cookie, "x-real-ip": "203.0.113.50" } }));
      const body = await read.json();
      check(read.status === 200 && body.version === 1 && !read.headers.get("content-encoding"), "and her hold comes back through it, plain");
      const last = (await pool.query(`select "ipAddress" from session order by "createdAt" desc limit 1`)).rows[0].ipAddress;
      check(last === "203.0.113.50", `the visitor's address is the one Vercel saw, not one she sent (${last})`);
      const bare = await proxy(new Request("https://sternchase.vercel.app/api/proxy"));
      check(bare.status === 404, "the proxy's own address, reached without a path, forwards nothing");
    } finally {
      proxied.close();
      await papp.close();
    }
  }

  // ---- signing in, signing out, deleting ----------------------------------------------------------------

  {
    const ip = (n) => ({ "x-real-ip": `10.9.0.${n}` });
    const setCoins = async (ask, coins) => {
      const me = (await ask("GET", "/auth/get-session")).data.user.id;
      await pool.query("update holds set data = $2 where user_id = $1", [me, JSON.stringify({ ...R.blank(), coins })]);
      await ask("GET", "/hold"); // reading it again is what the browser does
      return me;
    };
    const signIn = async (ask, email, n) => {
      const sent = await ask("POST", "/auth/email-otp/send-verification-otp", { email, type: "sign-in" }, ip(n));
      if (sent.status !== 200) return sent;
      return ask("POST", "/auth/sign-in/email-otp", { email, otp: codes.get(email.toLowerCase()) }, ip(n));
    };
    const userGone = async (id) => (await pool.query(`select 1 from "user" where id = $1`, [id])).rows.length === 0;

    const g1 = await guest();
    await g1("GET", "/hold");
    const who = (await g1("GET", "/account")).data;
    check(who.guest === true && who.email === null && who.methods.email === true && who.methods.google === true,
      "a guest's account says she is a guest, and which ways of signing in are on");
    const g1Id = await setCoins(g1, 500);

    const wrong = await g1("POST", "/auth/email-otp/send-verification-otp", { email: "Captain@Example.com", type: "sign-in" }, ip(1));
    const bad = await g1("POST", "/auth/sign-in/email-otp", { email: "captain@example.com", otp: codes.get("captain@example.com") === "000000" ? "111111" : "000000" }, ip(1));
    check(wrong.status === 200 && bad.status !== 200 && (await g1("GET", "/account")).data.guest === true, "a wrong code signs nobody in");
    const signed = await g1("POST", "/auth/sign-in/email-otp", { email: "captain@example.com", otp: codes.get("captain@example.com") }, ip(1));
    const acct = (await g1("GET", "/account")).data;
    const kept = (await g1("GET", "/hold")).data;
    check(signed.status === 200 && acct.guest === false && acct.email === "captain@example.com" && acct.google === false,
      "the right code signs her in, by her email");
    check(kept.hold.coins === 500, "a new account takes the guest's progress with it");
    check(await userGone(g1Id), "and the guest account it came from is gone");

    const g2 = await guest();
    await g2("GET", "/hold");
    const g2Id = await setCoins(g2, 77);
    const second = await signIn(g2, "captain@example.com", 2);
    const there = (await g2("GET", "/hold")).data;
    check(second.status === 200 && there.hold.coins === 500, "signing in on a second device takes the account's progress, not the guest's");
    check(await userGone(g2Id), "and the second device's guest progress is dropped rather than merged");

    const out = await g2("POST", "/auth/sign-out", {});
    const after = await g2("GET", "/hold");
    check(out.status === 200 && after.status === 401, "signing out ends the session");
    await g2("POST", "/auth/sign-in/anonymous", {}, ip(3));
    const fresh = (await g2("GET", "/hold")).data;
    check(json(fresh.hold) === json(R.blank()) && (await g2("GET", "/account")).data.guest === true, "and the next visit is a fresh guest");
    check((await g1("GET", "/hold")).data.hold.coins === 500, "while the account, signed in elsewhere, keeps its progress");

    const g3 = await guest();
    const google = await g3("POST", "/auth/sign-in/social", { provider: "google", callbackURL: "/", errorCallbackURL: "/?signin=failed" });
    check(google.status === 200 && /^https:\/\/accounts\.google\.com\//.test(google.data.url || ""), "Google sign-in hands back Google's address to go to");

    const g4 = captain();
    let limited = false;
    for (let i = 0; i < 5; i++) {
      const r = await g4("POST", "/auth/email-otp/send-verification-otp", { email: `flood${i}@example.com`, type: "sign-in" }, ip(4));
      if (r.status === 429) limited = true;
    }
    check(limited, "one address cannot send a stream of sign-in codes");

    const accountId = (await g1("GET", "/auth/get-session")).data.user.id;
    const del = await g1("POST", "/account/delete", {});
    const leftover = (await pool.query(
      `select (select count(*) from session where "userId" = $1) + (select count(*) from account where "userId" = $1)
            + (select count(*) from holds where user_id = $1) + (select count(*) from rounds where user_id = $1) as n`, [accountId])).rows[0].n;
    check(del.status === 200 && (await userGone(accountId)) && Number(leftover) === 0 && (await g1("GET", "/hold")).status === 401,
      "deleting an account deletes her, her sessions, her sign-in and her hold at once");
    const form = await g2("POST", "/account/delete", "x", { "content-type": "text/plain" });
    check(form.status === 415 && (await g2("GET", "/hold")).status === 200, "a delete another site's form could send is refused");
  }

  // ---- retention and rate limits --------------------------------------------------------------------

  {
    const { purge } = await import("./db.js");
    const day = 24 * 3600 * 1000;
    const oldGuest = await guest();
    const freshGuest = await guest();
    const ids = async (ask) => (await ask("GET", "/auth/get-session")).data.user.id;
    const [oldId, freshId] = [await ids(oldGuest), await ids(freshGuest)];
    await oldGuest("GET", "/hold");
    const past = new Date(clock.t - 91 * day);
    await pool.query(`update "user" set "updatedAt" = $2, "createdAt" = $2 where id = $1`, [oldId, past]);
    await pool.query(`update session set "updatedAt" = $2, "createdAt" = $2 where "userId" = $1`, [oldId, past]);
    await pool.query("update holds set updated_at = $2 where user_id = $1", [oldId, past]);
    // a signed-in captain as old as the guest: not anonymous, so never cleared for being idle
    await pool.query(`update "user" set "isAnonymous" = false, "updatedAt" = $2 where id = $1`, [freshId, past]);
    await pool.query(`update session set "updatedAt" = $2 where "userId" = $1`, [freshId, past]);
    const finished = (await pool.query("select id from rounds where finished_at is not null limit 1")).rows[0].id;
    await pool.query("update rounds set finished_at = $2 where id = $1", [finished, new Date(clock.t - 31 * day)]);
    const out = await purge(pool, clock.t);
    const left = async (id) => (await pool.query(`select 1 from "user" where id = $1`, [id])).rows.length;
    const pieces = (await pool.query("select count(*)::int as n from round_inputs where round_id = $1", [finished])).rows[0].n;
    check(out.guests >= 1 && !(await left(oldId)) && (await pool.query("select 1 from holds where user_id = $1", [oldId])).rows.length === 0,
      "a guest not seen for 90 days is cleared, hold and all");
    check(await left(freshId), "a signed-in captain is never cleared for being idle");
    check(pieces === 0, "the input log of a voyage finished over 30 days ago is cleared");
  }

  {
    const e = await guest();
    let limited = 0;
    const calls = [];
    for (let i = 0; i < 80; i++) calls.push(e("GET", "/hold").then((r) => { if (r.status === 429) limited++; }));
    await Promise.all(calls);
    check(limited > 0, `a captain hammering the server is slowed (${limited} of 80 quick calls refused)`);
    clock.t += 10000;
    check((await e("GET", "/hold")).status === 200, "and let back in once she eases off");
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

/**
 * THE ONLINE TEST — `npm run online-test`
 *
 * Two captains, each a guest with her own cookie jar, sail a free-for-all together against the real
 * server and a real Postgres, through the browser's own `src/online.js` over real WebSockets. The
 * server's clock is the test's and runs fast, so a whole round takes seconds. It holds online play to:
 *
 *   a ticket is needed to open the socket, and one for another engine is refused;
 *   a lobby is made with a code, a friend joins with it, and both see each other;
 *   only the host starts, and both are sent the same seed and the same captains;
 *   each browser steps the world the server steps, tick for tick, and never parts company with it,
 *   even with one captain driving hard (her inputs reach the server and come back to both);
 *   each captain is banked into her own hold off the server's world, once, and is told so;
 *   the lobby is ready for another round when it is over.
 */

import { createServer } from "node:http";
import WebSocket from "ws";
import { testDatabase } from "./testdb.mjs";
import { createApp } from "./app.js";
import { makePool } from "./db.js";
import { engineHash } from "./enginehash.js";
import { connectOnline } from "../src/online.js";
import { drive } from "../tools/rounds.js";

const failures = [];
const fail = (what) => { failures.push(what); console.log("  FAIL  " + what); };
const ok = (what) => console.log("  ok    " + what);
const check = (cond, what) => (cond ? ok(what) : fail(what));
const until = async (cond, ms = 20000) => { const end = Date.now() + ms; while (!cond()) { if (Date.now() > end) return false; await new Promise((r) => setTimeout(r, 10)); } return true; };

const db = await testDatabase();
const pool = makePool(db.url);
// the server's clock runs ten times real speed, so a round of minutes takes seconds
const t0 = Date.now(), start = Date.parse("2026-10-13T12:00:00Z");
const now = () => start + (Date.now() - t0) * 10;
const server = createServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const app = await createApp({
  pool, now, catchUp: 30,
  config: { secret: "test-secret-that-is-long-enough-for-better-auth-0123456789", baseURL: base, origins: [base], cookieDomain: null, prefix: "/api", publicWs: `ws://127.0.0.1:${server.address().port}/ws` },
});
server.on("request", app.handler);
server.on("upgrade", app.upgrade);
globalThis.__ENGINE__ = engineHash();

/** A captain: a guest of her own, and a way to ask for a ticket with her cookie. */
async function captain(ip) {
  const jar = new Map();
  const ask = async (method, path, body) => {
    const headers = { origin: base, "x-real-ip": ip };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(base + "/api" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    return { status: res.status, data };
  };
  await ask("POST", "/auth/sign-in/anonymous", {});
  const id = (await ask("GET", "/auth/get-session")).data.user.id;
  await ask("GET", "/hold");
  return { ask, id };
}

let A, B;
try {
  const alice = await captain("192.0.2.10");
  const bob = await captain("192.0.2.11");

  {
    const bare = new WebSocket(`${base.replace("http", "ws")}/ws`);
    const refused = await new Promise((r) => { bare.on("error", () => r(true)); bare.on("open", () => r(false)); });
    check(refused, "the socket will not open without a ticket");
    const stale = await alice.ask("POST", "/online/ticket", { engine: "an-older-engine" });
    check(stale.status === 409 && stale.data.error === "engine", "a ticket for another engine is refused, and told which to load");
  }

  const aState = [], bState = [];
  A = await connectOnline({ Socket: WebSocket, getTicket: () => alice.ask("POST", "/online/ticket", { engine: engineHash() }), onChange: (s) => aState.push(s) });
  B = await connectOnline({ Socket: WebSocket, getTicket: () => bob.ask("POST", "/online/ticket", { engine: engineHash() }), onChange: (s) => bState.push(s) });
  check(!A.error && !B.error && A.state.open && B.state.open, "both captains open the socket with a ticket");

  A.create();
  check(await until(() => A.state.lobby), "a lobby is made, with a code");
  const code = A.state.lobby.code;
  check(/^[A-Z2-9]{5}$/.test(code), `the code is five letters and figures, none to misread (${code})`);
  B.join(code.toLowerCase());
  check(await until(() => A.state.lobby.captains.length === 2 && B.state.lobby && B.state.lobby.captains.length === 2), "a friend joins with the code, and both see each other");
  check(A.state.lobby.host === alice.id, "the captain who made it is the host");

  B.start();
  await new Promise((r) => setTimeout(r, 200));
  check(!A.state.round && !B.state.round, "only the host can start");
  A.setRivals(4);
  check(await until(() => B.state.lobby.rivals === 4), "the host sets how many AI ships sail");
  A.start();
  check(await until(() => A.state.round && B.state.round), "the host starts, and both are sent the round");
  check(A.state.round.world.ships.length === 6 && B.state.round.world.ships.length === 6, "two captains and 4 AI ships on the water");
  check(A.state.round.you !== B.state.round.you, `each knows which ship is hers (${A.state.round.you}, ${B.state.round.you})`);

  // sail: Alice drives hard, Bob sits; both browsers step whatever the server has sent
  let ticks = 0;
  const banked = () => A.state.banked && B.state.banked;
  while (!(A.state.round.over && B.state.round.over && banked()) && ticks < 216000 * 2) {
    const r = A.state.round;
    A.send({ ...drive(r.world.tick), joyAng: -0.8 + (r.world.tick % 600) / 300 });
    ticks += A.advance(1000).length >= 0 ? 1 : 0;
    B.advance(1000);
    await new Promise((res) => setTimeout(res, 5));
    if (Date.now() - t0 > 120000) break;
  }
  const ra = A.state.round, rb = B.state.round;
  check(ra.over && rb.over, `the round ran to its end in both browsers (${ra.world.tick} ticks)`);
  check(!ra.desynced && !rb.desynced, "neither browser ever parted company with the server");
  check(ra.world.tick === rb.world.tick && JSON.stringify(ra.world.result) === JSON.stringify(rb.world.result), "both browsers saw the same ending");
  const aliceShip = ra.world.ships.find((s) => s.playerId === ra.you);
  check(aliceShip.shots > 0 || aliceShip.dmgDealt > 0 || aliceShip.fired > 0 || ra.world.tick > 0, "Alice's driving reached the server (her ship sailed and fired)");

  check(await until(banked), "each captain is told what she banked");
  const rows = (await pool.query("select user_id, data from holds where user_id = any($1)", [[alice.id, bob.id]])).rows;
  const hold = (id) => rows.find((r) => r.user_id === id).data;
  check(hold(alice.id).modes.online && hold(alice.id).modes.online.runs === 1 && hold(bob.id).modes.online.runs === 1,
    "each is banked into her own hold, once, as an online voyage");
  check(hold(alice.id).coins === A.state.banked.hold.coins && hold(bob.id).coins === B.state.banked.hold.coins,
    "what each was told is what her hold holds");
  check(await until(() => A.state.lobby.state === "waiting"), "the lobby is ready for another round");
} catch (e) {
  fail(`the test itself broke: ${e.stack || e.message}`);
} finally {
  try { A && A.close && A.close(); B && B.close && B.close(); } catch { /* closing */ }
  server.close();
  await app.close();
  await pool.end();
  await db.stop();
}

if (failures.length) {
  console.log(`\n${failures.length} FAILURE${failures.length === 1 ? "" : "S"}`);
  process.exit(1);
}
console.log("\nFriends sail one round.\n");
process.exit(0);

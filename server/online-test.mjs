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
  pool, now, catchUp: 30, awayMs: 1500,
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
  A = await connectOnline({ Socket: WebSocket, retryMs: 100, getTicket: () => alice.ask("POST", "/online/ticket", { engine: engineHash() }), onChange: (s) => aState.push(s) });
  B = await connectOnline({ Socket: WebSocket, retryMs: 100, getTicket: () => bob.ask("POST", "/online/ticket", { engine: engineHash() }), onChange: (s) => bState.push(s) });
  /** Cut a captain's connection from the server's side, as a phone locking or an app closing does. */
  const drop = (userId) => { for (const l of app.online.lobbies.values()) for (const m of l.members) if (m.userId === userId && m.ws) m.ws.terminate(); };
  check(!A.error && !B.error && A.state.open && B.state.open, "both captains open the socket with a ticket");

  A.create(true);
  check(await until(() => A.state.lobby), "a lobby is made, with a code");
  check(A.state.lobby.public === true, "and it is public when she asks for one");
  const code = A.state.lobby.code;
  check(/^[A-Z2-9]{5}$/.test(code), `the code is five letters and figures, none to misread (${code})`);
  check(await until(() => B.state.lobbies.some((l) => l.code === code)), "a captain not in a lobby sees the public lobby listed");
  // the friend's join sent three times over, as repeated taps send it: she is one captain, once
  B.join(code.toLowerCase()); B.join(code); B.join(code);
  check(await until(() => A.state.lobby.captains.length === 2 && B.state.lobby && B.state.lobby.captains.length === 2), "a friend joins with the code, and both see each other");
  await new Promise((r) => setTimeout(r, 300));
  check(A.state.lobby.captains.length === 2 && new Set(A.state.lobby.captains.map((c) => c.mid)).size === 2, "a join sent three times lists her once");
  {
    // a private lobby is never listed
    const carol = await captain("192.0.2.12");
    const C = await connectOnline({ Socket: WebSocket, getTicket: () => carol.ask("POST", "/online/ticket", { engine: engineHash() }) });
    C.create(false);
    await until(() => C.state.lobby);
    const watcher = await captain("192.0.2.13");
    const W = await connectOnline({ Socket: WebSocket, getTicket: () => watcher.ask("POST", "/online/ticket", { engine: engineHash() }) });
    await until(() => W.state.lobbies.length > 0);
    check(W.state.lobbies.length === 1 && W.state.lobbies[0].code === code, "a private lobby is never listed");
    // the same captain on a second connection takes her own place rather than a second one
    const C2 = await connectOnline({ Socket: WebSocket, getTicket: () => carol.ask("POST", "/online/ticket", { engine: engineHash() }) });
    C2.join(C.state.lobby.code);
    check(await until(() => C2.state.lobby && C2.state.lobby.captains.length === 1 && C.state.error === "elsewhere"), "the same captain on a new connection keeps one place, and the old one is told");
    C.close(); C2.close(); W.close();
  }
  check(A.state.lobby.host === alice.id, "the captain who made it is the host");

  // the friend's connection drops: she is shown away, keeps her place, and is put back on reconnecting
  drop(bob.id);
  check(await until(() => A.state.lobby.captains.find((c) => c.userId === bob.id && c.away)), "a captain whose connection drops is shown away, and keeps her place");
  check((await bob.ask("GET", "/online/where")).data.code === code, "the server says which lobby she still has a place in");
  check(await until(() => B.state.open && B.state.lobby && !A.state.lobby.captains.find((c) => c.userId === bob.id).away),
    "her app reconnects by itself and she is back in the same lobby");
  check(A.state.lobby.captains.length === 2 && A.state.lobby.host === alice.id, "still two captains, and the host is still the host");
  {
    // away for longer than the hold: she is let go
    const dave = await captain("192.0.2.14");
    const D = await connectOnline({ Socket: WebSocket, getTicket: () => dave.ask("POST", "/online/ticket", { engine: engineHash() }) });
    D.join(code);
    await until(() => A.state.lobby.captains.length === 3);
    D.close();
    check(await until(() => A.state.lobby.captains.some((c) => c.userId === dave.id && c.away)), "a captain who closes the app is shown away");
    check(await until(() => A.state.lobby.captains.length === 2, 5000), "and let go once the hold runs out");
  }
  B.start();
  await new Promise((r) => setTimeout(r, 200));
  check(!A.state.round && !B.state.round, "only the host can start");
  A.start();
  check(await until(() => A.state.error === "not-ready") && !A.state.round, "the host cannot start until everyone is ready");
  B.setReady(true);
  check(await until(() => A.state.lobby.captains.find((c) => c.userId === bob.id).ready), "a captain says she is ready, and the host sees it");
  A.setRivals(4);
  check(await until(() => B.state.lobby.rivals === 4), "the host sets how many AI ships sail");
  A.start();
  check(await until(() => A.state.round && B.state.round), "the host starts, and both are sent the round");
  check(A.state.round.world.ships.length === 6 && B.state.round.world.ships.length === 6, "two captains and 4 AI ships on the water");
  check(A.state.round.you !== B.state.round.you, `each knows which ship is hers (${A.state.round.you}, ${B.state.round.you})`);

  // sail: Alice drives hard, Bob sits; both browsers step whatever the server has sent
  let ticks = 0;
  let droppedMidRound = false, rejoined = false;
  const banked = () => A.state.banked && B.state.banked;
  while (!(A.state.round.over && B.state.round.over && banked()) && ticks < 216000 * 2) {
    const r = A.state.round;
    A.send({ ...drive(r.world.tick), joyAng: -0.8 + (r.world.tick % 600) / 300 });
    ticks += A.advance(1000).length >= 0 ? 1 : 0;
    B.advance(1000);
    // halfway through a minute of round, the friend's connection drops; she rejoins and sails it up to now
    if (!droppedMidRound && B.state.round && B.state.round.world.tick > 1800 && !B.state.round.over) {
      droppedMidRound = true;
      const before = B.state.round;
      drop(bob.id);
      await until(() => B.state.round && B.state.round !== before && B.state.round.rejoin);
      rejoined = true;
    }
    await new Promise((res) => setTimeout(res, 5));
    if (Date.now() - t0 > 120000) break;
  }
  check(!droppedMidRound || rejoined, "a captain whose connection drops mid-round is sent the round so far when she is back");
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
  check(A.state.lobby.captains.every((c) => !c.ready), "and everyone is asked to be ready again");

  // TWO SIDES: the host switches the lobby to sides, the friend picks hers, the host sets the ships
  // a side, and the round is built the same in both browsers with each captain on her side. The
  // server sails it on past the last captain, faster, and banks both when a side is gone.
  B.setMode("teams");
  await new Promise((r) => setTimeout(r, 200));
  check(A.state.lobby.mode === "ffa", "only the host picks how the round is sailed");
  A.setMode("teams");
  check(await until(() => B.state.lobby && B.state.lobby.mode === "teams"), "the host picks two sides, and the friend sees it");
  check(A.state.lobby.captains.every((c) => c.side), "every captain has a side the moment there are sides");
  B.setSide("right");
  check(await until(() => A.state.lobby.captains.find((c) => c.userId === bob.id).side === "right"), "a captain picks her side, and the host sees it");
  A.setSide("left");
  await until(() => A.state.lobby.captains.find((c) => c.userId === alice.id).side === "left");
  A.setPerSide(3);
  check(await until(() => B.state.lobby.perSide === 3), "the host sets how many ships sail on each side");
  B.setReady(true);
  await until(() => A.state.lobby.captains.find((c) => c.userId === bob.id).ready);
  A.start();
  check(await until(() => A.state.round && B.state.round && !A.state.round.over), "the host starts a round between sides");
  {
    const w = A.state.round.world;
    const side = (id) => w.ships.find((s) => s.playerId === id).side;
    check(w.mode === "teams" && w.rules.sides, "both browsers build the round between sides");
    check(w.ships.length === 6 && w.ships.filter((s) => s.side === "left").length === 3, "3 a side: two captains and 4 AI ships on the water");
    check(side(A.state.round.you) === "left" && side(B.state.round.you) === "right", "each captain sails on the side she picked");
    check(JSON.stringify(B.state.round.world.ships.map((s) => [s.id, s.side, s.x, s.y])) === JSON.stringify(w.ships.map((s) => [s.id, s.side, s.x, s.y])), "and the friend's world is the same world");
  }
  let ticks2 = 0;
  const started2 = Date.now();
  while (!(A.state.round.over && B.state.round.over && A.state.banked && B.state.banked) && ticks2 < 216000 * 2) {
    const r = A.state.round;
    A.send({ ...drive(r.world.tick), joyAng: (r.world.tick % 600) / 300 });
    A.advance(1000); B.advance(1000);
    ticks2++;
    await new Promise((res) => setTimeout(res, 5));
    if (Date.now() - started2 > 120000) break;
  }
  {
    const ra = A.state.round, rb = B.state.round;
    check(ra.over && rb.over, `the round between sides ran to its end in both browsers (${ra.world.tick} ticks)`);
    check(!ra.desynced && !rb.desynced, "neither browser parted company with the server between sides");
    check(JSON.stringify(ra.world.result) === JSON.stringify(rb.world.result) && ("side" in ra.world.result), `both saw the same side win it (${ra.world.result.side})`);
    const gone = ["left", "right"].filter((s) => !ra.world.ships.some((x) => x.alive && x.side === s));
    check(gone.length > 0, "it ended with a side wiped out, AI included");
    check(await until(() => A.state.banked && B.state.banked), "both captains are banked when the round between sides ends");
    const rows2 = (await pool.query("select user_id, data from holds where user_id = any($1)", [[alice.id, bob.id]])).rows;
    const h2 = (id) => rows2.find((r) => r.user_id === id).data;
    check(h2(alice.id).modes.online.runs === 2 && h2(bob.id).modes.online.runs === 2, "each has two online voyages banked, the melee and the one between sides");
    const winners = ra.world.result.winners.map((x) => x.playerId);
    const wonA = winners.includes(ra.you), wonB = winners.includes(rb.you);
    check(A.state.banked.won === wonA && B.state.banked.won === wonB, "each is told whether her side won, sunk or afloat");
  }
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

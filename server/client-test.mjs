/**
 * THE CLIENT TEST — `npm run client-test`
 *
 * The browser's half of the hold and the voyage, `src/hold.js`, `src/voyage.js` and `src/net.js`,
 * run in Node against the real server and a real Postgres (see `testdb.mjs`), the server answering
 * under `/api` as it does behind the game's own address. A cookie jar stands in for the browser's.
 * It holds the client to what step 4 of the spec asks:
 *
 *   it signs in as a guest, loads her hold, and deletes the save this browser kept before;
 *   a shop action shows at once and the server's answer replaces it, a refusal rolls it back, and a
 *   stale version (another tab) is caught and the action tried again on the newer record;
 *   with the server out of reach it says so, and comes back by itself;
 *   a voyage sailed and recorded here, its log sent in pieces, is banked by the server for exactly
 *   what the server's own replay says, and the hold the screen shows moves by it;
 *   signing in with an email code keeps her progress and reloads it, signing out leaves a fresh guest,
 *   signing back in brings the account's progress back, and deleting the account leaves a fresh guest.
 */

import { createServer } from "node:http";
import { testDatabase } from "./testdb.mjs";
import { createApp } from "./app.js";
import { makePool } from "./db.js";
import { engineHash } from "./enginehash.js";
import * as R from "../src/holdrules.js";
import { PARTS } from "../src/shipyard.js";
import { createWorld, step, voyageRun } from "../src/sim/index.js";
import { wander } from "../tools/rounds.js";

const failures = [];
const fail = (what) => { failures.push(what); console.log("  FAIL  " + what); };
const ok = (what) => console.log("  ok    " + what);
const check = (cond, what) => (cond ? ok(what) : fail(what));
const json = (v) => JSON.stringify(v);
const until = async (cond, ms = 5000) => { const end = Date.now() + ms; while (!cond()) { if (Date.now() > end) return false; await new Promise((r) => setTimeout(r, 20)); } return true; };

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
    secret: "test-secret-that-is-long-enough-for-better-auth-0123456789", baseURL: base, origins: [base], cookieDomain: null, prefix: "/api",
    sendCode: async (email, code) => { codes.set(email, code); },
  },
  now: () => clock.t,
});
server.on("request", app.handler);

// The browser, as far as the client modules can tell: a cookie jar, the page's origin, an old save.
globalThis.__ENGINE__ = engineHash();
const storage = new Map([["sternchase.hold", JSON.stringify({ coins: 1e9 })]]);
globalThis.window = {
  localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) },
  addEventListener() {},
};
const jar = new Map();
let reachable = true;
async function browserFetch(url, init = {}) {
  if (!reachable) throw new TypeError("fetch failed");
  const headers = { ...(init.headers || {}), origin: base };
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const res = await fetch(url, { ...init, headers });
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
  return res;
}
const net = await import("../src/net.js");
net.setTransport({ apiBase: base + "/api", fetchImpl: browserFetch });
const H = await import("../src/hold.js");
const V = await import("../src/voyage.js");

/** The hold as the server holds it, read straight from its table. */
const serverHold = async () => (await pool.query("select data, version from holds")).rows[0];
async function setServerHold(fn) {
  const row = await serverHold();
  await pool.query("update holds set data = $1, version = version + 1", [json(fn(row.data))]);
}

try {
  // ---- connecting ---------------------------------------------------------------------------------
  check(H.holdStatus() === "loading" && H.buyPart("gun3") === null, "before the server answers, the hold is loading and nothing can be bought");
  await H.connect();
  check(H.holdStatus() === "ready" && json(H.getHold()) === json(R.blank()), "it signs in as a guest and loads her hold from the server");
  check(!storage.has("sternchase.hold") && H.hadLocalSave(), "the save this browser kept before is deleted, and noticed");

  // ---- the shop -----------------------------------------------------------------------------------
  {
    check(H.buyPart("gun3") === null, "a part she cannot afford is refused here, before anything is sent");
    await setServerHold((h) => ({ ...h, coins: 1000 }));
    await H.connect();
    let heard = 0;
    const off = H.subscribeHold(() => heard++);
    const bought = H.buyPart("gun3");
    check(bought && bought.hold.coins === 1000 - PARTS.gun3.price && H.getHold().yard.parts[bought.part], "a purchase shows at once, before the server answers");
    await until(H.holdSettled);
    const row = await serverHold();
    check(json(H.getHold()) === json(row.data), "and the server's answer is what the screen then shows");
    off();
    check(heard >= 2, "every change is published to the screen");

    // the server refuses what this screen thought it could afford: another tab spent the coins
    await setServerHold((h) => ({ ...h, coins: 0 }));
    const guess = H.buyPart("gun3");
    check(guess !== null, "the screen, a version behind, thinks she can afford another");
    await until(H.holdSettled);
    const after = await serverHold();
    check(H.getHold().coins === 0 && json(H.getHold()) === json(after.data), "the server refuses it, and the screen is rolled back to the server's record");

    // a stale version (another tab moved the record on) is retried on the newer record and applied
    await setServerHold((h) => ({ ...h, coins: 500 }));
    await H.connect();
    await setServerHold((h) => h); // another tab wrote: same record, the version moved on
    const retried = H.buyPart("gun3");
    await until(H.holdSettled);
    const fresh = await serverHold();
    check(retried && fresh.data.coins === 500 - PARTS.gun3.price && json(H.getHold()) === json(fresh.data), "a stale version is caught, and the action is applied to the newer record");
  }

  // ---- offline ------------------------------------------------------------------------------------
  {
    reachable = false;
    const connecting = H.connect();
    check(await until(() => H.holdStatus() === "offline"), "with the server out of reach, it says so");
    check(H.buyPart("gun3") === null, "and nothing can be bought");
    reachable = true;
    await connecting;
    check(H.holdStatus() === "ready", "and it comes back by itself once the server answers");
  }

  // ---- a voyage -----------------------------------------------------------------------------------
  {
    const before = await serverHold();
    const started = await V.startVoyage("ffa");
    check(started.ok && Number.isInteger(started.round.seed), "a voyage starts with the server's seed and her loadout");
    const { round } = started;
    const t0 = clock.t;
    const rec = V.recorderFor(round.roundId);
    const world = createWorld({ mode: round.mode, seed: round.seed, players: [{ id: "p1", loadout: round.loadout }] });
    while (!world.result.over && world.tick < 216000) {
      const input = wander(world.tick);
      rec.record(world.tick, input);
      step(world, { p1: input });
      clock.t = t0 + Math.ceil((world.tick / 60) * 1000) + 100;
      if (world.tick % 300 === 0) await new Promise((r) => setTimeout(r, 0)); // let a piece go up
    }
    const pieces = (await pool.query("select count(*)::int as n from round_inputs where round_id = $1", [round.roundId])).rows[0].n;
    const out = await rec.finish(world.tick);
    const want = R.bank(before.data, voyageRun(world, "p1"));
    check(pieces > 1, `the log went up in pieces as she sailed (${pieces} before the end)`);
    check(out.ok && out.data.banked === want.banked && json(out.data.hold) === json(want.rec),
      `the server banks what its own replay says (${out.data && out.data.banked} coins)`);
    H.adoptHold(out.data);
    check(json(H.getHold()) === json(want.rec), "and the screen's hold moves by it");

    const again = await V.startVoyage("ffa");
    const r2 = V.recorderFor(again.round.roundId);
    r2.record(0, { joyMag: 2, joyAng: 0, broadside: false, bow: false, musket: false, repair: null });
    const refused = await r2.finish(5);
    check(!refused.ok && refused.refused && refused.refused.status === 422, "a voyage the server refuses comes back refused, not banked");
  }
  // ---- signing in ---------------------------------------------------------------------------------
  {
    const A = await import("../src/account.js");
    const progress = json(H.getHold());
    const who = await A.getAccount();
    check(who && who.guest && who.methods.email && !who.methods.google, "a guest is told she is one, and that email sign-in is on and Google is not");
    check(H.hasProgress(), "a guest who has sailed has progress she could lose");
    check((await A.sendCode(" Captain@Example.com ")) === "sent" && codes.has("captain@example.com"), "a code is sent to her email");
    const real = codes.get("captain@example.com");
    check((await A.signInWithCode("captain@example.com", real === "000000" ? "111111" : "000000")) === "wrong" && (await A.getAccount()).guest,
      "a wrong code is said to be wrong, and she is still a guest");
    const signed = await A.signInWithCode("captain@example.com", real);
    const acct = await A.getAccount();
    check(signed === "ok" && acct && !acct.guest && acct.email === "captain@example.com", "the right code signs her in");
    check(H.holdStatus() === "ready" && json(H.getHold()) === progress, "and the hold she sees is the progress she had as a guest");

    check((await A.signOut()) && H.holdStatus() === "ready" && json(H.getHold()) === json(R.blank()) && (await A.getAccount()).guest,
      "signing out leaves a fresh guest, with a blank hold");
    await A.sendCode("captain@example.com");
    check((await A.signInWithCode("captain@example.com", codes.get("captain@example.com"))) === "ok" && json(H.getHold()) === progress,
      "signing back in brings the account's progress back");
    check((await A.deleteAccount()) && json(H.getHold()) === json(R.blank()) && (await A.getAccount()).guest,
      "deleting the account leaves a fresh guest, with a blank hold");
    await A.sendCode("captain@example.com");
    await A.signInWithCode("captain@example.com", codes.get("captain@example.com"));
    check(json(H.getHold()) === json(R.blank()), "and the deleted account's progress is gone for good");
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
console.log("\nThe browser keeps to the server's hold.\n");
process.exit(0);

/**
 * THE GAME SERVER — guests, the hold, and voyages replayed.
 *
 * `createApp({ pool, config, now })` returns the request handler `index.js` serves and the tests
 * drive. It owns no clock of its own: `now` is handed in, so a round's pace can be tested without
 * waiting for it. Routes:
 *
 *   GET  /health                 alive, and which engine it replays with
 *   *    /auth/*                 Better Auth: guests, the email code, Google, sessions, sign-out
 *   GET  /account                who she is signed in as, and which ways of signing in are on
 *   POST /account/delete         delete her account, her hold and her voyages, at once
 *   GET  /hold                   the captain's hold and its version
 *   POST /hold/actions           one shop action, `{ action, args, version }`
 *   POST /hold/grant             100,000 coins, for an account `COIN_GRANT` names (the menu's tap code)
 *
 *   POST /rounds                 start a voyage
 *   POST /rounds/:id/inputs      a piece of its input log
 *   POST /rounds/:id/finish      the last piece; the server replays it and banks what it finds
 */

import { timingSafeEqual } from "node:crypto";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { betterAuth } from "better-auth";
import { authOptions } from "./auth.js";
import { migrate, transaction } from "./db.js";
import { cors, send, readJson, HttpError } from "./http.js";
import { lockHold, parseAction, act, grant } from "./hold.js";
import { engineHash } from "./enginehash.js";
import { replayer, startRound, addInputs, finishRound } from "./rounds.js";
import { createOnline, makeTicket } from "./online.js";

/**
 * How hard one captain may lean on the hold and round routes: a bucket of 60 requests refilled at
 * 20 a second. A browser playing honestly sends a piece of log every few seconds and a shop action
 * per tap, nowhere near it; past it, 429.
 */
const BUCKET = 60, REFILL = 20;

export async function createApp({ pool, config, now = () => Date.now(), catchUp, awayMs }) {
  // a pooled connection that drops (a database restart, a network blip) is logged and replaced, not
  // left to throw and take the process with it
  pool.on("error", (e) => console.error("database connection lost:", e.message));
  const options = authOptions({ pool, config });
  await migrate(pool, options);
  const auth = betterAuth(options);
  const authHandler = toNodeHandler(auth);
  const engine = engineHash();
  const replays = replayer();
  const online = createOnline({ pool, engine, secret: config.secret, publicWs: config.publicWs || null, now, catchUp, awayMs });

  const buckets = new Map();
  function spend(userId) {
    const t = now();
    const b = buckets.get(userId) || { tokens: BUCKET, at: t };
    b.tokens = Math.min(BUCKET, b.tokens + ((t - b.at) / 1000) * REFILL);
    b.at = t;
    buckets.set(userId, b);
    if (b.tokens < 1) throw new HttpError(429, "slow down");
    b.tokens -= 1;
  }
  // a bucket left full for a minute is forgotten, so the map holds only captains at sea
  const sweep = setInterval(() => {
    const t = now();
    for (const [id, b] of buckets) if (t - b.at > 60000) buckets.delete(id);
  }, 60000);
  sweep.unref();

  async function userOf(req) {
    const s = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!s || !s.user) throw new HttpError(401, "no session");
    spend(s.user.id);
    return s.user;
  }

  const routes = {
    "GET /health": async () => ({ status: 200, body: { ok: true, engine } }),
    "GET /account": async (req) => {
      const user = await userOf(req);
      const { rows } = await pool.query(`select 1 from account where "userId" = $1 and "providerId" = 'google' limit 1`, [user.id]);
      return {
        status: 200,
        body: {
          guest: !!user.isAnonymous,
          email: user.isAnonymous ? null : user.email,
          google: rows.length > 0,
          methods: { email: !!config.sendCode, google: !!config.google },
        },
      };
    },
    // a JSON body is asked for, though it carries nothing, so another site's form cannot send this
    "POST /account/delete": async (req) => {
      const user = await userOf(req);
      await readJson(req);
      // her sessions, sign-in methods, hold, rounds and their logs all go with her, by cascade
      await pool.query(`delete from "user" where id = $1`, [user.id]);
      return { status: 200, body: { deleted: true } };
    },
    "GET /hold": async (req) => {
      const user = await userOf(req);
      const cur = await transaction(pool, (c) => lockHold(c, user.id, now));
      return { status: 200, body: cur };
    },
    "POST /hold/actions": async (req) => {
      const user = await userOf(req);
      const body = parseAction(await readJson(req));
      return transaction(pool, (c) => act(c, user.id, body, now));
    },
    // The menu's tap code. The code itself is in the game's public script, so this is where it is
    // decided whether it does anything: only for an account the environment's `COIN_GRANT` names,
    // and a refusal says nothing a stranger could learn from. A JSON body is asked for, though it
    // carries nothing, so another site's form cannot send this.
    "POST /hold/grant": async (req) => {
      const user = await userOf(req);
      await readJson(req);
      const allowed = config.coinGrant || (() => false);
      if (!allowed(user)) return { status: 404, body: { error: "not found" } };
      return transaction(pool, (c) => grant(c, user.id, now));
    },
    // whether she still has a place in a lobby: a reopened app asks, and goes straight back to it
    "GET /online/where": async (req) => {
      const user = await userOf(req);
      return { status: 200, body: { code: online.whereIs(user.id) } };
    },
    // a ticket for the online socket, which reaches the server directly and so cannot carry the cookie
    "POST /online/ticket": async (req) => {
      const user = await userOf(req);
      const body = await readJson(req);
      if (!body || typeof body.engine !== "string") throw new HttpError(400, "shape");
      if (body.engine !== engine) return { status: 409, body: { error: "engine", engine } };
      if (!config.publicWs) return { status: 503, body: { error: "online is not configured" } };
      return { status: 200, body: { ticket: makeTicket(config.secret, user.id, engine, now()), ws: config.publicWs } };
    },
    "POST /rounds": async (req) => {
      const user = await userOf(req);
      const body = await readJson(req);
      return transaction(pool, (c) => startRound(c, user.id, body, { engine, now }));
    },
  };
  // the routes with a round's id in them
  const ROUND = /^\/rounds\/([0-9a-f-]{36})\/(inputs|finish)$/;
  async function roundRoute(req, path) {
    const m = ROUND.exec(path);
    if (!m || req.method !== "POST") return null;
    const user = await userOf(req);
    const body = await readJson(req);
    if (m[2] === "inputs") return transaction(pool, (c) => addInputs(c, user.id, m[1], body, { now }));
    return finishRound(pool, user.id, m[1], body, { engine, now, replays });
  }

  const prefix = config.prefix || "";
  const secret = config.proxySecret ? Buffer.from(config.proxySecret) : null;
  /** Whether a request carries the proxy's secret, compared in constant time. */
  const fromProxy = (req) => {
    const given = Buffer.from(String(req.headers["x-sternchase-proxy"] || ""));
    return given.length === secret.length && timingSafeEqual(given, secret);
  };

  async function handler(req, res) {
    try {
      if (cors(req, res, config.origins)) return;
      const full = new URL(req.url, "http://x").pathname;
      // Railway's own health check comes straight here, with no secret and no prefix
      if (full === "/health" && req.method === "GET") return send(res, 200, { ok: true, engine });
      if (secret && !fromProxy(req)) return send(res, 403, { error: "proxy only" });
      if (prefix && full !== prefix && !full.startsWith(prefix + "/")) return send(res, 404, { error: "not found" });
      const path = full.slice(prefix.length) || "/";
      if (path === "/auth" || path.startsWith("/auth/")) return await authHandler(req, res);
      const route = routes[`${req.method} ${path}`];
      const out = route ? await route(req, path) : await roundRoute(req, path);
      if (!out) return send(res, 404, { error: "not found" });
      send(res, out.status, out.body);
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.status === 413) res.setHeader("connection", "close");
        return send(res, e.status, e.body);
      }
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: "server" });
    }
  }

  /** WebSocket upgrades: the online socket at `/ws`, which authenticates by ticket rather than cookie. */
  function upgrade(req, socket, head) {
    const path = new URL(req.url, "http://x").pathname;
    if (path === "/ws" || path === `${prefix}/ws`) return online.upgrade(req, socket, head);
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
  }

  return { handler, upgrade, online, auth, engine, close: async () => { clearInterval(sweep); online.close(); await replays.close(); } };
}

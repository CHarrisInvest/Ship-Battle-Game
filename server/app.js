/**
 * THE GAME SERVER — guests, the hold, and voyages replayed.
 *
 * `createApp({ pool, config, now })` returns the request handler `index.js` serves and the tests
 * drive. It owns no clock of its own: `now` is handed in, so a round's pace can be tested without
 * waiting for it. Routes:
 *
 *   GET  /health                 alive, and which engine it replays with
 *   *    /auth/*                 Better Auth: guest sign-in, sessions
 *   GET  /hold                   the captain's hold and its version
 *   POST /hold/actions           one shop action, `{ action, args, version }`
 *
 *   POST /rounds                 start a voyage
 *   POST /rounds/:id/inputs      a piece of its input log
 *   POST /rounds/:id/finish      the last piece; the server replays it and banks what it finds
 */

import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { betterAuth } from "better-auth";
import { authOptions } from "./auth.js";
import { migrate, transaction } from "./db.js";
import { cors, send, readJson, HttpError } from "./http.js";
import { lockHold, parseAction, act } from "./hold.js";
import { engineHash } from "./enginehash.js";
import { replayer, startRound, addInputs, finishRound } from "./rounds.js";

export async function createApp({ pool, config, now = () => Date.now() }) {
  const options = authOptions({ pool, config });
  await migrate(pool, options);
  const auth = betterAuth(options);
  const authHandler = toNodeHandler(auth);
  const engine = engineHash();
  const replays = replayer();

  async function userOf(req) {
    const s = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!s || !s.user) throw new HttpError(401, "no session");
    return s.user;
  }

  const routes = {
    "GET /health": async () => ({ status: 200, body: { ok: true, engine } }),
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
    return transaction(pool, (c) => finishRound(c, user.id, m[1], body, { now, replays }));
  }

  async function handler(req, res) {
    try {
      if (cors(req, res, config.origins)) return;
      const path = new URL(req.url, "http://x").pathname;
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

  return { handler, auth, engine, close: async () => { await replays.close(); } };
}

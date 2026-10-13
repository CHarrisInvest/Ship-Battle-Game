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
 * and the round routes `rounds.js` adds.
 */

import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { betterAuth } from "better-auth";
import { authOptions } from "./auth.js";
import { migrate, transaction } from "./db.js";
import { cors, send, readJson, HttpError } from "./http.js";
import { lockHold, parseAction, act } from "./hold.js";
import { engineHash } from "./enginehash.js";

export async function createApp({ pool, config, now = () => Date.now() }) {
  const options = authOptions({ pool, config });
  await migrate(pool, options);
  const auth = betterAuth(options);
  const authHandler = toNodeHandler(auth);
  const engine = engineHash();

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
  };

  async function handler(req, res) {
    try {
      if (cors(req, res, config.origins)) return;
      const path = new URL(req.url, "http://x").pathname;
      if (path === "/auth" || path.startsWith("/auth/")) return await authHandler(req, res);
      const route = routes[`${req.method} ${path}`];
      if (!route) return send(res, 404, { error: "not found" });
      const out = await route(req, path);
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

  return { handler, auth, engine, close: async () => {} };
}

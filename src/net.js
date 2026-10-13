/**
 * THE GAME'S LINE TO ITS SERVER.
 *
 * Every call goes to `/api/*` on the game's own address, which the edge function in `api/proxy.js`
 * forwards to the server, so the session cookie is the game's own and travels with every call
 * (`credentials: "same-origin"`). A call never throws: it answers `{ status, data }`, with status 0
 * for a network that is not there, so a screen can say "offline" rather than break.
 *
 * `ENGINE` is the engine's fingerprint, built into the bundle by `vite.config.js` from the same files
 * the server hashes, so the server can refuse a round from a page left open across a deploy.
 */

let base = "/api";
let doFetch = (...a) => fetch(...a);

/** For the tests: where the server is, and a fetch that keeps cookies the way a browser does. */
export function setTransport({ apiBase, fetchImpl }) {
  if (apiBase !== undefined) base = apiBase;
  if (fetchImpl) doFetch = fetchImpl;
}

// eslint-disable-next-line no-undef
export const ENGINE = typeof __ENGINE__ !== "undefined" ? __ENGINE__ : "unbuilt";

export async function call(method, path, body) {
  try {
    const res = await doFetch(base + path, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "content-type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* an empty or plain answer */ }
    return { status: res.status, data };
  } catch {
    return { status: 0, data: null };
  }
}

/**
 * A session, made if there is none: the captain is a guest until she says otherwise, and her guest
 * account is what keeps her hold. True once there is one, false if the server could not be reached.
 */
export async function ensureSession() {
  const s = await call("GET", "/auth/get-session");
  if (s.status === 200 && s.data && s.data.user) return true;
  if (s.status === 0 || s.status >= 500) return false;
  const r = await call("POST", "/auth/sign-in/anonymous", {});
  return r.status === 200;
}

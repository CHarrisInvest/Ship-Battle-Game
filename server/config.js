/**
 * The server's settings, from the environment, read once at start. Nothing secret is ever printed.
 *
 *   DATABASE_URL         Postgres (Railway's reference to the Postgres service).
 *   BETTER_AUTH_SECRET   signs sessions; Railway generates it.
 *   BETTER_AUTH_URL      the server's own address, e.g. https://api.sternchase.org.
 *   CLIENT_ORIGINS       the game's addresses, comma separated: the only origins CORS and the
 *                        sign-in routes trust.
 *   COOKIE_DOMAIN        optional: `sternchase.org` in production, so the session cookie belongs to
 *                        the game's own site and Safari keeps it first-party.
 *   API_PREFIX           optional: `/api` in production, where the game's own domain forwards
 *                        `/api/*` here, so the server answers under that path.
 *   PROXY_SECRET         optional: set in production to the secret the Vercel proxy adds to every
 *                        request. Every route but `/health` then refuses a request without it, so the
 *                        server cannot be reached around the proxy, and the visitor's address is
 *                        read from the proxy's `x-client-ip` rather than from the connection.
 *   GUESTS_PER_MINUTE    optional: how many guest accounts one address may make a minute (10).
 *   PUBLIC_WS_URL        the address browsers open the online socket on, e.g.
 *                        wss://server-production-08778.up.railway.app/ws. The socket goes straight
 *                        to the server (Vercel's proxy cannot carry one), authenticated by ticket.
 *   RESEND_API_KEY       optional: turns on sign-in by email code, sent through Resend.
 *   EMAIL_FROM           the address the codes come from, on a domain verified with Resend, e.g.
 *                        `Sternchase <codes@sternchase.org>`. Needed with RESEND_API_KEY.
 *   GOOGLE_CLIENT_ID     optional, with GOOGLE_CLIENT_SECRET: turns on sign-in with Google. The
 *   GOOGLE_CLIENT_SECRET OAuth client's redirect URI is BETTER_AUTH_URL + API_PREFIX +
 *                        `/auth/callback/google`, e.g. https://sternchase.org/api/auth/callback/google.
 *   COIN_GRANT           optional: who the menu's tap code may hand 100,000 coins to. Unset, nobody,
 *                        which is how production should stay unless the owner wants it there.
 *                        `all` grants to every captain of this environment, guests included, which
 *                        is meant for staging. Anything else is a comma-separated list of email
 *                        addresses, and only an account signed in with one of them is granted.
 *   PORT                 Railway sets it.
 */

import { resendSender } from "./mail.js";

export function configFromEnv(env = process.env) {
  const need = (k) => {
    if (!env[k]) throw new Error(`${k} is not set`);
    return env[k];
  };
  return {
    databaseUrl: need("DATABASE_URL"),
    secret: need("BETTER_AUTH_SECRET"),
    baseURL: need("BETTER_AUTH_URL"),
    origins: need("CLIENT_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean),
    cookieDomain: env.COOKIE_DOMAIN || null,
    prefix: env.API_PREFIX || "",
    proxySecret: env.PROXY_SECRET || null,
    guestsPerMinute: Number(env.GUESTS_PER_MINUTE) || 10,
    publicWs: env.PUBLIC_WS_URL || null,
    sendCode: env.RESEND_API_KEY ? resendSender({ apiKey: env.RESEND_API_KEY, from: need("EMAIL_FROM") }) : null,
    google: env.GOOGLE_CLIENT_ID ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: need("GOOGLE_CLIENT_SECRET") } : null,
    port: Number(env.PORT) || 8787,
    coinGrant: grantRule(env.COIN_GRANT),
  };
}

/**
 * Whom `COIN_GRANT` lets the tap code grant coins to, as a test of a Better Auth user: nobody when it
 * is unset or blank, everybody for `all`, and otherwise only a signed-in account whose email is on
 * the list, compared without regard to case. A guest has no email of her own and is never on a list.
 */
export function grantRule(raw) {
  const v = String(raw || "").trim();
  if (!v) return () => false;
  if (v.toLowerCase() === "all") return () => true;
  const emails = new Set(v.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
  return (user) => !!user && !user.isAnonymous && typeof user.email === "string" && emails.has(user.email.toLowerCase());
}

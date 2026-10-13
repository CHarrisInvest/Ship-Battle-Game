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
 *   PORT                 Railway sets it.
 */
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
    port: Number(env.PORT) || 8787,
  };
}

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
    port: Number(env.PORT) || 8787,
  };
}

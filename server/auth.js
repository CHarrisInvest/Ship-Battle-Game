/**
 * Accounts, through Better Auth, mounted at `/auth`. In this step every visitor is a guest: the
 * anonymous plugin makes an account with no email the first time the game asks, and its session
 * cookie is what keeps a captain's hold hers. Email codes and Google come in step 5, and link to the
 * guest account the captain is already using.
 */

import { anonymous } from "better-auth/plugins/anonymous";

/** Better Auth's options. The tables are migrated from these before the instance is built from them. */
export function authOptions({ pool, config }) {
  return {
    database: pool,
    secret: config.secret,
    baseURL: config.baseURL,
    basePath: "/auth",
    trustedOrigins: config.origins,
    telemetry: { enabled: false },
    plugins: [anonymous()],
    // a guest is kept 90 days from her last visit, so her session is too, renewed once a day of play;
    // the default week would hand a returning guest a new, empty account long before her hold went
    session: { expiresIn: 90 * 24 * 3600, updateAge: 24 * 3600 },
    // on everywhere, not only in production, and tighter on making guests: an account is one request,
    // and each brings its own share of everything else the server allows a captain
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: { "/sign-in/anonymous": { window: 60, max: config.guestsPerMinute || 10 } },
    },
    advanced: {
      // the address a visitor is counted by: Railway's edge sets X-Real-IP to the client's own
      ipAddress: { ipAddressHeaders: ["x-real-ip", "x-forwarded-for"] },
      // The game and the server are one site (sternchase.org and api.sternchase.org), so the cookie
      // is set on the game's domain and stays first-party; locally there is no domain to share.
      ...(config.cookieDomain ? { crossSubDomainCookies: { enabled: true, domain: config.cookieDomain } } : {}),
      defaultCookieAttributes: { sameSite: "lax" },
    },
  };
}

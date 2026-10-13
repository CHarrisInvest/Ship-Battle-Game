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
    advanced: {
      // The game and the server are one site (sternchase.org and api.sternchase.org), so the cookie
      // is set on the game's domain and stays first-party; locally there is no domain to share.
      ...(config.cookieDomain ? { crossSubDomainCookies: { enabled: true, domain: config.cookieDomain } } : {}),
      defaultCookieAttributes: { sameSite: "lax" },
    },
  };
}

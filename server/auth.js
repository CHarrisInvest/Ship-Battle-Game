/**
 * Accounts, through Better Auth, mounted at `/auth`. Every visitor starts as a guest: the anonymous
 * plugin makes an account with no email the first time the game asks, and its session cookie is what
 * keeps a captain's hold hers. She keeps it for good by signing in, with a 6-digit code sent to her
 * email (when `sendCode` is configured) or with Google (when `google` is), and either one carries the
 * guest's hold over to the account she signs in to, if that account is new.
 */

import { anonymous } from "better-auth/plugins/anonymous";
import { emailOTP } from "better-auth/plugins/email-otp";
import { transaction } from "./db.js";

/**
 * What happens to the guest's progress when she signs in. Better Auth deletes the guest account once
 * this returns, and her hold and rounds with it, by cascade. So:
 *
 *   - an account signed in to for the first time has no hold yet, and takes the guest's, rounds and all;
 *   - an account that already has one keeps its own, and the guest's goes with the guest, because
 *     merging two holds is a way to duplicate coins. The game warns her before she signs in.
 */
export function guestLinker(pool) {
  return async ({ anonymousUser, newUser }) => {
    const from = anonymousUser.user.id;
    const to = newUser.user.id;
    if (from === to) return;
    await transaction(pool, async (c) => {
      const moved = await c.query(
        "update holds set user_id = $2 where user_id = $1 and not exists (select 1 from holds where user_id = $2)",
        [from, to],
      );
      if (moved.rowCount) await c.query("update rounds set user_id = $2 where user_id = $1", [from, to]);
    });
  };
}

/** Better Auth's options. The tables are migrated from these before the instance is built from them. */
export function authOptions({ pool, config }) {
  const plugins = [anonymous({ onLinkAccount: guestLinker(pool) })];
  if (config.sendCode) {
    plugins.push(emailOTP({
      otpLength: 6,
      expiresIn: 10 * 60,
      allowedAttempts: 5,
      sendVerificationOTP: ({ email, otp }) => config.sendCode(email, otp),
    }));
  }
  return {
    database: pool,
    secret: config.secret,
    baseURL: config.baseURL,
    basePath: `${config.prefix || ""}/auth`,
    trustedOrigins: config.origins,
    telemetry: { enabled: false },
    plugins,
    socialProviders: config.google
      ? { google: { clientId: config.google.clientId, clientSecret: config.google.clientSecret, prompt: "select_account" } }
      : {},
    // a guest is kept 90 days from her last visit, so her session is too, renewed once a day of play;
    // the default week would hand a returning guest a new, empty account long before her hold went
    session: { expiresIn: 90 * 24 * 3600, updateAge: 24 * 3600 },
    // on everywhere, not only in production, and tighter on making guests and on sending mail: an
    // account is one request, and a code is an email someone else's address could be sent
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/anonymous": { window: 60, max: config.guestsPerMinute || 10 },
        "/email-otp/send-verification-otp": { window: 60, max: 3 },
        "/sign-in/email-otp": { window: 60, max: 10 },
      },
    },
    advanced: {
      // the address a visitor is counted by. Behind the proxy, the one it passes on (Vercel sets it
      // from the connection, and only the proxy can reach the server); reached directly, the one
      // Railway's edge sets to the client's own.
      ipAddress: { ipAddressHeaders: config.proxySecret ? ["x-client-ip"] : ["x-real-ip", "x-forwarded-for"] },
      // The game and the server are one site (sternchase.org and api.sternchase.org), so the cookie
      // is set on the game's domain and stays first-party; locally there is no domain to share.
      ...(config.cookieDomain ? { crossSubDomainCookies: { enabled: true, domain: config.cookieDomain } } : {}),
      defaultCookieAttributes: { sameSite: "lax" },
    },
  };
}

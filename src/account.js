/**
 * WHO SHE IS SIGNED IN AS — the account behind the hold, and the ways of changing it.
 *
 * Every captain starts as a guest (`net.js` makes one), and her progress is already on the server.
 * Signing in keeps it for good: a 6-digit code sent to her email, typed in here, or Google. Either one
 * carries a guest's progress to an account that is new, and on an account that already has progress
 * the account's wins and the guest's is dropped, which the screen warns of first. Signing out and
 * deleting the account both leave her a fresh guest. Every change of who she is reloads the hold.
 *
 * Google is a redirect: the page goes to Google and comes back to `/?signin=google`, or to
 * `/?signin=failed` if it did not work, and `returnedFromGoogle` reads and clears that on load.
 */

import { call } from "./net.js";
import { reconnect, holdSettled } from "./hold.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Until every shop action already tapped has been answered, so none lands on the next account. */
async function settle() {
  for (let i = 0; i < 100 && !holdSettled(); i++) await wait(50);
}

/**
 * `{ guest, email, google, methods: { email, google } }`, or null if the server could not say.
 * `methods` is which ways of signing in the server has turned on.
 */
export async function getAccount() {
  const r = await call("GET", "/account");
  return r.status === 200 ? r.data : null;
}

/** Send a sign-in code to `email`. `"sent"`, `"slow"` (too many asked for), `"bad"` or `"offline"`. */
export async function sendCode(email) {
  const r = await call("POST", "/auth/email-otp/send-verification-otp", { email: email.trim(), type: "sign-in" });
  if (r.status === 200) return "sent";
  if (r.status === 429) return "slow";
  if (r.status === 0 || r.status >= 500) return "offline";
  return "bad";
}

/** Sign in with the code she was sent. `"ok"`, `"wrong"` (or expired), `"slow"` or `"offline"`. */
export async function signInWithCode(email, code) {
  await settle();
  const r = await call("POST", "/auth/sign-in/email-otp", { email: email.trim(), otp: code.trim() });
  if (r.status === 200) { await reconnect(); return "ok"; }
  if (r.status === 429) return "slow";
  if (r.status === 0 || r.status >= 500) return "offline";
  return "wrong";
}

/** Go to Google to sign in. Resolves only if the page could not be sent there, with `"offline"`. */
export async function signInWithGoogle() {
  await settle();
  const r = await call("POST", "/auth/sign-in/social", { provider: "google", callbackURL: "/?signin=google", errorCallbackURL: "/?signin=failed" });
  if (r.status === 200 && r.data && r.data.url) {
    window.location.assign(r.data.url);
    return new Promise(() => {});
  }
  return "offline";
}

/** Sign out, and carry on as a fresh guest. */
export async function signOut() {
  await settle();
  const r = await call("POST", "/auth/sign-out", {});
  if (r.status !== 200) return false;
  await reconnect();
  return true;
}

/** Delete her account and everything kept with it, and carry on as a fresh guest. */
export async function deleteAccount() {
  await settle();
  const r = await call("POST", "/account/delete", {});
  if (r.status !== 200) return false;
  await reconnect();
  return true;
}

/** `"google"` or `"failed"` if this page is Google sending her back, with the address cleaned up; else null. */
export function returnedFromGoogle() {
  const q = new URLSearchParams(window.location.search);
  const v = q.get("signin");
  if (!v) return null;
  q.delete("signin");
  q.delete("error");
  const rest = q.toString();
  window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
  return v === "google" ? "google" : "failed";
}

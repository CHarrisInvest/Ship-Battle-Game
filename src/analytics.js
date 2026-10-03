/**
 * ANALYTICS — Google Analytics 4, for those who have said yes, and for nobody else.
 *
 * `GA_ID` is the measurement ID from the GA4 property ("G-" and ten characters). While it is empty
 * nothing loads, `track` does nothing, and the cookie prompt and the privacy policy say the game
 * collects no analytics, because both read `analyticsLive` rather than assuming. Filling it in is the
 * one change that turns analytics on, and the policy's analytics section appears the same moment.
 *
 * Who has said yes depends on whose prompt asked (`ads.js`). Where the game's prompt asks, it is the
 * analytics switch (`isAnalyticsAllowed`). Where Google's consent message applies, the game's prompt
 * is never shown, so the answer is read off Google's TCF record: consent to store information on the
 * device (purpose 1) and to measure content performance (purpose 8), for Google as a vendor (755).
 * Nothing is sent before that yes: gtag.js is not even fetched, so there are no cookieless pings.
 *
 * Google signals and ad personalization are switched off on the tag, so what is collected is play
 * statistics and stays that. A later no stops collection at once (`ga-disable-<id>`), and gtag.js
 * stays out of the page on the next visit.
 */

import { isAnalyticsAllowed, onConsentChange } from "./consent.js";
import { onTcf, onAdRegion, getAdRegion } from "./ads.js";

export const GA_ID = "";
export const analyticsLive = () => GA_ID !== "";

const GOOGLE_VENDOR = 755;

let started = false;
let loaded = false;
let allowed = false;
let tcfRules = false;

function gtag() {
  window.dataLayer.push(arguments);
}

function load() {
  window[`ga-disable-${GA_ID}`] = false;
  if (loaded) return;
  loaded = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = gtag;
  gtag("consent", "default", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
  gtag("js", new Date());
  gtag("config", GA_ID, { allow_google_signals: false, allow_ad_personalization_signals: false });
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);
}

function set(yes) {
  allowed = yes;
  if (yes) load();
  else if (loaded) {
    window[`ga-disable-${GA_ID}`] = true;
    gtag("consent", "update", { analytics_storage: "denied" });
  }
}

/** Once, from the game's entry point. */
export function startAnalytics() {
  if (started || !analyticsLive() || typeof window === "undefined") return;
  started = true;
  // The game's switch counts only once the game's prompt is known to be the one asking, so a European
  // visitor is never measured on an answer given before Google's message was shown.
  const gameAnswer = () => { if (!tcfRules && getAdRegion() === "game") set(isAnalyticsAllowed()); };
  gameAnswer();
  onAdRegion(gameAnswer);
  onConsentChange(gameAnswer);
  // Where Google's message applies, its record is the answer, and the game's switch no longer counts.
  onTcf((tc) => {
    tcfRules = true;
    set(!!(tc.purpose?.consents?.[1] && tc.purpose?.consents?.[8] && tc.vendor?.consents?.[GOOGLE_VENDOR]));
  });
}

/** A game event, e.g. track("voyage_end", { mode: "wave", result: "sunk" }). Does nothing without consent. */
export function track(name, params) {
  if (allowed && loaded) gtag("event", name, params);
}

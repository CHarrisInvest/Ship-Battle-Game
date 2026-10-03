/**
 * ANALYTICS — Google Analytics 4: on unless turned off in most of the world, off unless turned on
 * where the law asks for that.
 *
 * `GA_ID` is the measurement ID from the GA4 property ("G-" and ten characters). While it is empty
 * nothing loads, `track` does nothing, and the cookie prompt and the privacy policy say the game
 * collects no analytics, because both read `analyticsLive` rather than assuming. Filling it in is the
 * one change that turns analytics on, and the policy's analytics section appears the same moment.
 *
 * Who decides depends on whose prompt asks (`ads.js`). Where Google's consent message applies (the
 * EEA, the UK and Switzerland) the game's prompt is never shown, and the answer is read off Google's
 * TCF record: consent to store information on the device (purpose 1) and to measure content
 * performance (purpose 8), for Google as a vendor (755). Nothing is sent before that yes; gtag.js
 * is not even fetched. Where the game's prompt asks, analytics are ON BY DEFAULT: measuring one's own
 * site needs no prior consent there, so they run from the first visit until the analytics switch is
 * turned off. Brazil is the exception, guessed from its time zones (`OPT_IN_ZONES`), because its law
 * leans toward consent for cookies that are not essential: there they wait for the switch like Europe.
 * `analyticsByDefault` is the one statement of that, and the prompt's switch and the privacy policy
 * both read it.
 *
 * Google signals and ad personalization are switched off on the tag, so what is collected is play
 * statistics and stays that. A later no stops collection at once (`ga-disable-<id>`), and gtag.js
 * stays out of the page on the next visit.
 */

import { isAnalyticsAllowed, hasConsentDecision, onConsentChange } from "./consent.js";
import { onTcf, onAdRegion, getAdRegion } from "./ads.js";

export const GA_ID = "";
export const analyticsLive = () => GA_ID !== "";

const GOOGLE_VENDOR = 755;

// Where the game's prompt asks but analytics still wait for a yes. Brazil's time zones; Quebec would
// belong here too but shares a zone with Ontario, so it cannot be told apart.
const OPT_IN_ZONES = /^America\/(Sao_Paulo|Bahia|Fortaleza|Recife|Maceio|Belem|Araguaina|Santarem|Manaus|Boa_Vista|Porto_Velho|Cuiaba|Campo_Grande|Rio_Branco|Eirunepe|Noronha)$/;

/** Whether analytics run before the game's prompt has been answered, for this visitor. */
export function analyticsByDefault() {
  try {
    return !OPT_IN_ZONES.test(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
  } catch (e) {
    return false;
  }
}

// The game's answer: what the switch says once it has been answered, the default until then.
const gameAllows = () => (hasConsentDecision() ? isAnalyticsAllowed() : analyticsByDefault());

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
  const gameAnswer = () => { if (!tcfRules && getAdRegion() === "game") set(gameAllows()); };
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

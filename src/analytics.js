/**
 * ANALYTICS — Google Analytics 4 and the Google Ads conversion tag: on unless turned off in most of
 * the world, off unless turned on where the law asks for that.
 *
 * The two are one gtag.js and answer to one switch, the prompt's Analytics row. The ads tag
 * (`ADS_ID`) measures conversions for the game's own campaigns on Google: it stores the ID of the ad
 * click that brought a player in, so the visit can be credited to that ad. It is never used to pick
 * ads for anyone, so remarketing and ad personalization stay off on it. Where Google's message asks,
 * it needs measuring ads (purpose 7) where Analytics needs measuring content (purpose 8).
 *
 * `GA_ID` is the measurement ID from the GA4 property ("G-" and ten characters). While it is empty
 * nothing loads, `track` does nothing, and the cookie prompt and the privacy policy say the game
 * collects no analytics, because both read `analyticsLive` rather than assuming. Filling it in is the
 * one change that turns analytics on, and the policy's analytics section appears the same moment.
 *
 * Who decides depends on whose prompt asks, which Google's consent tool settles (`ads.js`). Where
 * Google's message applies (the EEA, the UK and Switzerland) the game's prompt is never shown, and the
 * answer is read off Google's TCF record: consent to store information on the device (purpose 1) and
 * to measure content performance (purpose 8), for Google as a vendor (755). Nothing is sent before
 * that yes; gtag.js is not even fetched. Where the game's prompt asks, analytics are ON BY DEFAULT:
 * measuring one's own site needs no prior consent there, so they run from the first visit until the
 * analytics switch is turned off. The game reads no location of its own for this.
 *
 * Google signals and ad personalization are switched off on the tag, so what is collected is play
 * statistics and stays that. A later no stops collection at once (`ga-disable-<id>`), and gtag.js
 * stays out of the page on the next visit.
 */

import { isAnalyticsAllowed, isAdvertisingAllowed, hasConsentDecision, onConsentChange } from "./consent.js";
import { onTcf, onAdRegion, getAdRegion } from "./ads.js";

export const GA_ID = "G-SKDXWK6TYX";
export const analyticsLive = () => GA_ID !== "";

// The Google Ads tag, which measures which of the game's own ads on Google brought a player here.
// It is the same gtag.js as Analytics and rides the same answer: a player who turns analytics off
// is measured by neither. Empty, it loads nothing.
export const ADS_ID = "AW-18492440060";
export const conversionsLive = () => ADS_ID !== "";

/** Whether anything at all measures the game: what the prompt's switch and the policy read. */
export const measurementLive = () => analyticsLive() || conversionsLive();

const GOOGLE_VENDOR = 755;

// The game's answer: what the switch says once it has been answered, on until then.
const gameAllows = () => (hasConsentDecision() ? isAnalyticsAllowed() : true);

let started = false;
let loaded = false;
let allowed = false;
let tcfRules = false;

function gtag() {
  window.dataLayer.push(arguments);
}

// Ad storage is granted for the ads tag, or for the personalized ads the game's own switch allowed,
// the same rule `updateGoogleConsent` in consent.js writes, so neither undoes the other.
const adStorage = (which) => (which.ads || (!tcfRules && isAdvertisingAllowed()) ? "granted" : "denied");

// Each tag is configured once, the first time it is allowed, which may be after gtag.js is already up.
const configured = { ga: false, ads: false };
function configure(which) {
  if (which.ga && !configured.ga) {
    configured.ga = true;
    gtag("config", GA_ID, { allow_google_signals: false, allow_ad_personalization_signals: false });
  }
  if (which.ads && !configured.ads) {
    configured.ads = true;
    gtag("config", ADS_ID, { allow_ad_personalization_signals: false });
  }
}

// Which tags may run: { ga, ads }. Where the game's prompt asks both follow its one switch; where
// Google's message asks each needs its own purpose in the record.
function load(which) {
  if (GA_ID) window[`ga-disable-${GA_ID}`] = !which.ga;
  if (loaded) {
    gtag("consent", "update", { analytics_storage: which.ga ? "granted" : "denied", ad_storage: adStorage(which), ad_user_data: adStorage(which) });
    configure(which);
    return;
  }
  loaded = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = gtag;
  // The ads tag stores a click's ID to tie a later visit to the ad that brought it, which needs
  // ad storage. It is never used to pick ads for anyone, so ad personalization stays denied.
  gtag("consent", "default", {
    analytics_storage: which.ga ? "granted" : "denied",
    ad_storage: adStorage(which),
    ad_user_data: adStorage(which),
    ad_personalization: "denied",
  });
  gtag("js", new Date());
  configure(which);
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${which.ga ? GA_ID : ADS_ID}`;
  document.head.appendChild(s);
}

function set(which) {
  which = { ga: which.ga && analyticsLive(), ads: which.ads && conversionsLive() };
  allowed = which.ga || which.ads;
  if (allowed) load(which);
  else if (loaded) {
    if (GA_ID) window[`ga-disable-${GA_ID}`] = true;
    gtag("consent", "update", { analytics_storage: "denied", ad_storage: adStorage(which), ad_user_data: adStorage(which) });
  }
}

/** Once, from the game's entry point. */
export function startAnalytics() {
  if (started || !measurementLive() || typeof window === "undefined") return;
  started = true;
  // The game's switch counts only once the game's prompt is known to be the one asking, so a European
  // visitor is never measured on an answer given before Google's message was shown.
  const gameAnswer = () => { if (!tcfRules && getAdRegion() === "game") { const yes = gameAllows(); set({ ga: yes, ads: yes }); } };
  gameAnswer();
  onAdRegion(gameAnswer);
  onConsentChange(gameAnswer);
  // Where Google's message applies, its record is the answer, and the game's switch no longer counts.
  onTcf((tc) => {
    tcfRules = true;
    const google = !!(tc.purpose?.consents?.[1] && tc.vendor?.consents?.[GOOGLE_VENDOR]);
    // Purpose 8 is measuring content, which is Analytics; purpose 7 is measuring ads, which is the ads tag.
    set({ ga: google && !!tc.purpose?.consents?.[8], ads: google && !!tc.purpose?.consents?.[7] });
  });
}

/** A game event, e.g. track("voyage_end", { mode: "wave", result: "sunk" }). Does nothing without consent. */
export function track(name, params) {
  // Sent to Analytics alone, so play events never land in the ads account as conversions.
  if (allowed && loaded && configured.ga) gtag("event", name, { ...params, send_to: GA_ID });
}

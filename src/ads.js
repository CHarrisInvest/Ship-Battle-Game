/**
 * ADS — every visitor sees ads; what a consent answer decides is whether they are personalized.
 *
 * Two prompts, split by where the player is. In the European Economic Area, the UK and Switzerland
 * the asking is done by Google's own consent message (AdSense's Privacy & messaging), because Google
 * serves ads there only behind a certified TCF consent tool and the game's prompt is not one. Google's
 * message is shown by the AdSense script itself, so the script loads with ad requests paused until
 * Google has said whether the message applies. A visitor who agrees there gets personalized ads, and
 * one who declines gets Google's limited ads, which use no cookies or device storage: the law asks
 * for a choice about tracking, not about seeing ads.
 *
 * Everywhere else the game's own prompt (`consent.js`) asks, and the script loads straight away
 * asking for non-personalized ads, which stays the request until the advertising switch says yes.
 * Non-personalized ads still use cookies for frequency capping, fraud and reporting; the prompt and
 * the privacy policy say so, and do not call them essential, because they are not.
 *
 * Which region a visitor is in is first guessed from the browser's time zone, which needs no network,
 * and then settled by Google: once the script is up, its consent tool answers `gdprApplies`. A guess
 * that was wrong in either direction still ends asked: a European time zone outside the regulated
 * regions falls back to the game's prompt, and a regulated visitor with a far-off time zone gets
 * non-personalized ads until both the game's prompt and Google's message have been answered.
 *
 * `region` is what the menu reads: "pending" while Google is being asked, "google" when its message is
 * the one in charge, and "game" when the cookie prompt is. `onTcf` passes on Google's consent record,
 * which `analytics.js` reads in the regions where the game's prompt never asks.
 */

import { isAdvertisingAllowed, onConsentChange } from "./consent.js";

const CLIENT = "ca-pub-1929910138338917";
const SRC = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`;
// How long Google's consent tool has to answer before the game's prompt is shown instead.
const TCF_WAIT_MS = 6000;

// Time zones in the EEA, the UK and Switzerland, plus their neighbours in Europe/*. Only a guess:
// it decides whether to ask Google, and Google's answer is the one that counts.
const REGULATED_ZONES = /^(Europe\/|Atlantic\/(Azores|Madeira|Canary|Reykjavik|Faroe)$|Arctic\/Longyearbyen$|Asia\/(Nicosia|Famagusta)$)/;

let region = "pending";
let started = false;
let loaded = false;
let tcf = null;
const listeners = new Set();
const tcfListeners = new Set();

function setRegion(r) {
  if (region === r) return;
  region = r;
  listeners.forEach((fn) => fn(r));
}

export const getAdRegion = () => region;

/** Hears the region settle. Returns the unsubscribe. */
export function onAdRegion(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Hears Google's consent record each time it changes, and at once if there is one. Returns the unsubscribe. */
export function onTcf(fn) {
  tcfListeners.add(fn);
  if (tcf) fn(tcf);
  return () => tcfListeners.delete(fn);
}

export function guessRegulated() {
  try {
    return REGULATED_ZONES.test(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
  } catch (e) {
    return false;
  }
}

const queue = () => (window.adsbygoogle = window.adsbygoogle || []);
const pause = () => { queue().pauseAdRequests = 1; };
const resume = () => { queue().pauseAdRequests = 0; };
const personalize = (yes) => { queue().requestNonPersonalizedAds = yes ? 0 : 1; };

function load(onFail) {
  if (loaded) return;
  loaded = true;
  const s = document.createElement("script");
  s.async = true;
  s.src = SRC;
  s.crossOrigin = "anonymous";
  s.onerror = () => onFail && onFail();
  document.head.appendChild(s);
}

// Listens to Google's consent tool once it is on the page: the first answer says whether the GDPR
// applies, and every record after it goes to `onTcf`.
function askGoogle(answer) {
  let done = false;
  const settle = (v) => { if (!done) { done = true; answer(v); } };
  const t0 = Date.now();
  (function poll() {
    if (typeof window.__tcfapi === "function") {
      window.__tcfapi("addEventListener", 2, (tc, ok) => {
        if (!ok || !tc) return;
        if (typeof tc.gdprApplies === "boolean") settle(tc.gdprApplies);
        if (tc.gdprApplies) { tcf = tc; tcfListeners.forEach((fn) => fn(tc)); }
      });
      setTimeout(() => settle(false), TCF_WAIT_MS);
    } else if (Date.now() - t0 > TCF_WAIT_MS) {
      settle(false);
    } else {
      setTimeout(poll, 200);
    }
  })();
}

/** Once, from the entry point of a page that shows ads. */
export function startAds() {
  if (started || typeof window === "undefined") return;
  started = true;

  // The game's prompt is in charge: ads run from the start, personalized only once it says so.
  let gameRuled = false;
  const gameRules = () => {
    if (gameRuled) return;
    gameRuled = true;
    setRegion("game");
    personalize(isAdvertisingAllowed());
    onConsentChange((c) => personalize(c.advertising));
    resume();
  };

  const regulated = guessRegulated();
  if (regulated) pause(); else gameRules();
  load(() => gameRules());
  askGoogle((applies) => {
    if (region === "pending" && applies) {
      // Google's message decides from here, so the game's own answer no longer shapes the request.
      queue().requestNonPersonalizedAds = 0;
      setRegion("google");
      resume();
    } else if (region === "pending") {
      gameRules();
    }
  });
}

/** Reopens Google's consent message, for "Cookie settings" where Google's message is in charge. */
export function openGoogleChoices() {
  const fc = (window.googlefc = window.googlefc || {});
  fc.callbackQueue = fc.callbackQueue || [];
  fc.callbackQueue.push(() => window.googlefc.showRevocationMessage());
}

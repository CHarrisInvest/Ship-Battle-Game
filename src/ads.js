/**
 * ADS — Google AdSense, and the only ads on the site. Every visitor sees them; what a consent answer
 * decides is whether they are personalized.
 *
 * Every visitor gets the same page and the same code path. The AdSense script loads at once for
 * everyone, with ad requests paused and non-personalized, and Google's own consent tool (AdSense's
 * Privacy & messaging, a certified TCF tool that the script brings with it) says whose prompt asks.
 * The game never guesses a visitor's location itself: Google's `gdprApplies` is the whole of it.
 *
 * Where Google says the GDPR applies (the European Economic Area, the UK and Switzerland) its consent
 * message asks, and the game's prompt is never shown. A visitor who agrees there gets personalized
 * ads, and one who declines gets Google's limited ads, which use no cookies or device storage.
 *
 * Everywhere else, which includes Google's tool not answering within `TCF_WAIT_MS` and the script
 * failing to load, the game's own prompt (`consent.js`) asks, and ads stay non-personalized until the
 * advertising switch says yes. Non-personalized ads still use cookies for frequency capping, fraud and
 * reporting; the prompt and the privacy policy say so, and do not call them essential.
 *
 * `region` is what the menu reads: "pending" while Google is being asked, "google" when its message is
 * the one in charge, and "game" when the cookie prompt is. `onTcf` passes on Google's consent record,
 * which `analytics.js` reads where Google's message asks.
 */

import { isAdvertisingAllowed, onConsentChange } from "./consent.js";

const CLIENT = "ca-pub-1929910138338917";
const SRC = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`;
// How long Google's consent tool has to answer before the game's prompt is shown instead.
const TCF_WAIT_MS = 6000;

let region = "pending";
let started = false;
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

const queue = () => (window.adsbygoogle = window.adsbygoogle || []);
const pause = () => { queue().pauseAdRequests = 1; };
const resume = () => { queue().pauseAdRequests = 0; };
const personalize = (yes) => { queue().requestNonPersonalizedAds = yes ? 0 : 1; };

function load(onFail) {
  const s = document.createElement("script");
  s.async = true;
  s.src = SRC;
  s.crossOrigin = "anonymous";
  s.onerror = () => onFail();
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

  // The game's prompt is in charge: ads run, personalized only once it says so.
  const gameRules = () => {
    if (region !== "pending") return;
    setRegion("game");
    personalize(isAdvertisingAllowed());
    onConsentChange((c) => personalize(c.advertising));
    resume();
  };

  // Until Google has answered, nothing is requested, and nothing personalized.
  pause();
  personalize(false);
  load(gameRules);
  askGoogle((applies) => {
    if (region !== "pending") return;
    if (applies) {
      // Google's message decides from here, through its consent record, so the game asks nothing.
      queue().requestNonPersonalizedAds = 0;
      setRegion("google");
      resume();
    } else {
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

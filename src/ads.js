/**
 * ADS — when the AdSense script is allowed onto the page, and whose prompt asks first.
 *
 * Two prompts, split by where the player is. In the European Economic Area, the UK and Switzerland
 * the asking is done by Google's own consent message (AdSense's Privacy & messaging), because Google
 * serves ads there only behind a certified TCF consent tool and the game's prompt is not one. That
 * message is shown by the AdSense script itself, so in those regions the script has to load before
 * anyone has been asked; it loads with ad requests paused, and Google's message decides what follows.
 * Everywhere else the game's own prompt (`consent.js`) asks, and the script is not put on the page
 * at all until it says advertising is allowed. "Reject all" there means no ad script, not
 * non-personalized ads, since those still set cookies the prompt said were off.
 *
 * Which region a visitor is in is first guessed from the browser's time zone, which needs no network,
 * and then settled by Google: once the script is up, its consent tool answers `gdprApplies`. A guess
 * that was wrong in either direction still ends asked: a European time zone outside the regulated
 * regions falls back to the game's prompt with ads still paused, and a regulated visitor with a
 * far-off time zone answers the game's prompt first and then Google's message as well. A script
 * that never arrives (a blocker, no network) settles on the game's prompt, which then loads nothing.
 *
 * `region` is what the menu reads: "pending" while Google is being asked, "google" when its message is
 * the one in charge, and "game" when the cookie prompt is.
 */

import { isAdvertisingAllowed, onConsentChange } from "./consent.js";

const CLIENT = "ca-pub-5961011900507264";
const SRC = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`;
// How long Google's consent tool has to answer before the game's prompt is shown instead.
const TCF_WAIT_MS = 6000;

// Time zones in the EEA, the UK and Switzerland, plus their neighbours in Europe/*. Only a guess:
// it decides whether to ask Google, and Google's answer is the one that counts.
const REGULATED_ZONES = /^(Europe\/|Atlantic\/(Azores|Madeira|Canary|Reykjavik|Faroe)$|Arctic\/Longyearbyen$|Asia\/(Nicosia|Famagusta)$)/;

let region = "pending";
let started = false;
let loaded = false;
const listeners = new Set();

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

function guessRegulated() {
  try {
    return REGULATED_ZONES.test(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
  } catch (e) {
    return false;
  }
}

const queue = () => (window.adsbygoogle = window.adsbygoogle || []);
const pause = () => { queue().pauseAdRequests = 1; };
const resume = () => { queue().pauseAdRequests = 0; };

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

// Asks Google's consent tool whether the GDPR applies to this visitor, once it is on the page.
function askGoogle(answer) {
  let done = false;
  const settle = (v) => { if (!done) { done = true; answer(v); } };
  const t0 = Date.now();
  (function poll() {
    if (done) return;
    if (typeof window.__tcfapi === "function") {
      window.__tcfapi("addEventListener", 2, (tc, ok) => {
        if (ok && tc && typeof tc.gdprApplies === "boolean") settle(tc.gdprApplies);
      });
    } else if (Date.now() - t0 > TCF_WAIT_MS) {
      settle(false);
      return;
    } else {
      setTimeout(poll, 200);
      return;
    }
    setTimeout(() => settle(false), TCF_WAIT_MS);
  })();
}

/** Once, from the entry point of a page that shows ads. */
export function startAds() {
  if (started || typeof window === "undefined") return;
  started = true;

  // The game's prompt is in charge: the script waits for its yes, and a later no stops new requests.
  const gameRules = () => {
    setRegion("game");
    const apply = () => {
      if (isAdvertisingAllowed()) { resume(); load(); } else if (loaded) pause();
    };
    apply();
    onConsentChange(apply);
  };

  if (!guessRegulated()) { gameRules(); return; }

  pause();
  load(() => gameRules());
  askGoogle((applies) => {
    if (region !== "pending") return;
    if (applies) { setRegion("google"); resume(); } else gameRules();
  });
}

/** Reopens Google's consent message, for "Cookie settings" where Google's message is in charge. */
export function openGoogleChoices() {
  const fc = (window.googlefc = window.googlefc || {});
  fc.callbackQueue = fc.callbackQueue || [];
  fc.callbackQueue.push(() => window.googlefc.showRevocationMessage());
}

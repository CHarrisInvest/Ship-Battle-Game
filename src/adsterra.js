/**
 * ADSTERRA — the banners on the main menu, one at its head and one at its foot.
 *
 * Only the main menu carries them. A match never does, and neither do the yard, the shops, the
 * records or the end-of-voyage screens. Each banner is created when the main menu appears and
 * thrown away when it goes, so coming back to the menu, from a voyage or from the yard, loads a
 * fresh ad. Nothing refreshes on a timer: a new ad only ever follows a captain's own move.
 *
 * Each size is its own Adsterra zone with its own key, read off the zone's code in the Adsterra
 * dashboard: the string in `atOptions.key`, which is also the folder in the `invoke.js` address.
 * While every key is empty nothing loads, and the cookie prompt and the privacy policy say nothing
 * of Adsterra, because both read `adsterraLive` rather than assuming. Filling a key in is the one
 * change that turns that size on.
 *
 * Adsterra's code reads a global `atOptions` and writes an iframe beside its own script tag, which
 * a React page can neither re-run nor hold two of at once. So each banner is that code exactly as
 * Adsterra issues it, inside a frame of its own (`bannerDoc`), and a new frame is a new ad.
 *
 * Who may see one depends on whose prompt asks (`ads.js`). Adsterra takes no signal for
 * non-personalized ads, so it is shown where consent is not needed first, and only behind a yes
 * where it is:
 *   - where the game's prompt asks and the time zone is not a European one, to everyone, the way
 *     Google's non-personalized ads are;
 *   - where the game's prompt asks but the time zone is European (Google did not say its message
 *     applies), only with the advertising switch on;
 *   - where Google's message asks, only if Adsterra is a vendor in that message
 *     (`ADSTERRA_TCF_VENDOR`) and the visitor agreed to it there. While that is null, never.
 */

import { isAdvertisingAllowed, onConsentChange } from "./consent.js";
import { getAdRegion, onAdRegion, onTcf, guessRegulated } from "./ads.js";

// One zone per size. Empty, that size is never served and the next smaller one that fits is used.
export const BANNER_KEYS = {
  "728x90": "",
  "468x60": "",
  "320x50": "",
};

// The host in the zone's code, `//<host>/<key>/invoke.js`. Change it if the dashboard's code differs.
const HOST = "www.highperformanceformat.com";

// Adsterra's ID on the IAB's Global Vendor List, once it is added as an ad partner in Google's
// consent message (AdSense, Privacy & messaging). Null, no banner is shown where that message asks.
export const ADSTERRA_TCF_VENDOR = null;

// Largest first, with the viewport each one needs. A 90px leaderboard on a sideways phone would take
// a quarter of the screen before the menu starts, so the larger two want height as well as width.
const SIZES = [
  { id: "728x90", w: 728, h: 90, minW: 768, minH: 600 },
  { id: "468x60", w: 468, h: 60, minW: 500, minH: 500 },
  { id: "320x50", w: 320, h: 50, minW: 320, minH: 0 },
];

export const adsterraLive = () => Object.values(BANNER_KEYS).some(Boolean);

/** The banner for a viewport of this size: `{ id, w, h, key }`, or null when none fits. */
export function pickBanner(vw, vh) {
  const s = SIZES.find((z) => BANNER_KEYS[z.id] && vw >= z.minW && vh >= z.minH);
  return s ? { id: s.id, w: s.w, h: s.h, key: BANNER_KEYS[s.id] } : null;
}

/** Adsterra's own banner code for one zone, as a document for a frame of its own. */
export function bannerDoc({ w, h, key }) {
  const opts = JSON.stringify({ key, format: "iframe", height: h, width: w, params: {} });
  return (
    "<!doctype html><html><head><meta charset=\"utf-8\">" +
    "<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}</style></head><body>" +
    `<script>atOptions = ${opts};</script>` +
    `<script src="https://${HOST}/${encodeURIComponent(key)}/invoke.js"></script>` +
    "</body></html>"
  );
}

let tcf = null;
onTcf((tc) => { tcf = tc; });

function tcfAllows() {
  if (ADSTERRA_TCF_VENDOR == null || !tcf) return false;
  return !!(tcf.purpose?.consents?.[1] && tcf.vendor?.consents?.[ADSTERRA_TCF_VENDOR]);
}

/** Whether this visitor may be shown an Adsterra banner now. */
export function adsterraAllowed() {
  if (!adsterraLive()) return false;
  const region = getAdRegion();
  if (region === "google") return tcfAllows();
  if (region === "game") return !guessRegulated() || isAdvertisingAllowed();
  return false; // still waiting to hear whether Google's message applies
}

/** Hears anything that could change `adsterraAllowed`. Returns the unsubscribe. */
export function onAdsterraChange(fn) {
  const offs = [onAdRegion(fn), onConsentChange(fn), onTcf(fn)];
  return () => offs.forEach((off) => off());
}

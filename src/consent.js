/**
 * CONSENT — what a player has allowed this site to store beyond the game itself.
 *
 * Three categories, the usual ones: essential, analytics and advertising. What sits under
 * "essential" is the hold (`hold.js`), which is the player's coins, ships and records. That is
 * storage the player asked for by playing, it is never gated on this answer, and rejecting
 * everything must never touch it. A "Reject all" that wiped a captain's yard would be a consent prompt doing the opposite
 * of its job.
 *
 * Advertising is read by `ads.js`, which puts the AdSense script on the page only once
 * `isAdvertisingAllowed` says yes, except in the regions where Google's own consent message asks
 * instead and this answer is never sought. No analytics are loaded, so that switch turns nothing on
 * yet; the day they are added they load only behind `isAnalyticsAllowed`, and a player who said no
 * has already been heard. `updateGoogleConsent` is the Google Consent Mode v2 call and does nothing
 * while there is no `gtag` on the page.
 *
 * The answer is kept in localStorage under its own key, apart from the hold, so scuttling the hold
 * does not ask the question again and answering it never rewrites the hold.
 */

const KEY = "sternchase.consent";

export const CONSENT_STATUS = {
  PENDING: "pending", // not asked yet, or asked and not answered
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  CUSTOM: "custom",
};

// Privacy first: everything optional is off until the player says otherwise.
const DEFAULT_CONSENT = {
  status: CONSENT_STATUS.PENDING,
  analytics: false,
  advertising: false,
  functionality: true, // essential, which is the hold, and always on
  timestamp: null,
};

const listeners = new Set();

export function getStoredConsent() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "null");
    if (parsed && typeof parsed.status === "string") {
      return { ...DEFAULT_CONSENT, ...parsed, analytics: parsed.analytics === true, advertising: parsed.advertising === true, functionality: true };
    }
  } catch (e) {
    // Storage blocked or the entry unreadable: treat it as not yet asked.
  }
  return DEFAULT_CONSENT;
}

function save(status, analytics, advertising) {
  const consent = {
    status,
    analytics: Boolean(analytics),
    advertising: Boolean(advertising),
    functionality: true,
    timestamp: new Date().toISOString(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(consent));
  } catch (e) {
    // Private browsing can refuse the write. The answer still holds for this visit.
  }
  updateGoogleConsent(consent);
  listeners.forEach((fn) => fn(consent));
  return consent;
}

/**
 * Google Consent Mode v2. A no-op until something puts `gtag` on the page.
 */
export function updateGoogleConsent(consent) {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag("consent", "update", {
    analytics_storage: consent.analytics ? "granted" : "denied",
    ad_storage: consent.advertising ? "granted" : "denied",
    ad_user_data: consent.advertising ? "granted" : "denied",
    ad_personalization: consent.advertising ? "granted" : "denied",
    functionality_storage: "granted",
    security_storage: "granted",
  });
}

export const acceptAllCookies = () => save(CONSENT_STATUS.ACCEPTED, true, true);
export const rejectNonEssential = () => save(CONSENT_STATUS.REJECTED, false, false);
export const setCustomConsent = (analytics, advertising) => save(CONSENT_STATUS.CUSTOM, analytics, advertising);

export const hasConsentDecision = () => getStoredConsent().status !== CONSENT_STATUS.PENDING;
export const isAnalyticsAllowed = () => getStoredConsent().analytics === true;
export const isAdvertisingAllowed = () => getStoredConsent().advertising === true;

/** Hears every answer as it is given, for whatever loads analytics or ads later. Returns the unsubscribe. */
export function onConsentChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearConsent() {
  try {
    localStorage.removeItem(KEY);
  } catch (e) {
    // nothing to clear
  }
}

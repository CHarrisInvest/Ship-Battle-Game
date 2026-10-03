/**
 * THE PRIVACY POLICY — what the site stores, where, and what a player can do about it.
 *
 * One text, read in two places: the in-game screen off the menu and the cookie prompt, and the page
 * at /privacy/, which is the address AdSense and Google's consent message are given. Each passes its
 * own `Section` so the words are written once and dressed the way the place around them is.
 *
 * Everything here has to stay true of the code. The hold and the consent answer live in
 * localStorage (`hold.js`, `consent.js`); ads load as `ads.js` says; analytics as `analytics.js`
 * says, and the analytics section follows `analyticsLive` so it changes the day a measurement ID goes
 * in; Adsterra's banners as `adsterra.js` says, following `adsterraLive` the same way. Change any of those and this changes the same day, with `PRIVACY_UPDATED` moved.
 */

import { analyticsLive } from "./analytics.js";
import { adsterraLive, ADSTERRA_TCF_VENDOR } from "./adsterra.js";

export const PRIVACY_UPDATED = "3 October 2026";

// Where a player writes about this policy. Empty, the line is left out rather than pointing nowhere.
export const PRIVACY_CONTACT = "sternchasegame@gmail.com";

const A = ({ href, children, color }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" style={{ color, textDecoration: "underline" }}>{children}</a>
);

export function PrivacyPolicy({ Section, P, linkColor }) {
  const L = (props) => <A color={linkColor} {...props} />;
  const measured = analyticsLive();
  const adsterra = adsterraLive();
  return (
    <>
      <P>
        Sternchase is a game you play in your browser at sternchase.org. There are no accounts, and the
        game has no server of its own. This page says what is stored, where it is kept, and what you can
        do about it.
      </P>

      <Section title="What the game saves">
        <P>
          Your coins, ships, ship names and records are saved in your browser's local storage on this
          device, so they are there the next time you play. They are never sent anywhere. This is
          essential to the game and is always on.
        </P>
        <P>Your cookie choices are saved the same way, kept apart from your progress, so you are not asked on every visit.</P>
        <P>
          To delete your progress and your cookie choices, clear this site's data in your browser's
          settings.
        </P>
      </Section>

      <Section title="Advertising">
        <P>
          The game is free to play because it shows ads from Google AdSense, and everyone sees them. What
          you choose is whether they are personalized, which means chosen from what Google knows of your
          interests.
        </P>
        <P>
          In the European Economic Area, the UK and Switzerland, Google's own consent message asks you. If
          you agree, the ads can be personalized. If you do not, Google shows limited ads where it can,
          which use no cookies and store nothing on your device.
        </P>
        <P>
          Everywhere else, the game's cookie prompt asks you, and ads are not personalized until you turn
          personalized ads on. Ads that are not personalized still use cookies, to limit how often you see
          the same ad, to measure ads and to detect fraud.
        </P>
        <P>
          Third-party vendors, including Google, use cookies to serve ads based on your previous visits to
          this site or other sites. Google's use of advertising cookies lets it and its partners serve ads
          to you based on your visits to this site and other sites on the internet. This applies to
          personalized ads only.
        </P>
        <P>
          You can turn off personalized ads from Google in <L href="https://myadcenter.google.com/">My Ad Center</L>,
          and turn off some other vendors' use of cookies for personalized ads
          at <L href="https://www.aboutads.info/choices/">aboutads.info</L>. Google explains how it uses
          information from sites like this one
          in <L href="https://policies.google.com/technologies/partner-sites">How Google uses information from sites or apps that use our services</L>.
        </P>
        {adsterra && (
          <>
            <P>
              The main menu also shows banner ads from Adsterra, one at the top and one at the bottom.
              They are never shown during a match or on any other screen, and a new one loads each time
              you return to the main menu. Adsterra's servers receive your IP address and details of your
              browser and device when a banner loads, and may set cookies to count views and clicks, to
              limit how often you see the same ad and to detect fraud. The game passes Adsterra nothing
              about you, and Adsterra does not receive your personalized ads choice.
            </P>
            <P>
              In the European Economic Area, the UK and Switzerland, Adsterra's banners are shown only if
              you agree to them: {ADSTERRA_TCF_VENDOR != null
                ? "in Google's consent message, where Adsterra is listed as an ad partner, or"
                : "where Google's consent message asks you, they are not shown at all, and"} where the
              game's prompt asks you instead, only with personalized ads turned on. Everywhere else they
              are shown to everyone.
            </P>
            <P>
              Adsterra explains how it handles the data in
              the <L href="https://adsterra.com/privacy-policy/">Adsterra Privacy Policy</L>.
            </P>
          </>
        )}
      </Section>

      <Section title="Analytics">
        {measured ? (
          <>
            <P>
              The game uses Google Analytics to count how it is played: which modes are entered, how
              voyages end, and figures like those.
            </P>
            <P>
              In the European Economic Area, the UK and Switzerland it is off unless you agree to it in
              Google's consent message, and nothing is sent before then. In Brazil it is off until you
              turn it on in the game's cookie prompt. Everywhere else it is on from your first visit, and
              you can turn it off at any time with the Analytics switch under Cookie settings.
            </P>
            <P>
              Google Analytics sets cookies to tell one visit from the next. It is set up not to use the
              data for advertising, with Google signals and ad personalization turned off, and it does
              not store your IP address. Google explains how it handles the data
              in <L href="https://policies.google.com/privacy">Google's Privacy Policy</L>.
            </P>
          </>
        ) : (
          <P>
            The game does not use any analytics yet. When it does, analytics will load only with your
            consent, and this page will say so first.
          </P>
        )}
      </Section>

      <Section title="Hosting">
        <P>
          The site is hosted on GitHub Pages. Like any web host, GitHub receives your IP address when your
          browser loads the site and may keep it in its logs for security. The game itself never sees it.
          The <L href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement">GitHub General Privacy Statement</L> says
          how GitHub handles it.
        </P>
      </Section>

      <Section title="Your choices">
        <P>
          Cookie settings, at the foot of the menu, lets you change your answer at any time. In the
          European Economic Area, the UK and Switzerland it opens Google's consent message instead of the
          game's prompt.
        </P>
        <P>
          If you turn personalized ads off, the ads you see from then on are not personalized.
          {measured && " If you turn analytics off, collection stops at once."}
        </P>
      </Section>

      <Section title="Changes and contact">
        <P>
          Last updated {PRIVACY_UPDATED}. When the game starts storing or loading anything new, this page
          changes first.
        </P>
        {PRIVACY_CONTACT && (
          <P>Questions about this policy: <L href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</L></P>
        )}
      </Section>
    </>
  );
}

/**
 * THE PRIVACY POLICY — what the site stores, where, and what a player can do about it.
 *
 * One text, read in two places: the in-game screen off the menu and the cookie prompt, and the page
 * at /privacy/, which is the address AdSense and Google's consent message are given. Each passes its
 * own `Section` so the words are written once and dressed the way the place around them is.
 *
 * Everything here has to stay true of the code. The hold is kept by the game server (`server/`), under
 * a guest account whose session cookie is the one thing of it in the browser, with each voyage's seed,
 * controls and result kept for its replay and cleared as `purge` says; the consent answer lives in
 * localStorage (`consent.js`); ads load as `ads.js` says; analytics as `analytics.js`
 * says, and the analytics section follows `analyticsLive` so it changes the day a measurement ID goes
 * in, and the Google Ads tag beside it following `conversionsLive`. Change any of those and this changes the same day, with `PRIVACY_UPDATED` moved.
 */

import { analyticsLive, conversionsLive } from "./analytics.js";

export const PRIVACY_UPDATED = "13 October 2026";

// Where a player writes about this policy. Empty, the line is left out rather than pointing nowhere.
export const PRIVACY_CONTACT = "sternchasegame@gmail.com";

const A = ({ href, children, color }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" style={{ color, textDecoration: "underline" }}>{children}</a>
);

export function PrivacyPolicy({ Section, P, linkColor }) {
  const L = (props) => <A color={linkColor} {...props} />;
  const measured = analyticsLive();
  const credited = conversionsLive();
  // The switch that controls both, named as the cookie prompt names it.
  const switchName = measured || !credited ? "Analytics" : "Ad measurement";
  return (
    <>
      <P>
        Sternchase is a game you play in your browser. Your progress is kept on the game's own server,
        under an account the game makes for you the first time you play. This page says what is
        stored, where it is kept, and what you can do about it.
      </P>

      <Section title="What the game saves">
        <P>
          Your coins, ships, ship names and records are kept on the game's server, so they are there the
          next time you play. The first time you play, the game makes you a guest account. It holds no
          name or email of yours: only a random identifier, and a placeholder name and address the
          account system fills in itself. Your browser keeps a cookie that says which
          account is yours. That cookie is essential to the game and is always on: without it the game
          could not find your progress.
        </P>
        <P>
          So that the server can check what a voyage earned, it keeps, for each voyage you sail, the
          random number it started from, the ship you sailed as she was fitted, the controls you used
          (the stick, the fire buttons and the repairs, and nothing else from your device) and how it
          ended.
        </P>
        <P>
          With your session, the server records the IP address your requests came from and the name
          your browser gives itself (its user agent), and keeps them as long as the session. Separately,
          it counts requests by address, in memory only, to stop one address making accounts without end.
        </P>
        <P>
          A guest account that goes unused for 90 days is deleted, with its progress and its voyages.
          The controls kept for a voyage are deleted 30 days after it ends; the rest of a voyage is
          kept as long as the account.
        </P>
        <P>
          The server and its database run on Railway, in the United States. Your browser reaches them
          through Vercel, which also serves the game. Neither uses what is stored for anything but
          running the game.
        </P>
        <P>
          When you sail with friends, the captains in your lobby see the name of the ship you sail, and
          your browser connects to the game server directly rather than through Vercel, so the server
          sees your IP address on that connection too. Who is in a lobby is kept in the server's memory
          only. If your connection drops, your place is held for 2 minutes so you can come back to it,
          and it goes when you leave or the lobby empties.
        </P>
        <P>Your cookie choices are saved in your browser's local storage, apart from your progress, so you are not asked on every visit.</P>
        <P>
          To have your account and everything kept with it deleted,
          write to <L href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</L>. Clearing this site's data
          in your browser removes the cookie, after which the game makes you a new account and the old
          one is deleted 90 days later.
        </P>
      </Section>

      <Section title="Advertising">
        <P>
          The game is free to play because it shows ads from Google AdSense, and everyone sees them. They
          are the only ads on the site. What you choose is whether they are personalized, which means
          chosen from what Google knows of your interests.
        </P>
        <P>
          In the European Economic Area, the UK and Switzerland, Google's own consent message asks you.
          Google works out from your connection whether that applies; the game does not look up where
          you are. If you agree, the ads can be personalized. If you do not, Google shows limited ads
          where it can, which use no cookies and store nothing on your device.
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
      </Section>

      <Section title="Analytics">
        {measured && (
          <>
            <P>
              The game uses Google Analytics to count how it is played: which modes are entered, how
              voyages end, and figures like those.
            </P>
            <P>
              Google Analytics sets cookies to tell one visit from the next. It is set up not to use the
              data for advertising, with Google signals and ad personalization turned off, and it does
              not store your IP address.
            </P>
          </>
        )}
        {credited && (
          <P>
            The game advertises itself on Google, and uses the Google Ads tag to learn which of those
            ads bring players in. If you arrived by tapping one of them, the tag stores a cookie with an
            ID for that click, so the visit can be counted for the ad. It is not used to choose ads for
            you, and the game does not use it to follow you onto other sites.
          </P>
        )}
        {(measured || credited) ? (
          <>
            <P>
              In the European Economic Area, the UK and Switzerland {measured && credited ? "both are" : "it is"} off
              until you agree in Google's consent message, and nothing is sent before then. Everywhere else {measured && credited ? "both are" : "it is"} on
              from your first visit, and you can turn {measured && credited ? "them" : "it"} off at any
              time with the {switchName} switch under Cookie settings.
            </P>
            <P>
              Google explains how it handles the data
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
          {(measured || credited) && ` If you turn ${switchName.toLowerCase()} off, collection stops at once.`}
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

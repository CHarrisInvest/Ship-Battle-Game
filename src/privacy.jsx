/**
 * THE PRIVACY POLICY — what the site stores, where, and what a player can do about it.
 *
 * One text, read in two places: the in-game screen off the menu and the cookie prompt, and the page
 * at /privacy/, which is the address AdSense and Google's consent message are given. Each passes its
 * own `Section` so the words are written once and dressed the way the place around them is.
 *
 * Everything here has to stay true of the code. The hold and the consent answer live in
 * localStorage (`hold.js`, `consent.js`); ads load only as `ads.js` says. Change one of those and
 * this changes the same day, with `PRIVACY_UPDATED` moved.
 */

export const PRIVACY_UPDATED = "3 October 2026";

// Where a player writes about this policy. Empty, the line is left out rather than pointing nowhere.
export const PRIVACY_CONTACT = "";

const A = ({ href, children, color }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" style={{ color, textDecoration: "underline" }}>{children}</a>
);

export function PrivacyPolicy({ Section, P, linkColor }) {
  const L = (props) => <A color={linkColor} {...props} />;
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
          The game shows ads from Google AdSense. Ads load only after you have agreed to them, and how you
          are asked depends on where you are. In the European Economic Area, the UK and Switzerland,
          Google's own consent message asks you. Everywhere else the game's cookie prompt asks you, and
          with advertising turned off there, no ads are loaded at all.
        </P>
        <P>
          Third-party vendors, including Google, use cookies to serve ads based on your previous visits to
          this site or other sites. Google's use of advertising cookies lets it and its partners serve ads
          to you based on your visits to this site and other sites on the internet.
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
        <P>
          The game does not use any analytics. If that changes, analytics will load only with your
          consent, and this page will say so first.
        </P>
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
        <P>If you turn advertising off after ads have loaded, no more are requested, and none load on your next visit.</P>
      </Section>

      <Section title="Changes to this policy">
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

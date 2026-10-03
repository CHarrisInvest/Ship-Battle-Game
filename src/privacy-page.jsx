/**
 * The page at /privacy/: the policy in `privacy.jsx` on a plain page of its own, in the menu's
 * colours, with a way into the game. It loads nothing else, no ads among it.
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { PrivacyPolicy } from "./privacy.jsx";

const GOLD = "#e8c877";
const INK = "#eef4f2";
const DISPLAY = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
const UI = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const Section = ({ title, children }) => (
  <section style={{ marginTop: 24 }}>
    <h2 style={{ fontFamily: UI, fontSize: 12, fontWeight: 400, letterSpacing: 1, textTransform: "uppercase", color: INK, margin: "0 0 4px" }}>{title}</h2>
    {children}
  </section>
);
const P = ({ children }) => <p style={{ margin: "8px 0", lineHeight: 1.65 }}>{children}</p>;

function Page() {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "calc(32px + env(safe-area-inset-top, 0px)) 16px calc(40px + env(safe-area-inset-bottom, 0px))" }}>
      <a href="/" style={{ fontFamily: UI, fontSize: 12, color: "rgba(238,244,242,0.78)", textDecoration: "none" }}>Play Sternchase</a>
      <h1 style={{ fontFamily: DISPLAY, fontWeight: 400, fontSize: 28, color: GOLD, letterSpacing: 0.5, margin: "16px 0 8px" }}>PRIVACY POLICY</h1>
      <PrivacyPolicy Section={Section} P={P} linkColor={GOLD} />
    </main>
  );
}

document.body.style.cssText = `margin:0;background:#0f3b39;color:rgba(238,244,242,0.82);font-family:${UI};font-size:13px;-webkit-text-size-adjust:100%;text-size-adjust:100%`;
createRoot(document.getElementById("root")).render(<Page />);

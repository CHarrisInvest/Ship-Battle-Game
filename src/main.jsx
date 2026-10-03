import React from "react";
import { createRoot } from "react-dom/client";
import SternchaseIso from "./SternchaseIso.jsx";
import "./index.css";
import { startAds } from "./ads.js";

// Before the first render, so a visitor whose ads are Google's to ask about is asked as early as possible.
startAds();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <SternchaseIso />
  </React.StrictMode>
);

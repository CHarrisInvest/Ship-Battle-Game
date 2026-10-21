import React, { Fragment, useRef, useState, useEffect, useCallback, useMemo } from "react";
import { platePainter } from "./galleon.js";
import {
  getHold, subscribeHold, modeRecord, shipLoadout, shortfall, connect, holdStatus, subscribeStatus, hadLocalSave, adoptHold, holdSettled, hasProgress,
  buyShip, buyPart, fitMast, fitSail, fitStud, fitGun, unfitGun, setActiveShip, spareParts, ownedShips, partOf,
  shipName, nameShip, fitOwned, ownedFill, NAME_LIMIT, readiness, sellPart, refundOf,
} from "./hold.js";
import { startVoyage, recorderFor } from "./voyage.js";
import { getAccount, sendCode, signInWithCode, signInWithGoogle, signOut, deleteAccount, returnedFromGoogle } from "./account.js";
import { connectOnline, ONLINE_FAILED } from "./online.js";
import { call } from "./net.js";
import {
  kindOf, rate, rateOf, rigSpec, ladderHeight,
  HULLS, HULL_LIST, PARTS, statBand, maximumLoadout, outfitCost,
  mastsForSocket, sailsForBerth, studsForBerth, gunsForMount,
  knots, berthEffect, familyOf, gunTons, gunFits, gunEffect, cheapestCanvas, handlingScore, handlingPoints,
} from "./shipyard.js";
import { roll, tally, progressParts } from "./achievements.js";
import { getStoredConsent, hasConsentDecision, acceptAllCookies, rejectNonEssential, setCustomConsent } from "./consent.js";
import { getAdRegion, onAdRegion, openGoogleChoices } from "./ads.js";
import { analyticsLive, conversionsLive, measurementLive, track } from "./analytics.js";
import { PrivacyPolicy } from "./privacy.jsx";
import {
  createWorld, step, TICK, voyageStats, repairQuote, shipOf, playOn, playsOn, outInWeather, stormPhase, volleyWindow, reloadOf, canFire,
  HULL_PATCH_CAP, MAST_JURY_CAP, barsOf, MODES as RULES, MODE_LIST, modeOf, clamp, SIDES, SIDE_MIN, SIDE_MAX,
} from "./sim/index.js";
import { C, UI, SIDE_COLORS, CAPTAIN_TIMBER } from "./render/palette.js";
import { createRenderer } from "./render/renderer.js";
import { createFx, fxEvents, stepFx } from "./render/effects.js";
import { HUD, radarRight } from "./render/hud.js";
import { useControls } from "./input/controls.js";

/**
 * three.js, in a chunk of its own (`render3d/index.js`). It is asked for once the screen has
 * mounted, so the first paint never waits on it: until it arrives the sea is the 2D one and the
 * plate is `drawGalleon`, and both hand over to the 3D ones when it does. Every visitor asks for
 * it and runs the same code. `three3d` is the module once it is here, and null until then (or for
 * good, if the chunk could not be fetched, in which case the 2D picture simply stays).
 */
let three3d = null;
let three3dLoad = null;
function loadThree() {
  if (!three3dLoad) {
    three3dLoad = import("./render3d/index.js")
      .then((m) => (three3d = m))
      .catch(() => null);
  }
  return three3dLoad;
}

/** The plate's ship painted flat by drawGalleon: what shows until three.js arrives, or without it. */
function flatMenuShip(canvas) {
  const ctx = canvas.getContext("2d");
  const paint = platePainter();
  let w = canvas.width, h = canvas.height, dpr = 1;
  return {
    kind: "2d",
    resize(cw, ch, r = 1) {
      w = cw; h = ch; dpr = r;
      canvas.width = Math.round(cw * r);
      canvas.height = Math.round(ch * r);
      paint.reset();
    },
    draw(spec, deg) {
      paint(ctx, w, h, dpr, deg, spec);
    },
    dispose() {},
  };
}

/**
 * STERNCHASE: HELM & HULL — pirate battles at sea, on a tilted (isometric-ish) sea with tall wooden
 * ships. "Broadside" survives in the engine as the name of the side guns, which is the job it was
 * always doing in the simulation; the game's own name is Sternchase.
 *
 * THIS FILE IS THE SCREEN, AND NOT THE GAME'S RULES. It holds the menus, the shipyard's screens,
 * the HUD, the end screen, and the frame loop that joins the three parts beside it: the engine in
 * `sim/`, which decides everything that happens in a round and runs as well in Node as here, the
 * renderer in `render/`, which draws a world and never changes one, and the controls in `input/`.
 * The hold, analytics and the end screen's words are reached from here, never from the engine.
 *
 * WAVE ARENA: endless survival. One hunter to start, a stock ship a shade under the player's own;
 * kills bring reinforcements in from the edge of the map, well clear of your bow, 1-2-1-2 and then
 * two a kill, and every second kill the next rung of the stock ladder comes out of the horizon,
 * until the hunters have caught her up. From there the fight is numbers.
 * LADDER ARENA: one ship at a time, the whole stock fleet in order from the plain gundalow to the
 * fully found first rate. Sink one and the next sails in. Sink the last and the round is won.
 * FREE-FOR-ALL: up to 10 rival captains, equal start, opening on the nearest hull before they start
 * shopping for weak prey, loosing the odd volley at whatever drifts into the arc, and turning on a
 * runaway leader. Last afloat wins.
 * Every AI reloads on the same clock as the player, in every mode.
 *
 * NOBODY UPGRADES AT SEA. A ship is what she was when she sailed, and what she is comes from the
 * shipyard between voyages (`shipyard.js`), which is where a captain's money now goes. What a purse
 * buys during a round is repairs and nothing else, and it buys them out of the voyage's own takings:
 * every coin spent patching her is a coin that does not reach the hold. Every mode opens her purse at
 * nothing, so the first patch of a round is always paid for by something she did in it. So the stat
 * functions in `sim/ships.js` read only her damage, not any notion of a level, and their shape is
 * the seam the shipyard's `rate()` plugs into when the modes are reworked.
 */

const DISPLAY = 'Georgia, "Iowan Old Style", "Times New Roman", serif';

const REPAIRS = [
  { key: "hull", label: "HULL", sub: "planks and pitch, back to 80%", color: C.hull, whole: "Sound" },
  { key: "mast", label: "MAST", sub: "new mast at sea, 90% strength", color: C.mast, whole: "Sound" },
];

/**
 * What each mode is called and how its card sells it: the menu's half of a mode, beside the menu,
 * where the engine's half is its rules in `sim/modes.js`. `MODES` is the two put back together, for
 * the screens that read both, the menu cards and the records.
 */
const MODE_COPY = {
  wave: {
    title: "WAVE ARENA",
    short: "wave",
    color: C.side,
    desc: "Endless survival. One hunter to start but their numbers grow. Each ship you sink brings more in from the horizon. Patch up between waves, out of what you have taken. Score by ships sunk.",
    unsailed: "No wave has come for you here yet.", // the log, where a mode has no voyages in it
  },
  ladder: {
    title: "LADDER ARENA",
    short: "ladder",
    // The hull bar's amber, which the menu's dark grounds carry at better than 5 to 1; it sits
    // between the wave arena's gold and the derby's red, and the two arenas read as a pair.
    color: C.hull,
    desc: "One ship at a time. Start with the weakest ships and work up through ranks. Sink one and the next sails in. Patch up between rungs, out of what you have taken. Score by rungs climbed.",
    unsailed: "You have not set foot on the ladder.",
  },
  ffa: {
    title: "FREE-FOR-ALL",
    short: "free-for-all",
    color: C.mast,
    desc: "Last afloat wins. 10 other captains with each ship rivaling your own, hunting for weak prey and turning on whoever pulls ahead. Spend what you take on repairs, or keep it. A storm closes in that takes the crew of any ship caught.",
    unsailed: "You have not taken on the ten.",
  },
  derby: {
    title: "DEMOLITION DERBY",
    short: "derby",
    color: C.crew,
    desc: "Only one hand needed. Last afloat wins. 10 captains with similar ships. No guns, no repairs. Sink ships by ramming. Drive into enemy sides, face charging ships. Time afloat is paid and a storm closes in that takes the crew of any ship caught.",
    unsailed: "Untried. Nothing in there but iron and weather.",
  },
};
const MODES = Object.fromEntries(MODE_LIST.map((k) => [k, { ...RULES[k], ...MODE_COPY[k] }]));

// What an achievement's tag can name: a mode, or the pair of arenas for the ones that count both.
// A row in `achievements.js` says `mode: "arenas"` and the card reads it from here rather than
// from `MODES`, because the pair is not a mode a captain can sail. Sand rather than either arena's
// own colour, so the tag does not claim one of them; it carries the dark grounds at 6 to 1.
const TAGS = { ...MODES, arenas: { short: "all arenas", color: C.sand } };

const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
// Grouped, because a lifetime tally runs to five figures and 41203 is a number nobody reads at a
// glance. `fmtCoins` is the same thing under the name the purse uses.
const fmtNum = (n) => Math.round(n || 0).toLocaleString();
const fmtCoins = fmtNum;

// The one captain at this screen, by the id the engine knows her by. A round has one human in it,
// and she is this one: every input record, every HUD figure and the end screen are hers.
const ME = "p1";

// The end screen's sentence, picked from how the round ended. Copy is the screen's job and the engine
// never carries it: it says only who won and, for whoever sank, which way she went.
const WON_LAST = "You are the last hull afloat.";
const WON_LADDER = "Every ship in the fleet is on the bottom, from the plain gundalow to the fully found first rate.";
// Four different shapes on purpose. Written to one template they read as filled-in slots, however
// good the words are. The last is the round nobody survived: she and the last rival went down in
// the same moment, which is a sinking and not a win.
const SUNK_LINE = {
  together: "Nobody is left afloat. She and the last of them went down together.",
  storm: "The squall has your crew, and she founders in the weather.",
  hull: "Your hull is breached. She goes under.",
  crew: "Crew routed. You strike your colors.",
};
// How a round between sides ended for her. Won afloat, won from the bottom, lost, and the round
// both sides went under in together, which nobody won. The note is what the SUNK screen says while
// her side is still fighting: the round is not over for her purse until it is over for her side.
const SIDE_LINE = {
  wonAfloat: "The other side has no ship left afloat, and yours is still standing. The whole purse is yours.",
  wonSunk: "You went under before the end, but your side carried the day. A share of the purse is yours.",
  lost: "The other side still has ships afloat, and yours has none.",
  together: "Both sides went under in the same moment. Nobody won.",
};
const SIDE_FIGHTS_ON = "Your side fights on. The round ends when one side has no ship left, and what you banked is counted then.";

// A seed for the sea behind the menu, a round laid out and never sailed. A voyage's seed is the
// server's: the engine is handed it and never reaches for `Math.random`, so the server's replay of
// the round is the round she sailed.
const newSeed = () => (Math.random() * 2 ** 32) >>> 0;

/**
 * What the menu says when a voyage could not start, by the reason the server gave, and what it says
 * about the connection itself. Plain words: a captain needs to know what happened and what to do.
 */
const VOYAGE_REFUSED = {
  engine: "The game has been updated since this page opened. Reload the page to sail.",
  busy: "Your last voyage is still being counted. Try again in a moment.",
  offline: "The server cannot be reached, so no voyage can start. Your progress is safe.",
  refused: "The server would not start that voyage. Try again in a moment.",
};
const LINK_NOTE = {
  loading: "Loading your progress from the server.",
  blocked: "Your browser is blocking this site's cookies, so your progress cannot be kept. Allow cookies for this site to play.",
  offline: "The server cannot be reached. Your progress is safe, and the shop and voyages open again as soon as it answers.",
};
const MOVED_NOTE = "Your progress now saves to the server. Progress saved in this browser earlier could not be moved.";
const GOOGLE_NOTE = {
  google: "You are signed in with Google. Your progress is saved to your account.",
  failed: "Signing in with Google did not work. Try again, or sign in with an email code.",
};
const SAVING_NOTE = "Saving your changes to the server first.";
// a sentence opening on "the Frigate" opens on "The Frigate"
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

export default function App() {
  const canvasRef = useRef(null);
  const overlayRef = useRef(null); // the bars, guides, words and radar, flat over the 3D sea
  const gameRef = useRef(null); // the world: the round being sailed, or the one lying behind the menu
  const startRef = useRef(() => {});
  const syncRef = useRef(() => {});
  const liveRef = useRef(false); // a round is being sailed, rather than lying behind the menu
  const controls = useControls(ME); // her stick, fire buttons and repairs, as the engine reads them
  // which ship is hers: "p1" on a voyage of her own, and whichever the server says when sailing with friends
  const meRef = useRef(ME);

  const hudRef = useRef(null); // the safe-area box every control sits in; the canvas reads its insets
  const railRef = useRef(null); // the repair rail, faded by the loop when a ship sails under it
  const btnRefs = { broadside: useRef(null), bow: useRef(null), musket: useRef(null) };

  const [phase, setPhase] = useState("start");
  const [cookieAsk, setCookieAsk] = useState(false);
  // Whose prompt asks: the game's, or Google's consent message in the regions that need a certified
  // one (`ads.js`). Google's shows itself, so the game's waits until the region settles on "game".
  const [adRegion, setAdRegion] = useState(getAdRegion);
  useEffect(() => onAdRegion(setAdRegion), []);
  useEffect(() => {
    if (adRegion !== "game" || hasConsentDecision()) return;
    const t = setTimeout(() => setCookieAsk(true), 500);
    return () => clearTimeout(t);
  }, [adRegion]);
  // Where Google's message is in charge, "Cookie settings" reopens it rather than the game's prompt.
  const openCookies = () => (adRegion === "google" ? openGoogleChoices() : setCookieAsk(true));
  // Which of her ships the yard screens are looking at, and where the outfitter opens. The yard is
  // not bound to the ship she sails: the plate's arrows and the strip at the head of the yard turn
  // it to any hull she owns, and "Sail her" is a separate act. `null` follows the active ship.
  const [yardShip, setYardShip] = useState(null);
  const [outfitStart, setOutfitStart] = useState(null);
  const [mode, setMode] = useState("wave");
  const [result, setResult] = useState("");
  const [place, setPlace] = useState({ rank: 0, total: 0 });
  const [stats, setStats] = useState({ time: 0, kills: 0, dmg: 0, coins: 0, patches: 0, repaired: 0 });
  const [coins, setCoins] = useState(0);
  const [sunk, setSunk] = useState(0);
  const [left, setLeft] = useState(0);
  const [rank, setRank] = useState({ rank: 1, total: 1 });
  // Between sides, where the two fleets stand: her side's ships afloat and the other's, and how much
  // hull each has left, which is what the badge in the rank's place shows.
  const [sides, setSides] = useState(null);
  // What each repair would cost and put back, recomputed with the rest of the HUD so the rail prices
  // the patch she would get right now rather than the one she could have afforded a second ago.
  const [mend, setMend] = useState({});
  // The three bars, and what they are full at. Seeded from the ship the captain actually owns rather
  // than from a constant, so the HUD opens on her figures instead of flicking from a stock hull's to
  // hers on the first frame.
  const [ph, setPh] = useState(() => barsOf(shipLoadout(getHold())));
  const [phMax, setPhMax] = useState(() => barsOf(shipLoadout(getHold())));
  const [storm, setStorm] = useState({ closes: 0, out: false, phase: "waiting" });
  const [hold, setHold] = useState(getHold);
  const [banked, setBanked] = useState(0); // what the voyage on the end screen put in the hold
  const [bounty, setBounty] = useState(0); // ...and what the achievements it finished paid besides

  useEffect(() => subscribeHold(setHold), []);
  // The hold is the server's: sign in as a guest if need be, and load it. `link` is the connection,
  // so the menu can say when the hold is still loading or the server is out of reach.
  const [link, setLink] = useState(holdStatus);
  const [notice, setNotice] = useState("");
  // Sailing with friends: the connection, what the lobby screen shows of it, and whether the end
  // screen on show is for a round with friends.
  const onlineRef = useRef(null);
  const startOnlineRef = useRef(() => {});
  const [net, setNet] = useState(null);
  const [netNote, setNetNote] = useState("");
  const [onlineEnd, setOnlineEnd] = useState(false);
  // ...and how a round between sides ended for her, "won", "lost" or "draw", which picks the end
  // screen's headline; null while her side is still at it or in any other round
  const [sideEnd, setSideEnd] = useState(null);
  // Watching the rest of a round once she has sunk: whether there is a fight left to watch, the ship
  // the camera is on (its id in `watchRef`, which the frame loop reads), and how it ended.
  const [canWatch, setCanWatch] = useState(false);
  const [watching, setWatching] = useState({ name: "" });
  const [watchNote, setWatchNote] = useState("");
  const watchRef = useRef(null);
  const watchRefs = useRef({ start: () => {}, next: () => {}, stop: () => {} });
  const roundSeen = useRef(null);
  const pendingJoin = useRef(null);
  const onNet = useCallback((st) => {
    setNet(st);
    // a round has started: build its world and sail it
    if (st.round && st.round !== roundSeen.current) {
      roundSeen.current = st.round;
      startOnlineRef.current(st.round);
    }
    if (st.error) setNetNote(ONLINE_FAILED[st.error] || "Something went wrong with the connection.");
  }, []);
  const connecting = useRef(null);
  const openOnline = useCallback(async () => {
    setPhase("lobby");
    if (onlineRef.current && onlineRef.current.state.open) return;
    // one connection at a time: a second tap while the first is still opening waits for it
    if (connecting.current) return connecting.current;
    setNetNote("Connecting to the server.");
    connecting.current = connectOnline({ onChange: onNet });
    const c = await connecting.current;
    connecting.current = null;
    if (c.error) { setNetNote(ONLINE_FAILED[c.error]); return; }
    onlineRef.current = c;
    setNetNote("");
    setNet({ ...c.state });
    if (pendingJoin.current) { c.join(pendingJoin.current); pendingJoin.current = null; }
  }, [onNet]);
  const closeOnline = useCallback(() => {
    const c = onlineRef.current;
    if (c) { c.leave(); c.close(); }
    onlineRef.current = null;
    roundSeen.current = null;
    setNet(null);
    setNetNote("");
    setPhase("start");
  }, []);
  // What the server banked for her round with friends: shown on the end screen, kept in the hold.
  useEffect(() => {
    if (!net || !net.banked) return;
    adoptHold(net.banked);
    setBanked(net.banked.banked);
    setBounty(net.banked.bounty);
  }, [net && net.banked]);
  // An invite link carries the lobby's code: open the lobby screen and join it once the hold is in.
  // Without one, ask the server whether she still has a place in a lobby (the app was closed or the
  // phone locked mid-lobby): if she does, go straight back, and the server seats her again.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("join");
    if (code) {
      window.history.replaceState(null, "", window.location.pathname);
      pendingJoin.current = code.toUpperCase();
      connect().then(() => openOnline());
      return;
    }
    connect().then(async () => {
      const r = await call("GET", "/online/where");
      if (r.status === 200 && r.data && r.data.code) openOnline();
    });
  }, []);
  // Back on screen after the phone locked or the app was switched away: the connection is made again
  // at once rather than on its back-off, and the server puts her back where she was.
  useEffect(() => {
    const back = () => { if (document.visibilityState === "visible" && onlineRef.current) onlineRef.current.reconnectNow(); };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("pageshow", back);
    return () => { document.removeEventListener("visibilitychange", back); window.removeEventListener("pageshow", back); };
  }, []);
  useEffect(() => {
    const off = subscribeStatus(setLink);
    const google = returnedFromGoogle();
    connect().then(() => { if (hadLocalSave()) setNotice(MOVED_NOTE); else if (google) setNotice(GOOGLE_NOTE[google]); });
    return off;
  }, []);
  // Who she is signed in as, asked again whenever the hold is loaded afresh, which is what signing in
  // or out does. Null until the server says, and the menu shows no account row until it has.
  const [account, setAccount] = useState(null);
  useEffect(() => {
    if (link !== "ready") return;
    let live = true;
    getAccount().then((a) => { if (live && a) setAccount(a); });
    return () => { live = false; };
  }, [link]);

  // What the browser paints around the page: the strip behind a phone's clock and the bars Safari
  // tints to match a site, and the ground shown when a scroll rubber-bands past the edge. It is
  // the sea while a round runs and the menu's own dark ground everywhere else, because every
  // screen but the fight is that ground over the sea, and a sea-coloured band over a dark menu
  // read as a browser that had not caught up. Safari follows a change to the meta as it happens.
  useEffect(() => {
    const tint = phase === "playing" || phase === "watching" ? C.water : MENU_TINT;
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = tint;
    document.documentElement.style.background = tint;
    document.body.style.background = tint;
  }, [phase]);

  // The second line against the zoom, for the fight only. `touch-action` is the rule every element
  // carries, but iOS Safari has had versions that zoomed on a double tap regardless, and sideways
  // the counters sit exactly where a thumb drums. While a round is running, a second tap inside a
  // double-tap's window is cancelled at the touch, which is what stops the zoom, and a pinch is
  // refused outright. Nothing in the fight is driven by a click or wants zooming, so nothing is
  // lost; the menus and the yard are left alone, because a reader may pinch the small print there.
  useEffect(() => {
    if (phase !== "playing") return;
    let lastTap = 0;
    const onTouchEnd = (e) => {
      const now = e.timeStamp;
      // a touchend the browser has already committed to (a scroll under way) cannot be cancelled,
      // and asking anyway only leaves a complaint in the console
      if (now - lastTap < 350 && e.cancelable) e.preventDefault();
      lastTap = now;
    };
    const onGesture = (e) => e.preventDefault();
    document.addEventListener("touchend", onTouchEnd, { passive: false });
    document.addEventListener("gesturestart", onGesture, { passive: false });
    return () => {
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("gesturestart", onGesture);
    };
  }, [phase]);

  // The HUD's figures, read off the world: the frame loop asks at most every 0.09 s, and only when
  // something it shows has moved, so React hears of a hit and not of every frame.
  const syncHUD = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    const p = shipOf(g, meRef.current);
    setCoins(Math.floor(p.coins));
    setSunk(g.sunk);
    const aliveCount = g.ships.filter((s) => s.alive).length;
    if (g.rules.sides) {
      // the enemy afloat, and where the two fleets stand: ships and hull left on each side
      const tally = (mine) => g.ships.filter((s) => (s.side === p.side) === mine).reduce((t, s) => ({ ships: t.ships + (s.alive ? 1 : 0), hull: t.hull + (s.alive ? s.hull : 0), max: t.max + s.maxHull }), { ships: 0, hull: 0, max: 0 });
      const ours = tally(true), theirs = tally(false);
      setLeft(theirs.ships);
      setSides({ side: p.side, ours, theirs });
    } else {
      // her rivals, not every hull afloat: the pill that counts them used to count her as well, so a
      // fresh free-for-all read "11 left" under a card promising ten other captains
      setLeft(Math.max(0, aliveCount - (p.alive ? 1 : 0)));
    }
    setRank({ rank: p.rank || 1, total: g.aliveCount || aliveCount });
    if (g.rules.repairs) {
      const q = {};
      for (const r of REPAIRS) q[r.key] = repairQuote(g, meRef.current, r.key);
      setMend(q);
    }
    setPh({ hull: p.hull, mast: p.mast, crew: p.crew });
    setPhMax({ hull: p.maxHull, mast: p.maxMast, crew: p.maxCrew });
    if (g.rules.storm) {
      const w = g.rules.storm;
      setStorm({ closes: Math.max(0, w.grace - g.time), out: outInWeather(g, p), phase: stormPhase(g.time, w) });
    }
  }, []);
  syncRef.current = syncHUD;

  // A repair goes the same road as the stick: asked for here, carried out in the next step.
  const mendNow = useCallback((sys) => {
    const g = gameRef.current;
    if (!g || !liveRef.current || !g.rules.repairs) return;
    controls.ask(sys);
  }, [controls]);

  /**
   * THE FRAME LOOP: the one place the engine, the screen and React meet.
   *
   * Each frame it steps the world as many times as the time since the last frame pays for, reading
   * her controls once a step, hands what happened to the effects and to the end of the round, moves
   * the camera and the fire buttons, tells the HUD if anything it shows has moved, and draws. The
   * world is the engine's and `fx` is this screen's picture of it; the hold, analytics and the end
   * screen are reached from here and never from the engine.
   *
   * THE ROUND MOVES IN STEPS OF ONE `TICK` AND THE SCREEN DOES NOT. Real time is banked, a step is
   * taken for every whole tick in the bank, and what is left over says how far between the last
   * two steps to draw everything (`alpha`). So a round plays the same on a 60 Hz phone, a 120 Hz
   * one and a laptop, where it used to step by whatever the frame took and a fast screen took two
   * small steps where a slow one took one big one. A frame pays for at most five steps, so a tab
   * brought back from the background does not try to sail the minutes it missed: the bank is
   * emptied instead, and a phone dropping below twelve frames a second plays slower rather than in
   * jumps. The effects, the waves and the wind still run on the frame's own time, since nothing in
   * the round reads them.
   */
  useEffect(() => {
    // The sea in three dimensions, on the WebGL canvas with its overlay stacked over it. Where the
    // browser cannot give a canvas WebGL, the 2D sea draws on the overlay canvas instead, which the
    // 3D renderer leaves untouched until its own canvas is standing. Same calls either way.
    //
    // three.js comes in its own chunk (see `loadThree`): the 2D sea paints from the first frame and
    // the 3D one takes over the moment the chunk is here, or never, if this device cannot draw it.
    let renderer = three3d ? null : createRenderer(overlayRef.current);
    let gone = false;
    const take3d = (m) => {
      if (gone || !m) return false;
      try {
        renderer = m.createRenderer3d(canvasRef.current, overlayRef.current);
        return true;
      } catch {
        return false;
      }
    };
    if (!renderer && !take3d(three3d)) renderer = createRenderer(overlayRef.current);
    if (renderer.kind !== "3d") loadThree().then((m) => { if (take3d(m)) resize(); });
    let raf = 0,
      last = 0,
      bank = 0, // real time not yet stepped, in seconds
      // this viewer's picture of the round: smoke, wakes, words on the water, and how each ship looks
      fx = null;
    const MAX_STEPS = 5; // the most steps one frame may take

    // The page changed size. The canvas follows it, and the camera her, if there is a world to look at.
    function resize() {
      renderer.resize(hudRef.current?.getBoundingClientRect());
      const g = gameRef.current;
      if (g) renderer.follow(viewed(g));
    }

    /**
     * The ship the camera is on: hers, or the one she is watching once she has sunk. A watched ship
     * that goes under is kept in view a moment, so her sinking is seen, and then the camera moves
     * to the nearest ship still afloat.
     */
    let lostAt = 0;
    function viewed(g) {
      const id = watchRef.current;
      if (id == null) return shipOf(g, meRef.current);
      const s = g.ships.find((x) => x.id === id);
      if (s.alive) { lostAt = 0; return s; }
      if (!lostAt) lostAt = g.time;
      if (g.time - lostAt < 1.5) return s;
      const next = nearestAfloat(g, s);
      if (next) watchShip(g, next);
      return next || s;
    }

    // ...preferring a ship of her own side, between sides: the fight she wants to follow is hers
    function nearestAfloat(g, from) {
      let best = null, bd = Infinity;
      for (const s of g.ships) {
        if (!s.alive || s === from) continue;
        const d = ((s.x - from.x) ** 2 + (s.y - from.y) ** 2) * (from.side && s.side !== from.side ? 1e6 : 1);
        if (d < bd) { bd = d; best = s; }
      }
      return best;
    }

    // what she reads at the head of the screen: a friend's ship by the name she gave her, any other
    // by her class
    function shipLabel(s) {
      const friend = s.playerId && fx && fx.names && fx.names[s.playerId];
      return friend || `the ${s.loadout.hull.name}`;
    }

    function watchShip(g, s) {
      watchRef.current = s.id;
      lostAt = 0;
      setWatching({ name: shipLabel(s) });
    }

    // Her own round is over and banked; the fight goes on. Alone, she watches a copy of her round
    // the engine sails on without her. With friends, the round never stopped for her.
    function startWatch() {
      let g = gameRef.current;
      if (!g) return;
      // With friends the round is the server's until the last of them is out, and it stops there even
      // with AI ships still fighting. This browser holds the whole world, so from then on it sails
      // the rest itself, the way a voyage alone does.
      if (!isOnline(g) || g.result.over) {
        // the first time, the copy to watch; after "Stop watching", the same copy picked up again
        if (!g.watching) {
          const w = playOn(g);
          if (!w) return;
          gameRef.current = g = w;
        } else if (g.result.over) return;
        liveRef.current = true;
        last = 0;
        bank = 0;
      } else if (g.result.over) return;
      const first = nearestAfloat(g, shipOf(g, meRef.current));
      if (!first) return;
      watchShip(g, first);
      setPhase("watching");
    }

    // Each ship afloat in turn, in the order they were launched.
    function nextWatch() {
      const g = gameRef.current;
      if (!g || watchRef.current == null) return;
      const afloat = g.ships.filter((s) => s.alive && s.playerId !== meRef.current);
      if (!afloat.length) return;
      const after = afloat.find((s) => s.id > watchRef.current) || afloat[0];
      watchShip(g, after);
    }

    // Back to her end screen. Alone, the copy she was watching stops where it is; with friends the
    // round goes on, because the server is sailing it for everyone.
    function stopWatch() {
      const g = gameRef.current;
      watchRef.current = null;
      if (g && !isOnline(g)) {
        liveRef.current = false;
        setCanWatch(playsOn(g) || !!(g.watching && !g.result.over));
      }
      setPhase("dead");
    }

    // The fight she was watching is over: back to her end screen, which says who was left.
    function watchOver(g) {
      const last = g.ships.find((s) => s.alive);
      setWatchNote(last ? `${cap(shipLabel(last))} was the last ship afloat.` : "No ship was left afloat.");
      setCanWatch(false);
      watchRef.current = null;
      setPhase((ph) => (ph === "watching" ? "dead" : ph));
    }

    function isOnline(g) {
      const net = onlineRef.current;
      return !!(net && net.state.round && net.state.round.world === g);
    }
    watchRefs.current = { start: startWatch, next: nextWatch, stop: stopWatch };

    function updateButtons() {
      const p = shipOf(gameRef.current, meRef.current);
      for (const wk of ["broadside", "bow", "musket"]) {
        const el = btnRefs[wk].current;
        if (!el) continue;
        // A mount she has nothing on is held at a quarter: the button is there because the hull
        // bears the ports, and a captain who has not bought the guns should see that rather than tap
        // a live-looking control that does nothing.
        const armed = canFire(p, wk);
        const ratio = 1 - p.cd[wk] / reloadOf(p, wk);
        const fill = el.querySelector(".cd-fill");
        if (fill) fill.style.transform = `scaleX(${armed ? clamp(ratio, 0, 1) : 0})`;
        el.style.opacity = !armed ? "0.28" : p.cd[wk] > 0 ? "0.55" : "1";
      }
    }

    /**
     * The repair rail is a panel over the sea, and sideways it sits where the sea is fought on. It
     * fades when a ship sails under it, so what it is covering can be read, and comes back the
     * moment she is clear. The rail is DOM and the ships are canvas, so this is the one place the
     * two are compared: each ship is a circle of her own length on the screen, and the rail's box
     * is read off the element, which is cheap for one element and true whatever layout is up. The
     * opacity is written straight to the element, the way the joystick's knob is moved, because a
     * fade sixty times a second is not a thing to send through React.
     */
    let railFaded = false;
    function fadeRail() {
      const el = railRef.current;
      if (!el) { railFaded = false; return; } // a new round mounts a fresh rail, fully lit
      const g = gameRef.current;
      const under = !!g && liveRef.current && renderer.under(el.getBoundingClientRect(), g);
      if (under !== railFaded) {
        railFaded = under;
        el.style.opacity = under ? "0.3" : "1";
      }
    }

    function loop(ts) {
      if (!last) last = ts;
      const frame = (ts - last) / 1000;
      last = ts;
      const dt = Math.min(frame, 0.05); // the frame's own time, for what only decorates the sea
      renderer.tick(dt);
      const g = gameRef.current;
      let alpha = 1;
      if (g && liveRef.current) {
        bank += Math.min(frame, 0.25);
        const events = [];
        const net = onlineRef.current;
        if (net && net.state.round && net.state.round.world === g) {
          // Sailing with friends: her controls go to the server, and the world steps only on the
          // ticks the server sends back, at the pace real time pays for, catching up when frames
          // bunch on the wire. The server's world is the round; this one is stepped to match it.
          net.send(controls.read()[ME]);
          const behind = net.behind;
          let want = Math.floor(bank / TICK);
          if (behind > 9) want = Math.max(want, behind - 6);
          // back in a round after the connection dropped: the round so far, sailed through quickly
          want = Math.min(want, behind, behind > 300 ? 900 : 30);
          for (const e of net.advance(want)) events.push(e);
          // never expected (the engine steps to the same bits everywhere), but said if it happens
          if (net.state.round.desynced && !window.__sternchaseDesync) { window.__sternchaseDesync = true; console.warn("this round has parted company with the server's"); }
          bank = Math.min(Math.max(0, bank - want * TICK), 3 * TICK);
        } else {
          let steps = 0;
          // her controls are read once a step, so a repair she tapped is spent by the first of them
          while (bank >= TICK && steps < MAX_STEPS && !g.result.over) {
            const input = controls.read();
            if (recorder) recorder.record(g.tick, input[meRef.current]);
            for (const e of step(g, input)) events.push(e);
            bank -= TICK;
            steps++;
          }
          if (bank >= TICK) bank %= TICK; // behind by more than a frame can pay: let it go
        }
        alpha = g.result.over ? 1 : Math.min(1, bank / TICK);
        // what the steps did, drawn: the engine only said it happened
        fxEvents(fx, events);
        stepFx(fx, g, dt);
        renderer.follow(viewed(g), alpha);
        updateButtons();
        let hudNow = false;
        for (const e of events) {
          if (e.type === "repaired" && e.shipId === fx.me) hudNow = true; // the rail answers the tap
          if (onlineRef.current && onlineRef.current.state.round && onlineRef.current.state.round.world === g) {
            if (e.type === "player_out" && e.playerId === meRef.current) onlineOut(g, e);
            if (e.type === "round_over") {
              const won = e.result.winners.find((w) => w.playerId === meRef.current);
              liveRef.current = false;
              if (g.rules.sides) {
                // the round went to a side, hers or the other: her end screen says which, whether
                // she is still afloat or has been watching from the bottom
                const mine = won || e.result.losers.find((l) => l.playerId === meRef.current) || {};
                watchRef.current = null;
                onlineOut(g, { ...mine, won: !!won });
              } else if (won) onlineOut(g, { ...won, won: true });
              else if (watchRef.current != null && playsOn(g)) {
                // the last of her friends is out and the AI fight on: she watches on, sailed here
                gameRef.current = playOn(g);
                liveRef.current = true;
              } else if (playsOn(g)) setCanWatch(true);
              else watchOver(g);
            }
          } else if (e.type === "round_over") {
            if (g.watching) { liveRef.current = false; watchOver(g); }
            else endRound(g, e.result);
          }
        }
        hudAcc += dt;
        if (hudNow || hudAcc > 0.09) {
          const key = hudKey(g);
          if (hudNow || key !== hudLast) { syncRef.current(); hudLast = key; hudAcc = 0; }
        }
      }
      renderer.render(g, fx, { live: liveRef.current && watchRef.current == null, input: controls.input, alpha });
      fadeRail();
      raf = requestAnimationFrame(loop);
    }

    // What the HUD shows, as one string, so the loop can tell whether any of it has moved since React
    // last heard: her purse, the field, her rank, her three bars, and the weather's countdown, phase
    // and whether she is out in it. The repair rail is priced off the same purse and bars.
    let hudAcc = 0, hudLast = "";
    function hudKey(g) {
      const p = shipOf(g, meRef.current), w = g.rules.storm;
      return [
        Math.floor(p.coins), g.sunk, g.ships.filter((s) => s.alive).length, p.alive, p.rank, g.aliveCount,
        p.hull, p.mast, p.crew,
        // between sides, the hull the two fleets have left, to the point
        g.rules.sides ? g.ships.reduce((t, s) => t + (s.alive ? (s.side === p.side ? 1 : 1000) * Math.round(s.hull) : 0), 0) : 0,
        w ? Math.max(0, Math.ceil(w.grace - g.time)) : 0, w ? outInWeather(g, p) : false, w ? stormPhase(g.time, w) : "",
      ].join(",");
    }

    /**
     * The round is over: the end screen, the voyage banked, and the one analytics event that says how
     * it ended. The engine only said who won and how whoever sank went down; what that is worth, what
     * it is called and where it is written down is the screen's business, and happens once, here.
     */
    function endRound(g, result) {
      liveRef.current = false;
      const won = result.winners.some((w) => w.playerId === meRef.current);
      const mine = (won ? result.winners : result.losers).find((r) => r.playerId === meRef.current) || { rank: 0, cause: "hull" };
      if (g.rules.ranked) setPlace({ rank: mine.rank, total: result.field });
      const s = voyageStats(g, meRef.current);
      setStats(s);
      // A voyage banks once, at the end screen, whichever end it was. The engine ends a round once,
      // and the flag on the world is the guard behind that.
      if (!g.banked) {
        g.banked = true;
        // the server replays the voyage and banks what its replay says; until it answers the end
        // screen says it is counting, and if it refuses, that nothing was banked
        setBanked(null);
        setBounty(0);
        const rec = recorder;
        recorder = null;
        pendingFinish = rec.finish(g.tick).then((out) => {
          if (voyage !== g) return; // she has sailed again since
          if (out.ok) {
            adoptHold(out.data);
            setBanked(out.data.banked);
            setBounty(out.data.bounty);
          } else setBanked(false);
        });
        // What the privacy policy says Analytics counts: how voyages end. Nothing is sent without consent.
        track("voyage_end", { mode: g.mode, result: won ? "won" : "sunk", rank: mine.rank, kills: s.kills, seconds: Math.round(s.time) });
      }
      setResult(won ? (g.rules.ladder ? WON_LADDER : WON_LAST) : SUNK_LINE[mine.cause] || SUNK_LINE.crew);
      setCanWatch(!won && playsOn(g));
      setPhase(won ? "won" : "dead");
      syncRef.current();
    }

    // The sea behind the menu: her ship read fresh out of the hold, on a seed of its own.
    function newRound(m) {
      gameRef.current = createWorld({ mode: m, seed: newSeed(), players: [{ id: meRef.current, loadout: shipLoadout(getHold()) }] });
      fx = createFx(shipOf(gameRef.current, meRef.current).id);
    }

    // A voyage: the server's seed and the loadout off its copy of her hold, sent as the very JSON
    // its replay will build the world from, and a recorder for the controls she sails it with.
    let recorder = null;
    let voyage = null; // the world her voyage is banked off, which a round she watches after it is not
    let starting = false;
    let pendingFinish = Promise.resolve(); // the last voyage's finish, which a new one waits for
    async function start(m) {
      if (starting) return;
      starting = true;
      setNotice("");
      // her last voyage is banked before the next begins (starting one abandons any still open), and
      // the shop's changes reach the server first, so she sails the ship her screen shows
      await pendingFinish;
      if (!holdSettled()) {
        setNotice(SAVING_NOTE);
        for (let i = 0; i < 300 && !holdSettled(); i++) await new Promise((r) => setTimeout(r, 100));
        setNotice("");
      }
      const s = await startVoyage(m);
      starting = false;
      if (!s.ok) {
        setNotice(VOYAGE_REFUSED[s.reason]);
        setPhase("start");
        return;
      }
      const { round } = s;
      gameRef.current = voyage = createWorld({ mode: round.mode, seed: round.seed, players: [{ id: meRef.current, loadout: round.loadout }] });
      fx = createFx(shipOf(gameRef.current, meRef.current).id);
      recorder = recorderFor(round.roundId);
      resetWatch();
      renderer.follow(shipOf(gameRef.current, meRef.current));
      liveRef.current = true;
      controls.reset();
      last = 0;
      bank = 0;
      hudAcc = 0;
      hudLast = "";
      syncRef.current();
      setResult("");
      setBanked(0);
      setBounty(0);
      setMode(m);
      setSideEnd(null);
      setPhase("playing");
      // And which modes are entered.
      track("voyage_start", { mode: m });
    }
    startRef.current = start;

    /**
     * A round with friends begins: the world the server sent the seed and the captains for, built
     * here exactly as it built its own, and her ship the one it said is hers.
     */
    function startOnline(round) {
      gameRef.current = round.world;
      meRef.current = round.you;
      fx = createFx(shipOf(round.world, round.you).id);
      fx.names = round.names; // her friends' ship names, drawn over their ships
      recorder = null;
      resetWatch();
      renderer.follow(shipOf(round.world, round.you));
      liveRef.current = true;
      controls.reset();
      last = 0;
      bank = 0;
      hudAcc = 0;
      hudLast = "";
      syncRef.current();
      setResult("");
      setBanked(null);
      setBounty(0);
      setMode(round.mode);
      setOnlineEnd(false);
      setSideEnd(null);
      setWatchNote("");
      setPhase("playing");
      track("voyage_start", { mode: "online", field: round.mode });
    }
    startOnlineRef.current = startOnline;

    function resetWatch() {
      watchRef.current = null;
      setCanWatch(false);
      setWatchNote("");
    }

    /**
     * She is out of the round with friends, sunk or the last afloat: the end screen, over the sea.
     * Between sides it is shown twice over if she sinks first: once for her sinking, with her side
     * still fighting and her purse still open, and again when the round goes to a side.
     */
    function onlineOut(g, out) {
      const s = voyageStats(g, meRef.current);
      setStats(s);
      if (g.rules.sides) {
        const me = shipOf(g, meRef.current), r = g.result;
        if (!r.over) { setResult(SUNK_LINE[out.cause] || SUNK_LINE.crew); setWatchNote(SIDE_FIGHTS_ON); setSideEnd(null); }
        else {
          setWatchNote("");
          if (r.side === null) { setResult(SIDE_LINE.together); setSideEnd("draw"); }
          else if (out.won) { setResult(me.alive ? SIDE_LINE.wonAfloat : SIDE_LINE.wonSunk); setSideEnd("won"); }
          else { setResult(SIDE_LINE.lost); setSideEnd("lost"); }
        }
        setPlace({ rank: 0, total: 0 });
        setCanWatch(!me.alive && !r.over);
        setOnlineEnd(true);
        setPhase(out.won ? "won" : "dead");
        if (r.over) track("voyage_end", { mode: "online", field: "teams", result: out.won ? "won" : r.side === null ? "draw" : "lost", kills: s.kills, seconds: Math.round(s.time) });
        syncRef.current();
        return;
      }
      setPlace({ rank: out.rank, total: g.ships.length });
      setResult(out.won ? WON_LAST : SUNK_LINE[out.cause] || SUNK_LINE.crew);
      setCanWatch(!out.won && !g.result.over);
      setOnlineEnd(true);
      setPhase(out.won ? "won" : "dead");
      track("voyage_end", { mode: "online", result: out.won ? "won" : "sunk", rank: out.rank, kills: s.kills, seconds: Math.round(s.time) });
      syncRef.current();
    }

    resize();
    // the sea behind the menu: a round laid out and never sailed
    newRound("wave");
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(loop);
    return () => {
      gone = true;
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
      renderer.dispose?.();
    };
  }, []);

  const rules = modeOf(mode);
  const box = useBox(hudRef);
  const wide = box.w > box.h;

  // The counters: her purse, the field, and the weather. One set of pills, placed by the layout.
  const pills = (
    <>
      <Pill label={`${fmtCoins(coins)} coins`}><CoinIcon /><span>{fmtCoins(coins)}</span></Pill>
      {rules.ladder ? (
        // her score and her place on it in one pill: the rung she is on is the ship she is fighting,
        // and the count of hunters would always read one
        <Pill label={`rung ${Math.min(sunk + 1, ladderHeight())} of ${ladderHeight()}`}>
          <SunkIcon /><span>rung {Math.min(sunk + 1, ladderHeight())} of {ladderHeight()}</span>
        </Pill>
      ) : rules.reinforcements ? (
        <>
          <Pill label={`${sunk} sunk`}><SunkIcon /><span>{sunk}</span></Pill>
          <Pill label={`${left} hunting you`}><ShipIcon /><span>{left} hunting</span></Pill>
        </>
      ) : rules.sides ? (
        <Pill label={`${left} enemy ships left`}><ShipIcon /><span>{left} enemy</span></Pill>
      ) : (
        <Pill label={`${left} rivals left`}><ShipIcon /><span>{left} left</span></Pill>
      )}
      {rules.storm && <StormPill storm={storm} />}
    </>
  );

  // The repair rail, where the upgrade rail used to be. Two buttons, and each prices the work she
  // would get this second rather than a list price. The hull can be part paid, so it shows what her
  // purse actually buys; the mast cannot, so it shows the whole price whether she has it or not,
  // because a figure she is saving towards is more use than the word "no". A button with nothing to
  // do says which of the two reasons it is.
  const rail = rules.repairs && REPAIRS.map((t) => {
    const q = mend[t.key] || { whole: true, afford: 0, cost: 0, part: false };
    const can = !q.whole && q.afford > 0;
    const part = can && q.part && q.afford < q.cost; // her purse buys some of this bill, not all
    const price = can ? q.afford : q.cost; // what she would pay now, or what she is saving for
    return (
      // A dimmed button keeps its own ground and dims only what is written on it. Fading the whole
      // control put a half-transparent panel over a 50%-alpha ground, which came to a quarter
      // opaque: the sea showed straight through, and 8px of label landed on an island and stopped
      // being readable. The border goes neutral to say it is dead.
      <button
        key={t.key}
        disabled={!can}
        onPointerDown={(e) => { e.preventDefault(); mendNow(t.key); }}
        style={{ flex: "1 1 0", minWidth: 0, borderRadius: 10, border: `1px solid ${can ? t.color : C.hair}`, background: C.panel, color: C.ink, padding: "5px 4px", cursor: can ? "pointer" : "default", WebkitTapHighlightColor: "transparent" }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, opacity: can ? 1 : 0.6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: t.color }}>{t.label}</span>
          <span style={{ fontSize: 8, color: "rgba(238,244,242,0.55)", textAlign: "center", lineHeight: 1.25 }}>{t.sub}</span>
          <span style={{ fontSize: 9, color: q.whole ? "rgba(238,244,242,0.6)" : can ? C.gold : "rgba(232,200,119,0.5)", display: "inline-flex", alignItems: "center", gap: 3 }}>
            {/* A part payment names the whole bill beside it. "18 part" left a captain to work out
                what part of what; "18 of 79" is the same width and answers it. */}
            {q.whole ? q.label || t.whole : <><CoinIcon size={9} />{part ? `${fmtCoins(price)} of ${fmtCoins(q.cost)}` : fmtCoins(price)}</>}
          </span>
        </div>
      </button>
    );
  });

  return (
    // `manipulation` rather than `none`, and the difference matters: this div is the ancestor of every
    // shop and menu screen, and a `none` up the chain can stop the one under a finger from scrolling.
    // The sea takes `none` instead, on the canvas, which is where it belongs.
    <div
      style={{ position: "relative", width: "100%", height: "100dvh", overflow: "hidden", background: C.water, userSelect: "none", WebkitUserSelect: "none", touchAction: "manipulation", fontFamily: UI }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* The play surface swallows the lot: no pan, no pinch, no double-tap zoom. A finger on the sea
          is steering or it is nothing, and a gesture landing here mid-fight is never what was meant. */}
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", touchAction: "none" }} />
      {/* The overlay over the 3D sea: the bars over each ship, the aiming guides, the words on the
          water, the storm's edge, the vignette and the radar. It takes no touches of its own, so a
          finger on it is a finger on the sea, and says `none` for the same reason the sea does. */}
      <canvas ref={overlayRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", touchAction: "none", pointerEvents: "none" }} />

      {/* Every control sits inside this box, which is the screen less the phone's notch, corners
          and home bar, so nothing lands under them when the game runs full screen from the home
          screen. It is always mounted, empty between rounds, because the canvas reads its insets
          on resize to place the radar by the same edges. The box lets touches through to the sea,
          and each group of controls turns them back on for itself. */}
      {/* `touch-action: none` here rather than `manipulation`, and it is allowed here: this box holds
          the fight's controls and nothing else, so no menu is under it to lose its scroll. Every
          pill, bar and rail button inherits the intersection, which is `none`, and so a thumb
          landing twice on the counters, which sideways sit where the thumbs are, is two taps and
          never a zoom. The canvas, the joystick and the fire buttons already said so for themselves. */}
      <div ref={hudRef} style={{ position: "absolute", top: "env(safe-area-inset-top, 0px)", right: "env(safe-area-inset-right, 0px)", bottom: "env(safe-area-inset-bottom, 0px)", left: "env(safe-area-inset-left, 0px)", pointerEvents: "none", touchAction: "none" }}>
      {phase === "playing" && (
        <>
          {wide ? (
            // Sideways: the rank and the bars in the top left, and beside them, in the room
            // between the bars and the radar, a column of two rows: the counters, wrapping if the
            // screen is narrow, and the repair rail under them filling the same width.
            <div style={{ position: "absolute", top: 8, left: HUD.pad, right: radarRight(box.w, box.h, rules.guns) + HUD.radar + HUD.pad, display: "flex", gap: 6, alignItems: "flex-start" }}>
              <div style={{ flex: "0 0 auto", display: "flex", gap: 6, alignItems: "stretch", pointerEvents: "auto" }}>
                {rules.ranked && <RankBadge rank={rank.rank} total={rank.total} />}
                {rules.sides && sides && <SideBadge sides={sides} />}
                <div style={{ width: 180 }}>
                  <HealthPanel ph={ph} phMax={phMax} />
                </div>
              </div>
              <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, pointerEvents: "auto" }}>{pills}</div>
                {rules.repairs && <div ref={railRef} style={{ display: "flex", gap: 6, pointerEvents: "auto", transition: "opacity 0.25s" }}>{rail}</div>}
              </div>
            </div>
          ) : (
            <>
              <div style={{ position: "absolute", top: 8, left: HUD.pad, display: "flex", gap: 8, pointerEvents: "auto" }}>{pills}</div>

              <div style={{ position: "absolute", top: 36, left: HUD.pad, display: "flex", gap: 6, alignItems: "stretch", width: "min(236px, 72%)", pointerEvents: "auto" }}>
                {rules.ranked && <RankBadge rank={rank.rank} total={rank.total} />}
                {rules.sides && sides && <SideBadge sides={sides} />}
                <div style={{ flex: 1 }}>
                  <HealthPanel ph={ph} phMax={phMax} />
                </div>
              </div>

              {rules.repairs && <div ref={railRef} style={{ position: "absolute", top: 110, left: 8, right: 8, display: "flex", gap: 6, paddingBottom: 2, pointerEvents: "auto", transition: "opacity 0.25s" }}>{rail}</div>}
            </>
          )}

          <div
            {...controls.stick}
            style={{ position: "absolute", left: 24, bottom: 28, width: 120, height: 120, borderRadius: "50%", border: `1px solid ${C.hair}`, background: "rgba(13,58,56,0.55)", touchAction: "none", pointerEvents: "auto" }}
          >
            <div ref={controls.knobRef} style={{ position: "absolute", left: "50%", top: "50%", width: 52, height: 52, marginLeft: -26, marginTop: -26, borderRadius: "50%", background: "rgba(236,226,204,0.9)", boxShadow: "0 2px 6px rgba(0,0,0,0.4)", pointerEvents: "none" }} />
          </div>

          {rules.guns && (
          <div style={{ position: "absolute", right: HUD.fireRight, bottom: HUD.fireBottom, display: "flex", flexDirection: "column", gap: HUD.fireGap, pointerEvents: "auto" }}>
            <FireButton refEl={btnRefs.broadside} name="SIDE" sub="hull" color={C.hull} onDown={controls.hold("broadside", true)} onUp={controls.hold("broadside", false)} />
            <FireButton refEl={btnRefs.bow} name="FRONT" sub="mast" color={C.mast} onDown={controls.hold("bow", true)} onUp={controls.hold("bow", false)} />
            <FireButton refEl={btnRefs.musket} name="MUSKET" sub="crew" color={C.crew} onDown={controls.hold("musket", true)} onUp={controls.hold("musket", false)} />
          </div>
          )}
        </>
      )}
      </div>

      {phase === "start" && (
        <StartOverlay
          onStart={(m) => startRef.current(m)}
          note={[notice, LINK_NOTE[link]].filter(Boolean).join(" ")}
          onEdit={(id) => { setYardShip(id || null); setPhase("yard"); }}
          onOutfit={(id) => { setYardShip(id || null); setOutfitStart(null); setPhase("outfitter"); }}
          onRecords={() => setPhase("records")}
          onCookies={openCookies}
          onPrivacy={() => setPhase("privacy")}
          account={account}
          onAccount={() => setPhase("account")}
          onFriends={() => (link === "ready" ? openOnline() : setNotice(LINK_NOTE[link] || ""))}
          hold={hold}
        />
      )}
      {phase === "lobby" && (
        <LobbyScreen
          net={net}
          note={net && net.reconnecting ? "Reconnecting to the server. Your place in the lobby is held for 2 minutes." : netNote}
          onMake={(isPublic) => onlineRef.current && onlineRef.current.create(isPublic)}
          onReady={(r) => onlineRef.current && onlineRef.current.setReady(r)}
          onJoin={(code) => onlineRef.current && onlineRef.current.join(code)}
          onRivals={(n) => onlineRef.current && onlineRef.current.setRivals(n)}
          onMode={(m) => onlineRef.current && onlineRef.current.setMode(m)}
          onPerSide={(n) => onlineRef.current && onlineRef.current.setPerSide(n)}
          onSide={(s) => onlineRef.current && onlineRef.current.setSide(s)}
          onStart={() => onlineRef.current && onlineRef.current.start()}
          onLeave={() => onlineRef.current && onlineRef.current.leave()}
          onBack={closeOnline}
          onRetry={openOnline}
        />
      )}
      {phase === "yard" && (
        <YardScreen
          hold={hold}
          shipId={yardShip}
          onView={setYardShip}
          onBack={() => setPhase("start")}
          onCommission={() => setPhase("commission")}
          onOutfit={(start) => { setOutfitStart(start || null); setPhase("outfitter"); }}
        />
      )}
      {phase === "commission" && (
        <CommissionScreen hold={hold} onBack={() => setPhase("yard")} onBought={(id) => { setYardShip(id); setPhase("yard"); }} />
      )}
      {phase === "outfitter" && (
        <OutfitterScreen hold={hold} shipId={yardShip} onView={setYardShip} start={outfitStart} onBack={() => setPhase("yard")} />
      )}
      {/* Asked on the menu only. A first visit sees it once the menu has settled; answered, it stays
          away until "Cookie settings" brings it back. Unanswered, it waits out a voyage and is
          there again on the way back to the menu. */}
      {phase === "start" && cookieAsk && <CookieConsent onClose={() => setCookieAsk(false)} onPrivacy={() => setPhase("privacy")} />}
      {phase === "privacy" && <PrivacyScreen onBack={() => setPhase("start")} />}
      {phase === "account" && account && (
        <AccountScreen account={account} onBack={() => setPhase("start")} onDone={(note) => { setNotice(note); setPhase("start"); }} />
      )}
      {phase === "records" && <RecordsScreen hold={hold} onBack={() => setPhase("start")} onAchievements={() => setPhase("achievements")} />}
      {phase === "achievements" && <AchievementsScreen hold={hold} onBack={() => setPhase("records")} />}
      {/* The headline names the moment: the last afloat, the ladder climbed, or between sides the
          side's day, won or lost, over whatever became of her own ship. */}
      {phase === "won" && <EndOverlay title={sideEnd === "won" ? "YOUR SIDE WON" : rules.ladder && !onlineEnd ? "LADDER CLIMBED" : "LAST AFLOAT"} titleColor={C.gold} result={result} stats={stats} mode={mode} place={place} hold={hold} banked={banked} bounty={bounty} online={onlineEnd} onAgain={() => startRef.current(mode)} onMenu={() => (onlineEnd ? setPhase("lobby") : setPhase("start"))} />}
      {phase === "dead" && (
        <EndOverlay title={sideEnd === "lost" ? "YOUR SIDE LOST" : "SUNK"} titleColor={C.crew} result={result} note={watchNote} stats={stats} mode={mode} place={place} hold={hold} banked={banked} bounty={bounty} online={onlineEnd}
          onWatch={canWatch ? () => watchRefs.current.start() : null}
          onAgain={() => startRef.current(mode)} onMenu={() => { watchRef.current = null; if (gameRef.current && gameRef.current.watching) liveRef.current = false; setPhase(onlineEnd ? "lobby" : "start"); }} />
      )}
      {phase === "watching" && (
        <WatchBar name={watching.name} afloat={left} onNext={() => watchRefs.current.next()} onStop={() => watchRefs.current.stop()} />
      )}
    </div>
  );
}

// ---------------- HUD icons ----------------
// Drawn rather than set in emoji, so the HUD keeps its shape across iOS, Android and Windows instead
// of picking up whatever each OS ships in its emoji font. Every one is a 16-unit box filled with
// currentColor, so the same component serves the gold pills and the pale red storm-danger pill
// without a variant. aria-hidden throughout: the number beside the icon carries the meaning, and the
// pill itself takes the label.
//
// These run 9px to 17px, so every shape here is a mass rather than a stroke. The first drawn set was
// built out of outlines and hairlines, and at 1x the coin's ring and inner glyph read as a wall
// clock while the sinking hull read as a smudge. The rule the redraw follows: one silhouette a
// reader can name, and where an icon needs interior detail, cut it out of a filled body instead of
// drawing it in line, because a knocked-out mark keeps full contrast when it falls under a pixel and
// a thin stroke just fades.
const iconStyle = { verticalAlign: "-0.12em", flex: "0 0 auto" };

// Currency, both the run purse and the hold that outlives it. A solid disc with a skull struck into
// it, so the coin carries the same mark as the sunk counter and the money in this game is plainly
// pirate money. The disc doing the work is the whole reason it survives: at 17px on the menu the
// stamp resolves into a skull, and at 12px in the HUD it falls back to a round gold mass with a dark
// mark on it, which is still a coin. The version before this one was a ring with a thin glyph hung
// inside it, and at 12px a ring with a stub in the middle is a wall clock.
//
// Three levels of fill, and the order matters: gold disc, skull cut out of it, eye sockets filled
// back in. Cutting the skull out rather than drawing it in line is what keeps it black at 12px; the
// nose and teeth that SunkIcon can afford are left off here, because inside a 14-unit disc they are
// half-pixel marks that only silt up the sockets.
//
// The cranium is centred at 7.65 rather than 8, which is what sits the skull in the middle of the
// coin: the shape hangs down from the dome, so centring the dome leaves the whole mark riding high
// with a crescent of bare gold under the jaw. 7.65 puts the head-and-jaw box in the middle of the
// disc, within a tenth of a unit of where its centre of area wants to be.
function CoinIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={iconStyle}>
      <path
        fillRule="evenodd"
        d="M8 .8a7.2 7.2 0 1 1 0 14.4A7.2 7.2 0 0 1 8 .8Z
           M4.1 7.65a3.9 3.5 0 1 1 7.8 0v1.93H9.95v2.3h-3.9v-2.3H4.1Z
           M4.9 7.75a1.35 1.35 0 1 0 2.7 0 1.35 1.35 0 1 0-2.7 0Z
           M8.4 7.75a1.35 1.35 0 1 0 2.7 0 1.35 1.35 0 1 0-2.7 0Z"
      />
    </svg>
  );
}

// Rivals still afloat. A ship, not a flag: the counter is ships remaining. Three masses, sized so
// each one survives on its own: mast, mainsail, hull. The waves that used to run under the hull are
// gone. At 12px they were a 1px ripple that only furred the bottom edge, and the hull's own flat
// sheer line already puts the ship on the water.
function ShipIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={iconStyle}>
      <path d="M6.4 1.2h1.9v8.2H6.4z" />
      <path d="M9.1 2 13.6 8.2H9.1z" />
      <path d="M1.4 9.6h13.2l-2.4 4.6H3.8L1.4 9.6Z" />
    </svg>
  );
}

// Ships sunk. A skull over crossed bones: the count is kills, and the flag a captain runs up over
// them is the thing every player already reads as kills. It beats the sinking hull that stood here
// before, which needed a waterline to explain it and still arrived as a diagonal lump.
//
// The bones go down first and the skull over them, so the two shapes stay separate at size instead
// of fusing into one mass. Everything inside the skull is cut out, not drawn: sockets big enough to
// hold two dark pixels at 12px, and a nose that is the one detail here allowed to disappear, since
// a domed head with two sockets over a jaw is already a skull without it.
function SunkIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={iconStyle}>
      <path d="M1.27 11.7 14.07 15.5l.66-2.2L1.93 9.5ZM14.07 9.5 1.27 13.3l.66 2.2 12.8-3.8Z" />
      <path
        fillRule="evenodd"
        d="M3.5 5.6a4.5 4 0 1 1 9 0v2.2h-2.2v2.6H5.7V7.8H3.5Z
           M4.5 5.8a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0Z
           M8.5 5.8a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0Z
           M8 7.2l.6 1.2H7.4Z"
      />
    </svg>
  );
}

// The closing squall: the weather up top, the ring it is closing on underneath. The ring is the one
// thing the mode actually does to you, so it is worth the half of the box it takes.
//
// Both shapes run the full width. Two rules fought here and width settled both. A small cloud on a
// wide ring is a chess pawn, since the eye takes the narrow thing on top as a knob and the wide
// thing under it as a base; and a cloud tucked inside the ring, which is nearer to what the game
// draws, is worse still, because the overlap fuses them into one mass. Full-width and clear of each
// other, they stay two things: weather, and a perimeter drawing in under it.
//
// The ring is a shape with a hole rather than a stroked ellipse, so it keeps full contrast at 12px,
// and it can only be flattened so far: at this height the hole is about two device pixels, and
// squashing it further closes the hole and leaves a solid lozenge. The cloud is a bumpy top edge
// over a flat base, which is all a cloud is at 12px anyway.
function SquallIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={iconStyle}>
      <path d="M3.26 6.1Q1.6 6.1 1.6 3.87Q1.6 2.28 3.39 1.97Q3.9.8 6.98.8Q9.66.8 10.56 2.81Q12.61 2.5 14.4 3.87Q14.91 6.1 12.74 6.1Z" />
      <path
        fillRule="evenodd"
        d="M.4 12a7.6 3.8 0 1 0 15.2 0 7.6 3.8 0 1 0-15.2 0Z
           M1.9 12a6.1 2.3 0 1 1 12.2 0 6.1 2.3 0 1 1-12.2 0Z"
      />
    </svg>
  );
}

// A pill lays its children out in a row with a gap, so an icon sits beside its number without a
// space character doing the spacing. Wrap the text in one span: two loose children would each become
// a flex item and take the gap between them.
function Pill({ children, label }) {
  return <div aria-label={label} style={{ background: C.panel, border: `1px solid ${C.hair}`, borderRadius: 20, padding: "5px 11px", fontSize: 12, color: C.gold, fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>{children}</div>;
}

function StormPill({ storm }) {
  if (storm.out) return <div style={{ background: "rgba(70,18,18,0.85)", border: `1px solid ${C.crew}`, borderRadius: 20, padding: "5px 11px", fontSize: 12, color: "#ffd9d9", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }} aria-label="You are in the storm"><SquallIcon /><span>In storm</span></div>;
  if (storm.closes > 0) return <Pill label={`Storm closes in ${fmtTime(storm.closes)}`}><SquallIcon /><span>{fmtTime(storm.closes)}</span></Pill>;
  // the word is the weather's phase off the clock: closing, holding at the ring, closing again
  // through the squeeze, and closed once the eye has shut
  return <Pill label={`Storm ${storm.phase}`}><SquallIcon /><span>{storm.phase}</span></Pill>;
}

/**
 * Where the two fleets stand, in the rank badge's place, because between sides there is no rank:
 * her side's ships afloat against the other's, each in its side's colour and hers first, and under
 * them one bar split by the hull the two fleets have left, so a side that is winning on numbers but
 * losing on timber reads as such. The bar's two halves are the fleets' hull in the proportion they
 * stand, and it goes all hers when the other side has no hull left.
 */
function SideBadge({ sides }) {
  const ours = SIDE_COLORS[sides.side], theirs = SIDE_COLORS[SIDES.find((s) => s !== sides.side)];
  const hull = sides.ours.hull + sides.theirs.hull;
  const share = hull > 0 ? sides.ours.hull / hull : 0.5;
  const ahead = sides.ours.ships > sides.theirs.ships;
  return (
    <div style={{ background: C.panel, border: `1px solid ${ahead ? ours.fill : C.hair}`, borderRadius: 10, padding: "4px 8px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 52 }} aria-label={`${sides.ours.ships} ships on your side afloat, ${sides.theirs.ships} on the other`}>
      <span style={{ fontSize: 8, letterSpacing: 1, color: "rgba(238,244,242,0.5)" }}>Ships</span>
      <span style={{ fontSize: 18, fontWeight: 800, lineHeight: 1, display: "flex", alignItems: "baseline", gap: 3 }}>
        <span style={{ color: ours.fill }}>{sides.ours.ships}</span>
        <span style={{ fontSize: 10, color: "rgba(238,244,242,0.5)" }}>v</span>
        <span style={{ color: theirs.fill }}>{sides.theirs.ships}</span>
      </span>
      <span style={{ display: "block", width: 40, height: 4, borderRadius: 3, marginTop: 3, background: theirs.fill, overflow: "hidden" }}>
        <span style={{ display: "block", width: `${Math.round(share * 100)}%`, height: "100%", background: ours.fill }} />
      </span>
    </div>
  );
}

function RankBadge({ rank, total }) {
  const leader = rank === 1;
  return (
    <div style={{ background: C.panel, border: `1px solid ${leader ? C.gold : C.hair}`, borderRadius: 10, padding: "4px 8px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 44 }}>
      <span style={{ fontSize: 8, letterSpacing: 1, color: "rgba(238,244,242,0.5)" }}>Rank</span>
      <span style={{ fontSize: 20, fontWeight: 800, lineHeight: 1, color: leader ? C.gold : C.ink }}>#{rank}</span>
      <span style={{ fontSize: 8, color: "rgba(238,244,242,0.5)" }}>of {total}</span>
    </div>
  );
}

/**
 * The three bars, and a mark on the two that can be bought back.
 *
 * Hull and mast each carry a hairline where the work stops, because a bar that will not fill however
 * much is spent has to say so on itself: without it the last of it reads as a repair that failed
 * rather than as a repair nobody sells. Crew has no mark because it has no repair at all, and a mark
 * on that bar would promise one.
 *
 * One hairline, and it is the light one because of which ground matters. It lands on two: the bar's
 * own black below the cap, where she is damaged and the mark is the figure she is buying towards, and
 * the fill above it, where she is already past what a carpenter can reach and the mark is only
 * telling her where the reach ended. A pale line owns the first outright on both bars, and it is that
 * ground the mark is really for. It is full ink rather than a translucent one because the second
 * ground is what costs it: 2.20 on the hull's gold and 1.66 on the mast's pale blue, against 1.96 and
 * 1.48 at the 85% alpha it started on. The pale blue is the quietest the mark ever gets, and it is
 * quietest in the one state where the button has already said "Yard work" in words.
 */
function HealthPanel({ ph, phMax }) {
  const rows = [["HULL", ph.hull, phMax.hull, C.hull, HULL_PATCH_CAP], ["MAST", ph.mast, phMax.mast, C.mast, MAST_JURY_CAP], ["CREW", ph.crew, phMax.crew, C.crew, 0]];
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.hair}`, borderRadius: 10, padding: "7px 9px" }}>
      {rows.map(([label, val, max, col, cap]) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 9, color: "rgba(238,244,242,0.6)", width: 30 }}>{label}</span>
          <div style={{ position: "relative", flex: 1, height: 6, background: "rgba(0,0,0,0.35)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.max(0, (val / max) * 100)}%`, background: col, transition: "width 0.15s" }} />
            {cap > 0 && <div style={{ position: "absolute", top: 0, bottom: 0, left: `${cap * 100}%`, width: 1, background: C.ink }} />}
          </div>
        </div>
      ))}
    </div>
  );
}

// Whether the viewport is wider than tall, for the menus, which are laid out on the viewport rather
// than on the HUD's box: sideways the shell widens and the ship plate goes three abreast.
function useWideViewport() {
  const query = "(orientation: landscape)";
  const [wide, setWide] = useState(() => !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

// The size of an element, kept current as it is resized: the HUD's safe-area box, which is what
// the layout is chosen on. Wider than tall is sideways, the same test `(orientation: landscape)`
// makes of the viewport, taken off the box the controls actually sit in.
function useBox(ref) {
  const [box, setBox] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setBox((b) => (b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight }));
    read();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", read);
      return () => window.removeEventListener("resize", read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return box;
}

function FireButton({ refEl, name, sub, color, onDown, onUp }) {
  return (
    <button
      ref={refEl}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      onPointerCancel={onUp}
      style={{ position: "relative", width: HUD.fireW, height: HUD.fireH, borderRadius: 10, border: `1px solid ${color}`, background: "rgba(13,58,56,0.88)", color: C.ink, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, overflow: "hidden", touchAction: "none", WebkitTapHighlightColor: "transparent", cursor: "pointer" }}
    >
      <span style={{ fontSize: 12, fontWeight: 700 }}>{name}</span>
      {/* the system it hits, set as the health panel sets the same word, so HULL on the button and
          HULL on the bar read as one thing */}
      <span style={{ fontSize: 8, color }}>{sub.toUpperCase()}</span>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "rgba(0,0,0,0.4)" }}>
        <div className="cd-fill" style={{ height: "100%", background: color, transformOrigin: "left", transform: "scaleX(1)" }} />
      </div>
    </button>
  );
}

// How wide a menu runs: a phone's width upright, and sideways enough for the ship plate to carry her
// figures either side of her, with her centred and the longest class name on one line beside her,
// and for a mode card's description to run to three lines rather than eight, since a sideways phone
// has the width to spare and none of the height.
const SHELL_W = 360, SHELL_W_WIDE = 640;
// The shell's ground as it lands on open water: its rgba(8,38,37,0.80) over the sea, worked out
// flat, so the browser's own bars can be painted the same tone while a menu is up.
const MENU_TINT = "#0f3b39";

function Shell({ children }) {
  const wide = useWideViewport();
  return (
    // `margin:auto` rather than `align-items:center` so a tall menu on a short
    // screen scrolls from the top instead of having its head clipped off.
    //
    // It takes no touch-action of its own on purpose. The `manipulation` every element gets in
    // `index.css` is what this screen wants: it scrolls under a finger, a reader who wants the small
    // print bigger can still pinch it, and a double tap on a shop row is two taps rather than a zoom.
    // The padding grows by the phone's safe-area insets, so a menu run full screen from the home
    // screen keeps its edges clear of the notch and the home bar the way the HUD does.
    <div style={{ position: "absolute", inset: 0, display: "flex", overflowY: "auto", padding: "calc(24px + env(safe-area-inset-top, 0px)) calc(24px + env(safe-area-inset-right, 0px)) calc(24px + env(safe-area-inset-bottom, 0px)) calc(24px + env(safe-area-inset-left, 0px))", background: "rgba(8,38,37,0.80)", backdropFilter: "blur(4px)" }}>
      <div style={{ margin: "auto", maxWidth: wide ? SHELL_W_WIDE : SHELL_W, textAlign: "center" }}>{children}</div>
    </div>
  );
}

const GALLEON_W = 268;
const GALLEON_ASPECT = 0.62; // the projection is drawn into a 1 : 0.62 box
const GALLEON_DEG_PER_MS = 0.012; // ~30s per revolution

// What one of her own ships is drawn from: her rig, built of the captain's timber rather than her
// class's, the way she sails (`CAPTAIN_TIMBER`).
const ownRig = (loadout) => ({ ...rigSpec(loadout), timber: CAPTAIN_TIMBER });

// The ship on the menu: the same 3-D model that sails at sea, turning under a fixed
// light at drawGalleon's isometric angle, so it turns rather than spinning a flat sprite.
//
// She is the captain's own ship, not a stock galleon: `rig` is what is actually
// stepped and bent on aboard whichever hull she is sailing, so buying a sail
// shows up here, on her own class's hull.
function MenuGalleon({ rig }) {
  const cvs = useRef(null);
  // The rig changes rarely and the object is rebuilt on every render, so the
  // effect keys off the shape of it rather than its identity. Without this the
  // canvas tears down and restarts on every parent render, and the ship jumps
  // back to bearing zero mid-turn.
  const key = JSON.stringify(rig);
  // Her bearing lives outside the effect, so a change of rig, or a change of ship under the plate's
  // arrows, carries on from where she was turning rather than snapping her back to bearing zero.
  const degRef = useRef(0);
  // three.js, once its chunk is here; the plate is drawGalleon's until then
  const [three, setThree] = useState(three3d);
  useEffect(() => {
    if (three) return;
    let on = true;
    loadThree().then((m) => { if (on && m) setThree(m); });
    return () => { on = false; };
  }, [three]);

  useEffect(() => {
    const c = cvs.current;
    if (!c) return;
    // The one ship model, drawn through the menu's shared WebGL renderer into this 2D canvas, or
    // painted by drawGalleon where WebGL cannot be had (createMenuShip decides, and the box is the
    // same either way).
    const ship = three ? three.createMenuShip(c) : flatMenuShip(c);
    const w = GALLEON_W;
    const h = Math.round(w * GALLEON_ASPECT);
    ship.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
    const paint = (deg) => ship.draw(rig, deg);

    // A perpetually turning ship is exactly what reduced-motion asks us to drop,
    // so hold a three-quarter view instead.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      paint(24);
      return () => ship.dispose();
    }

    let raf = 0;
    let last = 0;
    const frame = (t) => {
      if (last) degRef.current = (degRef.current + (t - last) * GALLEON_DEG_PER_MS) % 360;
      last = t;
      paint(degRef.current);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ship.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, three]);

  return (
    <canvas
      ref={cvs}
      aria-hidden="true"
      style={{ display: "block", width: GALLEON_W, height: Math.round(GALLEON_W * GALLEON_ASPECT), margin: "2px auto -6px" }}
    />
  );
}

/**
 * The hold on the menu: what she is worth, what that means, and the way into the log.
 *
 * The line under the total used to be a summary that appeared only once there was something to
 * summarise, and it was doing two jobs badly. What the hold *is* wants saying every time, including
 * to a captain fifty voyages in; the tallies want more room than one comma-spliced line and they now
 * have a screen. So the line stays put and says the one thing, and the record sits below it as its
 * own control.
 */
function HoldPanel({ hold, onRecords }) {
  return (
    <div style={{ background: "rgba(11,51,49,0.6)", border: `1px solid ${C.hair}`, borderRadius: 10, padding: "9px 12px 0", margin: "14px 0 18px", textAlign: "left" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        {/* Set exactly as the row at the foot of this panel: same size, same ink, no tracking, so the
            box has one voice for the two things it labels. It carried a size and a letterspacing of
            its own, which made a heading and a control that sit one above the other in one box read
            as two unrelated kinds of label. The tracking went rather than being copied down, because
            the thing below it is a button and a button takes size over tracking. */}
        <span style={{ fontSize: 11, color: "rgba(238,244,242,0.78)" }}>The Hold</span>
        <span style={{ fontSize: 17, fontWeight: 800, color: C.gold, display: "inline-flex", alignItems: "center", gap: 4 }} aria-label={`${fmtCoins(hold.coins)} coins in the hold`}><CoinIcon size={17} />{fmtCoins(hold.coins)}</span>
      </div>
      <div style={{ fontSize: 10, color: "rgba(238,244,242,0.5)", lineHeight: 1.6, marginTop: 4 }}>
        Keep what you earn at sea, less any spent
      </div>
      {/* Full width and edge to edge inside the box, so the row is visibly the whole bottom of the
          panel rather than a word someone has underlined. The negative margins pay back the box's
          own padding; the box gives none at the foot for the same reason.

          Its own line under it, in the same ink and size as the hold's, so the panel reads as two
          things each saying what it is rather than one explained thing and one bare label. The
          chevron centres against the pair. */}
      <button
        onClick={onRecords}
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
          width: "calc(100% + 24px)", margin: "8px -12px 0", padding: "9px 12px 10px",
          background: "transparent", border: "none", borderTop: `1px solid ${C.hair}`,
          fontFamily: UI, color: "rgba(238,244,242,0.78)", textAlign: "left",
          cursor: "pointer", WebkitTapHighlightColor: "transparent",
        }}
      >
        <span>
          <span style={{ display: "block", fontSize: 11 }}>Achievements &amp; Tallies</span>
          <span style={{ display: "block", fontSize: 10, color: "rgba(238,244,242,0.5)", lineHeight: 1.6, marginTop: 2 }}>
            Track stats and achievements
          </span>
        </span>
        <ChevronIcon />
      </button>
    </div>
  );
}

// Points the way into a screen, or back out of one. Drawn rather than a `›`, which sets in whatever
// the UI font has and sits at a different weight and height on every platform.
function ChevronIcon({ size = 11, back }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path
        d={back ? "M10 3l-5 5 5 5" : "M6 3l5 5-5 5"}
        stroke="rgba(238,244,242,0.55)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The way out, at the top of a screen. Every screen off the menu carries one.
 *
 * These screens are read from the top and some of them are long: a captain who opened the tallies to
 * glance at one figure should not have to scroll past four cards to leave. The button at the foot
 * stays where it is, for the captain who *has* read to the bottom and is done there, and the two
 * carry the same words — one thing under two names would read as two different exits.
 *
 * The menu is "the sea", because that is what a captain is going back out to and it is what the yard
 * has always called it. So the yard and the tallies both come back to the sea, and the achievements
 * come back to the tallies, which is the screen they open from rather than a description of it.
 */
function BackLink({ label, onClick }) {
  return (
    <div style={{ textAlign: "left" }}>
      <button
        onClick={onClick}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          // Pulled out by its own padding so the glyph lines up with the card edges below it while the
          // tappable area stays a comfortable size on a phone.
          margin: "0 0 4px -10px", padding: "8px 10px",
          background: "transparent", border: "none",
          fontFamily: UI, fontSize: 11, color: "rgba(238,244,242,0.78)",
          cursor: "pointer", WebkitTapHighlightColor: "transparent",
        }}
      >
        <ChevronIcon size={11} back />
        <span>{label}</span>
      </button>
    </div>
  );
}

/**
 * THE LOG — every voyage she has made, totalled and then broken out by mode.
 *
 * The overview is the honest total across everything, taken from `lifetime` rather than by adding the
 * modes up: a voyage banked under a mode this build no longer lists would go missing from a sum and
 * does not go missing from the total.
 *
 * What each mode shows is decided by what that mode *is*, not by what the record happens to hold.
 * Placement only means something where there are placements, so the derby and the free-for-all show a
 * best finish, the wave arena shows its own score, which is ships sunk in one voyage, and the ladder
 * shows the highest rung she has reached and how often she has climbed the lot. Nothing is
 * repaired in the derby, so no carpenter's line appears there; there are no guns in it either, so it
 * counts rams where the other two count repairs, the same split the end-of-voyage tally makes.
 *
 * Achievements have a screen of their own, reached from the button above the tallies. What sits here
 * is the count, in the overview alongside everything else that is counted.
 */
function RecordsScreen({ hold, onBack, onAchievements }) {
  const lt = hold.lifetime;
  const sailed = lt.runs > 0;
  const won = tally(hold);

  return (
    <Shell>
      <BackLink label="Back to the sea" onClick={onBack} />
      {/* a step under the other screen titles: in caps this is the longest of them, and at 26px it
          wrapped inside the 342px a 390px phone leaves the shell */}
      <div style={{ fontFamily: DISPLAY, fontSize: "clamp(19px, 6.2vw, 24px)", color: C.gold, letterSpacing: 0.5 }}>
        ACHIEVEMENTS &amp; TALLIES
      </div>
      <div style={{ fontSize: 12, color: "rgba(238,244,242,0.7)", margin: "6px 0 2px" }}>
        {sailed
          ? `Everything from ${lt.runs} voyage${lt.runs === 1 ? "" : "s"}, totalled and by mode.`
          : "Nothing to show until you have been to sea."}
      </div>

      {/* Above the tallies, because it is the way to somewhere rather than a figure to read, and a
          control buried among nine rows of numbers is a control nobody finds. */}
      <BigRow label="Achievements" value={`${won.done} of ${won.total}`} onClick={onAchievements} />

      <Slab centred title="OVERVIEW">
        {sailed ? (
          <Rows
            rows={[
              // Achievements are not in here. The button above the card carries the same count, and
              // a figure printed twice on one screen is one of them saying nothing.
              //
              // Zero rows stay, though. A totals table whose rows appear and vanish as a captain
              // plays is harder to read than one that always has the same shape, and a nought is an
              // answer.
              ["Voyages", fmtNum(lt.runs)],
              ["Voyages won", fmtNum(lt.wins)],
              ["Ships sunk", fmtNum(lt.sunk)],
              ["Masts brought down", fmtNum(lt.dismasted)],
              ["Damage dealt", fmtNum(lt.dmg)],
              ["Rams landed", fmtNum(lt.rams)],
              ["Time afloat", fmtTime(lt.afloat)],
              ["Repairs bought", fmtNum(lt.patches)],
              ["Damage repaired", fmtNum(lt.healed)],
              ["Paid to the carpenter", <Coins key="c" n={lt.repaired} />],
              ["Into the hold", <Coins key="h" n={lt.earned} />],
              ["From achievements", <Coins key="b" n={hold.bounties} />],
            ]}
          />
        ) : (
          <Empty>Sail once and this fills in: what you sank, what it cost you, and what you kept.</Empty>
        )}
      </Slab>

      {sailed &&
        MODE_LIST.map((key) => {
          const m = MODES[key];
          const r = modeRecord(hold, key);
          return (
            <Slab centred key={key} title={m.title}>
              {r.runs > 0 ? (
                <Rows
                  rows={[
                    ["Voyages", fmtNum(r.runs)],
                    ...(m.ranked
                      ? [
                          ["Voyages won", fmtNum(r.wins)],
                          ["Best finish", r.bestRank > 0 ? `#${r.bestRank}` : "not yet placed"],
                        ]
                      : m.ladder
                        ? [
                            ["Highest rung reached", `${fmtNum(r.bestSunk)} of ${ladderHeight()}`],
                            ["Ladders climbed", fmtNum(r.wins)],
                          ]
                        : [["Most sunk in one voyage", fmtNum(r.bestSunk)]]),
                    ["Ships sunk", fmtNum(r.sunk)],
                    // A mast comes down to a bow gun, so the line only means something where there are guns.
                    ...(m.guns ? [["Masts brought down", fmtNum(r.dismasted)]] : []),
                    ["Damage dealt", fmtNum(r.dmg)],
                    // The end-of-voyage tally makes this same split, and for the same reason: a mode
                    // with no guns aboard is a mode where ramming is the whole of the fighting.
                    m.guns ? ["Repairs bought", fmtNum(r.patches)] : ["Rams landed", fmtNum(r.rams)],
                    ...(m.repairs ? [["Damage repaired", fmtNum(r.healed)], ["Paid to the carpenter", <Coins key="c" n={r.repaired} />]] : []),
                    ["Time afloat", fmtTime(r.afloat)],
                    ["Longest voyage", fmtTime(r.bestTime)],
                    ["Into the hold", <Coins key="h" n={r.earned} />],
                  ]}
                />
              ) : (
                <Empty>{m.unsailed}</Empty>
              )}
            </Slab>
          );
        })}

      <div style={{ height: 6 }} />
      <StartButton onClick={onBack} label="Back to the sea" />
    </Shell>
  );
}

/**
 * A card that is a way into somewhere, sized and ruled like the slabs it sits among so a screen made
 * of cards keeps one rhythm. It carries its own figure on the right, because a captain who only
 * wanted the number should not have to open the screen to get it.
 */
function BigRow({ label, value, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
        width: "100%", margin: "12px 0", padding: "12px", textAlign: "left",
        background: "rgba(11,51,49,0.6)", border: `1px solid ${C.hair}`, borderRadius: 10,
        fontFamily: UI, color: C.ink, cursor: "pointer", WebkitTapHighlightColor: "transparent",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.gold }}>{value}</span>
        <ChevronIcon size={12} />
      </span>
    </button>
  );
}

/**
 * THE ACHIEVEMENTS — one card each, earned first.
 *
 * Nothing here is stored. `achievements.js` asks the hold a question per achievement and the answer
 * is the progress, which is why a captain who sank her first ship before any of this existed opens
 * the screen already holding it.
 *
 * The ladders come first, as one table: a row each, with the figure against the rung she is on,
 * which rung it is, and what it pays. They are the running counts, and a table is how running
 * counts are read side by side; a card each would be twelve cards that differ by a number. They
 * keep the list's order rather than sorting, because a table that reshuffles as she plays is a
 * table she has to re-find her place in. The single goals follow as cards, earned first, so she
 * sees what she has before what she has not. The count at the head of the screen is in rungs.
 */
function AchievementsScreen({ hold, onBack }) {
  const list = roll(hold);
  const won = tally(hold);
  const ladders = list.filter((a) => a.rungs > 1);
  const singles = list.filter((a) => a.rungs === 1).sort((x, y) => Number(y.done) - Number(x.done));
  return (
    <Shell>
      <BackLink label="Back to the tallies" onClick={onBack} />
      <div style={{ fontFamily: DISPLAY, fontSize: "clamp(24px, 8vw, 30px)", color: C.gold, letterSpacing: 0.5 }}>
        ACHIEVEMENTS
      </div>
      <div style={{ fontSize: 12, color: "rgba(238,244,242,0.7)", margin: "6px 0 2px" }}>
        {won.done} of {won.total} earned.
      </div>

      <Slab centred title="LADDERS">
        <LadderTable ladders={ladders} />
      </Slab>

      <div style={{ fontSize: 10, letterSpacing: 1, color: C.ink, textAlign: "center", margin: "16px 0 0" }}>ONE-OFFS</div>
      {singles.map((a) => (
        <div
          key={a.id}
          style={{
            display: "flex", alignItems: "center", gap: 11, textAlign: "left",
            background: "rgba(11,51,49,0.6)", borderRadius: 10, padding: "11px 12px", margin: "12px 0",
            border: `1px solid ${a.done ? C.grass : C.hair}`,
          }}
        >
          <SealIcon done={a.done} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: a.done ? C.ink : "rgba(238,244,242,0.7)" }}>{a.name}</span>
              {a.mode && TAGS[a.mode] && <ModeTag mode={TAGS[a.mode]} />}
            </div>
            <div style={{ fontSize: 11, color: "rgba(238,244,242,0.55)", lineHeight: 1.5, marginTop: 2 }}>{a.blurb}</div>
          </div>
          {/* What it pays, only while it is still to be earned. Once it is done the seal says so, and
              a figure beside a struck seal is the same news twice. */}
          {!a.done && a.reward > 0 && <Pays n={a.reward} />}
        </div>
      ))}

      <div style={{ fontSize: 11, color: "rgba(238,244,242,0.5)", lineHeight: 1.6, margin: "2px 0 16px" }}>
        More come as the game grows. Each is worked out from what the hold already keeps, so anything
        you have done counts from the day it is added.
      </div>
      <StartButton onClick={onBack} label="Back to the tallies" />
    </Shell>
  );
}

/**
 * The ladders as one table. Four columns: the ladder, with its mode tag; the figure against the rung
 * she is on; which rung it is; and what it pays. Under the four cells a bar of how far up the rung
 * she is, and under that the line saying what the rung asks. A climbed ladder keeps its row with a
 * struck seal where the figure was, a full bar and nothing in the pays column, so the table holds
 * one shape however far she is: a row that vanishes when it is done is a row she cannot find again
 * to see that it is done.
 *
 * A grid rather than a table element, because the rule between rows, the bar and the line all have
 * to run the whole width, and the first column has to give way to the other three, which are figures
 * and must not wrap. The line sits on a row of its own for that reason: beside the figures it had a
 * third of a phone to wrap in and came out one word to a line.
 */
function LadderTable({ ladders }) {
  const head = { fontSize: 10, color: "rgba(238,244,242,0.5)", letterSpacing: 0.5, paddingBottom: 5 };
  // one cell across the whole row, not a border on each of four cells: cells of different heights
  // centred on one another put four borders at four heights
  const rule = { gridColumn: "1 / -1", borderTop: "1px solid rgba(160,224,210,0.14)", marginBottom: 7 };
  const cell = { alignSelf: "center" };
  const figure = { ...cell, fontSize: 12, fontWeight: 700, color: C.gold, textAlign: "right", whiteSpace: "nowrap" };
  return (
    // The first column has a floor, so the progress column, which a grid sizes to its widest cell in
    // any row, gives way before the names do: "1.1/3 hours" breaks in its one row rather than
    // "Masts brought down" breaking into three lines in every row. A figure breaks only after its
    // slash, so a short one never breaks.
    <div style={{ display: "grid", gridTemplateColumns: "minmax(88px, 1fr) auto auto auto", columnGap: 8 }}>
      <div style={head}>Ladder</div>
      <div style={{ ...head, textAlign: "right" }}>Progress</div>
      <div style={{ ...head, textAlign: "right" }}>Rung</div>
      <div style={{ ...head, textAlign: "right" }}>Pays</div>
      {ladders.map((a) => (
        <Fragment key={a.id}>
          <div style={rule} />
          <div style={{ ...cell, minWidth: 0, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: a.done ? C.ink : ROW_LABEL }}>{a.name}</span>
            {a.mode && TAGS[a.mode] && <ModeTag mode={TAGS[a.mode]} />}
          </div>
          <div style={{ ...figure, whiteSpace: "normal", display: "flex", justifyContent: "flex-end" }}>
            {a.done ? <SealIcon done size={16} /> : <Progress parts={progressParts(a, a)} />}
          </div>
          <div style={{ ...figure, color: a.done ? C.ink : ROW_LABEL, fontWeight: 400 }}>
            {a.done ? a.rungs : a.rung + 1}/{a.rungs}
          </div>
          <div style={{ ...figure, display: "flex", justifyContent: "flex-end" }}>
            {!a.done && <Pays n={a.reward} />}
          </div>
          <ProgressBar share={a.done ? 1 : a.count / a.goal} done={a.done} />
          <div style={{ gridColumn: "1 / -1", fontSize: 10, color: "rgba(238,244,242,0.5)", lineHeight: 1.4, padding: "0 0 6px" }}>
            {a.done ? "Climbed to the top." : a.blurb}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * How far up the rung she is, as a hairline bar the width of the row. Gold while it is climbing, the
 * green money into the hold is drawn in once it is done, so a full bar and a struck seal say the same
 * thing in the same colour. Radius 3, the hairline-fill figure from the set.
 */
function ProgressBar({ share, done }) {
  const pct = Math.max(0, Math.min(100, share * 100));
  return (
    <div style={{ gridColumn: "1 / -1", height: 4, borderRadius: 3, background: "rgba(0,0,0,0.35)", margin: "6px 0 5px", overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: done ? C.grass : C.gold }} />
    </div>
  );
}

/** `count/goal`, breakable only after the slash, so a short figure never breaks and a long one breaks in one place. */
function Progress({ parts: [count, goal] }) {
  return (
    <span>
      <span style={{ whiteSpace: "nowrap" }}>{count}/</span>
      <wbr />
      <span style={{ whiteSpace: "nowrap" }}>{goal}</span>
    </span>
  );
}

/** What a rung or a card pays, as a small coin figure in the colour money into the hold is drawn in. */
function Pays({ n }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 700, color: C.grass, whiteSpace: "nowrap", flexShrink: 0 }}>
      <CoinIcon size={10} />+{fmtCoins(n)}
    </span>
  );
}

/**
 * The mode an achievement belongs to, as a small pill in that mode's colour beside its name. The
 * mode's short name rather than its title, because a title in caps beside a card name is two
 * headlines on one line. Takes anything shaped like a row of `TAGS`, so the pair of arenas can
 * carry one too.
 */
function ModeTag({ mode }) {
  return (
    <span style={{ fontSize: 9, fontWeight: 700, color: mode.color, border: `1px solid ${mode.color}`, borderRadius: 20, padding: "1px 6px", opacity: 0.85, whiteSpace: "nowrap" }}>
      {mode.short}
    </span>
  );
}

/**
 * The mark on an achievement: a struck seal when it is earned, the empty ring it is struck into when
 * it is not.
 *
 * Drawn as masses rather than strokes, so it holds at the 20px it runs at here: the earned seal is a
 * filled disc with a notched ribbon under it and a tick knocked out of the body, and the unearned one
 * is the same outline with nothing in it. Neither needs the detail read to say which it is, because
 * the difference is a filled shape against an empty one.
 */
function SealIcon({ done, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      {done ? (
        <>
          <path d="M4.6 9.8 L3.2 14.6 L8 12.6 L12.8 14.6 L11.4 9.8Z" fill={C.grass} opacity="0.75" />
          <circle cx="8" cy="6.6" r="5.2" fill={C.grass} />
          <path d="M5.7 6.7 L7.3 8.3 L10.3 4.9" stroke="#0b3331" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </>
      ) : (
        <>
          <path d="M4.6 9.8 L3.2 14.6 L8 12.6 L12.8 14.6 L11.4 9.8" stroke="rgba(238,244,242,0.3)" strokeWidth="1.2" strokeLinejoin="round" fill="none" />
          <circle cx="8" cy="6.6" r="4.6" stroke="rgba(238,244,242,0.3)" strokeWidth="1.4" fill="none" />
        </>
      )}
    </svg>
  );
}

// A run of tally rows, ruled between. Takes `[label, value]` pairs so a caller can build the list
// conditionally without threading the rule through by hand and getting the first one wrong.
//
// Its labels sit a step brighter than the end screen's, because a card here is nothing but labels:
// there is no prose around them to carry the reading, and a screen of nine dim rows under a bright
// heading reads as a heading with a footnote under it. The end-of-voyage tally keeps the dimmer ink,
// where the labels are a caption on a result the captain is already looking at.
const ROW_LABEL = "rgba(238,244,242,0.8)";

function Rows({ rows }) {
  return rows.map(([label, value], i) => (
    <TallyRow key={label} label={label} value={value} labelColor={ROW_LABEL} rule={i === 0 ? undefined : "hair"} />
  ));
}

function Empty({ children }) {
  return (
    <div style={{ fontSize: 11, color: "rgba(238,244,242,0.6)", padding: "6px 0", lineHeight: 1.6 }}>{children}</div>
  );
}

/**
 * THE YARD — what the captain's own ship is, part by part.
 *
 * First screen of the shipyard, and deliberately the reading half of it. Everything here is already
 * worked out by `shipyard.js`: what she rates, what tier that puts her in, what is in every berth,
 * and what she still wants. None of it had anywhere to be shown, and a captain cannot make a decision
 * about a ship she cannot see. Buying and fitting come next, against a design that is still to come;
 * this is the screen they will be built into rather than a placeholder for it.
 *
 * The rig is listed socket by socket from the bow aft, because that is how a ship is rigged and how
 * `masts` reads in the catalogue. An empty socket and an empty berth are both shown rather than
 * skipped: the gaps are the whole point of the screen.
 */
function YardScreen({ hold, shipId, onView, onBack, onCommission, onOutfit }) {
  // The ship the yard is looking at: whichever she asked for, or the one she sails if that ship is
  // gone. Everything below reads off her, and the outfitter opens on her too.
  const id = hold.yard.ships[shipId] ? shipId : hold.yard.active;
  const loadout = useMemo(() => shipLoadout(hold, id), [hold, id]);
  const rig = useMemo(() => ownRig(loadout), [loadout]);
  const stats = useMemo(() => rate(loadout), [loadout]);
  const want = useMemo(() => shortfall(hold, id), [hold, id]);
  const rated = rateOf(loadout.hull);
  // How many of her spares would go aboard if she asked, worked out the way the button does it, so
  // the button never offers a number it cannot fit.
  const canFit = useMemo(() => ownedFill(hold, id).fitted, [hold, id]);

  // Named for the parts rather than for the HUD buttons: this is the shipyard, where a captain is
  // looking at guns she owns, not at the three keys she fires them with.
  const guns = [
    ["broadside", "Broadsides", stats.broadside.count, loadout.hull.guns.broadside],
    ["bow", "Bow chasers", stats.bow.count, loadout.hull.guns.bow],
    ["swivel", "Swivel guns", stats.swivel.count, loadout.hull.guns.swivel],
  ];

  return (
    <Shell>
      <BackLink label="Back to the sea" onClick={onBack} />
      <div style={{ fontFamily: DISPLAY, fontSize: 30, color: C.gold, letterSpacing: 1 }}>THE YARD</div>
      {/* The hull shop is the one door left off the yard, and it sits at the head rather than the
          foot: buying a hull comes before choosing which of them to look at, and a door under six
          slabs is a door only a captain who reads to the bottom finds. */}
      <div style={{ margin: "12px 0 0" }}>
        <ShopLink
          title="Boat Commission"
          sub="Buy a hull, and choose the one you sail"
          color={C.gold}
          onClick={onCommission}
        />
      </div>
      <FleetStrip hold={hold} shipId={id} onView={onView} />
      <NamePlate hold={hold} shipId={id} />
      <div style={{ fontSize: 12, color: "rgba(238,244,242,0.7)", margin: "6px 0 2px" }}>
        {/* Her class and then her rating, always both, even where the class is named for the rating
            and it reads "1st rate, 1st rate". Six of the sixteen are named that way today and the
            fleet is still being written: a line that drops one of them when they happen to match
            would hide the rating on exactly the ships whose names are about to stop matching. */}
        {loadout.hull.name}, {rated.name}
      </div>
      <MenuGalleon rig={rig} />

      <Slab title="How she sails">
        <TallyRow label="Top speed" value={fmtKnots(stats.speed)} />
        <TallyRow label="Handling" value={`${handlingScore(stats.turn).toFixed(1)} of 100`} rule="hair" />
        <TallyRow label="Hull" value={stats.hull} rule="hair" />
        <TallyRow label="Mast" value={stats.mast} rule="hair" />
        <TallyRow label="Crew" value={stats.crew} rule="hair" />
        <TallyRow label="Muskets in a volley" value={stats.muskets} rule="hair" />
        {/* Every gun throws its own ball, so the count above already says how many. What it does not
            say is what one of them takes off a hull, or how long her side takes to roll through: a
            first rate is a second of continuous firing and a cutter is an instant. Shown only when
            she has a broadside at all, because these rows on a boat with no guns say nothing. */}
        {stats.broadside.count > 0 && (
          <>
            <TallyRow label="Damage a ball" value={stats.broadside.perBall.toFixed(1)} rule="hair" />
            <TallyRow
              label="Her whole side is away in"
              value={`${volleyWindow(stats.broadside.count).toFixed(2)}s`}
              rule="hair"
            />
          </>
        )}
        <Glossary />
      </Slab>

      {/* Every row here is a door. Tapping a socket or a berth opens the outfitter on the rigging
          tab, so reading what she has and changing it are one screen apart rather than a screen and
          a tab and a scroll. The tab opens whole, with no picker up: a picker sprung open under a
          slab the captain has not scrolled past landed her mid-screen, and one tap more on the row
          she wants is cheaper than finding where she is. */}
      <Slab title="Rigging" sub="Tap a mast or a sail to change it">
        {loadout.hull.sockets.map((socket) => {
          const entry = loadout.rig[socket.id];
          const mast = entry && entry.mast;
          return (
            <div key={socket.id} style={{ borderTop: `1px solid rgba(160,224,210,0.14)`, padding: "4px 0 6px" }}>
              <DoorRow
                onClick={() => onOutfit({ view: "rigging" })}
                label={<span style={{ fontSize: 11, fontWeight: 700, color: C.mast }}>{socket.station[0].toUpperCase() + socket.station.slice(1)}</span>}
                value={
                  <span style={{ fontSize: 11, color: mast ? C.ink : "rgba(238,244,242,0.4)" }}>
                    {mast ? mast.name : socket.spar ? "no spar rigged" : "no mast stepped"}
                  </span>
                }
              />
              {mast &&
                mast.berths.map((berth, i) => {
                  const sail = entry.sails[i];
                  const stud = (entry.studs || [])[i];
                  // What each sail is giving her, read the other way up from `berthEffect`: the
                  // ship as she stands against the ship with this berth cleared. Taking the sail
                  // off takes its studdingsail with it, so the sail's figure includes the stud's,
                  // and the stud row below shows its own share of that.
                  const worth = sail ? giving(berthEffect(loadout, socket.id, i, null)) : null;
                  const studWorth = stud ? giving(berthEffect(loadout, socket.id, i, sail, null)) : null;
                  return (
                    <React.Fragment key={i}>
                      <DoorRow
                        indent={10}
                        onClick={() => onOutfit({ view: "rigging" })}
                        label={<span style={{ fontSize: 9, color: "rgba(238,244,242,0.45)" }}>{kindOf(berth.kind)?.name || berth.kind}</span>}
                        value={
                          <span style={{ textAlign: "right" }}>
                            <span style={{ display: "block", fontSize: 10, color: sail ? "rgba(238,244,242,0.8)" : "rgba(238,244,242,0.35)" }}>
                              {sail ? sail.name : "bare"}
                            </span>
                            {worth && <span style={{ display: "block", fontSize: 9, color: "rgba(238,244,242,0.45)" }}>{effectLine(worth, "yard")}</span>}
                          </span>
                        }
                      />
                      {/* run out beyond the sail above, so it reads as part of that sail's row */}
                      {stud && (
                        <DoorRow
                          indent={18}
                          onClick={() => onOutfit({ view: "rigging" })}
                          label={<span style={{ fontSize: 9, color: "rgba(238,244,242,0.45)" }}>Studdingsail</span>}
                          value={
                            <span style={{ textAlign: "right" }}>
                              <span style={{ display: "block", fontSize: 10, color: "rgba(238,244,242,0.8)" }}>{stud.name}</span>
                              <span style={{ display: "block", fontSize: 9, color: "rgba(238,244,242,0.45)" }}>{effectLine(studWorth, "yard")}</span>
                            </span>
                          }
                        />
                      )}
                    </React.Fragment>
                  );
                })}
            </div>
          );
        })}
      </Slab>

      <Slab title="Armament" sub="Tap a mount to arm it">
        {/* Her iron first, because it is the figure every gun below is bought against. */}
        <IronRow weight={stats.weight} tons={loadout.hull.tons} />
        {/* Green once a mount is full, and the ordinary gold otherwise. Colouring a short mount by its
            system read as an alarm: no swivels is not a fault, it is a purchase she has not made. */}
        {/* Every gun row opens the guns tab as a whole rather than one mount's picker: the tonnage
            and the three mounts are read together, and a picker sprung open under one of them
            landed a captain in the middle of a screen she had not seen the top of. */}
        {guns.map(([mount, label, has, bears]) => (
          <DoorRow
            key={mount}
            onClick={() => onOutfit({ view: "guns" })}
            label={<span style={{ fontSize: 11, color: "rgba(238,244,242,0.6)", letterSpacing: 0.5 }}>{label}</span>}
            value={
              <span style={{ fontSize: 13, fontWeight: 700, color: bears > 0 && has >= bears ? C.grass : C.gold }}>
                {has} of {bears}
              </span>
            }
          />
        ))}
      </Slab>

      {/* What she is short, and what of it the captain already owns, loose or aboard another of her
          ships. The cheapest legal fill is a floor, not a recommendation: a pole mast is free and
          fits any socket. What she already owns goes aboard in one tap, for nothing. */}
      <Slab title={want.gaps.length ? `She wants ${want.gaps.length} more ${want.gaps.length === 1 ? "part" : "parts"}` : "Fully found"}>
        {want.gaps.length ? (
          <>
            <TallyRow label="Cheapest way to fill her out" value={<Coins n={want.cost} />} />
            <TallyRow label="Of those, already yours" value={canFit} rule="hair" />
            {canFit > 0 && (
              <div style={{ marginTop: 8 }}>
                <WideButton
                  label={`Fit what you own, ${plural(canFit, "part")} for nothing`}
                  onClick={() => fitOwned(id)}
                />
                <div style={{ fontSize: 10, color: "rgba(238,244,242,0.45)", marginTop: 6, lineHeight: 1.5 }}>
                  Puts every spare mast, sail and gun you own into an empty slot it fits. Nothing is bought.
                </div>
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 11, color: "rgba(238,244,242,0.6)", padding: "6px 0", lineHeight: 1.6 }}>
            Every socket stepped, every berth bent on, every port run out.
          </div>
        )}
      </Slab>

      <div style={{ height: 4 }} />
      <StartButton onClick={onBack} label="Back to the sea" />
    </Shell>
  );
}

/**
 * What each figure on the sailing slab is, in one line apiece, behind a tap.
 *
 * Players said they could not tell what an upgrade did, and half of that was not knowing what the
 * figures it moved were for. The lines are what the FIGHT does with each number, because that is the
 * question: a hull figure is what side guns take off, a mast figure is what a chaser brings down and
 * what her speed falls with. Folded away by default, since a captain who knows them should not
 * scroll past eight lines of them every visit.
 */
const GLOSSARY = [
  ["Top speed", "How fast the ship goes, in knots. Over 11 is quick. Under 5 means sails are missing."],
  ["Handling", "Steering ability, out of 100. Above 70 turns on a coin, under 40 is a slow wide turn. More weight lowers it, some sails raise it."],
  ["Hull", "How much damage the hull can take before sinking. Side cannons and rams hit the hull."],
  ["Mast", "How much damage the masts can take. Bow chasers hit the masts. As it drops, ships slow and turn worse. At 0, masts are downed."],
  ["Crew", "How many hands the ship has. Musket volleys hit the crew. At 0 the crew surrenders."],
  ["Muskets in a volley", "How many musket balls fired at once. It comes from crew size, plus 1 for every swivel gun."],
  // the range is read off the guns on sale rather than written here, so it cannot go stale
  ["Damage a ball", `How much damage per cannonball from side cannons, between ${Math.round(Math.min(...gunsForMount("broadside").map((g) => g.damage)))} and ${Math.round(Math.max(...gunsForMount("broadside").map((g) => g.damage)))} depending on the cannon size.`],
  ["Her whole side is away in", "How long it takes every side cannon to fire once. More cannons can take longer to fire a volley."],
];

function Glossary() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ paddingTop: 8 }}>
      <TinyButton label={open ? "Hide what the figures mean" : "What the figures mean"} onClick={() => setOpen(!open)} />
      {open && (
        <div style={{ marginTop: 6 }}>
          {GLOSSARY.map(([term, line]) => (
            <div key={term} style={{ fontSize: 10, lineHeight: 1.5, padding: "4px 0", borderTop: "1px solid rgba(160,224,210,0.14)" }}>
              <span style={{ color: "rgba(238,244,242,0.8)" }}>{term}. </span>
              <span style={{ color: "rgba(238,244,242,0.5)" }}>{line}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Which of her ships the yard is looking at, at the head of every yard screen, so switching hull is
 * one tap from anywhere in the shipyard rather than a walk to the foot of the hull shop. Shown only
 * once there are two to choose between, because a strip with one pill on it is a label.
 *
 * Looking at a ship and sailing her are two different things, and the line under the strip keeps
 * them apart: the ship she sails says so, and any other offers to be.
 */
function FleetStrip({ hold, shipId, onView }) {
  const fleet = ownedShips(hold);
  if (fleet.length < 2) return null;
  const sailing = shipId === hold.yard.active;
  return (
    <div>
      {/* A native select rather than a row of pills: a fleet of six named ships wrapped into three
          rows of pills and pushed the screen down, and the phone's own picker is the one control
          every player already knows how to work. Styled to sit with the cards, in the UI face. A
          named ship lists her class after her name so two Speedwells can be told apart. */}
      <div style={{ position: "relative", margin: "10px 0 0" }}>
        <select
          value={shipId}
          onChange={(e) => onView(e.target.value)}
          aria-label="Which ship"
          style={{
            display: "block", width: "100%", padding: "9px 32px 9px 12px", boxSizing: "border-box",
            fontFamily: UI, fontSize: 12, fontWeight: 700, color: C.ink,
            background: "rgba(11,51,49,0.6)", border: `1px solid ${C.gold}`, borderRadius: 10,
            WebkitAppearance: "none", appearance: "none", cursor: "pointer",
          }}
        >
          {fleet.map((s) => (
            <option key={s.id} value={s.id} style={{ color: "#000" }}>
              {shipName(hold, s.id)}{s.name && HULLS[s.hull] ? `, ${HULLS[s.hull].name}` : ""}
            </option>
          ))}
        </select>
        {/* the screens' own chevron, turned to point down, so the box reads as a list that opens
            rather than a field to type in; the select underneath takes the tap */}
        <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%) rotate(90deg)", display: "inline-flex", pointerEvents: "none" }}>
          <ChevronIcon size={12} />
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, margin: "8px 0 2px", fontSize: 10, color: "rgba(238,244,242,0.5)" }}>
        {sailing ? (
          <span>The ship you sail</span>
        ) : (
          <>
            <span>Not the ship you sail</span>
            <TinyButton label="Sail her" onClick={() => setActiveShip(shipId)} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Her name, and the way to give her one.
 *
 * Read, it is the name in the display face, the way the plate on the menu sets it, with the button
 * beside it saying which of two things it does: "Name her" while she goes by her class, "Rename
 * her" once she does not. Open, it is a field with the name in it and two buttons, and the keyboard's
 * own return key keeps it too. An empty name takes hers off and she goes by her class again, which
 * is said under the field so it is not a surprise.
 */
function NamePlate({ hold, shipId }) {
  const ship = hold.yard.ships[shipId];
  const named = !!(ship && ship.name);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const open = () => { setDraft(named ? ship.name : ""); setEditing(true); };
  const keep = () => { nameShip(shipId, draft); setEditing(false); };

  if (editing) {
    return (
      <form onSubmit={(e) => { e.preventDefault(); keep(); }} style={{ margin: "8px 0 2px" }}>
        <input
          autoFocus
          value={draft}
          maxLength={NAME_LIMIT}
          placeholder={HULLS[ship.hull] ? HULLS[ship.hull].name : ""}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Her name"
          style={{
            display: "block", width: "100%", boxSizing: "border-box", padding: "9px 12px",
            fontFamily: DISPLAY, fontSize: 17, color: C.gold, textAlign: "center",
            background: "rgba(11,51,49,0.6)", border: `1px solid ${C.gold}`, borderRadius: 10, outline: "none",
          }}
        />
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 8 }}>
          <TinyButton label="Keep the name" onClick={keep} />
          <TinyButton label="Cancel" onClick={() => setEditing(false)} />
        </div>
        <div style={{ fontSize: 10, color: "rgba(238,244,242,0.45)", marginTop: 6, lineHeight: 1.5 }}>
          Up to {NAME_LIMIT} letters. Leave it empty and she goes by her class.
        </div>
      </form>
    );
  }
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, margin: "8px 0 0" }}>
      <span style={{ fontFamily: DISPLAY, fontSize: 21, color: C.gold, letterSpacing: 0.4, overflowWrap: "anywhere" }}>{shipName(hold, shipId)}</span>
      <TinyButton label={named ? "Rename her" : "Name her"} onClick={open} />
    </div>
  );
}

/**
 * Her iron against her tonnage: the figure, a bar of it, and the rule in one line.
 *
 * This is the one limit in the shipyard a captain has to plan around, and for a long time it was
 * nowhere on any screen. It is a bar rather than a figure alone because "31.2 of 45.4" takes a
 * moment's arithmetic and a bar two thirds full takes none. It never runs over: the rail refuses a
 * gun she cannot bear, so a full bar is a full bar and not a warning.
 */
function IronRow({ weight, tons }) {
  const share = tons > 0 ? Math.min(1, weight / tons) : 0;
  return (
    <div style={{ padding: "6px 0 8px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "rgba(238,244,242,0.6)", letterSpacing: 0.5 }}>Weight aboard</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: share >= 1 ? C.grass : C.gold }}>{fmtTons(weight)} of {fmtTons(tons)} tons</span>
      </div>
      <div style={{ height: 4, marginTop: 6, background: "rgba(0,0,0,0.35)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${share * 100}%`, background: share >= 1 ? C.grass : C.gold, borderRadius: 3 }} />
      </div>
      <div style={{ fontSize: 10, color: "rgba(238,244,242,0.45)", lineHeight: 1.5, marginTop: 5 }}>
        A broadside cannon counts twice, one each side. Bow chasers and swivels count once. She refuses a gun she cannot bear.
      </div>
    </div>
  );
}

/**
 * A row that is a way into the outfitter: what it says on the left, what is there on the right, and
 * a chevron to say the row opens. The label and the value come in as elements so the yard's rows
 * keep the sizes and inks they had when they were plain text.
 */
function DoorRow({ label, value, indent = 0, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 8,
        background: "transparent", border: "none", padding: "5px 0", paddingLeft: indent, textAlign: "left",
        color: C.ink, cursor: "pointer", WebkitTapHighlightColor: "transparent",
      }}
    >
      {label}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {value}
        <ChevronIcon size={9} />
      </span>
    </button>
  );
}

/** One of the yard's two doors. The whole card is the button, the same way the ship plate is. */
function ShopLink({ title, sub, color, onClick }) {
  const [lit, setLit] = useState(false);
  return (
    <button
      onClick={onClick}
      onPointerEnter={() => setLit(true)}
      onPointerLeave={() => setLit(false)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
        width: "100%", textAlign: "left", padding: "12px 14px",
        borderRadius: 10, border: `1px solid ${lit ? color : C.hair}`, background: C.panel,
        color: C.ink, cursor: "pointer", WebkitTapHighlightColor: "transparent",
      }}
    >
      <span>
        <span style={{ display: "block", fontFamily: DISPLAY, fontSize: 18, color }}>{title}</span>
        <span style={{ display: "block", fontSize: 11, color: "rgba(238,244,242,0.6)", marginTop: 2 }}>{sub}</span>
      </span>
      <ChevronIcon size={12} />
    </button>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* The two shops                                                                                   */
/* ---------------------------------------------------------------------------------------------- */

/**
 * A segmented control: two to four choices, one of them on.
 *
 * Sentence case and sized rather than letterspaced, like every other control in the game. It wraps,
 * because four labels do not fit across a 320px phone and a row that scrolls sideways hides the
 * choice a captain has not thought of yet.
 */
function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "10px 0 2px" }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            style={{
              flex: "1 1 auto", fontFamily: UI, fontSize: 11, fontWeight: on ? 700 : 500,
              color: on ? C.deep : "rgba(238,244,242,0.75)",
              background: on ? C.gold : "transparent",
              border: `1px solid ${on ? C.gold : C.hair}`,
              borderRadius: 20, padding: "7px 12px", cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * WHAT EVERY CLASS IS, worked out once when the module loads rather than on every render.
 *
 * Each row is a real loadout run through the same `rate()` the fight will read, at both ends: bare is
 * one mast, one sail and a chaser, and fully found is the dearest rig she can carry with every port
 * filled. Nothing here is a second set of numbers that can drift from the catalogue's.
 */
const SHELF = HULL_LIST.map((hull) => {
  const found = maximumLoadout(hull.id);
  let berths = 0;
  for (const socket of hull.sockets) {
    const entry = found.rig[socket.id];
    if (entry && entry.mast) berths += entry.mast.berths.length;
  }
  const foundRating = rate(found);
  return {
    hull,
    band: statBand(hull.id),
    rated: rateOf(hull),
    found: foundRating,
    masts: hull.sockets.filter((s) => !s.spar).length,
    berths,
    outfit: outfitCost(hull.id),
  };
});
const shelfOf = (hullId) => SHELF.find((s) => s.hull.id === hullId);

// How the shelf can be arranged. Four, because a captain shopping for a hull is asking one of four
// different questions and the answer to "what can I afford" is a different list from "what can I
// crew". Price runs through all of them as the tie-break, so every group climbs the same way.
const SHELVING = [
  { key: "price", label: "All by price" },
  { key: "purse", label: "Price range" },
  { key: "rate", label: "Rating" },
  { key: "masts", label: "Masts" },
  { key: "canvas", label: "Sails needed" },
];

const PURSE_BANDS = [
  { title: "Under 1,000 coins", has: (s) => s.hull.price < 1000 },
  { title: "1,000 to 10,000", has: (s) => s.hull.price >= 1000 && s.hull.price < 10000 },
  { title: "10,000 to 50,000", has: (s) => s.hull.price >= 10000 && s.hull.price < 50000 },
  { title: "Over 50,000", has: (s) => s.hull.price >= 50000 },
];
const MAST_BANDS = [1, 2, 3, 4].map((n) => ({
  title: `${n} mast${n === 1 ? "" : "s"}`,
  has: (s) => s.masts === n,
}));
// What it takes to bend canvas on her, which is the question "sail types" was really asking: a hull
// with seventeen berths costs a fortune to fill however cheap she was to buy. Which CATEGORIES she
// wants is not a fact about the hull at all, because the mast a captain steps decides it.
const CANVAS_BANDS = [
  { title: "1 or 2 sails", lo: 1, hi: 2 },
  { title: "3 to 5 sails", lo: 3, hi: 5 },
  { title: "6 to 9 sails", lo: 6, hi: 9 },
  { title: "10 to 14 sails", lo: 10, hi: 14 },
  { title: "15 sails and over", lo: 15, hi: 999 },
].map((b) => ({ title: b.title, has: (s) => s.berths >= b.lo && s.berths <= b.hi }));

function shelve(how) {
  const byPrice = SHELF.slice().sort((a, b) => a.hull.price - b.hull.price || a.hull.order - b.hull.order);
  if (how === "price") return [{ title: "", ships: byPrice }];
  // By rating the bands are the rungs themselves, read off each class's ports, so a rung with no
  // class on it is simply not shown and a new class lands on hers without a band being written.
  if (how === "rate") {
    const rungs = new Map();
    for (const s of byPrice) {
      if (!rungs.has(s.rated.rung)) rungs.set(s.rated.rung, { title: s.rated.name, ships: [] });
      rungs.get(s.rated.rung).ships.push(s);
    }
    return [...rungs.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
  }
  const bands = how === "purse" ? PURSE_BANDS : how === "masts" ? MAST_BANDS : CANVAS_BANDS;
  return bands
    .map((b) => ({ title: b.title, ships: byPrice.filter(b.has) }))
    .filter((g) => g.ships.length);
}

/**
 * THE BOAT COMMISSION: the hull shop.
 *
 * A hull is the one purchase in the game a captain saves for, so the shelf leads with what she costs
 * and every row opens on what she would be. The figures are the two ends of her: bare, which is what
 * the coins actually buy, and fully found, which is what she becomes after the outfitter has had the
 * rest of the money. Both are worth seeing before committing, because the gap between them is the
 * real price of a big hull.
 */
function CommissionScreen({ hold, onBack, onBought }) {
  const [how, setHow] = useState("price");
  const [open, setOpen] = useState(null);
  const groups = useMemo(() => shelve(how), [how]);
  const fleet = ownedShips(hold);
  const owned = new Set(fleet.map((s) => s.hull));
  // How far what she owns goes towards each class, worked out once per hold rather than per row,
  // because every open row asks and the answer only moves when the hold does.
  const ready = useMemo(() => Object.fromEntries(HULL_LIST.map((h) => [h.id, readiness(hold, h.id)])), [hold]);

  const commission = (hullId) => {
    const bought = buyShip(hullId);
    // She becomes the ship the yard is looking at, and not the ship you sail: "Sail her" is its own
    // act, on the page this lands on. She used to be made active here as well, from before the yard
    // could look at any ship but the active one, and a captain who bought a bare first rate and
    // tapped a mode card went to sea in a hull with no mast and no gun.
    if (bought && onBought) onBought(bought.ship);
  };

  return (
    <Shell>
      <BackLink label="Back to the yard" onClick={onBack} />
      <div style={{ fontFamily: DISPLAY, fontSize: 30, color: C.gold, letterSpacing: 1 }}>BOAT COMMISSION</div>
      <PurseLine hold={hold} />

      {/* Her fleet above the shelf rather than under it, where it sat below sixteen rows of classes
          she was not buying. Small, because it is a list to check against the shelf, not the shelf. */}
      <Slab title={`Your ships (${fleet.length})`}>
        {fleet.map((ship, i) => {
          const active = hold.yard.active === ship.id;
          return (
            <div key={ship.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "7px 0", borderTop: i ? "1px solid rgba(160,224,210,0.14)" : "none" }}>
              <span style={{ fontSize: 12, color: active ? C.gold : C.ink }}>
                {shipName(hold, ship.id)}
                {/* her class after her name, once she has a name of her own to be told apart from */}
                {ship.name && (
                  <span style={{ fontSize: 10, color: "rgba(238,244,242,0.5)" }}>, {HULLS[ship.hull] ? HULLS[ship.hull].name : ship.hull}</span>
                )}
              </span>
              {active ? (
                <span style={{ fontSize: 10, color: "rgba(238,244,242,0.5)" }}>the ship you sail</span>
              ) : (
                <TinyButton label="Sail her" onClick={() => setActiveShip(ship.id)} />
              )}
            </div>
          );
        })}
      </Slab>

      <Segmented options={SHELVING} value={how} onChange={setHow} />

      {groups.map((g) => (
        <Slab key={g.title || "all"} title={g.title || `${g.ships.length} classes, cheapest first`}>
          {g.ships.map((s, i) => (
            <HullRow
              key={s.hull.id}
              shelf={s}
              first={i === 0}
              owned={owned.has(s.hull.id)}
              ready={ready[s.hull.id]}
              coins={hold.coins}
              open={open === s.hull.id}
              onToggle={() => setOpen(open === s.hull.id ? null : s.hull.id)}
              onBuy={() => commission(s.hull.id)}
            />
          ))}
        </Slab>
      ))}

      <StartButton onClick={onBack} label="Back to the yard" />
      <div style={{ height: 8 }} />
    </Shell>
  );
}

/**
 * Which shapes of rig a hull takes, station by station, as one sentence: "Bowsprit takes headsails,
 * fore and main take square, mizzen takes spanker." Stations that take the same shapes are said
 * together, because "fore takes square, main takes square" is the same fact twice.
 */
function socketsLine(hull) {
  const runs = [];
  for (const socket of hull.sockets) {
    const shapes = socket.rigs.length ? socket.rigs.map((f) => familyOf(f)?.name || f).join(" or ") : "any rig of her size";
    const last = runs[runs.length - 1];
    if (last && last.shapes === shapes) last.stations.push(socket.station);
    else runs.push({ shapes, stations: [socket.station] });
  }
  const say = (r) => {
    const list = r.stations.length > 1
      ? `${r.stations.slice(0, -1).join(", ")} and ${r.stations[r.stations.length - 1]}`
      : r.stations[0];
    return `${list} ${r.stations.length > 1 ? "take" : "takes"} ${r.shapes}`;
  };
  const line = runs.map(say).join(", ");
  return `Her ${line}.`;
}

/**
 * One class on the shelf, which opens on her figures.
 *
 * Closed it is a name, a price and the one line that decides whether to look further. Open it is the
 * whole stat line, both ends of it, and the button. An accordion rather than a screen of its own
 * because a captain comparing two classes should not have to leave the list to do it.
 */
function HullRow({ shelf, first, owned, ready, coins, open, onToggle, onBuy }) {
  const { hull, band } = shelf;
  const afford = coins >= hull.price;
  /* Handling is the one stat that runs BACKWARDS: fully found, under a press of canvas with every
     port filled, she is stiffer on the helm than she was bare. Printed as a plain range that reads
     as a mistake, so a falling stat says which way it goes. */
  const range = (key, dp = 0, map = (v) => v) => {
    const b = band[key];
    const f = (v) => (dp ? map(v).toFixed(dp) : Math.round(map(v)));
    if (b.low === b.high) return `${f(b.low)}`;
    return `${f(b.bare)} ${b.rises ? "to" : "down to"} ${f(b.found)}`;
  };
  return (
    <div style={{ borderTop: first ? "none" : "1px solid rgba(160,224,210,0.14)" }}>
      <button
        onClick={onToggle}
        style={{
          display: "flex", width: "100%", alignItems: "baseline", justifyContent: "space-between", gap: 8,
          background: "transparent", border: "none", padding: "8px 0", textAlign: "left",
          color: C.ink, cursor: "pointer", WebkitTapHighlightColor: "transparent",
        }}
      >
        <span>
          <span style={{ fontSize: 13, color: open ? C.gold : C.ink }}>{hull.name}</span>
          <span style={{ display: "block", fontSize: 10, color: "rgba(238,244,242,0.5)", marginTop: 2 }}>
            {plural(shelf.masts, "mast")}, {plural(shelf.berths, "sail")}, {plural(hull.guns.broadside, "gun")} a side
            {owned ? ", one in your yard" : ""}
          </span>
        </span>
        <span style={{ fontSize: 12, color: afford ? C.gold : "rgba(238,244,242,0.35)", whiteSpace: "nowrap" }}>
          {hull.price === 0 ? "free" : <Coins n={hull.price} />}
        </span>
      </button>

      {open && (
        <div style={{ padding: "2px 0 10px" }}>
          <div style={{ fontSize: 10, color: "rgba(238,244,242,0.45)", lineHeight: 1.6, marginBottom: 4 }}>
            Two figures where she changes: what she is bare, and what she becomes fully found.
          </div>
          <TallyRow label="Hull" value={range("hull")} />
          <TallyRow label="Crew" value={range("crew")} rule="hair" />
          <TallyRow label="Top speed" value={`${knots(band.speed.bare).toFixed(1)} to ${knots(band.speed.found).toFixed(1)} knots`} rule="hair" />
          <TallyRow label="Handling, of 100" value={range("turn", 1, handlingScore)} rule="hair" />
          <TallyRow label="Broadsides" value={range("broadside")} rule="hair" />
          <TallyRow label="Bow chasers" value={range("bow")} rule="hair" />
          <TallyRow label="Swivel guns" value={range("swivel")} rule="hair" />
          <TallyRow label="Muskets in a volley" value={range("muskets")} rule="hair" />
          <TallyRow label="Damage a ball, fully found" value={shelf.found.broadside.perBall.toFixed(1)} rule="hair" />
          <TallyRow label="Rated" value={shelf.rated.name} rule="group" />
          {/* What she bears in iron is on the shelf because it is the figure that decides whether a
              cheap hull with many ports can arm them: a class pierced for 12 a side that bears 45
              tons carries 36-pounders in 6 of them and nothing in the rest. */}
          <TallyRow label="Bears in guns" value={`${fmtTons(hull.tons)} tons`} rule="hair" />
          <TallyRow label="Rigging and guns to fill her out" value={<Coins n={shelf.outfit} />} rule="hair" />
          {/* Which shapes of rig her sockets take, on the shelf rather than in the mast picker after
              she is bought, so a captain with a spare suit of square rig can see it will not step in
              a xebec before paying for the xebec. */}
          <div style={{ fontSize: 10, color: "rgba(238,244,242,0.55)", lineHeight: 1.6, marginTop: 8 }}>
            {socketsLine(hull)}
          </div>
          {/* How far what she already owns goes, worked out the way "fit what you own" would do it
              on the day she buys her: a captain shopping for a hull is really shopping for a ship,
              and the difference between the two is what is in her hold. */}
          {ready && (
            <div style={{ fontSize: 10, color: "rgba(238,244,242,0.55)", lineHeight: 1.6, marginTop: 4 }}>
              {ready.fitted > 0 ? (
                <>
                  From what you own: masts for {ready.masts} of {plural(ready.sockets, "socket")}, sails for {ready.sails} of{" "}
                  {plural(ready.berths, "berth")} on them, guns for {ready.guns} of {plural(ready.ports, "port")}.
                  {" "}The rest at the cheapest: <Coins n={ready.cost} />.
                </>
              ) : (
                <>Nothing you own fits her yet. Rigging and guns at the cheapest: <Coins n={ready.cost} />.</>
              )}
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <WideButton
              label={hull.price === 0 ? "Commission her" : <span>Commission her for <Coins n={hull.price} /></span>}
              disabled={!afford}
              onClick={onBuy}
            />
            {!afford && (
              <div style={{ fontSize: 10, color: "rgba(238,244,242,0.45)", marginTop: 6 }}>
                Short by {fmtCoins(hull.price - coins)}.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * THE RIGGING OUTFITTER: masts, sails and guns for the ship she is sailing.
 *
 * One screen with a toggle at the head of it rather than two, because rigging and arming are the same
 * job done in one visit: a captain filling out a new hull moves between them a dozen times, and two
 * doors off the yard would make her walk back through it every time.
 *
 * Everything works on the ACTIVE ship. Which one that is comes from the Boat Commission, and the line
 * under the title says so, because fitting a topsail to a hull you are not sailing is the one mistake
 * this screen could invite.
 */
function OutfitterScreen({ hold, shipId: asked, onView, start, onBack }) {
  // `start` is where the yard sent her: which tab to open on.
  const [view, setView] = useState((start && start.view) || "rigging");
  // No picker is ever up on arrival, whichever row sent her: the tab opens whole, read from the
  // top, and the tap that opens a picker is made here where the picker will appear.
  const [picking, setPicking] = useState(null);
  const shipId = hold.yard.ships[asked] ? asked : hold.yard.active;
  const loadout = useMemo(() => shipLoadout(hold, shipId), [hold, shipId]);
  const stats = useMemo(() => rate(loadout), [loadout]);
  const fleetSize = Object.keys(hold.yard.ships).length;
  // Tons she has left under her cap, which is what every gun row below is measured against.
  const room = loadout.hull.tons - stats.weight;

  // Everything she owns that THIS ship is not already carrying, counted by type, so the picker can
  // offer one she owns ahead of one in the shop and a captain never buys a second of something she
  // has. Guns and canvas standing in her other hulls are in here: only one ship goes to sea, so a
  // part being aboard the frigate is no reason the sloop cannot be found with it too. What is left
  // out is this ship's own, which is what keeps ten guns from filling eleven ports.
  const spare = useMemo(() => {
    const byType = new Map();
    for (const pid of spareParts(hold, shipId)) {
      const type = partOf(hold, pid);
      if (!type) continue;
      const list = byType.get(type.id) || [];
      list.push(pid);
      byType.set(type.id, list);
    }
    return byType;
  }, [hold, shipId]);

  const close = () => setPicking(null);
  const fitFrom = (typeId, fit) => {
    const held = spare.get(typeId);
    if (held && held.length) return fit(held[0]);
    const bought = buyPart(typeId);
    if (bought) fit(bought.part);
  };

  /**
   * The same thing `n` times, for a ship with fifty ports a side.
   *
   * Fitting one gun at a time is right for a rig, where every socket takes a different mast and the
   * choice is the point. It is not right for a battery: nobody wants to tap fifty times to arm a
   * first rate, and nobody wants to tap fifty times to strip her either. It spends out of what she
   * already owns first, exactly as fitting one does, and stops the moment her purse or her ports
   * run out rather than refusing the lot.
   */
  const fitMany = (typeId, n, fit) => {
    const held = (spare.get(typeId) || []).slice();
    // Her tonnage decides the count before a coin is spent, because a gun bought and then refused at
    // the rail would land loose in the hold, paid for and going nowhere.
    const type = PARTS[typeId];
    if (type && type.part === "gun") n = Math.min(n, Math.floor(room / gunTons(type) + 1e-6));
    for (let i = 0; i < n; i++) {
      const pid = held.shift();
      if (pid) {
        if (!fit(pid)) return;
        continue;
      }
      const bought = buyPart(typeId);
      if (!bought || !fit(bought.part)) return; // her purse is out, and what she has bought is aboard
    }
  };

  return (
    <Shell>
      <BackLink label="Back to the yard" onClick={onBack} />
      <div style={{ fontFamily: DISPLAY, fontSize: 30, color: C.gold, letterSpacing: 1 }}>RIGGING OUTFITTER</div>
      <FleetStrip hold={hold} shipId={shipId} onView={(id) => { close(); if (onView) onView(id); }} />
      <div style={{ fontSize: 12, color: "rgba(238,244,242,0.7)", margin: "6px 0 0" }}>
        {/* Always names the ship, with her class after her name once she has one, because fitting a
            topsail to a hull you are not looking at is the one mistake this screen could invite. */}
        Fitting out {hold.yard.ships[shipId].name ? `${shipName(hold, shipId)}, your ${loadout.hull.name}` : `your ${loadout.hull.name}`}.
      </div>
      {/* Said only to a captain with a second hull, because it is only true of one. A part standing
          in another of her ships reads "already yours" in the pickers below and costs nothing here,
          and she is owed the reason why before she taps it. */}
      {fleetSize > 1 && (
        <div style={{ fontSize: 11, color: "rgba(238,244,242,0.5)", margin: "4px 0 0", lineHeight: 1.5 }}>
          Whatever you own can be fitted here, and what your other ships carry stays aboard them.
        </div>
      )}
      {/* Pinned above the tabs and everything under them: her purse and her figures as she stands,
          so what a tap just did, and what is left to spend, are read where the tap was made rather
          than by scrolling back. Five tiles and nothing else, each with its name over it and its
          unit or its ceiling under it, because a sentence of figures is read once and a row of
          tiles is glanced at every tap. */}
      <Pinned>
        {/* The purse is not a figure of hers, so it is not a tile: it sits on its own at the left,
            two lines centred on the strip, in the ink the figures are not, with a rule between it
            and them. The coin keeps its gold; it is the one mark on the strip and it says which
            number is money. */}
        <div style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", alignSelf: "stretch", textAlign: "center", lineHeight: 1.2 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, whiteSpace: "nowrap" }}>{fmtCoins(hold.coins)}</div>
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 3, fontSize: 8, color: "rgba(238,244,242,0.55)", marginTop: 2 }}>
            <span style={{ color: C.gold, display: "inline-flex" }}><CoinIcon size={9} /></span>coins
          </div>
        </div>
        <div aria-hidden="true" style={{ alignSelf: "stretch", width: 1, background: C.hair, margin: "0 2px" }} />
        <Stat label="Speed" value={knots(stats.speed).toFixed(1)} unit="knots" />
        <Stat label="Steer" value={handlingScore(stats.turn).toFixed(1)} unit="/100" />
        <Stat label="Damage" value={stats.broadside.perBall.toFixed(1)} unit={`${stats.broadside.count}/side`} />
        <Stat label="Weight" value={fmtTons(stats.weight)} unit={`/${fmtTons(loadout.hull.tons)} tons`} />
      </Pinned>

      <Segmented
        options={[{ key: "rigging", label: "Masts and sails" }, { key: "guns", label: "Guns" }, { key: "spares", label: "Spares" }]}
        value={view}
        onChange={(v) => { setView(v); close(); }}
      />

      {view === "rigging" &&
        loadout.hull.sockets.map((socket) => {
          const entry = loadout.rig[socket.id];
          const mast = entry && entry.mast;
          return (
            <Slab key={socket.id} title={`${socket.station.toUpperCase()}, ${socket.size}`}>
              <FitRow
                label={socket.spar ? "Spar" : "Mast"}
                value={mast ? mast.name : socket.spar ? "no spar rigged" : "no mast stepped"}
                empty={!mast}
                onClick={() => setPicking({ what: "mast", socket: socket.id })}
              />
              {mast &&
                mast.berths.map((berth, i) => {
                  const sail = entry.sails[i];
                  // a square sail that takes one gets a studdingsail row of its own under it: the
                  // stud hangs off the sail, so the row only exists while the sail does
                  const stud = (entry.studs || [])[i];
                  const takesStud = sail && studsForBerth(mast, i).length > 0;
                  return (
                    <React.Fragment key={i}>
                      <FitRow
                        indent
                        label={kindOf(berth.kind)?.name || berth.kind}
                        value={sail ? sail.name : "bare"}
                        empty={!sail}
                        onClick={() => setPicking({ what: "sail", socket: socket.id, berth: i })}
                      />
                      {takesStud && (
                        <FitRow
                          indent
                          label="Studdingsail"
                          value={stud ? stud.name : "none run out"}
                          empty={!stud}
                          onClick={() => setPicking({ what: "stud", socket: socket.id, berth: i })}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              {picking && picking.socket === socket.id && (
                <Picker
                  title={
                    picking.what === "mast"
                      ? socket.spar ? "Spars that fit" : "Masts that fit"
                      : picking.what === "stud"
                        ? "Studdingsails that boom out from this sail"
                        : "Sails that fit"
                  }
                  options={
                    picking.what === "mast"
                      ? mastsForSocket(socket)
                      : picking.what === "stud"
                        ? studsForBerth(mast, picking.berth)
                        : sailsForBerth(mast.berths[picking.berth])
                  }
                  fitted={
                    picking.what === "mast" ? mast
                      : picking.what === "stud" ? (entry.studs || [])[picking.berth]
                      : entry.sails[picking.berth]
                  }
                  // what a socket takes, said up front, so a mast she owns that is not in the
                  // list is not a mystery: it is the wrong shape of rig for this station
                  note={
                    picking.what === "mast" && socket.rigs.length
                      ? `Her ${socket.station} takes ${socket.rigs.map((f) => familyOf(f)?.name || f).join(" or ")}.`
                      : null
                  }
                  // every sail and studdingsail shows what fitting it HERE would do to her, the
                  // ship as she stands against the ship with this one in the berth
                  effect={
                    picking.what === "sail"
                      ? (type) => berthEffect(loadout, socket.id, picking.berth, type, (entry.studs || [])[picking.berth])
                      : picking.what === "stud"
                        ? (type) => berthEffect(loadout, socket.id, picking.berth, entry.sails[picking.berth], type)
                        : null
                  }
                  // a mast opens berths, and berths are purchases: its line says what the
                  // cheapest canvas on all of them would come to
                  line={picking.what === "mast" ? mastLine : undefined}
                  removeLabel={
                    picking.what === "mast"
                      ? socket.spar ? "Unrig the spar" : "Take the mast down"
                      : picking.what === "stud" ? "Take it in"
                      : "Take the sail off"
                  }
                  spare={spare}
                  coins={hold.coins}
                  onRemove={() => {
                    if (picking.what === "mast") fitMast(shipId, socket.id, null);
                    else if (picking.what === "stud") fitStud(shipId, socket.id, picking.berth, null);
                    else fitSail(shipId, socket.id, picking.berth, null);
                    close();
                  }}
                  onPick={(type) => {
                    fitFrom(type.id, (pid) => {
                      if (picking.what === "mast") fitMast(shipId, socket.id, pid);
                      else if (picking.what === "stud") fitStud(shipId, socket.id, picking.berth, pid);
                      else fitSail(shipId, socket.id, picking.berth, pid);
                    });
                    close();
                  }}
                  onClose={close}
                />
              )}
            </Slab>
          );
        })}

      {/* Her iron at the head of the guns, above every mount, because it is one figure for the whole
          battery and every gun below is bought against it. It moves as she is armed. */}
      {view === "guns" && (
        <Slab title="Weight">
          <IronRow weight={stats.weight} tons={loadout.hull.tons} />
        </Slab>
      )}
      {view === "guns" &&
        GUN_MOUNTS.map(({ mount, title, note }) => {
          const bears = loadout.hull.guns[mount];
          const shipRec = hold.yard.ships[shipId];
          // Walked off the RECORD rather than off the resolved loadout, so the id taken off the rail
          // is the id in the slot the captain tapped. `resolve()` drops a part the catalogue no
          // longer knows, which would shift every index after it and unfit the wrong gun.
          const fitted = shipRec.guns[mount].map((pid) => ({ pid, type: partOf(hold, pid) })).filter((g) => g.type);
          return (
            <Slab key={mount} title={`${title}, ${fitted.length} of ${bears}`}>
              {bears === 0 ? (
                <div style={{ fontSize: 11, color: "rgba(238,244,242,0.5)", padding: "6px 0" }}>
                  She has no ports for these.
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 10, color: "rgba(238,244,242,0.45)", lineHeight: 1.6, paddingBottom: 2 }}>{note}</div>
                  {/* A battery is rows of the same gun, so it is listed as a battery: one row a type
                      with what she has of it. Fifty rows saying "Thirty two pounder" told a captain
                      nothing fifty times over, and buried the one row that was a different gun. */}
                  {groupGuns(fitted).map(({ type, pids }) => (
                    <div key={type.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid rgba(160,224,210,0.14)" }}>
                      <span style={{ fontSize: 11, color: C.ink }}>
                        {type.name}{pids.length > 1 ? `, ${pids.length} of them` : ""}
                      </span>
                      <span style={{ display: "inline-flex", gap: 6 }}>
                        <TinyButton label="Take one off" onClick={() => unfitGun(shipId, pids[pids.length - 1])} />
                        {pids.length > 1 && (
                          <TinyButton label="Take them all off" onClick={() => { for (const pid of pids) unfitGun(shipId, pid); }} />
                        )}
                      </span>
                    </div>
                  ))}
                  {fitted.length < bears && (
                    <>
                      <FitRow
                        label="Another gun"
                        value={`${plural(bears - fitted.length, "port")} still empty`}
                        empty
                        onClick={() => setPicking({ what: "gun", mount })}
                      />
                      {bears - fitted.length > 1 && (
                        <FitRow
                          label="Fill her empty ports"
                          value={`${bears - fitted.length} at once, as far as your purse goes`}
                          empty
                          onClick={() => setPicking({ what: "gun", mount, fill: true })}
                        />
                      )}
                    </>
                  )}
                  {picking && picking.what === "gun" && picking.mount === mount && (
                    <Picker
                      title={picking.fill ? "One gun in every empty port" : "Guns for this mount"}
                      note={picking.fill ? `${fmtTons(room)} tons left under her cap. The fill stops where her tonnage or your purse does.` : null}
                      options={gunsForMount(mount)}
                      spare={spare}
                      coins={hold.coins}
                      // a gun she cannot bear is in the list and not a button, the same as one she
                      // cannot afford, and its line says which of the two it is
                      fits={(type) => gunFits(type, stats.weight, loadout.hull.tons)}
                      // what THIS gun does to THIS ship: her volley from this mount before and
                      // after, what the iron costs her helm, and what it weighs against her room
                      line={(type) => gunLine(loadout, mount, type, room)}
                      onPick={(type) => {
                        const fit = (pid) => fitGun(shipId, mount, pid);
                        if (picking.fill) fitMany(type.id, bears - fitted.length, fit);
                        else fitFrom(type.id, fit);
                        close();
                      }}
                      onClose={close}
                    />
                  )}
                </>
              )}
            </Slab>
          );
        })}

      {view === "spares" && <SparesView hold={hold} shipId={shipId} />}

      <StartButton onClick={onBack} label="Back to the yard" />
      <div style={{ height: 8 }} />
    </Shell>
  );
}

/**
 * A line that stays at the top of the screen as it scrolls, under the title and above the tabs.
 *
 * The shops are long and the figures a choice is made against, the purse and the ship as she
 * stands, were at the head of the screen and out of sight by the second slab. Sticky rather than
 * fixed, so it scrolls with the shell and sits in the flow where it is read first. The menu and the
 * yard carry nothing pinned: the yard is the reading screen and has nowhere a tap changes a figure.
 */
function Pinned({ children }) {
  return (
    <div
      style={{
        position: "sticky", top: 0, zIndex: 2, margin: "10px 0 0", padding: "6px 4px 7px",
        display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 2,
        background: "rgba(8,38,37,0.96)", border: `1px solid ${C.hair}`, borderRadius: 10,
      }}
    >
      {children}
    </div>
  );
}

/**
 * One figure in the pinned strip: its name over it, the number big, its unit under it. The number
 * is the only thing set large, because it is the only thing that changes when a captain taps.
 */
function Stat({ label, value, unit }) {
  return (
    // grows from its own content rather than from an equal share of the strip, because the purse is
    // three times the width of the speed and equal shares put the two on top of each other at 320px;
    // what room is left over is shared out evenly, which is what centres each figure in its space
    <div style={{ flex: "1 1 auto", textAlign: "center", lineHeight: 1.2, minWidth: 0 }}>
      <div style={{ fontSize: 8, color: "rgba(238,244,242,0.55)", whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.gold, margin: "1px 0", whiteSpace: "nowrap" }}>{value}</div>
      <div style={{ fontSize: 8, color: "rgba(238,244,242,0.55)", whiteSpace: "nowrap" }}>{unit}</div>
    </div>
  );
}

/** The purse, on its own line under a shop's title, because every price below is read against it. */
function PurseLine({ hold }) {
  return (
    <div style={{ fontSize: 12, color: "rgba(238,244,242,0.7)", margin: "6px 0 0" }}>
      In the hold: <span style={{ color: C.gold, fontWeight: 700 }}><Coins n={hold.coins} /></span>
    </div>
  );
}

/**
 * What one gun would do to her, for its row in the picker: the mount's volley before and after, what
 * the iron takes off her helm, and what it weighs against the room she has. "Before and after"
 * because a gun's own damage figure is not what a captain feels; her side going from 84 to 90 is.
 */
function gunLine(loadout, mount, type, room) {
  const e = gunEffect(loadout, mount, type);
  const what = mount === "broadside" ? "her side" : mount === "bow" ? "her chasers" : "her swivels";
  const volley = `${what} from ${Math.round(e.side - e.damage)} to ${Math.round(e.side)} damage`;
  const pts = handlingPoints(e.turn);
  const helm = pts < -0.5 ? `, stiffens the helm by ${Math.round(Math.abs(pts))}` : "";
  const t = gunTons(type);
  const after = room - t;
  const tons = after >= -1e-6 ? `adds ${fmtTons(t)} tons, ${fmtTons(Math.max(0, after))} left` : `adds ${fmtTons(t)} tons, more than she can bear`;
  return `${volley}${helm}, every ${type.reload.toFixed(2)}s, ${tons}`;
}

/** A mast's row: the sails it carries, and what the cheapest canvas on all of them comes to. */
function mastLine(type) {
  const canvas = cheapestCanvas(type);
  return `${partLine(type)}${canvas > 0 ? `, about ${fmtCoins(canvas)} coins to fill at the cheapest` : ""}`;
}

/**
 * THE SPARES: everything she owns that this ship is not carrying, and the way to sell it back.
 *
 * A yard where fifty guns can be bought and none sold strands a battery the moment a captain
 * changes hull, so parts sell back here, in full (see `REFUND_SHARE`). The list is what the outfitter
 * offers as "already yours", grouped by type with what is loose and what is standing in her other
 * ships, because selling one of the latter takes it off that ship and the row has to say so before
 * the tap. Loose ones go first.
 */
function SparesView({ hold, shipId }) {
  // A part standing in a sister ship is sold on the second tap, not the first: the row names her
  // and asks, because a captain selling "a spare 12-pounder" is not expecting to strip her frigate.
  // A loose part sells on the first tap; there is nothing to strip.
  const [asking, setAsking] = useState(null);
  // where every part of hers that is not on THIS ship stands: loose, or aboard which other ship
  const aboard = new Map();
  for (const [sid, ship] of Object.entries(hold.yard.ships)) {
    if (sid === shipId) continue;
    for (const slot of Object.values(ship.rig)) {
      if (slot.mast) aboard.set(slot.mast, sid);
      for (const s of slot.sails) if (s) aboard.set(s, sid);
      for (const st of slot.studs || []) if (st) aboard.set(st, sid);
    }
    for (const mount of ["broadside", "bow", "swivel"]) for (const g of ship.guns[mount]) aboard.set(g, sid);
  }
  const rows = new Map();
  for (const pid of spareParts(hold, shipId)) {
    const type = partOf(hold, pid);
    if (!type) continue;
    const row = rows.get(type.id) || { type, loose: [], standing: [] };
    (aboard.has(pid) ? row.standing : row.loose).push(pid);
    rows.set(type.id, row);
  }
  const list = [...rows.values()].sort((a, b) => a.type.part.localeCompare(b.type.part) || a.type.price - b.type.price);

  return (
    <Slab title="Spares" sub="Sold parts refund in full">
      <div style={{ fontSize: 10, color: "rgba(238,244,242,0.45)", lineHeight: 1.6, paddingBottom: 2 }}>
        Everything you own that this ship is not carrying. A part standing in another of your ships is
        listed with her, and selling it takes it off her.
      </div>
      {list.length === 0 && (
        <div style={{ fontSize: 11, color: "rgba(238,244,242,0.5)", padding: "6px 0" }}>Nothing spare. Everything you own is aboard this ship.</div>
      )}
      {list.map(({ type, loose, standing }) => {
        const where = standing.map((pid) => shipName(hold, aboard.get(pid)));
        const said = [
          loose.length ? `${loose.length} loose` : null,
          standing.length ? `${standing.length} aboard ${[...new Set(where)].join(" and ")}` : null,
        ].filter(Boolean).join(", ");
        // a loose one goes before one standing in a sister ship, so nothing is stripped that need not be
        const next = loose[0] || standing[0];
        const strips = !loose.length;
        const her = strips ? shipName(hold, aboard.get(next)) : null;
        const sell = () => { sellPart(next); setAsking(null); };
        return (
          <div key={type.id} style={{ padding: "7px 0", borderTop: "1px solid rgba(160,224,210,0.14)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span>
                <span style={{ display: "block", fontSize: 11, color: C.ink }}>{type.name}</span>
                <span style={{ display: "block", fontSize: 9, color: "rgba(238,244,242,0.45)", marginTop: 2 }}>{said}</span>
              </span>
              <TinyButton
                label={<span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Sell one for <Coins n={refundOf(type)} /></span>}
                onClick={() => (strips ? setAsking(asking === type.id ? null : type.id) : sell())}
              />
            </div>
            {strips && asking === type.id && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 6, padding: "6px 8px", border: `1px solid ${C.crew}`, borderRadius: 10 }}>
                <span style={{ fontSize: 10, color: "rgba(238,244,242,0.8)", lineHeight: 1.4 }}>
                  This one is aboard {her}. Selling it takes it off her.
                </span>
                <span style={{ display: "inline-flex", gap: 6, flexShrink: 0 }}>
                  <TinyButton label="Sell it" onClick={sell} />
                  <TinyButton label="Keep it" onClick={() => setAsking(null)} />
                </span>
              </div>
            )}
          </div>
        );
      })}
    </Slab>
  );
}

/**
 * Guns of one sort, gathered. Keeps the order she has them in, so the row a captain sees is the row
 * the shelf put there, and hands back the part ids in that order: taking one off takes the last one
 * fitted, which is the one she just bought if she has changed her mind.
 */
function groupGuns(fitted) {
  const rows = [];
  const at = new Map();
  for (const { pid, type } of fitted) {
    if (!at.has(type.id)) {
      at.set(type.id, rows.length);
      rows.push({ type, pids: [] });
    }
    rows[at.get(type.id)].pids.push(pid);
  }
  return rows;
}

// The three mounts, and what each is for. A captain buying her first gun should not have to work out
// from the name which of them puts iron into a hull.
const GUN_MOUNTS = [
  { mount: "broadside", title: "Broadsides", note: "Counted a side and mirrored: one gun bought is one gun each side. These hole a hull." },
  { mount: "bow", title: "Bow chasers", note: "They point where the bow points, and aimed high they bring a rig down." },
  { mount: "swivel", title: "Swivels", note: "On the rail, one hand to a gun. Each one adds a ball to the musket volley." },
];

/** A slot in the outfitter: what is in it, and a tap to change it. */
function FitRow({ label, value, empty, indent, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", width: "100%", alignItems: "baseline", justifyContent: "space-between", gap: 8,
        background: "transparent", border: "none", borderTop: "1px solid rgba(160,224,210,0.14)",
        padding: "8px 0", paddingLeft: indent ? 10 : 0, textAlign: "left",
        color: C.ink, cursor: "pointer", WebkitTapHighlightColor: "transparent",
      }}
    >
      <span style={{ fontSize: indent ? 9 : 11, color: "rgba(238,244,242,0.5)" }}>{label}</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: indent ? 10 : 11, color: empty ? "rgba(238,244,242,0.4)" : C.ink }}>{value}</span>
        <ChevronIcon size={9} />
      </span>
    </button>
  );
}

/**
 * What could go in a slot, in one list: what she already owns first, then what the shop sells.
 *
 * A part she owns is free to fit and a part in the shop is not, and that is the whole difference, so
 * they are one list with different right-hand ends rather than two lists a captain has to compare.
 * What she owns counts the rigging and guns standing in her other hulls as well as what is lying
 * loose, because being aboard one ship has never been a reason a part cannot be fitted to another.
 */
function Picker({ title, note, options, fitted, effect, line, fits, removeLabel, spare, coins, onPick, onRemove, onClose }) {
  // A picker opens under the row that asked for it, which on a phone is often below the fold, and
  // one opened straight from the yard is under a slab or two the captain has not scrolled past. It
  // brings itself into view, and no further than that, so a picker already on screen stays put.
  const box = useRef(null);
  useEffect(() => {
    if (box.current && box.current.scrollIntoView) box.current.scrollIntoView({ block: "nearest" });
  }, []);
  return (
    <div ref={box} style={{ borderTop: `1px solid ${C.hair}`, marginTop: 6, paddingTop: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, paddingBottom: 2 }}>
        <span style={{ fontSize: 10, letterSpacing: 1, color: C.gold }}>{title}</span>
        <TinyButton label="Close" onClick={onClose} />
      </div>
      {note && (
        <div style={{ fontSize: 10, color: "rgba(238,244,242,0.5)", lineHeight: 1.5, paddingBottom: 4 }}>{note}</div>
      )}
      {fitted && onRemove && (
        <div style={{ padding: "6px 0", borderTop: "1px solid rgba(160,224,210,0.14)" }}>
          <TinyButton label={removeLabel} onClick={onRemove} />
        </div>
      )}
      {options.map((type) => {
        const held = (spare.get(type.id) || []).length;
        // the part already in the slot is in the list, so the captain can see it against the
        // rest, and it is not a button: tapping it would buy her a second one
        const here = !!fitted && fitted.id === type.id;
        // she cannot take it if it does not fit her, whatever it costs; a gun past her tonnage is
        // the one case, and it is greyed the same way as one she cannot afford
        const bears = !fits || fits(type);
        const afford = !here && bears && (held > 0 || coins >= type.price);
        return (
          <button
            key={type.id}
            onClick={() => afford && onPick(type)}
            style={{
              display: "flex", width: "100%", alignItems: "baseline", justifyContent: "space-between", gap: 8,
              background: "transparent", border: "none", borderTop: "1px solid rgba(160,224,210,0.14)",
              padding: "8px 0", textAlign: "left", cursor: afford ? "pointer" : "default",
              opacity: afford || here ? 1 : 0.45, WebkitTapHighlightColor: "transparent",
            }}
          >
            <span>
              <span style={{ display: "block", fontSize: 11, color: here ? C.grass : C.ink }}>{type.name}</span>
              <span style={{ display: "block", fontSize: 9, color: "rgba(238,244,242,0.45)", marginTop: 2 }}>
                {/* a sail is priced by what it would do to THIS ship from here, and the one already
                    in the berth by what it is giving her, so the two read against each other; a
                    mast or a gun by its own figures, which are the same wherever it goes, unless
                    the caller has a line of its own, which a gun has: its weight against her room */}
                {effect ? effectLine(here ? giving(effect(null)) : effect(type), here ? "yard" : "shop") : line ? line(type) : partLine(type)}
              </span>
            </span>
            <span style={{ fontSize: 11, color: here || (held && bears) ? C.grass : afford ? C.gold : "rgba(238,244,242,0.4)", whiteSpace: "nowrap" }}>
              {/* "Already yours" rather than "in the hold": one of these may be standing in another
                  of her hulls this minute, and it is hers to fit here all the same. */}
              {here ? "fitted here" : !bears ? "too heavy for her" : held ? `${held} already yours` : type.price === 0 ? "free" : <Coins n={type.price} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Speed to one decimal in knots, because the reference speeds the fleet was fitted against are
// written in halves and "12 knots" against "12.4" is the difference between two sails.
const fmtKnots = (rating) => `${knots(rating).toFixed(1)} knots`;

// A part's contribution read the other way up: `berthEffect` with the berth cleared says what she
// loses, and what she loses is what the part is giving her.
const giving = (e) => ({ speed: -e.speed, turn: -e.turn });

/**
 * What a change to one berth does to her, in words. `how` is "shop", where the figure is what
 * fitting the part from here would add or cost, or "yard", where it is what the part aboard is
 * worth to her. Under a twentieth of a knot is nothing a captain could feel, so it says so rather
 * than printing 0.0.
 */
function effectLine({ speed, turn }, how) {
  const kn = knots(speed);
  const pace =
    Math.abs(kn) < 0.05 ? (how === "yard" ? "no speed to speak of" : "no change to her speed")
      : how === "yard" ? `worth ${Math.abs(kn).toFixed(1)} knots`
        : `${kn > 0 ? "adds" : "costs"} ${Math.abs(kn).toFixed(1)} knots here`;
  // the helm in the same points the handling score is read in, so "helps the helm by 3" is 3 on
  // the figure the strip and the yard print; under half a point rounds to nothing and says so
  const pts = handlingPoints(turn);
  const helm =
    Math.abs(pts) < 0.5 ? "leaves the helm alone"
      : `${pts > 0 ? "helps" : "stiffens"} the helm by ${Math.round(Math.abs(pts))}`;
  return `${pace}, ${helm}`;
}

// The figures that decide between two parts of the same sort, and no others. A mast is chosen for
// what it can carry, a sail for what it pulls and what it costs the helm, a gun for what it throws
// and how fast.
function partLine(type) {
  if (type.part === "mast") {
    return `${type.berths.length} sail${type.berths.length === 1 ? "" : "s"}: ${type.berths.map((b) => kindOf(b.kind)?.name || b.kind).join(", ")}`;
  }
  // A sail's figure is what she does to THIS ship from HERE, which is `berthEffect`'s answer and
  // the one every sail picker passes in, so this is never reached for a sail in the game as it
  // stands. It used to print the raw `drive` and `hand` coefficients, which the rules forbid; if it
  // is ever reached, her category is the one thing about a sail that is true everywhere.
  if (type.part === "sail") return kindOf(type.kind)?.name || type.kind;
  // a swivel's grouping is the other half of what quality buys, so a tighter one says so
  const group = type.group != null && type.group < 1 ? `, groups ${Math.round((1 - type.group) * 100)}% tighter than a musket` : "";
  return `${type.damage} damage every ${type.reload.toFixed(2)}s, weighs ${type.weight.toFixed(2)}${group}`;
}

// "1 sails" is the sort of thing that makes a screen look unfinished, and this shelf counts four
// different things.
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A small inline action inside a slab: a link that is a button, not a control that competes. */
function TinyButton({ label, onClick }) {
  return (
    // an explicit type, because one of these sits inside the naming form beside its Keep button and
    // a button in a form submits it unless told otherwise
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: UI, fontSize: 10, color: C.gold, background: "transparent",
        border: `1px solid ${C.hair}`, borderRadius: 20, padding: "4px 10px",
        cursor: "pointer", WebkitTapHighlightColor: "transparent",
      }}
    >
      {label}
    </button>
  );
}

/** The one action a screen is for, full width under what it acts on. */
function WideButton({ label, onClick, disabled }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        display: "block", width: "100%", fontFamily: UI, fontSize: 13, fontWeight: 700,
        color: disabled ? "rgba(238,244,242,0.4)" : C.deep,
        background: disabled ? "transparent" : C.gold,
        border: `1px solid ${disabled ? C.hair : C.gold}`,
        borderRadius: 10, padding: "11px 14px",
        cursor: disabled ? "default" : "pointer", WebkitTapHighlightColor: "transparent",
      }}
    >
      {label}
    </button>
  );
}

// A titled group inside the shell. The end screen's tally uses the same rules and radius, so the two
// screens read as one game rather than two.
//
// `centred` is for a screen that is nothing but slabs. The yard's headings sit over a list they
// introduce and belong at its left margin; the log's are the only thing telling one card from the
// next, so they are centred and set in full ink to read as the heading of a section rather than as
// the first line of it. Full ink is what the button above them uses, which is the brightest thing on
// that screen that is not a figure, and the headings are its equals.
function Slab({ title, sub, children, centred }) {
  return (
    <div style={{ background: "rgba(11,51,49,0.6)", border: `1px solid ${C.hair}`, borderRadius: 10, padding: "8px 12px 10px", margin: "12px 0", textAlign: "left" }}>
      <div
        style={{
          fontSize: 10, letterSpacing: 1, marginBottom: 2,
          color: centred ? C.ink : "rgba(238,244,242,0.55)",
          textAlign: centred ? "center" : "left",
          padding: centred ? "2px 0 5px" : 0,
          display: sub ? "flex" : "block", justifyContent: "space-between", alignItems: "baseline", gap: 8,
        }}
      >
        {/* a section title is set in caps, the same treatment as a screen's title and the game's
            proper nouns, so every heading in the game reads one way; it is a transform rather than
            a caps string so a title built from a figure or a class name stays legible in the source */}
        <span style={{ textTransform: "uppercase" }}>{title}</span>
        {/* what the rows below do when tapped, said once at the head rather than on every row */}
        {sub && <span style={{ letterSpacing: 0, color: "rgba(232,200,119,0.72)", textAlign: "right" }}>{sub}</span>}
      </div>
      {children}
    </div>
  );
}

const Coins = ({ n }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
    <CoinIcon size={12} />
    {fmtCoins(n)}
  </span>
);

/**
 * The ship on the menu, framed as the control it now is.
 *
 * She was decoration: a ship turning under the title, and nothing you could do with her. She is also
 * the only picture of the captain's own ship anywhere in the game, which makes her the obvious way in
 * to the yard, and a turning ship that does nothing when tapped is a worse answer than a still one.
 *
 * So she gets a frame, her class named in the corner and a line under her saying what tapping does.
 * The name is set in the display face rather than as a small bold label, because it is the name of a
 * ship and the game already sets its proper nouns that way: it reads as a plate on her transom
 * instead of a caption. The instruction goes underneath and centred, where it reads as a footer to
 * the whole picture rather than as a second thing competing with the name for the top line.
 *
 * The whole plate is one button. A frame you have to hit the middle of is a frame that feels broken
 * on a phone, and the ship inside it is a canvas with transparent corners.
 */
function ShipPlate({ hold, onEdit, onOutfit }) {
  const [lit, setLit] = useState(false);
  const wide = useWideViewport();
  const fleet = ownedShips(hold);
  // The plate turns any of her ships, not only the one she sails. It starts on that one, and comes
  // back to it if the ship it was showing is gone, as when the site's data is cleared in another tab.
  const [viewing, setViewing] = useState(hold.yard.active);
  const id = hold.yard.ships[viewing] ? viewing : hold.yard.active;
  const loadout = useMemo(() => shipLoadout(hold, id), [hold, id]);
  const rig = useMemo(() => ownRig(loadout), [loadout]);
  const stats = useMemo(() => rate(loadout), [loadout]);
  const sailing = id === hold.yard.active;
  const at = fleet.findIndex((s) => s.id === id);
  const step = (d) => setViewing(fleet[(at + d + fleet.length) % fleet.length].id);
  // What would stop her fighting, said on the plate: nothing bent on, or nothing to fire. Buying a
  // hull no longer makes her the ship you sail, but a captain can still choose a bare one, and the
  // mode cards are a tap away.
  const unfit = [
    stats.sails > 0 ? null : "No sail is bent on her, so she cannot get under way.",
    stats.broadside.count + stats.bow.count > 0 ? null : "She has no gun aboard, so she cannot fire.",
  ].filter(Boolean);

  // Her name over her class, and the ways off the plate. The name is what the captain called her,
  // or her class until she has one, and it is set in the display face because it is the name of a
  // ship. The class line under it is ordinary text: it is information, not a name.
  const info = (
    <div style={{ minWidth: 0, lineHeight: 1.15, textAlign: "left" }}>
      <div style={{ fontFamily: DISPLAY, fontSize: 17, color: C.gold, letterSpacing: 0.4, overflowWrap: "anywhere" }}>{shipName(hold, id)}</div>
      {/* Her class and her rate under the name, and never the same words twice on one plate: an
          unnamed ship goes by her class, so only the rate is news, and a class named for her rate,
          "6th rate", is said once. The yard's line keeps both on purpose; this is a plate, not a
          description, and it has two lines to say what she is. */}
      <div style={{ fontSize: 10, color: "rgba(238,244,242,0.55)", marginTop: 3 }}>
        {(() => {
          const rated = rateOf(loadout.hull).name;
          if (!hold.yard.ships[id].name || loadout.hull.name === rated) return rated;
          return `${loadout.hull.name}, ${rated}`;
        })()}
      </div>
      {/* Two ways off the plate besides the ship herself: sail this one, and go straight to her
          rigging. "Outfit her" is here because the outfitter is where most visits to the yard end
          up, and the yard is a scroll away from it. Sideways the column beside her is narrow, so
          the two take a row each rather than wrapping as the words happen to fall. */}
      <div style={{ display: "flex", flexWrap: "wrap", flexDirection: wide ? "column" : "row", alignItems: wide ? "flex-start" : "center", gap: 6, marginTop: 8 }}>
        {sailing ? (
          <span style={{ fontSize: 10, color: "rgba(238,244,242,0.5)" }}>The ship you sail</span>
        ) : (
          <TinyButton label="Sail her" onClick={() => setActiveShip(id)} />
        )}
        <TinyButton label="Outfit her" onClick={() => onOutfit(id)} />
      </div>
      {unfit.length > 0 && (
        <div style={{ fontSize: 10, color: C.crew, marginTop: 6, lineHeight: 1.5 }}>
          {unfit.map((line) => <div key={line}>{line}</div>)}
        </div>
      )}
    </div>
  );

  // The ship herself is the way into the yard. She is the only picture of the captain's own ship in
  // the game, and a turning ship that does nothing when tapped is a worse answer than a still one.
  const ship = (
    <button
      onClick={() => onEdit(id)}
      onPointerEnter={() => setLit(true)}
      onPointerLeave={() => setLit(false)}
      aria-label={`Open the yard for ${shipName(hold, id)}`}
      style={{ display: "block", width: wide ? GALLEON_W : "100%", flex: "0 0 auto", padding: 0, background: "transparent", border: "none", color: C.ink, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}
    >
      <MenuGalleon rig={rig} />
      {/* MenuGalleon carries a -6px bottom margin to tuck itself up under whatever follows, so this
          pays that back before spacing itself off her keel. */}
      <div style={{ textAlign: "center", paddingTop: 14, fontSize: 10, letterSpacing: 0.5, color: lit ? C.gold : "rgba(232,200,119,0.72)" }}>
        Tap the ship to edit
      </div>
    </button>
  );

  return (
    <div
      style={{
        width: "100%", margin: "10px 0 0", padding: "8px 10px 9px", boxSizing: "border-box",
        borderRadius: 10, border: `1px solid ${lit ? C.gold : C.hair}`, background: C.panel, color: C.ink,
      }}
    >
      {/* Upright: her name and figures in a row over her picture. Sideways the shell is wide enough
          for the three abreast, her name to the left of her and her figures to the right, which
          spends width the screen has on height it does not. */}
      {wide ? (
        // her name and her figures hold the top of the plate, as they do upright; only she is tall
        // Three columns with the two beside her equal, so she sits on the plate's centre line. The
        // shell is set wide enough sideways for a class name like "Bermuda Sloop light" to hold one
        // line in that column; a name longer than the room still wraps rather than pushing her off
        // centre or off the plate.
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", alignItems: "start", gap: 10 }}>
          {info}
          {ship}
          <div style={{ display: "flex", justifyContent: "flex-end" }}><QuickStats stats={stats} /></div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            {info}
            <QuickStats stats={stats} />
          </div>
          {ship}
        </>
      )}

      {/* The arrows, only once there is somewhere to turn to. They step through her ships in the
          order she bought them and wrap at either end, and the count between them says where in
          the fleet the plate is. */}
      {fleet.length > 1 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 8 }}>
          <ArrowButton back label="Previous ship" onClick={() => step(-1)} />
          <span style={{ fontSize: 10, color: "rgba(238,244,242,0.5)" }}>Ship {at + 1} of {fleet.length}</span>
          <ArrowButton label="Next ship" onClick={() => step(1)} />
        </div>
      )}
    </div>
  );
}

/**
 * Her figures as she stands, in words and numbers and nothing else: the five the fight reads off
 * `rate()`, speed as a bare figure in knots. Her weight is not here; it is a shipyard concern and the
 * yard and the outfitter carry it. Right aligned so the numbers make a column, and small, because
 * the plate is her picture first.
 */
function QuickStats({ stats }) {
  const rows = [
    ["Hull", stats.hull],
    ["Mast", stats.mast],
    ["Crew", stats.crew],
    ["Speed", knots(stats.speed).toFixed(1)],
    ["Broadsides", stats.broadside.count],
  ];
  return (
    <div style={{ flexShrink: 0, textAlign: "right", fontSize: 10, lineHeight: 1.45 }}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <span style={{ color: "rgba(238,244,242,0.5)" }}>{label} </span>
          <span style={{ color: C.ink }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

/** One of the plate's two arrows: the chevron the screens already use, in a tappable ring. */
function ArrowButton({ back, label, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", width: 36, height: 36,
        background: "transparent", border: `1px solid ${C.hair}`, borderRadius: 20,
        cursor: "pointer", WebkitTapHighlightColor: "transparent",
      }}
    >
      <ChevronIcon size={14} back={back} />
    </button>
  );
}

// Tons to one decimal, because the guns are weighed in hundredths and a cap of 45.4 read as 45
// would let a captain think a gun fits when it does not.
const fmtTons = (t) => t.toFixed(1);

function StartOverlay({ onStart, onEdit, onOutfit, onRecords, onCookies, onPrivacy, onFriends, onAccount, account, hold, note }) {
  return (
    <Shell>
      {/* The name is a lockup of two lines, and the first one carries it. STERNCHASE is the word a
          captain says; HELM & HULL sits under it at a third the size, in the same gold run dim, so
          the pair reads as one title rather than as a title and a tagline competing for the eye. */}
      {/* 44px is the size the title wants, but STERNCHASE at 44 measures wider than the 272px a
          320px phone leaves inside the shell's padding, and the last letter went off the screen.
          It gives size back on a narrow screen rather than being set small everywhere. */}
      <div style={{ fontFamily: DISPLAY, fontSize: "clamp(34px, 12vw, 44px)", color: C.gold, letterSpacing: 2, lineHeight: 1.05 }}>STERNCHASE</div>
      <div style={{ fontFamily: DISPLAY, fontSize: 15, color: "rgba(232,200,119,0.62)", letterSpacing: 3, marginTop: 4 }}>HELM &amp; HULL</div>
      {/* What the server has to say: still loading, out of reach, a voyage it would not start, or that
          progress moved to it. One line of plain prose, over the plate it is about. */}
      {note && (
        <div role="status" style={{ marginTop: 12, padding: "9px 12px", borderRadius: 10, border: `1px solid ${C.hair}`, background: "rgba(11,51,49,0.6)", fontSize: 12, lineHeight: 1.5, color: "rgba(238,244,242,0.85)", textAlign: "left" }}>
          {note}
        </div>
      )}
      <ShipPlate hold={hold} onEdit={onEdit} onOutfit={onOutfit} />
      <HoldPanel hold={hold} onRecords={onRecords} />
      <AccountRow account={account} onClick={onAccount} />
      {/* A heading over the modes, in the display face like the screens' own titles, so the mode
          cards read as a section of the menu rather than as more panels after the hold. To its
          right, in small words, what the cards are for: the same coin as the purse above, so a
          captain reads that entering a mode is how that figure grows. */}
      <div className="mode-head" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, margin: "18px 0 10px" }}>
        {/* Neither side ever breaks. Where the row is too narrow for the whole note beside the
            heading, `index.css` swaps the long wording for the short one on the row's own width. */}
        <div style={{ fontFamily: DISPLAY, fontSize: MODE_HEAD_PX, color: C.gold, letterSpacing: 1, whiteSpace: "nowrap" }}>GAME MODES</div>
        <div style={{ fontSize: 11, color: "rgba(238,244,242,0.6)", whiteSpace: "nowrap" }}>
          <span className="earn-long">Enter to earn</span>
          <span className="earn-short">Earn</span>{" "}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: C.gold, verticalAlign: "bottom" }}><CoinIcon size={11} />coins</span>
        </div>
      </div>
      {MODE_LIST.map((key) => {
        const m = MODES[key];
        return <ModeCard key={key} color={m.color} title={m.title} desc={m.desc} onClick={() => onStart(key)} />;
      })}
      {/* The one mode sailed with other people: a free-for-all in a lobby a captain makes and her
          friends join with its code. Last in the list, because it is the one that needs friends. */}
      <ModeCard color={C.gold} title="WITH FRIENDS" desc="Up to 8 captains, in a free-for-all or on two sides. Make a lobby and send your friends its code, or join theirs." onClick={onFriends} />
      <div style={{ marginTop: 16, fontSize: 11, color: "rgba(238,244,242,0.5)", lineHeight: 1.6 }}>
        Stick to sail. Your side guns hit the hull, the bow gun brings down the mast, muskets clear
        the crew. Rams can pack a punch.
      </div>
      <FullScreenButton />
      <HomeScreenHelp />
      <div style={{ marginTop: 10, display: "flex", justifyContent: "center", gap: 8 }}>
        <FootLink label="Cookie settings" onClick={onCookies} />
        <FootLink label="Privacy policy" onClick={onPrivacy} />
      </div>
    </Shell>
  );
}

/**
 * The cookie prompt: essential, analytics and advertising, with the answer kept by `consent.js`. It rides over the foot of the menu as a sheet rather than blocking the
 * screen, and the App only shows it on the menu, so a captain is never asked mid-fight.
 *
 * The copy says plainly what is true. Saved progress is the essential row and always on. Ads run for
 * everyone (`ads.js`), and the advertising switch decides only whether they are personalized, so it is
 * labelled for that; the cookies non-personalized ads still use are said in the body rather than
 * filed under essential, which they are not. Analytics run by default wherever this prompt asks, so
 * the switch starts on and the body says so. While
 * the game has no measurement ID (`measurementLive`) the row says nothing is collected yet and starts off. The Google Ads
 * conversion tag answers to the same row, which is named for whichever of the two is running. In the regions where
 * Google's own consent message asks instead, this prompt is never shown.
 *
 * The privacy policy is linked from the body, and opens as a screen of its own off the menu.
 */
function CookieConsent({ onClose, onPrivacy }) {
  const [choosing, setChoosing] = useState(false);
  const [prefs, setPrefs] = useState(() => {
    const c = getStoredConsent();
    // Unanswered, the analytics switch shows what is actually happening: on where analytics run by default.
    const analytics = hasConsentDecision() ? c.analytics : measurementLive();
    return { analytics, advertising: c.advertising };
  });
  const done = (act) => () => { act(); onClose(); };
  // What the measuring switch covers, said as what the game does: play, the game's own ads, or both.
  const said = (counts, credits) => [analyticsLive() && counts, conversionsLive() && credits].filter(Boolean).join(", and ");
  const measures = said("counts how it is played with Google Analytics", "notes which of its own ads on Google brought you here");

  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 20, display: "flex", justifyContent: "center", padding: "0 calc(12px + env(safe-area-inset-right, 0px)) calc(12px + env(safe-area-inset-bottom, 0px)) calc(12px + env(safe-area-inset-left, 0px))", pointerEvents: "none" }}>
      <div
        role="dialog" aria-labelledby="cookie-title" aria-describedby="cookie-body"
        style={{ pointerEvents: "auto", width: "100%", maxWidth: SHELL_W_WIDE, maxHeight: "calc(100vh - 24px - env(safe-area-inset-top, 0px))", overflowY: "auto", background: "#0c3533", border: `1px solid ${C.hair}`, borderRadius: 10, padding: "12px 14px 14px", fontFamily: UI, color: C.ink, textAlign: "left", boxShadow: "0 -6px 24px rgba(0,0,0,0.35)" }}
      >
        <div id="cookie-title" style={{ fontSize: 10, letterSpacing: 1, color: "rgba(238,244,242,0.55)", textTransform: "uppercase", marginBottom: 6 }}>Cookie preferences</div>
        <div id="cookie-body" style={{ fontSize: 11, color: "rgba(238,244,242,0.78)", lineHeight: 1.6 }}>
          A cookie keeps you signed in to your progress on the game's server, so it is here next time
          you play. That is essential and always on. The game is free because it shows ads from Google, which uses cookies
          to limit how often you see an ad, to measure ads and to stop fraud. You choose whether
          those ads are personalized.{measures && ` The game also ${measures}, unless you turn that off.`} Read the{" "}
          <button onClick={onPrivacy} style={{ font: "inherit", color: C.gold, background: "transparent", border: "none", padding: 0, textDecoration: "underline", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
            privacy policy
          </button>{" "}
          for the details.
        </div>

        {choosing && (
          <div style={{ marginTop: 10 }}>
            <ConsentRow title="Essential" note="Keeps you signed in to your coins, ships and records on the game's server. Always on." on locked />
            <ConsentRow title="Personalized ads" note="Lets Google choose ads based on your interests. With this off you still see ads, but they are not based on your interests."
              on={prefs.advertising} onToggle={() => setPrefs((p) => ({ ...p, advertising: !p.advertising }))} />
            <ConsentRow title={analyticsLive() || !conversionsLive() ? "Analytics" : "Ad measurement"}
              note={!measurementLive()
                ? "The game collects no play statistics yet. Your answer is kept for when it does."
                : [
                    analyticsLive() && "Lets the game count how it is played, such as which modes you enter and how voyages end, using Google Analytics.",
                    conversionsLive() && (analyticsLive()
                      ? "It also tells the game which of its own ads on Google brought you here, using Google Ads."
                      : "Lets the game see which of its own ads on Google brought you here, using Google Ads. Nothing about how you play is collected."),
                  ].filter(Boolean).join(" ")}
              on={prefs.analytics} onToggle={() => setPrefs((p) => ({ ...p, analytics: !p.analytics }))} />
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          {choosing ? (
            <>
              <ConsentButton label="Back" ghost onClick={() => setChoosing(false)} />
              <ConsentButton label="Save choices" onClick={done(() => setCustomConsent(prefs.analytics, prefs.advertising))} />
            </>
          ) : (
            <>
              <ConsentButton label="Choose" ghost onClick={() => setChoosing(true)} />
              <ConsentButton label="Reject all" ghost onClick={done(rejectNonEssential)} />
              <ConsentButton label="Accept all" onClick={done(acceptAllCookies)} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// One of the small links at the foot of the menu.
function FootLink({ label, onClick }) {
  return (
    <button onClick={onClick} style={{ fontFamily: UI, fontSize: 10, color: "rgba(238,244,242,0.5)", background: "transparent", border: "none", padding: 4, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
      {label}
    </button>
  );
}

/**
 * The privacy policy, as a screen off the menu. The words are `privacy.jsx`, which the page at
 * /privacy/ reads as well; this dresses them in the menu's slabs.
 */
/**
 * SAIL WITH FRIENDS: the lobby. Before a lobby, a captain makes one or types a friend's code; in one,
 * she sees its code and the link that carries it, who has joined, how the round is sailed (a melee,
 * or two sides, which the host picks) and how many AI ships will sail, besides them in a melee and
 * filling each side between sides, which the host sets too. Between sides every captain picks her
 * own side. Only the host starts. A round already under way when she joins is one she waits out,
 * and the next starts with her in it.
 */
function LobbyScreen({ net, note, onMake, onJoin, onRivals, onMode, onPerSide, onSide, onStart, onLeave, onReady, onBack, onRetry }) {
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  // a make or join sent and not yet answered: the buttons wait for it, so a second tap sends nothing
  const [pending, setPending] = useState(false);
  const lobby = net && net.lobby;
  useEffect(() => { setPending(false); }, [lobby && lobby.code, net && net.error]);
  const me = net && net.you;
  const host = lobby && lobby.host === me;
  const link = lobby ? `${window.location.origin}/?join=${lobby.code}` : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the link is on screen to copy by hand */ }
  };
  const make = (isPublic) => { if (pending) return; setPending(true); onMake(isPublic); };
  const join = (c) => { if (pending || !c) return; setPending(true); onJoin(c); };
  const small = { fontSize: 12, color: "rgba(238,244,242,0.78)", lineHeight: 1.6, textAlign: "left" };
  const field = { flex: 1, minWidth: 0, fontFamily: UI, fontSize: 16, letterSpacing: 2, textTransform: "uppercase", color: C.ink, background: "rgba(8,38,37,0.9)", border: `1px solid ${C.hair}`, borderRadius: 10, padding: "10px 12px" };
  const row = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "7px 0", borderTop: "1px solid rgba(160,224,210,0.14)", fontSize: 13, color: C.ink };
  // the sea takes 11 ships, so the AI the host can ask for shrinks as captains join; what is shown
  // and what Fewer and More count from is that, not the figure stored before they did
  const most = Math.max(0, 10 - (lobby ? lobby.captains.length - 1 : 0));
  const shown = lobby ? Math.min(lobby.rivals, most) : 0;
  const mine = lobby && lobby.captains.find((c) => c.userId === me);
  // between sides: who is on each, and the ships a side, which is the host's figure or the larger
  // side's captains if there are more of them, since every captain sails
  const teams = !!lobby && lobby.mode === "teams";
  const onSides = Object.fromEntries(SIDES.map((s) => [s, lobby ? lobby.captains.filter((c) => c.side === s) : []]));
  const least = Math.max(SIDE_MIN, ...SIDES.map((s) => onSides[s].length));
  const perSide = lobby ? Math.max(least, Math.min(SIDE_MAX, lobby.perSide || SIDE_MIN)) : SIDE_MIN;
  const unready = lobby ? lobby.captains.filter((c) => c.userId !== lobby.host && (!c.ready || c.away)).length : 0;
  const open = (net && net.lobbies) || [];
  return (
    <Shell>
      <BackLink label="Back to the menu" onClick={onBack} />
      <div style={{ fontFamily: DISPLAY, fontSize: "clamp(19px, 6.2vw, 24px)", color: C.gold, letterSpacing: 0.5 }}>SAIL WITH FRIENDS</div>
      {note && (
        <div role="status" style={{ ...small, marginTop: 12, padding: "9px 12px", borderRadius: 10, border: `1px solid ${C.hair}`, background: "rgba(11,51,49,0.6)" }}>
          {note}
          {net === null && !/^Connecting/.test(note) && (
            <div style={{ marginTop: 8 }}><StartButton onClick={onRetry} label="Try again" /></div>
          )}
        </div>
      )}
      {net && net.open && !lobby && (
        <>
          <Slab title="Make a lobby">
            <div style={small}>A public lobby is listed below for anyone to join. A private one is joined only with its code or invite link. Up to 8 captains, with AI ships filling the rest of the sea.</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10, flexWrap: "wrap" }}>
              <StartButton onClick={() => make(true)} label="Make a public lobby" disabled={pending} />
              <StartButton onClick={() => make(false)} label="Make a private lobby" ghost disabled={pending} />
            </div>
          </Slab>
          <Slab title="Open lobbies">
            {open.length ? open.map((l) => (
              <div key={l.code} style={row}>
                <span>{l.host}<span style={{ fontSize: 11, color: "rgba(238,244,242,0.55)" }}>{`, ${l.captains} of ${l.max} captains${l.mode === "teams" ? ", two sides" : ""}`}</span></span>
                <StartButton ghost label="Join" onClick={() => join(l.code)} disabled={pending} />
              </div>
            )) : (
              <div style={small}>No public lobbies are open right now. Make one, or join a friend's with its code.</div>
            )}
          </Slab>
          <Slab title="Join with a code">
            <div style={small}>Type the code a friend sent you.</div>
            <form onSubmit={(e) => { e.preventDefault(); join(code.trim()); }} style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input aria-label="Lobby code" value={code} maxLength={5} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Code" autoCapitalize="characters" autoComplete="off" style={field} />
              <StartButton label="Join" onClick={() => join(code.trim())} disabled={pending} />
            </form>
          </Slab>
        </>
      )}
      {lobby && (
        <>
          <Slab title="Lobby code" sub={lobby.public ? "Public: listed for anyone" : "Private: code or link only"}>
            <div style={{ fontFamily: DISPLAY, fontSize: 34, color: C.gold, letterSpacing: 6, textAlign: "center", margin: "4px 0" }}>{lobby.code}</div>
            <div style={{ ...small, textAlign: "center", wordBreak: "break-all" }}>{link}</div>
            <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
              <StartButton onClick={copy} label={copied ? "Link copied" : "Copy the invite link"} ghost />
            </div>
          </Slab>
          {/* The round, as three rows read top to bottom: what kind, how big, and between sides
              which side she is on. The host turns the first two and every captain the third;
              anyone else sees them as they stand. One sentence says what the kind means. */}
          <Slab title="The round">
            <Toggle
              options={[{ key: "ffa", label: "FREE-FOR-ALL" }, { key: "teams", label: "TEAMS" }]}
              value={lobby.mode}
              onChange={host ? onMode : null}
            />
            <div style={{ ...small, textAlign: "center", marginTop: 8 }}>
              {teams ? "Two fleets, one on each flank. Your guns cannot hurt your own side. The last side with a ship afloat wins." : "Every ship against every other. The last hull afloat wins."}
            </div>
            <Counter
              label={teams ? "Ships a side" : "AI ships"}
              sub={!host ? "set by the host" : teams ? "captains and AI together" : "besides the captains"}
              value={teams ? perSide : shown}
              onLess={host ? () => (teams ? onPerSide(Math.max(least, perSide - 1)) : onRivals(Math.max(0, shown - 1))) : null}
              onMore={host ? () => (teams ? onPerSide(Math.min(SIDE_MAX, perSide + 1)) : onRivals(Math.min(most, shown + 1))) : null}
              atLeast={teams ? perSide <= least : shown <= 0}
              atMost={teams ? perSide >= SIDE_MAX : shown >= most}
            />
            {teams && (
              <Toggle
                style={{ marginTop: 10 }}
                options={SIDES.map((s) => ({
                  key: s, label: SIDE_COLORS[s].name, color: SIDE_COLORS[s].fill,
                  sub: `${onSides[s].length} ${onSides[s].length === 1 ? "captain" : "captains"}`,
                  disabled: onSides[s].length >= SIDE_MAX,
                }))}
                value={mine ? mine.side : null}
                onChange={onSide}
              />
            )}
          </Slab>
          <Slab title={`Captains, ${lobby.captains.length} of 8`}>
            {lobby.captains.map((c) => (
              <div key={c.mid} style={row}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  {/* between sides, her side as a dot in its colour, which is how her ship reads at sea */}
                  {teams && c.side && SIDE_COLORS[c.side] && (
                    <span aria-label={SIDE_COLORS[c.side].name} style={{ flex: "0 0 auto", width: 10, height: 10, borderRadius: 20, background: SIDE_COLORS[c.side].fill }} />
                  )}
                  <span>
                    {c.name}
                    {c.userId === me && <span style={{ fontSize: 11, color: "rgba(238,244,242,0.55)" }}>, you</span>}
                  </span>
                </span>
                {/* the host is named as such on the right, where the others say whether they are
                    ready; in plain ink, since green is the word for ready and the host never is */}
                <span style={{ fontSize: 12, fontWeight: 700, color: c.away ? C.gold : c.userId === lobby.host ? C.ink : c.ready ? C.grass : "rgba(238,244,242,0.55)" }}>
                  {c.away ? "Away" : c.userId === lobby.host ? "Host" : c.ready ? "Ready" : "Not ready"}
                </span>
              </div>
            ))}
          </Slab>
          {lobby.state === "sailing" ? (
            <div style={{ ...small, textAlign: "center", margin: "14px 0" }}>A round is under way. You will sail in the next one.</div>
          ) : host ? (
            <div style={{ textAlign: "center", margin: "14px 0" }}>
              <StartButton onClick={onStart} disabled={unready > 0 || lobby.state === "starting"}
                label={lobby.state === "starting" ? "Starting" : "Start the round"} />
              {unready > 0 && (
                <div style={{ ...small, textAlign: "center", marginTop: 8 }}>
                  {unready === 1 ? "Waiting for 1 captain to be ready or come back." : `Waiting for ${unready} captains to be ready or come back.`}
                </div>
              )}
            </div>
          ) : (
            <div style={{ textAlign: "center", margin: "14px 0" }}>
              <StartButton onClick={() => onReady(!(mine && mine.ready))} label={mine && mine.ready ? "I'm not ready" : "I'm ready"} ghost={!!(mine && mine.ready)} />
              <div style={{ ...small, textAlign: "center", marginTop: 8 }}>
                {mine && mine.ready ? "The host can start once everyone is ready." : "Tap when you are ready to sail."}
              </div>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "center" }}>
            <StartButton onClick={onLeave} label="Leave the lobby" ghost />
          </div>
        </>
      )}
    </Shell>
  );
}

/**
 * A choice between a few things, as one bar split into equal halves: the one chosen is filled and
 * the rest are outlined, so the bar reads as a switch and not as a row of buttons. Each option takes
 * its own colour when it has one (a side's), the gold otherwise. With no `onChange` it only shows
 * the choice, for a captain who does not get to make it.
 */
function Toggle({ options, value, onChange, style }) {
  return (
    <div role="radiogroup" style={{ display: "flex", border: `1px solid ${C.hair}`, borderRadius: 10, overflow: "hidden", background: "rgba(8,38,37,0.6)", ...style }}>
      {options.map((o, i) => {
        const on = o.key === value, col = o.color || C.gold;
        const can = !!onChange && !on && !o.disabled;
        return (
          <button key={o.key} role="radio" aria-checked={on} disabled={!can} onClick={() => can && onChange(o.key)}
            style={{ flex: "1 1 0", minWidth: 0, padding: "10px 6px", border: "none", borderLeft: i ? `1px solid ${C.hair}` : "none", background: on ? col : "transparent", color: on ? C.deep : col, fontFamily: UI, fontSize: 13, fontWeight: 800, lineHeight: 1.2, cursor: can ? "pointer" : "default", opacity: o.disabled && !on ? 0.4 : 1, WebkitTapHighlightColor: "transparent" }}>
            <div>{o.label}</div>
            {o.sub && <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.8, marginTop: 2 }}>{o.sub}</div>}
          </button>
        );
      })}
    </div>
  );
}

/** A figure with a step down and a step up beside it, on one row with its label. Without the steps it only shows the figure. */
function Counter({ label, sub, value, onLess, onMore, atLeast, atMost }) {
  const stepStyle = (off) => ({ width: 36, height: 36, borderRadius: 10, border: `1px solid ${C.gold}`, background: "transparent", color: C.gold, fontFamily: UI, fontSize: 18, fontWeight: 700, lineHeight: 1, cursor: off ? "default" : "pointer", opacity: off ? 0.35 : 1, WebkitTapHighlightColor: "transparent" });
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 10 }}>
      <span style={{ textAlign: "left" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{label}</div>
        <div style={{ fontSize: 11, color: "rgba(238,244,242,0.55)" }}>{sub}</div>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {onLess && <button aria-label="Fewer" disabled={atLeast} onClick={onLess} style={stepStyle(atLeast)}>&minus;</button>}
        <span style={{ fontSize: 20, fontWeight: 800, color: C.gold, minWidth: 22, textAlign: "center" }}>{value}</span>
        {onMore && <button aria-label="More" disabled={atMost} onClick={onMore} style={stepStyle(atMost)}>+</button>}
      </span>
    </div>
  );
}

/**
 * The menu's line about her account, under the hold it keeps. A guest is offered the way to keep her
 * progress; a signed-in captain sees who she is signed in as. Both open the account screen. Nothing
 * shows until the server has said who she is, or while it offers no way of signing in to a guest.
 */
function AccountRow({ account, onClick }) {
  if (!account) return null;
  const { guest, email, google, methods } = account;
  if (guest && !methods.email && !methods.google) return null;
  const label = guest ? "Save your progress" : google ? "Signed in with Google" : "Signed in";
  const sub = guest ? "Sign in to keep your ships and coins, on any device" : email;
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
        width: "100%", margin: "-8px 0 18px", padding: "9px 12px 10px", textAlign: "left",
        background: "rgba(11,51,49,0.6)", border: `1px solid ${guest ? C.gold : C.hair}`, borderRadius: 10,
        fontFamily: UI, color: "rgba(238,244,242,0.78)", cursor: "pointer", WebkitTapHighlightColor: "transparent",
      }}
    >
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 11, color: guest ? C.gold : "rgba(238,244,242,0.78)" }}>{label}</span>
        <span style={{ display: "block", fontSize: 10, color: "rgba(238,244,242,0.5)", lineHeight: 1.6, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span>
      </span>
      <ChevronIcon />
    </button>
  );
}

/**
 * Her account. A guest signs in here, with a code sent to her email or with Google, whichever the
 * server has turned on; a signed-in captain sees who she is signed in as, and can sign out or delete
 * the account. Signing in to an account that already has progress replaces this browser's, so a guest
 * with something to lose is told that before she starts, not after.
 */
function AccountScreen({ account, onBack, onDone }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const small = { fontSize: 12, color: "rgba(238,244,242,0.78)", lineHeight: 1.6, textAlign: "left" };
  const field = { flex: 1, minWidth: 0, fontFamily: UI, fontSize: 16, color: C.ink, background: "rgba(8,38,37,0.9)", border: `1px solid ${C.hair}`, borderRadius: 10, padding: "10px 12px" };
  const title = { fontFamily: DISPLAY, fontSize: "clamp(19px, 6.2vw, 24px)", color: C.gold, letterSpacing: 0.5 };
  // a ref as well as the state: the button inside each form submits it as well as clicking, in the
  // same tick, and the second must find the first already under way
  const going = useRef(false);
  const run = async (fn) => {
    if (going.current) return;
    going.current = true;
    setBusy(true);
    setNote("");
    try { await fn(); } finally { going.current = false; setBusy(false); }
  };

  const send = () => run(async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setNote("That does not look like an email address."); return; }
    const r = await sendCode(email);
    if (r === "sent") { setSentTo(email.trim()); setCode(""); }
    else setNote(r === "slow" ? "Too many codes asked for. Wait a minute and try again." : r === "offline" ? "The server cannot be reached. Try again in a moment." : "That email address was not accepted.");
  });
  const verify = () => run(async () => {
    const r = await signInWithCode(sentTo, code);
    if (r === "ok") onDone("You are signed in. Your progress is saved to your account.");
    else setNote(r === "wrong" ? "That code is wrong or has run out. Check it, or send a new one." : r === "slow" ? "Too many tries. Wait a minute and try again." : "The server cannot be reached. Try again in a moment.");
  });
  const google = () => run(async () => {
    await signInWithGoogle();
    setNote("The server cannot be reached. Try again in a moment.");
  });
  const leave = () => run(async () => {
    if (await signOut()) onDone("You are signed out. Sign in again to pick up your progress.");
    else setNote("Signing out did not work. Try again in a moment.");
  });
  const remove = () => run(async () => {
    if (await deleteAccount()) onDone("Your account and its progress are deleted.");
    else setNote("Deleting your account did not work. Try again in a moment.");
  });

  const status = note && (
    <div role="status" style={{ ...small, marginTop: 12, padding: "9px 12px", borderRadius: 10, border: `1px solid ${C.hair}`, background: "rgba(11,51,49,0.6)" }}>{note}</div>
  );

  if (!account.guest) {
    return (
      <Shell>
        <BackLink label="Back to the menu" onClick={onBack} />
        <div style={title}>YOUR ACCOUNT</div>
        {status}
        <Slab title="Signed in">
          <div style={{ fontSize: 14, color: C.ink, overflowWrap: "anywhere" }}>{account.email}</div>
          <div style={{ ...small, marginTop: 6 }}>
            {account.google ? "With Google. " : ""}Your progress is saved to this account. Sign in with it on any device to pick it up there.
          </div>
        </Slab>
        <Slab title="Sign out">
          <div style={small}>This browser starts again as a guest. Your progress stays with your account.</div>
          <div style={{ marginTop: 10 }}><StartButton ghost onClick={leave} label={busy ? "Signing out" : "Sign out"} /></div>
        </Slab>
        <Slab title="Delete my account">
          {confirmDelete ? (
            <>
              <div style={small}>This deletes your account, your ships, your coins and your records for good. It cannot be undone.</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                <StartButton onClick={remove} label={busy ? "Deleting" : "Delete everything"} />
                <StartButton ghost onClick={() => setConfirmDelete(false)} label="Keep my account" />
              </div>
            </>
          ) : (
            <>
              <div style={small}>Delete your account and everything saved with it.</div>
              <div style={{ marginTop: 10 }}><StartButton ghost onClick={() => setConfirmDelete(true)} label="Delete my account" /></div>
            </>
          )}
        </Slab>
      </Shell>
    );
  }

  const { methods } = account;
  return (
    <Shell>
      <BackLink label="Back to the menu" onClick={onBack} />
      <div style={title}>SAVE YOUR PROGRESS</div>
      <div style={{ ...small, marginTop: 10 }}>
        You are playing as a guest, so your progress is kept only in this browser, and only for 90 days
        after your last visit. Sign in to keep it for good and to play on with it on another device.
      </div>
      {hasProgress() && (
        <div style={{ ...small, marginTop: 10, padding: "9px 12px", borderRadius: 10, border: `1px solid ${C.gold}`, background: "rgba(11,51,49,0.6)" }}>
          A new account keeps what you have now. If you sign in to an account that already has progress,
          that account's progress replaces this browser's.
        </div>
      )}
      {status}
      {methods.email && (
        <Slab title="Sign in with email">
          {sentTo ? (
            <>
              <div style={small}>We sent a 6-digit code to <span style={{ color: C.ink, overflowWrap: "anywhere" }}>{sentTo}</span>. It works for 10 minutes.</div>
              <form onSubmit={(e) => { e.preventDefault(); verify(); }} style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <input
                  aria-label="Sign-in code" value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="Code"
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} style={{ ...field, letterSpacing: 4 }}
                />
                <StartButton onClick={verify} label={busy ? "Checking" : "Sign in"} />
              </form>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                <StartButton ghost onClick={send} label="Send a new code" />
                <StartButton ghost onClick={() => { setSentTo(null); setNote(""); }} label="Use another email" />
              </div>
            </>
          ) : (
            <>
              <div style={small}>We will email you a 6-digit code to type in here. No password.</div>
              <form onSubmit={(e) => { e.preventDefault(); send(); }} style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <input
                  aria-label="Email address" type="email" value={email} autoComplete="email" autoCapitalize="none" placeholder="Email address"
                  onChange={(e) => setEmail(e.target.value)} style={field}
                />
                <StartButton onClick={send} label={busy ? "Sending" : "Send code"} />
              </form>
            </>
          )}
        </Slab>
      )}
      {methods.google && (
        <Slab title="Sign in with Google">
          <div style={small}>Google asks which account to use, then brings you back here.</div>
          <div style={{ marginTop: 10 }}><StartButton ghost onClick={google} label="Continue with Google" /></div>
        </Slab>
      )}
    </Shell>
  );
}

function PrivacyScreen({ onBack }) {
  const P = ({ children }) => <p style={{ fontSize: 11, color: "rgba(238,244,242,0.78)", lineHeight: 1.6, margin: "6px 0", textAlign: "left" }}>{children}</p>;
  return (
    <Shell>
      <BackLink label="Back to the sea" onClick={onBack} />
      <div style={{ fontFamily: DISPLAY, fontSize: "clamp(19px, 6.2vw, 24px)", color: C.gold, letterSpacing: 0.5 }}>PRIVACY POLICY</div>
      <div style={{ marginTop: 8 }}>
        <PrivacyPolicy Section={Slab} P={P} linkColor={C.gold} />
      </div>
      <StartButton onClick={onBack} label="Back to the sea" />
    </Shell>
  );
}

// One category: what it is and what it does on the left, its switch on the right.
function ConsentRow({ title, note, on, locked, onToggle }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 0", borderTop: "1px solid rgba(160,224,210,0.14)" }}>
      <div>
        <div style={{ fontSize: 11, color: C.ink }}>{title}</div>
        <div style={{ fontSize: 10, color: "rgba(238,244,242,0.5)", lineHeight: 1.5, marginTop: 2 }}>{note}</div>
      </div>
      <button
        role="switch" aria-checked={!!on} aria-label={locked ? `${title}, always on` : title}
        disabled={locked} onClick={onToggle}
        style={{ flexShrink: 0, position: "relative", width: 38, height: 22, borderRadius: 20, border: `1px solid ${on ? C.gold : C.hair}`, background: on ? (locked ? "rgba(232,200,119,0.45)" : C.gold) : "rgba(8,38,37,0.9)", padding: 0, cursor: locked ? "default" : "pointer", WebkitTapHighlightColor: "transparent" }}
      >
        <span style={{ position: "absolute", top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: 20, background: on ? C.deep : "rgba(238,244,242,0.55)", transition: "left 120ms" }} />
      </button>
    </div>
  );
}

// The menu's own gold button, a size down so three fit across a phone.
function ConsentButton({ label, ghost, onClick }) {
  return (
    <button onClick={onClick} style={{ fontFamily: UI, fontSize: 12, fontWeight: 700, color: ghost ? C.gold : C.deep, background: ghost ? "transparent" : C.gold, border: `1px solid ${C.gold}`, borderRadius: 10, padding: "9px 14px", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
      {label}
    </button>
  );
}

/**
 * Full screen, where the browser allows it. Android Chrome and every desktop browser take the
 * request and drop their own bars; iPhone Safari does not offer it to a page at all, so there the
 * button never shows and the way to a full screen is Share, then Add to Home Screen, which the
 * manifest and the meta tags in `index.html` make open without the address bar. A game already
 * opened from the home screen has nothing to ask for either, so the button stays off there too.
 */
function FullScreenButton() {
  const [on, setOn] = useState(() => !!document.fullscreenElement);
  const can = !!document.fullscreenEnabled && !!document.documentElement.requestFullscreen
    && !window.matchMedia?.("(display-mode: standalone), (display-mode: fullscreen)").matches
    && !navigator.standalone;
  useEffect(() => {
    if (!can) return;
    const sync = () => setOn(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [can]);
  if (!can) return null;
  const toggle = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
  };
  return (
    <button
      onClick={toggle}
      style={{ marginTop: 14, fontFamily: UI, fontSize: 10, color: "rgba(238,244,242,0.5)", background: "transparent", border: `1px solid ${C.hair}`, borderRadius: 10, padding: "6px 12px", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}
    >
      {on ? "Leave full screen" : "Play full screen"}
    </button>
  );
}

/**
 * How to put the game on a phone's home screen, folded shut at the foot of the menu. It is the only
 * way to a full screen on an iPhone, and the manifest makes it open without the address bar on both.
 * The steps name the browser's own words (Share, Add to Home Screen, Install app) and where the
 * menu hides them, never an icon's shape or a position on the bar, because those are what move
 * between releases. A game already opened from the home screen has nothing to learn here, so it
 * stays off there, by the same test as the full screen button.
 */
function HomeScreenHelp() {
  const [open, setOpen] = useState(false);
  const installed = window.matchMedia?.("(display-mode: standalone), (display-mode: fullscreen)").matches || navigator.standalone;
  if (installed) return null;
  const Step = ({ phone, children }) => (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, color: C.ink }}>{phone}</div>
      <div style={{ fontSize: 10, color: "rgba(238,244,242,0.6)", lineHeight: 1.6, marginTop: 2 }}>{children}</div>
    </div>
  );
  return (
    <div style={{ marginTop: 14, textAlign: "left", border: `1px solid ${C.hair}`, borderRadius: 10 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%", fontFamily: UI, fontSize: 11, color: "rgba(238,244,242,0.7)", background: "transparent", border: "none", padding: "9px 12px", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}
      >
        <span>Add the game to your home screen</span>
        <span style={{ display: "inline-flex", transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms" }}>
          <ChevronIcon size={12} />
        </span>
      </button>
      {open && (
        <div style={{ padding: "0 12px 12px" }}>
          <div style={{ fontSize: 10, color: "rgba(238,244,242,0.6)", lineHeight: 1.6 }}>
            From there it opens full screen like an app, with no address bar.
          </div>
          <Step phone="iPhone">
            Open the game in Safari and tap Share. If Share is not on the bar, look in the menu
            behind the three dots. Then tap Add to Home Screen.
          </Step>
          <Step phone="Android">
            Open the game in Chrome and tap the menu behind the three dots. Then tap Add to home
            screen, or Install app if that is what it offers.
          </Step>
        </div>
      )}
    </div>
  );
}

// The GAME MODES heading and every mode's name on its card are set at this one size, upright and
// sideways alike, so the cards read as the section the heading announces. One figure rather than
// two copies of 20, because the two drifted apart once on a sideways phone and it took a while to
// see that the source had not moved (`index.css` says what had).
const MODE_HEAD_PX = 20;

function ModeCard({ color, title, desc, onClick }) {
  return (
    <button onClick={onClick} style={{ display: "block", width: "100%", textAlign: "left", borderRadius: 10, border: `1px solid ${color}`, background: "rgba(13,58,56,0.85)", color: C.ink, padding: "14px 16px", marginBottom: 12, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
      <div style={{ fontFamily: DISPLAY, fontSize: MODE_HEAD_PX, color, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: "rgba(238,244,242,0.78)", lineHeight: 1.5 }}>{desc}</div>
    </button>
  );
}

// One row of the end-of-voyage tally. `rule` draws the line above it: "hair" inside a group, "group"
// where one group ends and the next begins.
function TallyRow({ label, value, rule, labelColor, valueColor, valueSize, valueWeight }) {
  return (
    // A group break gets air as well as a brighter rule. The two line weights alone are 0.20 against
    // 0.14 and read as the same line, so the space is what actually separates the sections.
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: rule === "group" ? "11px 0 6px" : "6px 0", borderTop: rule ? `1px solid ${rule === "group" ? C.hair : "rgba(160,224,210,0.14)"}` : "none" }}>
      <span style={{ fontSize: 11, color: labelColor || "rgba(238,244,242,0.6)", letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: valueSize || 13, color: valueColor || C.gold, fontWeight: valueWeight || 700 }}>{value}</span>
    </div>
  );
}

function EndOverlay({ title, titleColor, result, note, stats, mode, place, hold, banked, bounty, online, onWatch, onAgain, onMenu }) {
  const rules = modeOf(mode);

  // How she sailed.
  const statRows = [];
  if (rules.ranked && place) statRows.push(["Placement", `#${place.rank} of ${place.total}`]);
  statRows.push(["Time afloat", fmtTime(stats.time)]);
  // on the ladder a sinking is a rung, and how far up she got is the figure she came for
  statRows.push(rules.ladder ? ["Rungs climbed", `${stats.kills} of ${ladderHeight()}`] : ["Ships sunk", stats.kills]);
  if (rules.guns) statRows.push(["Masts brought down", stats.dismasted || 0]);
  statRows.push(["Damage dealt", stats.dmg]);
  statRows.push(rules.repairs ? ["Repairs bought", stats.patches || 0] : ["Rams landed", stats.rams || 0]);

  // What she was paid, kept apart from the stats and put directly above the total it makes, so the
  // column adds up on the page. "Coins earned" used to sit up among the stats, three rows from its
  // own subtotal, and named as though it were the lot when it was only what the guns took.
  //
  // The carpenter's bill is the one row that goes the other way, and it belongs here rather than
  // among the stats for exactly that reason: it is the last thing between what she took and what she
  // keeps, and a captain should be able to read straight down the column and see where the money
  // went. It is drawn in the same red as a sunk ship, and it is only shown when there is one.
  const payRows = [["From fighting", `+${fmtCoins(stats.coins)}`, null]];
  // A winner is paid for a whole round however early she ended it, and the row has to say so: a
  // captain who read "For time at sea" beside a clock showing 1:12 and a purse of 175 would be
  // owed an explanation the screen was not giving her.
  if (rules.timeCoins > 0) {
    payRows.push([stats.paidInFull ? "For a full round at sea" : "For time at sea", `+${fmtCoins(stats.timePay)}`, null]);
  }
  if (stats.winPay > 0) payRows.push(["For winning", `+${fmtCoins(stats.winPay)}`, null]);
  if (stats.repaired > 0) payRows.push(["Paid to the carpenter", `-${fmtCoins(stats.repaired)}`, C.crew]);
  return (
    <Shell>
      <div style={{ fontFamily: DISPLAY, fontSize: 40, color: titleColor, letterSpacing: 1 }}>{title}</div>
      <div style={{ fontSize: 13, color: "rgba(238,244,242,0.85)", margin: "10px 0 14px", lineHeight: 1.6 }}>{result}{note ? <><br />{note}</> : null}</div>
      <div style={{ background: "rgba(11,51,49,0.6)", border: `1px solid ${C.hair}`, borderRadius: 10, padding: "6px 12px", marginBottom: 18, textAlign: "left" }}>
        {statRows.map(([l, v], i) => <TallyRow key={l} label={l} value={v} rule={i > 0 ? "hair" : ""} />)}
        {payRows.map(([l, v, col], i) => <TallyRow key={l} label={l} value={v} valueColor={col} rule={i === 0 ? "group" : "hair"} />)}
        {/* The voyage is over and the ship's purse with it; this is the part that sails on. */}
        {/* What the server banked once it had replayed the voyage: "Counting" until it answers, and
            "Not banked" if it would not, with the reason under the column. */}
        <TallyRow label="Into the hold" value={banked === null ? "Counting" : banked === false ? "Not banked" : `+${fmtCoins(banked)}`} rule="group"
          valueColor={banked > 0 ? C.grass : banked === false ? C.crew : "rgba(238,244,242,0.5)"} />
        {/* Paid by the achievements this voyage finished, apart from what the voyage was worth,
            and between that and the total so the column still adds up. Only shown when there is
            one: most voyages finish nothing, and a row of noughts would say so every time. */}
        {bounty > 0 && <TallyRow label="For achievements" value={`+${fmtCoins(bounty)}`} valueColor={C.grass} rule="hair" />}
        <TallyRow label="Hold total" value={<span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><CoinIcon size={15} />{fmtCoins(hold.coins)}</span>} valueSize={15} valueWeight={800} />
      </div>
      {banked === false && (
        <div style={{ fontSize: 12, color: "rgba(238,244,242,0.75)", margin: "-8px 0 16px", lineHeight: 1.5 }}>
          The server could not confirm this voyage, so nothing from it was added to your hold.
        </div>
      )}
      {onWatch && (
        <div style={{ marginBottom: 10 }}>
          <StartButton onClick={onWatch} label="Spectate" ghost />
        </div>
      )}
      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        {online ? (
          <StartButton onClick={onMenu} label="Back to the lobby" />
        ) : (
          <>
            <StartButton onClick={onAgain} label="Rematch" />
            <StartButton onClick={onMenu} label="Menu" ghost />
          </>
        )}
      </div>
    </Shell>
  );
}

/**
 * What she sees while she watches the rest of a round: which ship the camera is on, how many are
 * still afloat, a button to move to the next and one to go back to her end screen. It sits at the
 * foot of the screen, where her stick and guns were, clear of the radar in the top corner.
 */
function WatchBar({ name, afloat, onNext, onStop }) {
  return (
    <div style={{ position: "absolute", bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)", left: 0, right: 0, display: "flex", justifyContent: "center", padding: "0 16px", pointerEvents: "none" }}>
      <div style={{ pointerEvents: "auto", background: C.panel, border: `1px solid ${C.hair}`, borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, width: 340, maxWidth: "100%", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: C.ink, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Spectating {name}</span>
          <span style={{ flex: "0 0 auto", fontSize: 12, color: "rgba(238,244,242,0.65)" }}>{afloat} {afloat === 1 ? "ship" : "ships"} afloat</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onNext} style={watchBtn(false)}>Next ship</button>
          <button onClick={onStop} style={watchBtn(true)}>Stop spectating</button>
        </div>
      </div>
    </div>
  );
}

const watchBtn = (ghost) => ({
  flex: "1 1 0", fontFamily: UI, fontSize: 13, fontWeight: 700, borderRadius: 10, padding: "8px 10px", cursor: "pointer",
  color: ghost ? C.gold : C.deep, background: ghost ? "transparent" : C.gold, border: ghost ? `1px solid ${C.gold}` : "none", WebkitTapHighlightColor: "transparent",
});

function StartButton({ onClick, label, ghost, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ opacity: disabled ? 0.45 : 1, fontFamily: UI, fontSize: 14, fontWeight: 700, color: ghost ? C.gold : C.deep, background: ghost ? "transparent" : C.gold, border: ghost ? `1px solid ${C.gold}` : "none", borderRadius: 10, padding: "12px 22px", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
      {label}
    </button>
  );
}

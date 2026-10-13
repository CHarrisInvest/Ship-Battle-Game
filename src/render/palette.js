/**
 * THE GAME'S COLOURS, for the sea and the chrome over it, and the two typefaces.
 */

// The sea is three tones of one hue, laid down by depth: open water everywhere, the shallows banked
// around each island, and a thin beach rim where the bottom comes up to meet the sand. Everything the
// UI paints on top of the water — panels, scrims, the grid — is the same hue run down to near black,
// so the chrome reads as the sea in shadow rather than as a second, unrelated colour scheme.
export const C = {
  water: "#2a8f8b",      // open water — the main sea, and the page background behind it
  shallows: "#45b39d",   // the bank of shallow water an island sits in
  beachRim: "#7fd0bd",   // the thin band right where the water meets the sand
  foam: "#f4fffc",       // a cap catching the light as it breaks
  waterEdge: "#1c6663",  // outside the buoys: open water run deep, so the arena reads as the bright part
  deep: "#0b3331",       // the sea at its darkest — panel grounds, and ink on a gold field
  grid: "rgba(9,52,50,0.10)",
  player: "#ece2cc",
  playerStroke: "#b3a684",
  // Round shot is cast iron, and going dark reads better than the gold it replaces almost
  // everywhere, because every ground it crosses but one is lighter than it. Against the gold, by
  // ground: open water 2.93 to 2.32, the shallows 4.44 to 1.53, grass 4.27 to 1.59, sand 5.88 to
  // 1.15, the rim where the water meets the sand 6.32 to 1.07. A gold ball crossing an island was
  // very nearly not there at all.
  //
  // The exception is dark water: 1.70 out past the buoys, and as little as 1.08 where the weather
  // has the sea darkened outside the ring, which is a ball nobody can see. So the ball is not one
  // mass but two, and the second is the answer to the first. The light off the top of it scores
  // 2.96 to 5.45 on exactly those dark grounds, where the body has nothing, and falls to 1.55 on
  // open water, where the body has 2.93. Whichever ground it crosses, one of the two is holding it.
  // The trail does the same job again from further out, 5.73 to 11.66 on the dark grounds, and a
  // round shot is only ever on screen while it is flying, so the trail is always there.
  ball: "#333b42",
  ballLit: "#9aa5af",   // the light off the top of it, which is what makes it a sphere and not a hole
  smoke: "#e6efec",     // powder smoke: what a gun leaves behind and what a ball drags after it
  pellet: "#dfefff",
  hull: "#d99a3c",
  // Mast reads on three grounds: the enemy bar's 50%-black backing, the player's HUD bar, and the
  // FRONT gun button — the bow gun brings masts down, so it carries this colour too. It was a teal
  // barely a shade off open water (1.41 contrast) and vanished against the sea. Pale rather than
  // navy on purpose: a dark blue scores 1.01 against the bar's own dark backing, which would make a
  // full mast bar look exactly like an empty one.
  mast: "#a8c4ff",
  crew: "#d15b5b",
  side: "#e8c877",
  front: "#7a9cc6",
  splinter: "#b98a4a",
  gold: "#e8c877",
  panel: "rgba(11,51,49,0.80)",
  hair: "rgba(160,224,210,0.20)",
  ink: "#eef4f2",
  sand: "#cbb98a",
  sandDark: "#a8935f",
  grass: "#6fae5c",
  frond: "#4f9a3f",
  frondDk: "#2f6634",
  coconut: "#b58a4a",
  sail: "#f4ecd8",
  wood: "#6b4a2b",
  woodLit: "#8d6740",
  hullWood: "#7c5a37",
  hullDeck: "#8c6a44",
  hullDark: "#48331f",
  boundary: "#e8c877",
  buoyA: "#d15b5b",
  buoyB: "#eef4f2",
};

export const AI_COLORS = [
  { fill: "#c15236", stroke: "#8a3722" },
  { fill: "#c98a3b", stroke: "#8f5f22" },
  { fill: "#a6584f", stroke: "#743833" },
  { fill: "#7a9c8f", stroke: "#4d6a5f" },
  { fill: "#9c7ab0", stroke: "#5f4d6a" },
  { fill: "#b0a24f", stroke: "#6a5f2a" },
  { fill: "#6f93b4", stroke: "#425a70" },
  { fill: "#c76b8e", stroke: "#7f3f57" },
  { fill: "#5fa27f", stroke: "#356050" },
  { fill: "#b8794f", stroke: "#7a4b2c" },
];

export const UI = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

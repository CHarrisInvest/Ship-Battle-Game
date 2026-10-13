# The engine

Design note for `src/sim/`, the part of Sternchase that decides what happens in a round, and for how
the screen drives it. It is Stage A of the road to online play: the game plays as it always did, but
the simulation now lives in plain JavaScript that a browser or a Node server can run unchanged.

## The split

| Folder | Holds | Reads |
| --- | --- | --- |
| `src/sim/` | The world, the step, ships, guns, rams, the AI, the weather, the round's rules and its end, the mode rules, the dice | Itself, `shipyard.js`, `shipref.js`, `hullform.js` |
| `src/render/` | The canvas: camera, water, islands and their planting, hulls and rigs, shot, smoke and wakes, the vignette, the radar, interpolation | The world, never writing to it |
| `src/input/` | The joystick, the fire buttons and the repair rail, turned into an input record | Nothing of the round |
| `src/SternchaseIso.jsx` | The menus, the shipyard screens, the HUD, the end screen, and the frame loop that joins the rest | Everything above |

Only the engine decides what happens in a round. `hold.js`, `analytics.js`, `ads.js` and `consent.js`
are called from the component, never from the engine.

## The interface

```js
import { createWorld, step, voyageStats, repairQuote, TICK } from "./sim/index.js";

const world = createWorld({ mode: "ffa", seed, players: [{ id: "p1", loadout }] });
const events = step(world, { p1: { joyMag, joyAng, broadside, bow, musket, repair } });
voyageStats(world, "p1");            // what she has earned so far
repairQuote(world, "p1", "hull");    // what a patch would cost her now
```

- **`createWorld`** lays out a round. `players` is a list so a second human can come aboard without
  the call changing; today there is one. The field is matched against the first.
- **`step`** advances exactly one `TICK` (1/60 s) and returns what happened in it. A round that is
  over stays over.
- **Inputs** are one record per human, keyed by player id: the stick's reach and world heading, the
  three fire buttons, and `repair`, `"hull"` or `"mast"`, which the step that reads it spends. A repair
  goes the same road as the wheel so that it reaches the engine the same way wherever the engine is.
- **The world** is plain data: no functions, nothing from the page. `structuredClone(world)` works,
  and the headless test checks it every round. Ships keep the field names the game always used;
  `controller` (`"human"` or `"ai"`) and `playerId` replaced `isPlayer`, and `world.players` maps a
  player id to her ship's id. The mode's rules ride on the world as its row of `MODES`, which is data
  too: the two rules that are worked out rather than read name a function in `modes.js`.
- **`world.result`** is `{ over, winners, losers, field }` once the round ends: each winner is a
  `{ playerId, rank }`, each loser carries her `cause` as well (`"hull"`, `"crew"`, `"storm"` or
  `"together"`), and `field` is how many ships started, for the placement line.

## Events

The engine says what happened and never how it looks. Every event carries ids and numbers, never a
reference into the world, so it can be drawn, counted or sent anywhere.

| Event | Fields | Who uses it |
| --- | --- | --- |
| `fired` | `shipId, weapon, x, y, dir` | the renderer: flash and smoke, one per gun per side for a broadside |
| `hit` | `targetId, bar, dmg, x, y, by, cause` | the renderer: splinters where it bit, the hull's flash, the vignette |
| `splash` | `x, y` | the renderer |
| `sunk` | `shipId, by, cause, x, y` | the renderer: wreckage, and `SUNK` or `LOST` over a rival |
| `dismasted` | `shipId, by, x, y` | the renderer: `MAST DOWN` or `OUR MAST!` |
| `repaired` | `shipId, system, coins` | the HUD, which answers the tap at once |
| `round_over` | `result` | the component: end screen, its sentence, banking and analytics, once |

The HUD needs no event: the frame loop reads the world at most every 0.09 s and tells React only when
something it shows has moved. Wakes, bow spray and a ship's heel are worked out by the renderer from
how each ship is sailing. The end screen's sentences are the component's, picked from `cause`; a
server should never carry copy.

## Determinism

The same seed and the same inputs give the same round, on a phone, a laptop or a server.

- **The dice.** `rng.js` is mulberry32 with its whole state on `world.rng`. Every gameplay draw comes
  off it: ship personalities, islands, spawns, loadout picks, the AI's retargeting and wandering, the
  way out of a heap, gun timing and spread. What only decorates the sea (smoke, sparks, splashes,
  spray, the idle heel) stays on `Math.random()` in the renderer, so two viewers' smoke may differ.
  An island's planting is grown by the renderer from dice seeded where the island stands.
- **The step.** The frame loop banks real time and steps once per whole `TICK` banked, at most five a
  frame, so a backgrounded tab does not try to catch up minutes of play. Drawing blends each ship
  and each ball between where the last step found it and where it left it, by the time left over.
  The effects, the camera's clock and the waves still run on real frame time.

## Purity

Nothing under `src/sim/` imports React, the renderer, the menus, the hold, analytics, ads or consent,
or anything from npm, and nothing there mentions `window`, `document`, `localStorage`, a canvas,
`Math.random`, `Date.now` or `performance`. `npm run purity` enforces it, and holds the three
catalogue modules the engine imports to the same rules. It runs first in the smoke test and in the
deploy, before the build.

`hullform.js` is on the allowed list as well as `shipyard.js` and `shipref.js`: a ship's length and
beam are her collision ellipse, and they live with her art there. It imports only `shipref.js` and
touches nothing of the page.

## Tests

- `npm run sim-test` plays every mode to its end in plain Node, idle and driven, in the starter's
  gundalow and in a fully found first rate, and sails each round twice from one seed. It fails on a
  round that never ends, a ship whose figures stop being numbers, a world or a result that differs
  between the two sailings, a world that is not plain data, an event that carries a reference, a
  voyage that does not add up, an end said more than once, or a repair that charges for something
  other than what it puts back. It runs in the deploy too.
- `npm run smoke` plays the built game in a browser as before.

## Questions this stage answered

- **Does the AI read anything but the world?** No. Every AI function takes the world and her own
  ship; target choice reads ships' positions, headings, bars, strength and earnings, and nothing on
  the screen. The purity check would fail if one reached for the page.
- **Do `CLAUDE.md`'s rules move into the code they describe?** No. The rules stay in `CLAUDE.md`,
  where a change to one is a change to the one statement of it; the code keeps the reasoning in its
  comments, as it always has, and moved with it.
- **Does banking survive the move?** It happens once, in the component's `round_over` handler,
  guarded by `world.banked`, and the smoke test still checks the end screen's column against the
  hold.

## Left for later stages

- **More than one human in a world (Stage B).** The interface already takes a list of players and an
  input record per player id, ships say who sails them, and a non-melee mode's hunters chase the
  nearest human afloat. What is not decided: where a second captain starts, whose round goes on when
  one sinks (today her sinking ends it), how a second viewer's ship is drawn, and how a ranked mode
  places several humans.
- **The tick rate on a server (Stage D).** 60 steps a second matches what a 60 Hz phone always ran.
  A server with six players might want 30, which changes how volleys and rams resolve; that trade is
  for measurements, not for this stage.
- **What goes over the wire (Stage D).** Events are already ids and numbers. The world copies with
  `structuredClone`; a network snapshot will want less of it.

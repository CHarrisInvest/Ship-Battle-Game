# Online free-for-all: design

Status: draft for review. Date: 2026-10-13.

Sternchase plays one captain against the AI. This is the design for taking it online: friends host
a lobby, share a code, and fight one free-for-all round together, with AI ships filling the empty
places. It picks up where `docs/ENGINE.md` left off: Stage A put the engine in `src/sim/` where a
browser or a Node server can run it unchanged, and this note covers the stages after it.

## What was decided, and why

| Question | Decision |
| --- | --- |
| Who it is for first | Friends, through private lobbies joined by code or link. A public lobby list follows once that works. |
| Which modes go online | Free-for-all only, battle royale style: random spawns, last ship afloat wins, the storm ring closes the round. The derby, the wave arena and the ladder stay single player for now. |
| AI ships | The host sets how many, from 0 up to the lobby cap. The default tops the lobby up to 11 ships. |
| Lobby size | 11 ships, humans and AI together, which is the single-player free-for-all's field (her and 10 rivals). Up to 8 of them human. |
| Which ship a captain sails | Her own, from her hold, as she has fitted her. The server trusts the loadout the browser sends. A rating cap or server accounts can come later. |
| Coins earned online | Banked into her hold the same way a single-player voyage is. |
| When she sinks | She sees her placement ("4th of 8"), may watch the rest of the round, and may leave for the lobby at any time. |
| How the games stay in step | The server runs the round. Each browser predicts its own ship so the helm answers at once, and draws everyone else a little in the past, smoothed. |

### Why the server runs the round

Three ways were weighed:

1. **The server runs the round (chosen).** One copy of the world, on the server; browsers send
   controls and receive state. A bad connection only hurts its own player, a browser cannot decide
   a hit, and the engine already runs in Node.
2. **Lockstep, every browser runs the round.** Least bandwidth, but it needs every device to
   compute bit-identical floating point. `Math.sin` and friends are not guaranteed to agree between
   Safari, Chrome and Firefox, and one difference splits the rounds apart silently. The slowest
   player also holds everyone back.
3. **The host's browser is the server, over WebRTC.** No server bill, but the host plays with no
   lag, the round dies when she closes the tab, and some networks block direct connections, so a
   relay server is needed anyway.

### Why prediction is in the first version

The delay between touching the wheel and seeing the ship answer is the trip to the server and
back, roughly 50 to 150 ms. The server's tick rate is a small part of it (at most 16 ms at 60 a
second), so a faster tick cannot remove it. Prediction can: the browser moves its own ship the
moment the wheel turns, and quietly corrects to the server when the server's word arrives. The
engine is well suited to it because the same `step` already runs in the browser and controls
already travel as one input record per tick, which is exactly what prediction replays.

## The stages

Each stage gets its own implementation plan, is merged on its own, and leaves the game playable.

| Stage | What it delivers | Testable without a server |
| --- | --- | --- |
| **B: several captains in one world** | The engine runs a free-for-all with 2 to 8 humans. | Yes, in `sim-test` |
| **C: the netcode** | Snapshots, interpolation and prediction, over a transport that can be in-process. | Yes, with a simulated network |
| **D: the server and private lobbies** | A Node server on Railway, lobby codes and invite links, the lobby and online screens. | No |
| **E: public lobbies** | A list of open lobbies to join. | No |

Better AI is wanted as well, and is a separate piece of work that can run alongside any of these.

## Stage B: several captains in one world

All of it is in `src/sim/`, and the single-player game must play exactly as it does now.

- **Spawns.** In a free-for-all every captain is placed at random, the way the AI is today:
  clear of islands and at least a set distance (`HUMAN_SPAWN_GAP`, about 500 paces) from every
  other captain, falling back to the best spot found if the sea is crowded. A single captain
  keeps her place in the middle of the sea, as now.
- **How many AI.** `createWorld` takes an optional `rivals` count that overrides the mode's own,
  so the host's setting reaches the engine. The server clamps humans plus AI to 11.
- **Who the AI are matched against.** Today the field is matched against `players[0]`. With
  several captains it is matched against the captain whose ship measures nearest the lobby's
  average, so the AI suit the lobby rather than whoever joined first, and are still a real class
  from the catalogue.
- **Whose round goes on.** `judge` stops ending the round on the first human sinking. A captain
  who sinks is placed then (ships still afloat, plus one), recorded as a loser with her cause, and
  a `player_out` event (`playerId, rank, cause`) says so at once. The round is over when one ship
  or none is left afloat, or when every human has sunk. A world with one human ends exactly as it
  does today, which `sim-test` holds it to.
- **Credit for damage.** `byPlayer` on a ship assumes one human. It becomes damage taken per
  player id, so "worn down" and "by the bow alone" are judged for whichever captain did the work.
- **`voyageStats(world, playerId)`** already answers per captain; it is checked for each of them.
- **Tests.** `sim-test` gains rounds with 2, 4 and 8 humans, idle and driven, played twice from
  one seed. It fails on two captains spawning too close, a round that ends while a human is
  still afloat and more than one ship stands, a captain placed twice or not at all, or a captain
  who sank later placed below one who sank earlier. Two captains who sink on the same step share
  a place.

## Stage C: the netcode

A `src/net/` folder, pure enough to run in Node, that sits between the engine and a transport.
It does not know whether the other end is a WebSocket or a function call in the same process.

### What goes over the wire

- **Round start.** The server sends the seed, the mode, the rival count and every captain's id
  and loadout. Each browser calls `createWorld` with them and gets the same opening world, islands
  included, without the world being sent.
- **Browser to server, every tick:** `{ seq, input }`, where `input` is the input record the
  engine already takes and `seq` counts up. Inputs are batched into one message per frame.
- **Server to browser, 20 times a second:** a snapshot of the tick it describes, the last `seq`
  the server applied for that browser, and the state of every ship and ball the screen and the
  prediction need (position, heading, way, the three bars, alive, coins and earnings, and each
  ball's position and velocity), plus the storm ring and every event since the last snapshot.
  Snapshots are encoded compactly; the target is under 2 KB each for 11 ships.
- **Round over:** the result, and each captain's `voyageStats`, so the browser can bank her
  voyage without holding the whole world.

### On the server

The server steps the world at 60 a second. For each captain it applies the next input waiting
in her queue; when the queue is empty it repeats her last input, so a late packet makes her hold
her course rather than drop the wheel.

### In the browser

- **Her own ship is predicted.** The browser applies her input to her own ship at once, using
  the engine's own helm code for one ship (a `steer` entry point split out of `stepHuman`, so
  there is one rule for how a ship answers her helm and the prediction uses it). It keeps every
  input the server has not yet acknowledged. When a snapshot arrives it puts her ship where the
  server says, replays the unacknowledged inputs on top, and blends any remaining difference out
  over a few frames rather than snapping.
- **Everyone else is interpolated.** Other ships and every ball are drawn about 100 ms in the
  past, between the two snapshots either side of that moment. The renderer already blends
  between two states; it is fed snapshots instead of steps.
- **Combat is the server's.** Hits, damage, sinkings and coins come only from the server. The
  fire button's flash and smoke show at once on her own ship so the press feels answered; the
  balls themselves are the server's.
- Ships ramming each other is where prediction is weakest, because each browser predicts only
  its own ship. A small correction after a collision is accepted.

### Tests

A Node test runs a server and several clients joined by a simulated network with configurable
latency, jitter and loss. It fails when a client's predicted ship ends more than a set distance
from the server's after a correction, when interpolation draws a ship somewhere the server never
put her, or when a client's view of the round's result differs from the server's.

## Stage D: the server and private lobbies

### The server

- A `server/` folder: Node, the `ws` package, and `src/sim/` and `src/net/` imported directly,
  so there is one engine. Lobbies and rounds live in memory; nothing is stored.
- Hosted on Railway as one always-on service in one region to start. The browser finds it
  through `VITE_SERVER_URL`. The site stays on GitHub Pages.
- **Checks on what browsers send.** A loadout must be one `rate()` accepts from the catalogue.
  Input values are clamped to their ranges, and a browser sending far more than 60 inputs a
  second is cut off.

### Lobbies

- **Hosting.** A captain picks a name (kept in her browser, up to 16 characters) and hosts. She
  gets a 5-letter code and a link, `sternchase.org/?join=CODE`, to send to friends.
- **Joining** by the code or the link. A joining captain brings her current ship.
- **The lobby screen** lists each captain, her ship and whether she is ready. The host sets the
  number of AI ships and starts the round; she can start with anyone in, herself alone included.
- **After the round** everyone returns to the lobby, which keeps its code, for a rematch.
- **If the host leaves**, the next captain to have joined becomes host.
- **If a captain drops mid-round**, the AI takes her ship and sails it on. If she comes back
  within the round she takes it back.

### The screen

`SternchaseIso.jsx` gains an online entry on the menu, the lobby screen and an online round.
The online round is the same canvas and HUD with the frame loop fed by the netcode instead of
by `step`. Each viewer's own ship is "her" ship for the camera, colours and callouts; every
other ship, human or AI, is drawn as a rival, as now. The end screen shows her placement out
of the field. Copy follows `CLAUDE.md`'s rules for player-facing text.

### Tests

A server test drives real WebSocket clients through host, join, start, a round played to its
end, and a rematch. `npm run smoke` gains an online round between two browser pages.

## Stage E: public lobbies

The host can mark a lobby public. The menu lists open public lobbies with their size and lets a
captain join one. Nothing else changes.

## Not in this design

- Online derby, wave arena or ladder (co-op).
- Accounts, server-side holds, or any stop on edited loadouts.
- Matchmaking by skill, and more than one server region.
- Voice or text chat.
- Spectating a lobby you are not in.

## Open questions

- **Railway region.** One region to start; which one depends on where the players are.
- **Snapshot rate.** 20 a second is the starting figure; Stage C's simulated network is where it
  gets measured against bandwidth and how smooth the interpolation looks.
- **Ads in online rounds.** Whether the end-of-round ad shows after an online round, given a
  rematch is the next thing a captain wants. Decided in Stage D, under `CLAUDE.md`'s ad rules.

# Stage B: Several Captains in One World Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The engine in `src/sim/` runs a free-for-all with 2 to 8 human captains in one world, places each one as she sinks, and ends the round only when one ship or none is left or every human is out, while a one-captain world plays exactly as it does today.

**Architecture:** Three changes inside the engine and nothing outside it. `createWorld` scatters several captains across the sea, takes the host's AI count, and matches the AI against the most typical captain. `judge` places each human as she sinks and emits a `player_out` event, ending the round only when nobody is left to play it. Damage credit on a ship is kept per player id instead of for one human. A new headless test, `tools/captains-test.mjs`, runs alongside `tools/sim-test.mjs` under `npm run sim-test`.

**Tech Stack:** Plain JavaScript ES modules, Node 20 (`node tools/*.mjs`), no test framework: tests are scripts that print `ok` / `FAIL` and exit 1 on failure, as `tools/sim-test.mjs` already does.

**Spec:** `docs/superpowers/specs/2026-10-13-online-multiplayer-design.md` (section "Stage B: several captains in one world")

## Global Constraints

- The engine stays pure: nothing under `src/sim/` imports anything but itself, `shipyard.js`, `shipref.js` and `hullform.js`, or mentions `window`, `document`, `localStorage`, a canvas, `Math.random`, `Date.now` or `performance`. Every random number comes off `world.rng` via `random(world)`. `npm run purity` must pass.
- The world stays plain data (`structuredClone(world)` works). No functions or class instances on it.
- Events carry ids, numbers and words only, never a reference into the world.
- A world with exactly one player must behave as it does today: same spawn (middle of the sea, bow north, before islands are generated), same rules for when the round ends, same result shape. The existing `node tools/sim-test.mjs` must pass unchanged.
- The same seed and the same inputs give the same round, for any number of captains.
- `npm run purity`, `npm run sim-test` and `npm run build` all pass at the end of every task.
- Code comments follow the file's existing voice: full sentences explaining why, ships referred to as "she". No em dashes in any comment or doc text.
- Do not touch `src/SternchaseIso.jsx` or `src/render/`. The screen stays single player in this stage.

## Review Focus

1. **Eight captains on one sea:** a full lobby must still spawn every captain clear of islands and reasonably far apart, never two on top of each other, even when the ideal gap cannot be met. Pinned in Task 1.
2. **Two captains sinking on the same step:** both are placed, both get one `player_out`, and they share a place. Pinned in Task 2.
3. **The last ship afloat is an AI:** the round ends with no winners and every human placed. Pinned in Task 2.
4. **One captain out while others fight on:** the round must not end. Pinned in Task 2.
5. **Inputs missing for some captains on a step:** a captain with no input record holds no helm and fires nothing (the engine's existing `NO_INPUT` default). Pinned in Task 1's driven rounds, where only some captains are driven.

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `src/sim/tables.js` | Modify | Add `HUMAN_SPAWN_GAP`. |
| `src/sim/world.js` | Modify | `createWorld` takes `rivals`; several captains spawn by `spawnPos`; `fieldCaptain` picks who the AI are matched against; `world.out` holds captains already placed. |
| `src/sim/ships.js` | Modify | A ship carries `placed` and `byPlayers` (per player id) instead of `byPlayer`. |
| `src/sim/round.js` | Modify | `judge` places captains as they sink and ends the round when nobody is left to play it; `applyHit` and `killShip` credit per player id. |
| `tools/captains-test.mjs` | Create | Headless test for worlds with several captains. |
| `package.json` | Modify | `sim-test` runs both test scripts. |
| `docs/ENGINE.md`, `CLAUDE.md` | Modify | Say what Stage B changed. |

---

### Task 1: Several captains take the sea

**Files:**
- Modify: `src/sim/tables.js` (after `export const WORLD = 2000;`, line 11)
- Modify: `src/sim/world.js:1-60` (imports and `createWorld`), and add `spawnPos` and `fieldCaptain` after `farPos`
- Modify: `package.json` (`scripts.sim-test`)
- Create: `tools/captains-test.mjs`

**Interfaces:**
- Consumes: `createWorld`, `step`, `voyageStats`, `shipOf`, `isHuman`, `NO_INPUT`, `TICK` from `src/sim/index.js`; `STARTER`, `resolve`, `ladder` from `src/shipyard.js`.
- Produces:
  - `createWorld({ mode, seed, players, rivals })`, where `rivals` is an optional non-negative integer that replaces `world.rules.rivals` as the number of AI ships at the drop.
  - `HUMAN_SPAWN_GAP` (number, paces) exported from `src/sim/tables.js`.
  - `spawnPos(world, gap) -> { x, y }` exported from `src/sim/world.js`.
  - `fieldCaptain(rules, players) -> player` exported from `src/sim/world.js`.
  - `world.out`: an array, empty at creation (filled in Task 2).
  - `tools/captains-test.mjs` exporting nothing, with helpers `sailCaptains(n, seed, script, rivals)` and the `ok` / `fail` reporters that Tasks 2 and 3 add checks to.

- [ ] **Step 1: Write the failing test**

Create `tools/captains-test.mjs`:

```js
/**
 * THE CAPTAINS TEST, run by `npm run sim-test` after the single-captain test.
 *
 * Plays free-for-all rounds with several human captains aboard, in plain Node, through the engine's
 * own interface. It is Stage B's proof: a world takes more than one person, places each of them as
 * she sinks, and ends only when nobody is left to play it.
 *
 * It fails if:
 *
 *   captains spawn on top of each other, on an island, or (with a few of them) closer than the gap;
 *   the host's AI count is not the count of AI on the water;
 *   the same seed and the same hands give a different round;
 *   a round with several captains does not end, or a voyage does not add up.
 */

import { createWorld, step, voyageStats, shipOf, isHuman, NO_INPUT, HUMAN_SPAWN_GAP } from "../src/sim/index.js";
import { STARTER, resolve, ladder } from "../src/shipyard.js";

const LIMIT = 3600;
const failures = [];
const fail = (what) => { failures.push(what); console.log("  FAIL  " + what); };
const ok = (what) => console.log("  ok    " + what);

const GUNDALOW = resolve(STARTER);
const FIRST_RATE = ladder()[ladder().length - 1].loadout;
const captains = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, loadout: i % 2 ? FIRST_RATE : GUNDALOW }));

/** Hands off for everyone, or every other captain hard over with her guns going and the rest left with no input at all. */
const idle = () => ({});
const drive = (world, ids) => {
  const inputs = {};
  ids.forEach((id, i) => {
    if (i % 2 === 0) inputs[id] = { joyMag: 1, joyAng: -0.8 + i, broadside: true, bow: true, musket: true, repair: null };
  });
  return inputs;
};

function sailCaptains(n, seed, script, rivals) {
  const players = captains(n);
  const ids = players.map((p) => p.id);
  const world = createWorld({ mode: "ffa", seed, players, rivals });
  const opening = world.ships.map((s) => ({ id: s.id, human: isHuman(s), x: s.x, y: s.y }));
  const events = [];
  while (!world.result.over && world.time < LIMIT) {
    for (const e of step(world, script(world, ids))) events.push(e);
  }
  return { world, ids, opening, events };
}

function spawns() {
  if (!(HUMAN_SPAWN_GAP > 0)) fail("spawns: HUMAN_SPAWN_GAP is not exported from the engine");
  for (const n of [2, 4, 8]) {
    const world = createWorld({ mode: "ffa", seed: 40 + n, players: captains(n) });
    const humans = world.ships.filter(isHuman);
    if (humans.length !== n) { fail(`spawns ${n}: ${humans.length} captains on the water`); continue; }
    let closest = Infinity;
    for (let i = 0; i < humans.length; i++)
      for (let j = i + 1; j < humans.length; j++)
        closest = Math.min(closest, Math.hypot(humans[i].x - humans[j].x, humans[i].y - humans[j].y));
    // a few captains always get the whole gap; a full lobby gets the best the sea allows, never a pile-up
    const want = n <= 4 ? HUMAN_SPAWN_GAP : 250;
    if (closest < want) fail(`spawns ${n}: two captains ${closest.toFixed(0)} apart, wanted ${want}`);
    else ok(`spawns ${n}: closest two captains ${closest.toFixed(0)} apart`);
    const aground = humans.find((s) => world.islands.some((isl) => Math.hypot(s.x - isl.x, s.y - isl.y) < isl.r + 55));
    if (aground) fail(`spawns ${n}: ${aground.playerId} starts on an island`);
    for (const id of Object.keys(world.players)) if (!shipOf(world, id)) fail(`spawns ${n}: ${id} has no ship`);
  }
}

function aiCount() {
  for (const rivals of [0, 3, 9]) {
    const world = createWorld({ mode: "ffa", seed: 7, players: captains(2), rivals });
    const ai = world.ships.filter((s) => !isHuman(s)).length;
    if (ai !== rivals) fail(`ai count: asked for ${rivals}, got ${ai}`);
    else ok(`ai count: ${rivals} AI ships as asked`);
  }
  const world = createWorld({ mode: "ffa", seed: 7, players: captains(2) });
  const ai = world.ships.filter((s) => !isHuman(s)).length;
  if (ai !== world.rules.rivals) fail(`ai count: no setting gave ${ai}, the mode says ${world.rules.rivals}`);
  else ok(`ai count: no setting gives the mode's own ${ai}`);
}

function rounds() {
  for (const n of [2, 4, 8]) {
    for (const [scriptName, script] of [["idle", idle], ["driven", drive]]) {
      const tag = `${n} captains ${scriptName}`;
      const seed = 300 + n * 11 + (scriptName === "driven" ? 1 : 0);
      const a = sailCaptains(n, seed, script, 11 - n);
      if (!a.world.result.over) { fail(`${tag}: no end after ${LIMIT} s`); continue; }
      ok(`${tag}: over at ${a.world.time.toFixed(1)} s`);
      try { structuredClone(a.world); } catch (e) { fail(`${tag}: the world is not plain data (${e.message})`); }
      for (const id of a.ids) {
        const v = voyageStats(a.world, id);
        if (v.total !== v.coins + v.timePay + v.winPay) fail(`${tag}: ${id}'s voyage does not add up`);
      }
      const b = sailCaptains(n, seed, script, 11 - n);
      if (JSON.stringify(b.world.result) !== JSON.stringify(a.world.result) || b.world.tick !== a.world.tick)
        fail(`${tag}: the same seed ended differently`);
      else ok(`${tag}: the same seed gives the same round (${a.world.tick} steps)`);
    }
  }
}

const t0 = Date.now();
spawns();
aiCount();
rounds();
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (failures.length) {
  console.log(`\n${failures.length} FAILURE${failures.length === 1 ? "" : "S"}`);
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
console.log("\nA world takes several captains.\n");
```

In `package.json`, change the `sim-test` script to run both files:

```json
"sim-test": "node tools/sim-test.mjs && node tools/captains-test.mjs",
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tools/captains-test.mjs`
Expected: FAIL with `spawns: HUMAN_SPAWN_GAP is not exported from the engine`, `spawns 8: two captains 90 apart, wanted 250` (today a second captain lies 90 paces off the first), and `ai count: asked for 0, got 10` (the `rivals` option is ignored).

- [ ] **Step 3: Add the gap constant**

In `src/sim/tables.js`, directly after `export const WORLD = 2000;`:

```js
// How far apart captains are dropped when a round has more than one of them: about a quarter of
// the sea, so nobody opens the round inside another captain's broadside. A full lobby may not fit
// at this gap, and then each takes the clearest water left.
export const HUMAN_SPAWN_GAP = 450;
```

- [ ] **Step 4: Spawn several captains, take the AI count, match the field**

In `src/sim/world.js`, change the tables import to bring in the gap:

```js
import { WORLD, ARENA_SPAWN_CLEAR, ARENA_SPAWN_GAP, STORM_R0, HUMAN_SPAWN_GAP } from "./tables.js";
```

Replace the doc comment's paragraph about `players` and the body of `createWorld` from its signature down to `computeMeta(world);` with:

```js
/**
 * A FRESH ROUND: the sea, its islands, each captain's ship and the rivals her mode opens with.
 *
 * `players` lists the humans aboard, each with the loadout she sails, as `[{ id: "p1", loadout }]`.
 * One captain opens in the middle of the sea with her bow to the north, as the game always began.
 * Several are scattered across it once the islands are down, as far apart as the sea allows.
 * `rivals`, when given, is how many AI ships sail besides them, in place of the mode's own count:
 * it is the host's setting in an online lobby. `seed` decides everything else that is left to
 * chance, so the same seed and the same players give the same round.
 *
 * The world is plain data, with no functions in it and nothing from the page, so a copy of it is a
 * copy of the round. What the engine looks up rather than carries, the rules a mode's row names and
 * a class's hull, comes out of tables that never change.
 */
export function createWorld({ mode, seed, players, rivals }) {
  const rules = modeOf(mode);
  const world = {
    mode, rules,
    players: {}, // player id to the id of the ship she sails
    ships: [], shots: [], volleys: [], islands: [],
    time: 0, tick: 0,
    rng: seedOf(seed), // the round's dice: every random number the round uses comes off these
    sunk: 0, fieldSize: 0, aliveCount: 0, leader: null, avgEarned: 0,
    spawnT: 0, spawnQueue: 0, stormR: STORM_R0,
    events: [], // what happened during the step under way, handed back by `step`
    nextId: 0,
    banked: false, // set by whoever banks the voyage, so it is banked once
    out: [], // each captain already placed, in the order they went under
    result: { over: false, winners: [], losers: [], field: 0 }, // how the round ended, once it has
  };
  // The field is matched against one captain's ship: who she meets, and on the ladder which rung
  // is next. With one aboard it is hers; with several it is whichever of them is most typical.
  const field = fieldCaptain(rules, players);
  world.playerLoadout = field.loadout;
  world.playerStrength = measure(rate(world.playerLoadout));
  const board = (pl, x, y, heading) => {
    const ship = makeShip(world, x, y, heading, { playerId: pl.id, loadout: pl.loadout });
    world.players[pl.id] = ship.id;
    world.ships.push(ship);
  };
  if (players.length === 1) {
    // her own ship, in the middle of the sea with her bow to the north, before the islands are
    // planted, which is the order the dice have always been thrown in for a single captain
    board(players[0], WORLD / 2, WORLD / 2, -Math.PI / 2);
    genIslands(world);
  } else {
    // islands first, so nobody is dropped on one, then each captain in the clearest water left
    genIslands(world);
    for (const pl of players) {
      const pos = spawnPos(world, HUMAN_SPAWN_GAP);
      board(pl, pos.x, pos.y, random(world) * Math.PI * 2);
    }
  }
  const count = rivals ?? rules.rivals;
  for (let i = 0; i < count; i++) {
    // where a mode replaces its losses, rivals sail in from the horizon the same way the
    // reinforcements will; where the field is fixed, they are scattered across the whole sea
    if (rules.reinforcements) world.ships.push(spawnArenaEnemy(world));
    else {
      const pos = farPos(world, 440);
      world.ships.push(makeShip(world, pos.x, pos.y, random(world) * Math.PI * 2, { livery: i, loadout: rivalLoadout(world, 0) }));
    }
  }
  world.fieldSize = world.ships.length;
  computeMeta(world);
  return world;
}
```

Note the single-captain branch keeps today's position (`WORLD / 2 + 0 * 90` was `WORLD / 2`), heading and dice order exactly.

Directly after `farPos`, add:

```js
/**
 * Where a captain is dropped when a round has several: clear of the islands and at least `gap`
 * from every captain already aboard. A crowded sea may have no such place, and then she gets the
 * water furthest from anyone that the search turned up, never the last place it happened to try.
 */
export function spawnPos(world, gap) {
  let best = null, bestD = -1;
  for (let t = 0; t < 80; t++) {
    const x = 180 + random(world) * (WORLD - 360);
    const y = 180 + random(world) * (WORLD - 360);
    if (world.islands.some((isl) => Math.hypot(x - isl.x, y - isl.y) < isl.r + 55)) continue;
    const d = humanRange(world, x, y);
    if (d >= gap) return { x, y };
    if (d > bestD) { bestD = d; best = { x, y }; }
  }
  return best || { x: WORLD / 2, y: WORLD / 2 };
}

/**
 * The captain the AI are matched against. With one aboard it is her. With several it is the one
 * whose ship measures nearest the lobby's average, on the scale the mode fights on, so the field
 * suits the lobby rather than whoever joined first, and is still matched to a real class.
 */
export function fieldCaptain(rules, players) {
  if (players.length === 1) return players[0];
  const key = rules.guns ? "overall" : "ram";
  const m = players.map((pl) => measure(rate(pl.loadout))[key]);
  const avg = m.reduce((a, b) => a + b, 0) / m.length;
  let best = 0;
  for (let i = 1; i < m.length; i++) if (Math.abs(m[i] - avg) < Math.abs(m[best] - avg)) best = i;
  return players[best];
}
```

- [ ] **Step 5: Run the tests**

Run: `node tools/captains-test.mjs`
Expected: every `spawns` and `ai count` line is `ok`. The `rounds` lines may still FAIL or end early, because `judge` still ends the round at the first human sinking; Task 2 fixes that. If any `spawns` line fails, fix it before moving on.

Run: `node tools/sim-test.mjs`
Expected: PASS, with the same step counts as before this task (compare with `git stash; node tools/sim-test.mjs; git stash pop` if unsure). A changed step count for a single captain means the single-captain path changed and must be put back.

Run: `npm run purity`
Expected: `purity: ... are clean`.

- [ ] **Step 6: Commit**

```bash
git add src/sim/tables.js src/sim/world.js tools/captains-test.mjs package.json
git commit -m "B1: Drop several captains on one sea, and take the host's count of AI"
```

---

### Task 2: Place each captain as she sinks, and end the round when nobody is left to play it

**Files:**
- Modify: `src/sim/ships.js` (`makeShip`, the object literal, near `rank: 0`)
- Modify: `src/sim/round.js:47-74` (`judge` and its doc comment)
- Modify: `tools/captains-test.mjs`

**Interfaces:**
- Consumes: `createWorld({ mode, seed, players, rivals })`, `world.out`, `sailCaptains` from Task 1; `applyHit(world, target, bar, amt, attacker, cause)` from `src/sim/round.js` (already exported through `src/sim/index.js`).
- Produces:
  - Ship field `placed: boolean`, false until `judge` has placed her.
  - Event `{ type: "player_out", playerId, rank, cause }`, emitted once per human, on the step her sinking is judged. `rank` is `0` in an unranked mode. `cause` is `"hull"`, `"crew"`, `"storm"` or `"together"`, as on a loser today.
  - `world.result.losers`: every human placed, in the order they went under. `world.result.winners`: the humans still afloat when the round ended, each at rank 1 in a ranked mode.

- [ ] **Step 1: Write the failing tests**

In `tools/captains-test.mjs`, add `applyHit` to the engine import:

```js
import { createWorld, step, voyageStats, shipOf, isHuman, applyHit, NO_INPUT, HUMAN_SPAWN_GAP } from "../src/sim/index.js";
```

Add these functions above the `const t0 = Date.now();` line:

```js
/** Put a captain under at once, as if the last ball had just landed, with nobody credited. */
const sink = (world, id) => { const s = shipOf(world, id); applyHit(world, s, "hull", s.hull + 1, null, "broadside"); };

function placing() {
  // one captain out while two others fight on: the round goes on, and she is placed at once
  {
    const world = createWorld({ mode: "ffa", seed: 21, players: captains(3), rivals: 2 });
    sink(world, "p1");
    const events = step(world, {});
    const out = events.filter((e) => e.type === "player_out");
    if (world.result.over) fail("placing: one captain sinking ended a round with two still afloat");
    else if (out.length !== 1 || out[0].playerId !== "p1" || out[0].rank !== 5) fail(`placing: wanted p1 out in 5th, got ${JSON.stringify(out)}`);
    else ok("placing: one captain out, 5th of 5, and the round goes on");
    const again = step(world, {});
    if (again.some((e) => e.type === "player_out")) fail("placing: a captain was placed twice");
  }
  // two captains under on one step, and the last ship afloat an AI: they share 2nd and nobody wins
  {
    const world = createWorld({ mode: "ffa", seed: 22, players: captains(2), rivals: 1 });
    sink(world, "p1");
    sink(world, "p2");
    const events = step(world, {});
    const out = events.filter((e) => e.type === "player_out");
    const r = world.result;
    if (!r.over) fail("placing: every captain under and the round goes on");
    else if (out.length !== 2 || out.some((e) => e.rank !== 2)) fail(`placing: wanted both out in 2nd, got ${JSON.stringify(out)}`);
    else if (r.winners.length !== 0 || r.losers.length !== 2) fail(`placing: wanted no winners and two losers, got ${JSON.stringify(r)}`);
    else ok("placing: two under on one step share 2nd, and an AI afloat alone ends it");
    if (events.filter((e) => e.type === "round_over").length !== 1) fail("placing: the end was not said once");
  }
  // the last captain afloat, with every rival gone, wins at 1st
  {
    const world = createWorld({ mode: "ffa", seed: 23, players: captains(2), rivals: 0 });
    sink(world, "p2");
    step(world, {});
    const r = world.result;
    if (!r.over || r.winners.length !== 1 || r.winners[0].playerId !== "p1" || r.winners[0].rank !== 1) fail(`placing: wanted p1 to win, got ${JSON.stringify(r)}`);
    else if (r.losers.length !== 1 || r.losers[0].playerId !== "p2" || r.losers[0].rank !== 2) fail(`placing: wanted p2 2nd, got ${JSON.stringify(r.losers)}`);
    else ok("placing: the last captain afloat wins, the other is 2nd");
  }
}

/** Over a whole round: every captain placed exactly once, in range, and later sinkings never placed lower. */
function standings(tag, a) {
  const r = a.world.result;
  const placed = [...r.winners, ...r.losers].map((x) => x.playerId).sort();
  if (JSON.stringify(placed) !== JSON.stringify([...a.ids].sort())) fail(`${tag}: placed ${placed.join(",")}, aboard ${a.ids.join(",")}`);
  const ranks = [...r.winners, ...r.losers].map((x) => x.rank);
  if (ranks.some((k) => k < 1 || k > r.field)) fail(`${tag}: a rank out of 1..${r.field}: ${ranks.join(",")}`);
  const outs = a.events.filter((e) => e.type === "player_out");
  if (outs.length !== r.losers.length) fail(`${tag}: ${outs.length} player_out events for ${r.losers.length} losers`);
  for (let i = 1; i < outs.length; i++) if (outs[i].rank > outs[i - 1].rank) fail(`${tag}: ${outs[i].playerId} sank later and was placed lower`);
  const standing = a.world.ships.filter((s) => s.alive).length;
  if (r.winners.length && standing !== 1) fail(`${tag}: won with ${standing} ships still afloat`);
  for (const w of r.winners) if (!shipOf(a.world, w.playerId).alive) fail(`${tag}: ${w.playerId} won from the bottom`);
}
```

In `rounds()`, call `standings` on the first sailing, directly after the `structuredClone` line:

```js
      standings(tag, a);
```

And call `placing()` between `aiCount();` and `rounds();`:

```js
spawns();
aiCount();
placing();
rounds();
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tools/captains-test.mjs`
Expected: FAIL on `placing: one captain sinking ended a round with two still afloat`, and `standings` failures (`placed p1, aboard p1,p2,...`), because `judge` ends the round on the first human sinking and emits no `player_out`.

- [ ] **Step 3: Give a ship her `placed` flag**

In `src/sim/ships.js`, in `makeShip`'s object literal, change the line that begins `coins: 0, earned: 0,` to add `placed` after `rank`:

```js
    coins: 0, earned: 0, repaired: 0, patches: 0, rank: 0, placed: false, kills: 0, dmgDealt: 0, rams: 0, exposure: 0,
```

- [ ] **Step 4: Rewrite `judge`**

In `src/sim/round.js`, replace `judge` and its whole doc comment with:

```js
/**
 * THE ROUND ENDS ONCE, HERE, at the end of the step. Hits and the weather only mark ships dead;
 * nothing inside a hit handler ends the round, because a step is not over when a hull goes
 * under. A rival's ball already in the air can still find a captain after her last rival sank,
 * and the storm can take the last two crews on one tick, and each of those used to raise both
 * ends at once: a win banked, then a sinking painted over it. So the step plays out and one
 * question is asked of what it left.
 *
 * Every captain who went under on this step is placed now, at the number of ships still afloat
 * plus one, so two who go down together share a place, and she is told at once by `player_out`
 * while the rest fight on. The round is over when no captain is left afloat, or when the last
 * ship afloat (or the top of the ladder) says the ones who are have won. A sinking outranks a
 * win: a captain not afloat was not the last afloat, whatever else went down beside her. With one
 * captain aboard this is the rule the game always had: her sinking ends it.
 */
export function judge(world) {
  if (world.result.over) return;
  const humans = world.ships.filter(isHuman);
  const standing = world.ships.filter((s) => s.alive).length;
  const together = world.rules.lastAfloatWins && standing === 0;
  for (const s of humans) {
    if (s.alive || s.placed) continue;
    s.placed = true;
    const out = { playerId: s.playerId, rank: world.rules.ranked ? standing + 1 : 0, cause: together ? "together" : s._deathBar || "hull" };
    world.out.push(out);
    world.events.push({ type: "player_out", ...out });
  }
  const afloat = humans.filter((s) => s.alive);
  let winners = [];
  if (afloat.length && (
    (world.rules.lastAfloatWins && standing === 1) ||
    // the ladder is climbed when there is no rung left to send, which the same rule the spawner
    // reads says by sending nothing
    (world.rules.ladder && !hunterOf(world.rules, world.playerStrength, world.sunk))
  )) {
    winners = afloat.map((s) => ({ playerId: s.playerId, rank: world.rules.ranked ? 1 : 0 }));
  } else if (afloat.length) return;
  world.result = { over: true, winners, losers: world.out.map((o) => ({ ...o })), field: world.fieldSize };
  world.events.push({ type: "round_over", result: world.result });
}
```

- [ ] **Step 5: Run the tests**

Run: `node tools/captains-test.mjs`
Expected: PASS, every line `ok`, ending `A world takes several captains.`

Run: `node tools/sim-test.mjs`
Expected: PASS with the same step counts as before. A single captain still ends her round when she sinks, and the result has the same shape (the one loser carries `playerId`, `rank` and `cause`, in that order, as before).

Run: `npm run purity && npm run build`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/sim/ships.js src/sim/round.js tools/captains-test.mjs
git commit -m "B2: Place each captain as she sinks, and end the round when nobody is left to play it"
```

---

### Task 3: Credit each captain for her own work, and write Stage B down

**Files:**
- Modify: `src/sim/ships.js` (`makeShip`, the `byPlayer` line and its comment)
- Modify: `src/sim/round.js` (`killShip`'s `isHuman(attacker)` block, `applyHit`'s `isHuman(attacker)` block)
- Modify: `tools/captains-test.mjs`
- Modify: `docs/ENGINE.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `applyHit`, `createWorld`, `shipOf`, `isHuman` as in Tasks 1 and 2.
- Produces: ship field `byPlayers: { [playerId]: { hull, mast, crew, ram } }`, replacing `byPlayer`. Nothing outside `src/sim/` reads either (checked with `grep -rn byPlayer src`).

- [ ] **Step 1: Write the failing test**

In `tools/captains-test.mjs`, above `const t0 = Date.now();`, add:

```js
/**
 * "Worn down" is judged on what the captain who sank her did, not on what everyone did. Before
 * Stage B there was one human and one tally, so another captain's work counted as hers.
 */
function credit() {
  const wear = (world, t, who) => {
    for (const bar of ["hull", "mast", "crew"]) applyHit(world, t, bar, t["max" + bar[0].toUpperCase() + bar.slice(1)] * 0.6, who, "broadside");
  };
  {
    const world = createWorld({ mode: "ffa", seed: 31, players: captains(2), rivals: 1 });
    const t = world.ships.find((s) => !isHuman(s));
    const p1 = shipOf(world, "p1");
    wear(world, t, p1);
    applyHit(world, t, "hull", t.hull + 1, p1, "broadside");
    if (p1.wornDown !== 1) fail(`credit: p1 wore her down herself and was credited ${p1.wornDown}`);
    else ok("credit: a captain who wore her down herself is credited");
  }
  {
    const world = createWorld({ mode: "ffa", seed: 31, players: captains(2), rivals: 1 });
    const t = world.ships.find((s) => !isHuman(s));
    const p1 = shipOf(world, "p1"), p2 = shipOf(world, "p2");
    wear(world, t, p2);
    applyHit(world, t, "hull", t.hull + 1, p1, "broadside");
    if (p1.wornDown !== 0) fail("credit: p1 was credited with wearing her down on p2's work");
    else if (p2.wornDown !== 0) fail("credit: p2 was credited for a ship p1 sank");
    else ok("credit: one captain's work is not another's");
  }
}
```

Call it after `placing();`:

```js
placing();
credit();
rounds();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tools/captains-test.mjs`
Expected: FAIL with `credit: p1 was credited with wearing her down on p2's work`, because `byPlayer` is one tally shared by every human.

- [ ] **Step 3: Keep the tally per captain**

In `src/sim/ships.js`, in `makeShip`, replace the `byPlayer` comment and line:

```js
    // What each PLAYER has done to this ship, bar by bar, and how much of her hull went to that
    // player's bow, keyed by player id and opened on her first blow. Rivals hit each other in a
    // melee, the storm takes crew, and in an online round other captains fire too, so "you wore
    // her down" and "you sank her by the bow alone" are judged on this and never on her bars.
    byPlayers: {},
```

In `src/sim/round.js`, in `killShip`, replace `const b = s.byPlayer;` with:

```js
      const b = s.byPlayers[attacker.playerId] || { hull: 0, mast: 0, crew: 0, ram: 0 };
```

and change the comment above it from "the player's own guns and bow" / "the player's ram" to "her own guns and bow" / "her own ram", so it reads:

```js
      // Both are judged on what this captain did to her and not on the state she went down in,
      // because in a melee her bars carry every rival's work and the storm's besides. Worn down
      // is half of each of her three bars off this captain's own guns and bow; by the bow alone is
      // her whole hull gone to her own ram, with a hair of tolerance for the float sum.
```

In `applyHit`, replace:

```js
    if (isHuman(attacker)) {
      target.byPlayer[bar] += took;
      if (cause === "ram") target.byPlayer.ram += took;
    }
```

with:

```js
    if (isHuman(attacker)) {
      const b = (target.byPlayers[attacker.playerId] ||= { hull: 0, mast: 0, crew: 0, ram: 0 });
      b[bar] += took;
      if (cause === "ram") b.ram += took;
    }
```

- [ ] **Step 4: Run every check**

Run: `grep -rn "byPlayer\b" src tools`
Expected: no output.

Run: `npm run sim-test`
Expected: both scripts PASS; the single-captain step counts are unchanged.

Run: `npm run purity && npm run build`
Expected: both pass.

- [ ] **Step 5: Write Stage B down**

In `docs/ENGINE.md`:

1. In "The interface", change the `createWorld` example and bullet to:

```js
const world = createWorld({ mode: "ffa", seed, players: [{ id: "p1", loadout }], rivals });
```

```markdown
- **`createWorld`** lays out a round. `players` lists the humans aboard: one opens in the middle of
  the sea as the game always began, and several are scattered across it, `HUMAN_SPAWN_GAP` apart
  where the sea allows. `rivals`, when given, replaces the mode's count of AI ships. The field is
  matched against the captain whose ship measures nearest the lobby's average (`fieldCaptain`).
```

2. In the `world.result` bullet, add after the first sentence: `Each captain is placed as she goes under, so `losers` lists them in the order they sank, and two who sink on one step share a place.`

3. In the Events table, add a row after `dismasted`:

```markdown
| `player_out` | `playerId, rank, cause` | the screen: a captain is placed the step she sinks, while the round goes on for the rest |
```

4. In "Left for later stages", replace the "More than one human in a world (Stage B)" bullet with a new "Questions Stage B answered" section placed before "Left for later stages":

```markdown
## Questions Stage B answered

- **Where does a second captain start?** In a world with several, every captain is dropped once
  the islands are down, clear of them and `HUMAN_SPAWN_GAP` from every other captain, or in the
  clearest water left when a full lobby cannot fit at that gap.
- **Whose round goes on when one sinks?** Everyone's. She is placed at once, and the round ends
  when no captain is afloat, or when the last ship afloat is a captain.
- **How does a ranked mode place several humans?** By the order they went under: ships still
  afloat plus one. The winner is 1st.
- **How is a second viewer's ship drawn?** That is the screen's, and Stage D's: each viewer draws
  her own ship as hers and every other as a rival.
- `byPlayer` became `byPlayers`, keyed by player id, so "worn down" and "by the bow alone" are
  credited to the captain who did the work.
```

In `CLAUDE.md`, in the `src/sim/` bullet, change `createWorld({ mode, seed, players })` to `createWorld({ mode, seed, players, rivals })`.

Check: `grep -c "—" docs/ENGINE.md CLAUDE.md` prints the same counts as before this step (this step adds none).

- [ ] **Step 6: Commit**

```bash
git add src/sim/ships.js src/sim/round.js tools/captains-test.mjs docs/ENGINE.md CLAUDE.md
git commit -m "B3: Credit each captain for her own work, and write Stage B down"
```

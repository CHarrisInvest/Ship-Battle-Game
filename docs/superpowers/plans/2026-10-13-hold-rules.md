# Split the hold into rules and a store: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift every rule of the hold out of `src/hold.js` into a pure module, `src/holdrules.js`, that the browser and the server will both import, without changing anything a captain sees.

**Architecture:** `holdrules.js` holds the record's shape (`blank`, `sanitize`), the achievement settlement (`settle`), every reader the screens use, banking (`bank`), and the shop as a table of pure actions (`ACTIONS`) behind one door, `applyAction(rec, name, args)`, which returns `{ rec, ...extras }` with the record settled, or `null` for a refusal. It imports only `shipyard.js` and `achievements.js` and touches no storage. `hold.js` becomes the store: it loads and saves the record in `localStorage`, publishes changes, and keeps its exported interface exactly, so `SternchaseIso.jsx` does not change.

**Tech Stack:** Plain ES modules, Node for the tests.

**Spec:** `docs/superpowers/specs/2026-10-13-accounts-and-server-hold-design.md`, "The hold on the server", "Splitting `hold.js`", and step 2 of "The order of work".

## Global Constraints

- No behaviour change. Every exported name of `hold.js` stays, with the same arguments and the same return shapes (`buyShip` returns `{ hold, ship }`, `buyPart` `{ hold, part }`, `fitOwned` `{ hold, fitted }`, `bankVoyage` `{ hold, banked, bounty, rungs }`, the other writers the new record, every writer `null` on a refusal).
- `holdrules.js` imports only `shipyard.js` and `achievements.js`, mentions no browser API, and never mutates the record it is given. `npm run purity` checks it, and `achievements.js`, by the same rules as the engine.
- Banking a voyage is not a shop action. `ACTIONS` holds only what a captain may ask for between voyages; `bank` is exported apart from it, because from step 4 only the server banks, off its own replay.
- An action given junk arguments returns `null` and never throws: from step 3 the arguments come off the network.
- Comments and doc comments move with their code, unchanged except where a sentence names `current()`, `commit` or `localStorage` and is no longer true.

## Review Focus

- **Junk from the network.** An action called with missing, wrong-typed or unknown arguments must return `null`, not throw and not write. Pinned in Task 1's junk sweep.
- **The input record mutated.** A pure action that edits the record it was handed would corrupt the store's cached copy, and on the server the stored row. Pinned in Task 1 by comparing the input before and after every action.
- **A refused action leaving a write behind.** The store must not save or publish when an action is refused. Pinned in Task 2.
- **Achievements paid on a shop action.** `settle` runs on every write today, so buying something that completes an achievement pays its bounty at once. `applyAction` must settle. Pinned in Task 1.
- **Reload.** A record saved by the store reads back identically after a reload. Pinned in Task 2.

---

### Task 1: The rules, pure

**Files:**
- Create: `src/holdrules.js`
- Create: `tools/hold-test.mjs`
- Modify: `package.json` (`"hold-test": "node tools/hold-test.mjs"`)

**Interfaces:**
- Produces, from `src/holdrules.js`:
  - constants `VERSION`, `NAME_LIMIT`, `HOLD_SHARE`, `REFUND_SHARE`; `cleanName(raw)`, `refundOf(type)`
  - `blank()`, `sanitize(raw)`, `settle(rec) => { rec, paid, rungs }`
  - readers, unchanged in signature: `modeRecord`, `voyageValue`, `partOf`, `ownedShips`, `shipName`, `spareParts`, `shipLoadout`, `shortfall`, `ownedFill`, `readiness`
  - `bank(rec, run) => { rec, banked, bounty, rungs }` (settled) and `spend(rec, amount) => { rec } | null`
  - `ACTIONS`: `buyShip(rec, hullId) => { rec, ship }`, `nameShip(rec, shipId, name)`, `buyPart(rec, typeId) => { rec, part }`, `sellPart(rec, partId)`, `fitOwned(rec, shipId) => { rec, fitted }`, `setActiveShip(rec, shipId)`, `fitMast(rec, shipId, socketId, partId)`, `fitSail(rec, shipId, socketId, berth, partId)`, `fitStud(rec, shipId, socketId, berth, partId)`, `fitGun(rec, shipId, mount, partId)`, `unfitGun(rec, shipId, partId)`; each returns `{ rec, ...extras }` or `null`, the record unsettled
  - `applyAction(rec, name, args) => { rec, ...extras } | null`: looks `name` up in `ACTIONS` (own properties only), returns `null` for an unknown name or a non-array `args`, catches nothing (the actions themselves must not throw), and settles the record it returns.

- [ ] **Step 1: Write the failing test** `tools/hold-test.mjs`, part one, against `../src/holdrules.js`:
  - a blank record has the starter ship, active, and settles to itself;
  - `applyAction` on every name in `ACTIONS` with a legal argument list applies (coins and yard move as the old writers did: `buyPart` takes the price and adds one loose part; `sellPart` refunds in full and lowers `spent`; `buyShip` adds a bare hull; `fitOwned` fits what is loose; `fitGun` and `unfitGun` move a gun; `nameShip` cleans the name; `setActiveShip` moves `active`);
  - refusals return `null`: a part she cannot afford, a hull that does not exist, a gun on the wrong mount, a gun past her tonnage, an unknown action name, `args` that is not an array;
  - **junk sweep:** every action, called through `applyAction` with each of `[]`, `[null]`, `[{}]`, `["nope", "nope", 3, "x"]`, `[1e9, -1, NaN, Infinity]`, returns `null` or a result and never throws, and an action that returns a result for junk leaves a record that `sanitize` maps to itself;
  - **purity of the input:** for every applied action, the record passed in is unchanged afterwards (its JSON before and after);
  - **settlement:** bank a voyage that completes an achievement rung, and see `bounty` paid; then a shop action on a record with an unpaid rung pays it in the record `applyAction` returns;
  - `bank` adds what `voyageValue` says, and `ACTIONS` has no `bank` or `spend`.

- [ ] **Step 2: Run it to see it fail.** `npm run hold-test` → `Cannot find module '.../src/holdrules.js'`.

- [ ] **Step 3: Write `src/holdrules.js`** by moving code out of `hold.js`: everything from `NAME_LIMIT` through `grantStarter`, `settle`, and every reader and writer. Writers drop `const rec = current();` for a `rec` first parameter; `commitYard(rec, yard, cost)` becomes `withYard(rec, yard, cost)`, returning the new record or `null`; each writer returns `{ rec: next, ...extras }`. Add `bank`, `spend`, `ACTIONS` and `applyAction` as above. Guard every argument an action reads before using it as a key (`typeof id === "string"` and an own property of the table it indexes), so junk returns `null`.

- [ ] **Step 4: Run it to see it pass.** `npm run hold-test` → all `ok`.

- [ ] **Step 5: Commit.** "Lift the hold's rules into a pure module the server can share"

### Task 2: The store on the rules, and purity

**Files:**
- Modify: `src/hold.js` (becomes the store)
- Modify: `tools/hold-test.mjs` (part two)
- Modify: `tools/purity.mjs`
- Modify: `CLAUDE.md`, `docs/ENGINE.md` if it names `hold.js`'s rules, `.gitignore` (`.worktrees/`)

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces: `src/hold.js` with exactly the exports it had (`getHold`, `holdIsPersistent`, `bankVoyage`, `spendFromHold`, `getYard`, `subscribeHold`, every writer and reader, the constants), the readers and constants re-exported from `holdrules.js`.

- [ ] **Step 1: Write the failing test**, part two of `tools/hold-test.mjs`: set `globalThis.window` to an object with an in-memory `localStorage` and a no-op `addEventListener` before importing `../src/hold.js`; then
  - every export the component imports exists on `hold.js` (the list in `SternchaseIso.jsx`'s import);
  - a script of writes through the store (`bankVoyage`, `buyPart`, `buyShip`, `nameShip`, `fitOwned`, `fitGun`, `unfitGun`, `sellPart`, `setActiveShip`) gives at each step the same record `applyAction` gives on the record before it, and the same return shape as before;
  - a refused write returns `null`, does not change `getHold()`, does not write storage and does not call a subscriber;
  - after the script, the stored JSON sanitizes to `getHold()`, and a second import of the module (cache-busted with a query string) reads the same record back.
  Run it on the current `hold.js` first: the parts that only use the old exports must already pass (this is the characterization), and the comparison with `applyAction` passes too, since Task 1 moved the rules unchanged.

- [ ] **Step 2: Characterize against the old store.** Copy `hold.js` from the base commit to `src/hold-old.js` (temporarily, not committed), run the same write script through both and compare every step's record and return value as JSON. Expected: identical. Delete `src/hold-old.js`.

- [ ] **Step 3: Rewrite `hold.js` as the store** on `holdrules.js`: `load` reads and `sanitize`s, `commit` settles, saves and publishes, each writer is `act(name, ...args)` mapped to its old return shape, `bankVoyage` uses `bank`, `spendFromHold` uses `spend`. Its doc comment says what it now is: where the record is kept in this browser, and that the rules live in `holdrules.js`.

- [ ] **Step 4: Purity.** In `tools/purity.mjs`, check `holdrules.js` and `achievements.js` against `FORBIDDEN`, with their imports limited to `shipyard.js`, `exact.js`, `achievements.js` and each other; the engine's allowed list does not change. Run `npm run purity` (expected: clean), then put `localStorage` into `holdrules.js` temporarily and see it fail, and take it out.

- [ ] **Step 5: Run everything.** `npm run hold-test`, `npm run purity`, `npm run sim-test`, `npm run build`, and `npm run smoke` (expected: the same three `touchend` console failures `main` has, and no others; every shop and banking check `ok`).

- [ ] **Step 6: Docs.** `CLAUDE.md`: the `hold.js` bullet says the rules are in `holdrules.js`, pure and shared with the server, and `hold.js` keeps the record in this browser; the achievements bullet's "`settle` in `hold.js`" becomes `holdrules.js`; the refund bullet's "`REFUND_SHARE` in `hold.js`" likewise. Add `.worktrees/` to `.gitignore`.

- [ ] **Step 7: Commit.** "Keep the hold in this browser through the shared rules"

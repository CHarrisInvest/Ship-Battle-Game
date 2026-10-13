# The game server: guests, the hold, and replayed voyages: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Node service for Railway that gives every visitor a guest account, keeps each captain's hold in Postgres, applies shop actions with the shared rules, and banks a voyage only after replaying it from its seed and its inputs.

**Architecture:** `server/` is plain `node:http` with Better Auth mounted at `/auth/*` (anonymous plugin only in this step; email and Google are step 5). Postgres holds Better Auth's tables plus `holds` and `rounds`, created at boot by Better Auth's `getMigrations` and the server's own numbered SQL. Shop actions go through `applyAction` from `src/holdrules.js` inside a row lock, with the record's `version` as an optimistic check. A voyage is `POST /rounds` (server seed, server loadout), then its input log in pieces, then `finish`; the server replays it in a worker thread with the same engine the browser runs, refuses anything that does not add up, and banks `voyageRun` off its own world. The browser does not change in this step.

**Tech Stack:** Node 22, `node:http`, `node:worker_threads`, `better-auth` 1.7.7, `pg` 8.23.1, Postgres 18 on Railway (17 in tests via Docker or the CI service container).

**Spec:** `docs/superpowers/specs/2026-10-13-accounts-and-server-hold-design.md`: "Where things live", "Accounts" (guest only), "The hold on the server", "Voyages: the server replays every round", "The database", step 3 of "The order of work". The open question on the input log, answered in step 1, decides that the log goes up in pieces during the round.

## Global Constraints

- The engine stays pure and unchanged in behaviour: `npm run purity`, `sim-test` and `determinism` pass after every task.
- The server never trusts a figure the browser computed. It picks the seed, resolves the loadout from its own hold, replays the inputs, and banks what its replay says.
- The browser and the server build a round's world from the same JSON loadout: the server stores what it sends.
- A round's player id is `"p1"`, as the component's `ME`.
- Every route but `/health` and `/auth/*` needs a session. Bodies are JSON, at most 1 MB.
- No secret is printed, committed, or put in a test fixture. Better Auth's telemetry is off.
- Server code is ES modules under `server/`, run with `node server/index.js`; it imports `src/` directly.

## Review Focus

- **A forged voyage.** Inputs that claim a round the server did not start, someone else's round, a finish twice, a log faster than real time, a log that ends on a different tick, an input record the controls could never produce. Each is refused and banks nothing. Pinned in Task 4.
- **Two tabs.** A shop action against a stale version is refused with the current record, never applied over the newer one. Pinned in Task 3.
- **Junk bodies.** Malformed JSON, wrong types, huge bodies and unknown actions get a 400 or 422, never a 500 or a crash. Pinned in Tasks 3 and 4.
- **A record that grows without bound.** Free parts bought in a loop. The rules cap ships and parts. Pinned in Task 2.
- **Replay stalling the server.** A long ladder round replays in a worker, so `/health` still answers meanwhile. Pinned in Task 4.

---

### Task 1: What a voyage banks, and what an input is, in the engine

**Files:** `src/sim/round.js` (add `voyageRun`), `src/sim/index.js` (add `isInput`), `src/SternchaseIso.jsx` (`endRound` uses `voyageRun`), `tools/sim-test.mjs`, `docs/ENGINE.md`, `CLAUDE.md` (the engine's interface list).

- `voyageRun(world, playerId)` returns exactly the object `endRound` passes to `bankVoyage` today: `{ mode, earned, repaired, kills, dmg, time, rams, patches, won, rank, dismasted, healed, sunkByRam, sunkByGuns, sunkByMuskets, rammedWhole, wornDown }`, with `won` and `rank` read off `world.result` as `endRound` reads them.
- `isInput(x)` is true only for a record the controls can produce: an object with exactly the keys of `NO_INPUT`, `joyMag` a finite number in [0, 1], `joyAng` a finite number, the three fire keys booleans, `repair` `null`, `"hull"` or `"mast"`.
- [ ] Failing checks in `sim-test`: `isInput` accepts `NO_INPUT`, every `drive` and `wander` record, and refuses each of: an extra key, a missing key, `joyMag` 1.01 or NaN, `joyAng` Infinity, a string for a boolean, `repair: "crew"`, an array, `null`. `voyageRun` on a finished round equals the object built the old way from `voyageStats` and `world.result`.
- [ ] Implement; `endRound` calls `voyageRun(g, ME)` and keeps its own `won` and `mine` for the end screen.
- [ ] `sim-test`, `determinism`, `build`, `smoke` (3 known failures only). Commit.

### Task 2: A cap on the yard

**Files:** `src/holdrules.js`, `tools/hold-test.mjs`, `CLAUDE.md`.

- `MAX_SHIPS = 50`, `MAX_PARTS = 2000`. `buyShip` refuses past the first, `buyPart` past the second. Both are far above any honest fleet (a fully found first rate is about 130 parts).
- [ ] Failing test: a record with `MAX_PARTS` parts refuses `buyPart`; one with `MAX_SHIPS` ships refuses `buyShip`; one under the caps buys.
- [ ] Implement, test, commit.

### Task 3: The server, guests and the hold

**Files:** create `server/index.js`, `server/app.js`, `server/config.js`, `server/db.js`, `server/migrations/001_holds_rounds.sql`, `server/auth.js`, `server/hold.js`, `server/http.js` (body reading, JSON replies, CORS), `server/test.mjs`, `server/testdb.mjs`; modify `package.json` (`server`, `server-test` scripts).

- `createApp({ pool, config, now })` returns a `node:http` request handler; `index.js` reads the config from the environment, migrates, and listens on `PORT`.
- Config: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (the API's own address), `CLIENT_ORIGINS` (comma list, the only origins CORS and Better Auth trust), `COOKIE_DOMAIN` (optional; `sternchase.org` in production, so the cookie is first-party to the game).
- Auth: Better Auth with `basePath: "/auth"`, the pg pool, the anonymous plugin, `trustedOrigins` from `CLIENT_ORIGINS`, `telemetry: { enabled: false }`, cross-subdomain cookies when `COOKIE_DOMAIN` is set.
- Migration `001`: `holds (user_id text primary key references "user"(id) on delete cascade, data jsonb not null, version integer not null, updated_at timestamptz not null)` and `rounds (id text primary key, user_id text not null references "user"(id) on delete cascade, mode text not null, seed bigint not null, loadout jsonb not null, engine text not null, started_at timestamptz not null, finished_at timestamptz, inputs jsonb not null default '[]', next_tick integer not null default 0, ticks integer, result jsonb, banked integer)`, and a `migrations` table recording what ran.
- Routes: `GET /health` → `{ ok, engine }`. `GET /hold` → `{ hold, version }`, creating `blank()` at version 1 for a user with none. `POST /hold/actions` `{ action, args, version }` → 200 `{ hold, version, ...extras }`; 409 `{ hold, version }` for a stale version; 422 `{ hold, version }` for a refusal or unknown action; 400 for a body that is not that shape. The row is read `FOR UPDATE` in a transaction.
- `testdb.mjs`: a Postgres for the tests, from `TEST_DATABASE_URL` if set, otherwise a throwaway `postgres:17` container on a free port that it removes afterwards.
- [ ] Failing tests in `server/test.mjs` (cookie jar over `fetch`): `/health`; `/hold` without a session is 401; `POST /auth/sign-in/anonymous` gives a session; `/hold` is the blank record at version 1 and stays version 1 on a second read; `buyPart` applies and moves the version; one she cannot afford is 422 with the unchanged hold; a stale version is 409 with the current one; an unknown action is 422; malformed JSON, a non-object, `args` not a list, and a 2 MB body are 400; two guests never see each other's hold; a preflight from an allowed origin is answered and one from another origin is not given CORS headers.
- [ ] Implement, test, commit.

### Task 4: Voyages, replayed

**Files:** create `server/rounds.js`, `server/replay.js`, `server/replay-worker.js`, `server/enginehash.js`; modify `server/app.js`, `server/test.mjs`.

- `enginehash.js`: a SHA-256 over the source of `src/sim/*.js`, `shipyard.js`, `shipref.js`, `hullform.js`, `exact.js` in a fixed order, first 16 hex characters. `GET /health` reports it; step 4 builds it into the client too.
- `POST /rounds { mode, engine }`: 409 `{ engine }` if `engine` is not the server's; 400 for a mode not in `MODE_LIST`. Otherwise a round row with a random 32-bit seed and `JSON.parse(JSON.stringify(shipLoadout(hold)))` as its loadout; returns `{ roundId, seed, loadout, mode }`.
- `POST /rounds/:id/inputs { entries }`: `entries` is a list of `[tick, input]` with integer ticks, strictly increasing, the first at or after the round's `next_tick`, every input passing `isInput`, at most 5000 entries a request and 216000 a round. The last tick may not be more than `(now - started_at)` in ticks plus 5 seconds' worth. Appends, moves `next_tick` past the last.
- `POST /rounds/:id/finish { ticks, entries }`: the same checks for the final entries, then `ticks` at least `next_tick`, at most 216000, and within the same pace limit. Replays in a worker: the input in force at each step is the last entry at or before its tick, starting from `NO_INPUT`; the round must be over exactly at `ticks`. Then `bank(hold, voyageRun(world, "p1"))` and `settle`, stored with the version moved, the round marked finished with its result and what it banked. Returns `{ hold, version, banked, bounty, rungs, result }`.
- Every refusal is 422 with a reason word (`"pace"`, `"order"`, `"input"`, `"ended"`, `"tick"`), 404 for a round that is not this user's, 409 for a finished round. A refusal changes nothing.
- `replay.js` is the replay as a plain function (testable without a worker); the worker wraps it; the app keeps one worker and queues to it.
- [ ] Failing tests: start with a wrong engine (409) and a bad mode (400); start a round, play it in the test with the engine and the wandering hands to its end, recording the log as the browser will (entry when the input changes, tick before the step), post it in pieces with a fake clock moving at real speed, finish, and see the bank equal `voyageRun` off the test's own world and the hold's coins move by it; finish again (409); another guest's round (404); a log posted faster than real time (422 pace); a finish that claims a different end tick (422 tick); entries out of order (422 order); an input with `joyMag: 2` (422 input); `/health` answers while a long ladder round replays.
- [ ] Implement, test, commit.

### Task 5: Retention, rate limits, CI and docs

**Files:** `server/db.js` (`purge(pool, now)`), `server/app.js` (a per-user limit), `.github/workflows/ci.yml` (a `server` job with a Postgres service), `CLAUDE.md` (a server section), `docs/ENGINE.md`, the spec ("Finishing" describes pieces; the open question closes).

- `purge`: anonymous users whose newest session and own `updatedAt` are more than 90 days old are deleted (their hold and rounds go with them by cascade); `inputs` of rounds finished more than 30 days ago are set to `[]`. The server runs it at boot and every 6 hours.
- Rate limit: each user may make 20 hold or round requests a second, bursting to 60; past that, 429.
- [ ] Failing tests: purge removes an old guest and keeps a fresh one and an old signed-in user; 61 quick requests see a 429.
- [ ] Implement; CI runs `npm run server-test` against a `postgres:17` service; docs; commit.

### Task 6: On Railway

- Create the `server` service in the `sternchase` project from `fozzydiablo/Ship-Battle-Game`, branch `main`, start command `npm run server`, health check `/health`.
- Variables: `DATABASE_URL` as a reference to the Postgres service's, `BETTER_AUTH_SECRET` generated by Railway, `BETTER_AUTH_URL` the service's domain, `CLIENT_ORIGINS` `https://sternchase.org,https://www.sternchase.org`, `COOKIE_DOMAIN` set once `api.sternchase.org` is attached.
- A Railway domain now; `api.sternchase.org` as a custom domain once its DNS record is added (the captain's DNS, so it is reported, not done).
- [ ] After merge, deploy, read the logs, and call `/health` and a guest sign-in against the live service.

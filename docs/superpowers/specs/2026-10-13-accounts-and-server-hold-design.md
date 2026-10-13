# Accounts and the server's hold: design

Status: draft for review. Merges once the Railway service and database exist. Date: 2026-10-13.

Today a captain's progress is one key in `localStorage`, `sternchase.hold`, written by `src/hold.js`.
Anyone can open the browser's tools and give themselves a million coins and a fully found first
rate, and once captains meet online (`2026-10-13-online-multiplayer-design.md`) that stops being
their own business. Storage in the browser is also fragile: Safari deletes it after 7 days without a
visit, clearing site data wipes it, and a captain who moves from phone to laptop starts again.

This design moves the hold off the browser entirely. The server keeps every captain's hold, decides
every change to it, and works out what each voyage earned by replaying the round itself. Captains
get an account, a guest one at first and an email or Google one when they choose.

## What was decided, and why

| Question | Decision |
| --- | --- |
| Where the hold lives | On the server, in Postgres. Nothing of the game is kept in the browser. |
| Who decides what it says | The server. The browser asks, the server applies the rule and answers. |
| How a voyage's coins are known | The browser sends the round's inputs; the server replays the round and banks what its own replay says. |
| Someone who has not signed in | Gets a guest account on the server the moment they arrive, and plays and earns at once. |
| Signing in | A 6-digit code by email, or Google. Either attaches to the guest account already in use. |
| Progress saved in browsers today | Not carried over. Everyone starts fresh, and the old key is deleted. |
| Hosting | The game stays on GitHub Pages. The API and Postgres are on Railway, in the service multiplayer Stage D grows into. |

### Why the server decides, rather than storing what the browser says

Storing the browser's hold (a sync) gives saves across devices and nothing else: a captain who
edits her coins locally just uploads the edit. The only rule the browser cannot break is one it
does not run, so every write to the hold becomes a request the server answers.

### Why replay, rather than trusting the voyage's figures or running the round on the server

Three ways of knowing what a single-player voyage earned were weighed:

1. **Replay (chosen).** The browser plays the round exactly as now and records its inputs; the
   server replays them from the same seed and the same loadout and reads `voyageStats` off its
   own world. The engine was built for this: it is pure, it is deterministic, and `sim-test`
   already sails every round twice and fails on a difference. A round in Node costs about a
   second per twenty minutes of play, so checking one is cheap, and the helm answers at once
   because nothing waits on the network during the round.
2. **Plausibility checks on reported figures.** Cap coins by time, kills by the field, and so on.
   Cheap, but every cap is a guess, and a cheat who stays under them is never caught.
3. **The server runs every single-player round live,** the way an online round runs. Nothing to
   replay and no determinism to prove, but it needs the Stage C netcode and prediction before a
   single-player round can be played, puts every round on the server's clock, and costs a round's
   worth of server time per captain at sea. It is the fallback if replay cannot be made exact.

Replay cannot stop a bot playing well. A bot's round is still a real round, played by the rules.

### Why a guest account rather than a login wall

A sign-in screen before the first round loses most of the players an ad brings in. A guest account
is created without asking, so the first round plays as it does today, and the progress it earns is
already on the server when the captain decides to keep it.

### Why nobody's old progress comes over

A local hold can have been edited, so importing it imports whatever was edited into it, forever.
The player base is small enough now that a fresh start costs little, and it is the only choice that
leaves no cheat in the record.

## Where things live

| Place | Holds |
| --- | --- |
| GitHub Pages, `sternchase.org` | The game, built by Vite as now. |
| Railway, `api.sternchase.org` | One Node service: accounts, the hold API, round replay, and later the multiplayer server. |
| Railway Postgres | Accounts, sessions, holds, rounds. |
| Resend | Sends the sign-in codes. One API key, plus SPF and DKIM records on `sternchase.org`. |
| Google Cloud | One OAuth client for Google sign-in. |
| The browser | The session cookie, and the cookie prompt's answer (`consent.js`), which describes this browser and not the captain, and must be answerable before anyone has an account. Nothing else. |

`api.sternchase.org` is a subdomain of the game's own domain, so the session cookie is first-party
(`SameSite=Lax`, `Secure`, `HttpOnly`). On a `*.railway.app` address Safari would refuse it. The
browser calls the API with `credentials: "include"`, and the API allows the origin
`https://sternchase.org` and the Vite dev origin only.

## Accounts

Better Auth runs in the Node service, with its tables in the same Postgres.

- **Guest.** The first request from a browser with no session creates an anonymous user (Better
  Auth's anonymous plugin) and a blank hold for them. Nothing is asked.
- **Saving progress.** A "Save your progress" button on the menu offers an email or Google. The
  email path sends a 6-digit code (the email OTP plugin, sent through Resend) and the captain types
  it in. A code rather than a link, because a link opens in Safari, not in the home-screen app, and
  would sign in the wrong browser. Either path links to the guest user, so the hold stays where it
  is.
- **Signing in where an account already exists.** On a second device, the captain is a guest with
  progress of her own. Signing in to the existing account switches to that account's hold and
  drops the guest's, because merging two holds is a way to duplicate coins. The game says so before
  it happens, and only when the guest has something to lose.
- **Signing out** returns to a fresh guest.
- **Deleting an account** is a button in the settings. It deletes the user, their hold and their
  rounds at once.
- **Guests not seen for 90 days** are deleted, hold and all. A signed-in account is never deleted
  for being idle.

Google sign-in has to be tried from the home-screen app on an iPhone before it ships, because a
redirect out of a standalone web app is where that flow tends to break. If it fails there, email
ships first and Google follows.

### Safari's 7-day limit on the API's cookies

Safari caps cookies set by a server that lives at a different address from the site (a CNAME to
another host, or a different IP) at 7 days, and `api.sternchase.org` on Railway is that. The session
is refreshed on every visit, so the effect is that a guest who stays away for more than 7 days in
Safari comes back as a new guest. That is no worse than `localStorage` today, and a signed-in
captain only has to sign in again. Serving the game from the same Railway service would remove the
cap; see the open questions.

## The hold on the server

### Splitting `hold.js`

`src/hold.js` is two things today: the rules of the hold, and keeping it in `localStorage`. It splits
along that line.

- **`src/holdrules.js`** is the rules, as pure functions from a record to a record: `blank`,
  `sanitize`, `settle`, `bank(rec, run)`, `buyShip`, `nameShip`, `buyPart`, `sellPart`, `fitMast`,
  `fitSail`, `fitStud`, `fitGun`, `unfitGun`, `fitOwned`, `setActiveShip`, and the readers
  (`shipLoadout`, `spareParts`, `shortfall`, `readiness`, `ownedFill` and the rest). It imports only
  `shipyard.js` and `achievements.js`, touches no storage, and is held to that by `npm run purity`
  the way `src/sim/` is. The browser and the server both import it.
- **`src/hold.js`** keeps its exported interface, so the screens do not change: `getHold`,
  `subscribeHold` and the writers. What sits behind it is a copy of the server's record, loaded at
  start-up, not a key in `localStorage`.

New ids already come from a counter in the record (`yard.seq`), so the same action applied to the
same record gives the same ids in the browser and on the server.

### A shop action

1. The writer applies the rule from `holdrules.js` to the local copy and publishes the result, so
   the screen answers at once and the writer can still return what it does today (`buyShip` its
   new ship's id).
2. It posts `{ action, args, version }` to `POST /hold/actions`.
3. The server loads the stored record, refuses if `version` is not the one it holds, applies the
   same rule, runs `settle`, stores the result with the version moved on, and returns it.
4. The browser replaces its copy with the server's answer, whatever its own guess said. A refusal
   (an action the rules reject, or a stale version from a second tab) puts the screen back to the
   server's record.

Actions are queued and sent one at a time, so two quick taps arrive in order.

### The routes

| Route | Does |
| --- | --- |
| `GET /hold` | The captain's hold and its version, creating the guest and a blank hold on a first visit. |
| `POST /hold/actions` | One shop action, as above. |
| `POST /rounds` | Starts a voyage: `{ mode }` in, `{ roundId, seed, loadout }` out. |
| `POST /rounds/:id/finish` | Ends one: the input log in, `{ hold, version, banked, bounty, rungs }` out. |
| `/auth/*` | Better Auth's own routes: sessions, the email code, Google, linking, sign-out, deletion. |

## Voyages: the server replays every round

### Starting

`POST /rounds` records a round with a fresh id, a seed chosen by the server, the mode, the start
time, and the loadout resolved from the server's copy of the yard. The browser builds the world from
exactly that: `createWorld({ mode, seed, players: [{ id, loadout }] })`. It never resolves the
loadout itself, so a yard edited in the browser cannot reach the sea, and `rate()` is computed once,
on the server.

`newSeed()` in `SternchaseIso.jsx`, today the one place the game rolls its own dice for a round, goes
away: the seed always comes from the server.

### Recording

The frame loop already hands `step` one input record per tick. It also appends that record to the
round's log when it differs from the last one, as `[tick, input]`. The joystick's magnitude and
angle are rounded in `src/input/controls.js` before they reach `step` (to 1/1024 of a turn and of
full deflection), so the browser plays the same rounded figures it logs, and a captain steering
steadily writes few entries. The log lives in memory only.

### Finishing

On `round_over` the browser gzips the log (`CompressionStream`) and posts it with the tick the round
ended on. The server, in a worker thread so a replay never stalls a live multiplayer round:

1. refuses the round if it is not this captain's, is already finished, or is older than the 1-hour
   limit `sim-test` already uses;
2. refuses it if its ticks come to more time than has really passed since `POST /rounds`, less a
   few seconds' slack, so a round cannot be finished faster than it could be played;
3. rebuilds the world from the stored seed, mode and loadout, steps it through the log, and refuses
   it if the round does not end on the tick the browser said;
4. banks `voyageStats` from its own world through `bank`, runs `settle`, stores the hold, marks the
   round finished, and returns the new hold and what was banked and paid.

The end screen shows what the server returns. If the finish fails on the network, the browser
retries from memory while the tab is open. A closed tab banks nothing, which is today's rule for a
round abandoned mid-fight.

Online rounds need no replay: the server ran them, so it banks them directly, as Stage D will.

### Making the round replay identically everywhere

Replay only works if Safari, Chrome and Firefox step the same world to the same bits as Node.
Addition, subtraction, multiplication, division and `Math.sqrt` are exact in every JavaScript engine;
`Math.sin`, `cos`, `atan2`, `pow`, `hypot`, `exp`, `log` and `asin` are not, and the engine calls
all of them. So:

- `src/sim/math.js` gains its own versions of those eight, built from exact operations only (a
  port of the fdlibm routines V8 already uses, so Node's results do not move).
- `npm run purity` refuses those `Math` functions anywhere under `src/sim/`, and in any function of
  `shipyard.js` or `hullform.js` the engine reaches. The ones the renderer uses are untouched.
- `npm run determinism`, a new test, plays the `sim-test` rounds in Node and, through the
  `playwright-core` already installed, in WebKit, Chromium and Firefox, and fails unless every final
  world matches Node's bit for bit. It runs in CI beside `sim-test`.

**Nothing that moves the hold to the server ships until `npm run determinism` passes.** If it cannot be made to pass,
single-player rounds move to the server live (option 3 above) and the rest of this design stands.

## What the captain sees

Copy follows `CLAUDE.md`'s rules for player-facing text. The lines here are starting points.

- **The menu** gains "Save your progress" while she is a guest, and her email or "Signed in with
  Google" once she is not.
- **Sign-in** is one screen: an email field and "Send code", then a 6-digit field; or "Continue with
  Google".
- **Switching accounts** warns first: "This device's progress will be replaced by the account's."
- **The first visit after this ships** says once that progress now saves to her account and the old
  save could not come with it.
- **No connection:** the menu says the game cannot reach the server, and rounds and the shop wait
  until it can. There is no offline play, because there is nowhere to bank it.
- **Settings** gain "Sign out" and "Delete my account", the second behind a confirmation.

## Privacy and consent

`src/privacy.jsx` changes in the same PR as the code, with `PRIVACY_UPDATED` moved:

- what is stored on the server: the hold, an email or a Google account id, rounds' seeds, inputs
  and results, and sessions;
- the session cookie on `api.sternchase.org`, which is essential: it is what keeps a captain's game,
  as the hold always was, and it is never gated on the cookie prompt;
- Railway (hosting and database) and Resend (sign-in emails) as processors, and Google for those who
  choose Google sign-in;
- how long each is kept (guests 90 days from their last visit, rounds' input logs 30 days), and that
  "Delete my account" removes everything at once.

Nothing about the login changes who sees which ads or what the page shows. Ads and analytics stay
exactly as `ads.js`, `consent.js` and `analytics.js` describe them.

## The database

Better Auth's own tables (`user`, `session`, `account`, `verification`), and two more:

| Table | Columns |
| --- | --- |
| `holds` | `user_id` (primary key), `data` (jsonb, the record `holdrules.js` reads), `version`, `updated_at` |
| `rounds` | `id`, `user_id`, `mode`, `seed`, `loadout` (jsonb), `started_at`, `finished_at`, `ticks`, `inputs` (gzipped bytes), `result` (jsonb), `banked` |

The hold stays one record in one row, because it is one object the rules read whole. Splitting it
into tables waits until something (leaderboards, trading) needs to query across captains.

## The order of work

Each step is merged on its own and leaves the game playable.

1. **Exact maths and the determinism test.** No server needed. This is the gate for everything
   after it, so it goes first.
2. **Split `hold.js` into `holdrules.js` and the store.** The store is still `localStorage`; no
   behaviour changes.
3. **The Railway service and database:** Better Auth with guests, the hold routes and the round
   routes, with server tests. Needs Railway set up.
4. **The game on the server's hold:** the store becomes the server's copy, rounds start and finish
   through the API, the old key is deleted, the offline state, and the privacy policy.
5. **Email and Google sign-in, linking, sign-out and deletion,** and the menu's account controls.

## Tests

- `npm run sim-test` and `npm run purity` as now, with purity's new rules.
- `npm run determinism` in all four engines.
- Server tests for every hold action (applied, refused, stale version), and for each refusal a finish
  can meet: a round finished twice, someone else's round, a log faster than real time, a log that
  ends on the wrong tick.
- A replay test that plays recorded rounds through the server's finish route and checks the bank
  against `voyageStats` from the browser's own world.
- `npm run smoke` gains a run that starts as a guest, plays a round, banks it, buys a part, saves
  progress by email code (Resend in test mode), and signs back in on a second browser context.

## Not in this design

- Importing anyone's existing local progress.
- Leaderboards, trading, or anything else that reads another captain's hold.
- Sign in with Apple, which needs a paid Apple developer account.
- Detecting bots.
- Offline play.

## Open questions

- **Serve the game from Railway too?** One origin would lift Safari's 7-day cap on the session
  cookie and remove CORS, at the cost of moving off GitHub Pages and its deploy workflow.
- **Railway region.** The same one multiplayer picks, and the Postgres beside it.
- **Input log size.** The rounding in `controls.js` is a first figure; step 1 measures what a
  20-minute ladder round's log weighs gzipped, and the rounding moves if it is too heavy.

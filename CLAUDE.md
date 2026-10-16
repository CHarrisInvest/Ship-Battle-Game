# Sternchase: Helm & Hull

An isometric age-of-sail combat game. Canvas 2D, React shell, no engine.

The game is Sternchase; `Helm & Hull` is the second line of the title and never stands alone. The
repository keeps its old name, `Ship-Battle-Game`, but the site is served from the root of
`sternchase.org`, so the Vite base path is `/` and nothing in the build carries the repo's name.
`broadside` in the code is the side guns, not the old title, and stays.

- **A change reaches players by way of `staging`.** Branch `staging` is `staging.sternchase.org`,
  with its own Railway environment and Postgres; branch `main` is `sternchase.org`. A pull request
  goes into `staging`, and every push there opens or carries the one pull request from `staging` into
  `main` (`.github/workflows/promote.yml`), whose merge is the release. Only a fix that cannot wait
  goes to `main` first, and it is merged back into `staging` the same day. The README's "Deploying"
  section is the whole of the setup.
- `src/SternchaseIso.jsx` is the screen: the menus, the shipyard screens, the HUD, the end screen, and
  the frame loop that joins the engine, the renderer and the controls. It holds no rule of play.
- **`src/sim/` is the engine, and only the engine decides what happens in a round.** The world, the
  step, ships, guns, rams, the AI, the weather, the round's rules and its end, the mode rules and the
  dice live there. `createWorld({ mode, seed, players, rivals })`, `step(world, inputs)`,
  `voyageStats`, `voyageRun`, `repairQuote`, `isInput` and `playOn` are the whole of its interface:
  controls go in as one input record per player id (a repair included, so it travels the road the
  wheel does), `isInput` says whether a record is one the controls could have made, `voyageRun` is
  what a finished voyage banks, read off the world once for the browser and the server alike, `playOn`
  is a copy of a round she has sunk out of that sails on without her so she can watch the rest (it
  banks and places nobody), and what happened comes back as events carrying ids and numbers, never a
  reference into the world, with `world.result` once the round is over. The world is plain data that
  `structuredClone` copies. `docs/ENGINE.md` is its design note.
- **The engine is pure, and `npm run purity` says so.** Nothing under `src/sim/` imports anything but
  itself, `shipyard.js`, `shipref.js`, `hullform.js` and `exact.js`, or mentions `window`, `document`,
  `localStorage`, a canvas, `Math.random`, `Date.now` or `performance`. Nor does it, or the catalogue
  modules it reads, call a `Math` function JavaScript lets each engine round its own way (`sin`,
  `cos`, `atan2`, `asin`, `exp`, `log`, `pow`, `hypot` and the rest) or use `**`: those come from
  `src/exact.js`, built from operations IEEE 754 fixes, so Node, Chromium, WebKit and Firefox step a
  round to the same bits, which is what will let the server replay a voyage and bank what really
  happened. `npm run determinism` sails the recorded rounds in all four and fails on a difference.
  That is what lets it run unchanged in Node, where `npm run sim-test` plays every mode, and what
  makes the same seed and the same inputs the same round. The hold, analytics, ads and consent are
  reached from the component and never from the engine, so banking a voyage and tracking it happen
  once, in the component's `round_over` handler. Every random number a round uses comes off `world.rng`; only what decorates
  the sea keeps `Math.random`, in the renderer.
- **The engine says what happened, and the screen decides how it looks.** Smoke, splinters, wakes, the
  words over a sinking, the vignette, a ship's colours, her heel and her drawn rig are `src/render/`'s,
  built from the step's events and the world and never read back by the engine. The end screen's
  sentences are the component's, picked from `world.result`. A visual field on a ship or a line of
  copy in the engine is the old tangle coming back.
- **The round steps at a fixed `TICK`, a sixtieth of a second, and the screen draws between steps.**
  The frame loop banks real time and takes a step for every whole tick, five a frame at most, and the
  renderer blends each ship and ball by what is left over. A figure tuned per frame is per step now,
  the same on a 60 Hz phone, a 120 Hz one and a server.
- `src/render/` is the canvas: `renderer.js` draws a world and holds the camera, `effects.js` is one
  viewer's picture of the round, and the palette, the view, the island planting, the sea rig and the
  HUD's placement sit beside them. `src/input/controls.js` turns the joystick, the fire buttons and
  the repair rail into the input record.
- `src/galleon.js` draws the rotating ship on the menu. It draws a rig rather than *the* rig:
  `drawGalleon(ctx, w, h, deg, spec)` builds whatever is stepped and bent on, and falls back to the
  galleon it was written around when given no spec.
- `src/shipyard.js` is the catalogue and the maths for buying ships and parts. Hulls, masts, sails
  and guns as data, what fits what, and `rate()` turning a set of them into the figures a fight
  reads. It holds no state, touches no storage and imports nothing but `exact.js`, and it should
  stay that way.
- **A ship's rate is read off her ports, and her strength off her stat line. Neither is ever
  declared.** `rateOf(hull)` counts `guns.broadside` both sides and lands her on one of the eight
  rungs in `RATES`, the way the navy rated a ship: a hull pierced for fifty a side is a hundred-gun
  ship and a first rate, chasers and swivels excluded. `measure()` derives strength from what `rate()`
  says about the finished ship, which is a different question: a first rate with half her ports empty
  is a first rate, badly found. Modes read both, the rate for who she meets and the measure for the
  order they come in. A hull's `order` is her place on the shop shelf and is a third thing again: do
  not match opponents on it. Nothing in `STOCK` carries a rate or a rung of its own.
- `src/shipref.js` is generated beside it and holds what each class *was*: her dimensions, the shape
  of her, her timber, her era and what she was for. `hullform.js` is the one reader, and it is the
  "later" the file was kept for: it turns those proportions into each class's drawn hull. Keep it out
  of `shipyard.js`, which is what a fight reads and has no use for a tumblehome score.
- `src/hullform.js` models each class's hull from her reference row: the 3-D menu model `galleon.js`
  builds (stations, castles, gunports, stern shape, mast geometry), the hull at sea (her world length
  and beam, which are also her collision ellipse, her outline, her stern cabin, where her masts
  stand), and her timber, a species-and-density cast over the wooden palette in both views. The
  galleon is the authored anchor: her hull, castles and mast geometry are the literal numbers the
  game always drew under the plain Oak palette, a few small fittings are re-derived as ratios that
  agree to within a few hundredths of a unit, and every other class is derived by the same rules from
  her own row. Sizes are deliberately compressed around her, so she is the size she always was. A
  class's size lives here, with her art, and still never in the catalogue.
  **Her battery is the one part of her that is solved rather than authored.** `GALLEON_REF` is her
  row and her ports come out of the same `portsOf` as everyone's, because an anchor the port rules do
  not apply to is an anchor nobody can check them against. She was drawn pierced for eight guns on a
  130-foot hull; she carries the forty-six a great galleon of her size really did.
- **The hold's rules are pure, and the server will run them too.** `src/holdrules.js` is what the
  record is (`blank`, `sanitize`), what a voyage banks (`bank`), what achievements pay (`settle`),
  every reader the screens use, and the shop as a table of actions behind one door,
  `applyAction(rec, name, args)`, which settles what it returns and answers junk arguments with
  `null` rather than throwing, because from the server they come off the network. Banking is not a
  shop action. It imports only the catalogue and `achievements.js`, never edits the record it is
  handed, and `npm run purity` holds it to the engine's rules; `npm run hold-test` holds it to the
  shipyard's. `src/hold.js` is this browser's copy of the server's record: a shop action is applied
  here at once, shown and sent, the server's answer replaces the guess, a refusal rolls the screen
  back, and a stale version (another tab) is tried again on the record the server sent. It keeps the
  exports the screen has always read, adds `connect` and the connection's status for the menu, and
  deletes the save this browser kept before the hold moved (a local record could have been edited).
  `src/voyage.js` starts a voyage on the server's seed and loadout and records the controls it is
  sailed with, in pieces, for the server's replay; the stick is rounded in `controls.js` before the
  step sees it, so what is sailed is what is logged, and the end screen shows what the server banked.
  `src/net.js` is the one line to `/api`. `npm run client-test` runs all three against a real server.
  Nothing else is saved; worlds and islands are generated fresh every match.
- **`server/` is the game server, on Railway, and it believes nothing the browser computed.** Plain
  `node:http`, Better Auth at `/auth/*` (every visitor a guest through the anonymous plugin), and
  Postgres for the holds and the voyages. **A guest keeps her progress by signing in**, with a
  6-digit code sent through Resend (`RESEND_API_KEY`) or with Google (`GOOGLE_CLIENT_ID`), each on
  only when its keys are set, and `GET /account` tells the menu which. `guestLinker` in
  `server/auth.js` is the one rule for what happens to her hold: an account signed in to for the
  first time takes it, and an account that already has one keeps its own, because merging two holds
  duplicates coins; the account screen (`src/account.js`) warns a guest with progress first.
  Signing out and `POST /account/delete` leave the browser a fresh guest.
  A shop action is `applyAction` under a row lock with the record's `version` as the check, so a stale tab is refused with the record as it stands. A voyage is
  started by the server (its seed, the loadout off its own copy of the hold, sent as the JSON the
  browser builds the world from), fed its input log in pieces no faster than real time, and banked
  only after the server replays it and finds it ends where the browser said. The replay runs in a
  worker and outside any transaction, holding no connection and no lock, one finish per round at a
  time; only a replay that says yes locks anything, the hold and then the round, the order every
  route takes them in. One voyage at a time; a refusal banks nothing, and three close the round. `GET /health` reports the engine's fingerprint
  (`enginehash.js`) and a round for another engine is refused, because a replay under other rules
  would bank what the captain never saw. Document columns are `json`, never `jsonb`, which reorders
  keys. `purge` keeps only what the privacy policy says is kept. `npm run server-test` runs it all
  against a real Postgres (a throwaway Docker container, or CI's service container).
  **The browser never talks to Railway.** The game has no domain of its own, and a server on another
  site sets a third-party cookie Safari refuses, so `api/proxy.js`, a Vercel edge function `vercel.json` routes every `/api/*` path to,
  forwards `/api/*` on the game's address to the server, which answers under `API_PREFIX` (`/api`).
  The function adds the `PROXY_SECRET` the server demands of every route but `/health`, and the
  visitor's address as Vercel saw it (`x-client-ip`), which the server's limits count by; whatever a
  visitor sends in either header is dropped first.
- **Sailing with friends is one round the server runs and every browser steps.** `server/online.js`
  keeps lobbies (a five-letter code, up to 8 captains, the host sets the AI ships and starts) and runs
  each round at 60 ticks a second on its own clock, from its own seed and each captain's loadout off
  her own hold. What it sends is not the world but each tick's controls, twenty frames a second, and
  every browser (`src/online.js`) steps the same world through them: the engine steps to the same
  bits everywhere, which is what `exact.js` and `npm run determinism` are for, so this is safe, and a
  fingerprint of the ships every two seconds says if it ever is not. Each captain is banked off the
  server's world as she goes out or the round ends, connected or not. The socket goes straight to
  Railway (`PUBLIC_WS_URL`), because Vercel's proxy cannot carry one, so it is opened with a short-lived
  ticket from `/api/online/ticket`, where the cookie still travels. A dropped connection is not a
  departure: phones drop sockets the moment an app is switched away from, so she is shown away and
  her place is held for `AWAY_MS` (2 minutes). The socket reopens by itself, the server seats her by
  her account (no code kept in the browser), a reopened app asks `/api/online/where` and goes back,
  and mid-round she is sent the start and every tick so far, which her browser sails up to the
  server's tick in a moment. `npm run online-test` sails two
  captains through a round over real sockets; `npm run online-smoke` does it in two real browsers.
- `src/consent.js` is the cookie prompt's answer: essential, analytics and advertising, kept
  under its own key. **The hold is the essential category and is never gated on
  it**: "Reject all" must not touch a captain's progress.
- `src/ads.js` puts AdSense on the page and decides **whose prompt asks first**. **AdSense is the
  only ad network, and everyone sees ads; consent decides only whether they are personalized.**
  **Every visitor gets the same page and the same code path.** The script loads at once for everyone
  with ad requests paused and non-personalized, and Google's own consent tool (AdSense Privacy &
  messaging, a certified TCF tool the script brings) answers `gdprApplies`. Where it says yes (the
  EEA, the UK and Switzerland) Google's message asks, a no there gets Google's limited ads, the
  game's prompt is never shown, and "Cookie settings" reopens Google's. Everywhere else, including
  Google not answering, the game's prompt asks and `isAdvertisingAllowed` (the "Personalized ads"
  switch) lifts the non-personalized request. Non-personalized ads still set cookies, so the prompt
  says so in its body and never files them under essential: they are not strictly necessary, and in
  Europe calling them that is exactly what the law forbids. Ads load from `main.jsx` only, so the
  privacy page carries none. **A preview build loads no ads and no analytics.** `__PREVIEW__` in
  `vite.config.js` is true when Vercel builds a preview deployment (staging and every feature
  branch), and `ads.js` and `analytics.js` read it: `adsLive`, `analyticsLive` and `conversionsLive`
  all say no there, and the game's own prompt asks so the consent screens still work. It is decided
  once per build and is the same for everyone who opens that build, which is what keeps it clear of
  the rule below; the real site is one build that loads everything for everyone.
- **No cloaking, ever.** The game does not guess where a visitor is (no time zones, no user agent,
  no referrer) and shows nothing to one visitor that it hides from another; Google's consent answer
  is the only thing that varies the asking, and it varies only the asking. Do not add a second ad
  network, a script loaded on a condition, or a feature switched off "while Google reviews": Google
  Ads suspended the account for circumventing systems after a third-party banner did all three, and
  the static text in `index.html` must say what the game shows, the same for everyone.
- **What search engines read is in `index.html`**: the title, the meta and share descriptions, the
  `VideoGame` structured data and the plain-HTML block in `#root`, all saying one thing in the same
  words. It names modes as examples ("game modes such as ...") and never counts modes or ships, so a
  new one does not make it false. `public/sitemap.xml` lists every page with an address of its own;
  a new page goes in it the day it ships.
- `src/analytics.js` is Google Analytics 4 for those who opted in, and nothing at all until `GA_ID`
  holds a measurement ID: `analyticsLive` is what the prompt and the privacy policy read, so filling
  the ID in is the one change that turns analytics on and the copy follows. **Where the game's prompt
  asks, analytics are on until the switch turns them off**, because measuring one's own site needs no
  prior consent there.
  Where Google's message asks, its TCF record (purposes 1 and 8, vendor 755) is the answer and
  gtag.js is not fetched before a yes. Game events go through `track`, which does nothing without
  consent. **The Google Ads conversion tag (`ADS_ID`) is the same gtag.js and answers to the same
  switch**, which the prompt names "Ad measurement" while GA is empty; under Google's message it needs
  purpose 7 where Analytics needs 8. It credits a visit to the game's own campaign and is never used
  to pick ads, so ad personalization stays denied on it, and `track` sends play events to GA alone.
- `src/privacy.jsx` is the privacy policy, read by the in-game screen (off the menu and the cookie
  prompt) and by the page at `/privacy/`, a second Vite entry, because AdSense and Google's message
  need it at an address. **It must stay true of the code**: anything new stored or loaded changes it
  the same day, with `PRIVACY_UPDATED` moved.
- **A ship's name is the captain's, and her class is the catalogue's.** A ship record carries a
  `name`, empty until she is given one, and `shipName(rec, id)` is the one reader: the name if she
  has one, her class if not. Every screen that prints a ship's name reads it from there, so she is
  called one thing everywhere and an unnamed ship reads exactly as she did before names existed.
  `NAME_LIMIT` and `cleanName` are the whole of the rule. There is no filter, because until online
  play the only reader was the captain who wrote it; sailing with friends shows a ship's name to
  them, and those are people she chose to sail with.
- **Her tonnage is a hard limit, and the rail refuses a gun she cannot bear.** `hull.tons` is the
  iron she carries, in the tons the guns are weighed in, and a broadside gun counts twice because it
  is mounted both sides. `gunTons` and `gunFits` in `shipyard.js` are the one statement of that rule;
  `fitGun` checks it, `sanitizeYard` checks it on load so an old record comes up under the cap, and
  `shortfall` counts her ports under it so a port nothing is light enough for is not a gap. For a
  long time the cap was a soft one that cost handling and appeared on no screen, which is a rule
  nobody could plan around. The figure now sits on the menu plate, the yard and the outfitter.
- **The yard is the hub, and every row on it is a door.** The plate on the menu turns any ship she
  owns, the strip at the head of the yard and the outfitter looks at any of them, and "Sail her" is
  its own act rather than a side effect of looking. Tapping a socket, a berth or a mount in the yard
  opens the outfitter on that tab, whole and with no picker up, so `OutfitterScreen` takes a
  `start` naming the tab and the yard screens take a `shipId`. `ownedFill` is "fit what you own" worked out
  on a copy, so the button can say how many parts it will fit before it is tapped, and `readiness`
  is the same run against a hull she has not bought, for the shelf.
- **A part sells back in full.** `REFUND_SHARE` in `holdrules.js` is 1 and `sellPart` is the one door:
  the part comes off every ship carrying it and the refund comes off `spent`, so the ledger still
  reconstructs what she earned. Lower the constant if a part ever needs to be a commitment; do not
  add a second price.
- **A part is exclusive to a slot, not to a ship.** One instance is in one slot of one hull or in
  none of hers, so a ship pierced for fifty a side still wants fifty guns bought to fill her. Across
  the fleet nothing is exclusive: a mast standing in the frigate steps in the sloop as well, and the
  frigate keeps hers. Only one ship ever goes to sea, so the old rule, which held one instance to one
  slot in the whole yard, bought nothing but the tedium of stripping a hull by hand before rigging
  the next one. `pull()` therefore works on one ship rather than the yard, and `spareParts(rec,
  shipId)` — everything owned that this ship is not already carrying — is the inventory the outfitter
  offers. Do not reintroduce a fleet-wide claim on a part.
- `src/achievements.js` is the achievement list, and **an achievement is a question asked of the hold,
  never a stored flag**: a `count(hold)` and a `goal`, or `goals` for a ladder climbed rung by rung.
  So one added tomorrow credits what a captain did last week, and it can only ask what the hold
  actually keeps. Wanting one the record cannot answer means adding what it counts to `holdrules.js` first,
  then the achievement is a row. **A rung pays coins, and what is stored is the payment, not the
  achievement.** `rewards` on the row says what each rung is worth; `settle` in `holdrules.js` pays every
  rung earned above the `paid` ledger on every write and once on load, and `bounties` totals it so the
  purse still reconstructs. Do not write an achievement's state anywhere else.
- **Nothing is bought at sea but repairs.** A ship is what she was when she sailed; what she is comes
  from the shipyard between voyages. Repairs are paid out of the voyage's own takings, so a coin spent
  on the carpenter is a coin that never reaches the hold. If you find yourself adding a stat that
  grows mid-round, that is the upgrade rail coming back and it was deliberately removed.
- **The catalogue tables are generated.** `data/hulls.tsv`, `data/masts.tsv`, `data/sails.tsv` and
  `data/guns.tsv` are the source; `npm run import` writes them into the marked blocks in
  `shipyard.js`. Editing those blocks by hand works until the next import throws it away, so edit the
  table. `npm run workbook` writes the four tables out as `data/ships.xlsx` for editing in Numbers or
  Excel and `npm run workbook:read` reads them back; the workbook is a way of editing the tables and
  never a second source, so anything that does not come back through it never happened.
- **`active` says which hulls are at sea, and the table keeps the rest.** A class laid up holds her
  row with her figures as they stood and sails again the day the column says yes, so the table is the
  fleet's whole history and the game is the part of it currently afloat. Two rows may therefore share
  an id, one sailing and one laid up, which is what a class rebuilt to new figures looks like: only
  the sailing half is ever written into `shipyard.js` or `shipref.js`, and both tools refuse two rows
  that both sail. Delete a row only to forget a ship ever existed.
- **A mast type is a shape of rig, not a station, and a hull says which shapes she takes.** A mast
  carrying three square sails is that mast wherever it is stepped, so a brig's fore and main are one
  part bought twice. Every mast carries one `family` in `RIG_FAMILIES` (square, spanker, schooner,
  gaff, Bermuda, lateen, lug, boat, headsails, spritsail) and every socket of a sailing class names
  the families it takes, written `station/size/family+family` in `hulls.tsv`. `mastFitsSocket`
  matches the family before the size rung, the way it matches spar against mast, because size alone
  let a lug mast step in a first rate and her "plain" stock fit really did sail under lug topmasts.
  Berths run deck upward, and a fore-and-aft driving sail sharing the lowest
  level with a course takes berth 0 with the square canvas above it, because the model holds one sail
  to a band and a spanker belongs at the bottom of the rig rather than over the topgallant.
- **A sail's category is the whole of the fitting rule.** A berth names one of the seven in
  `SAIL_KINDS` and a sail belongs to one, and they are compared as a single key. Area is not the
  category: a topgallant is nearly four times a skysail and both are `SSQ`, so the range inside a
  category belongs in `drive` rather than in a second field. This replaced a cut-and-size pair that
  produced combinations no real rig has; do not reintroduce one.
- **A lateen is not a headsail**, which is why there are seven categories and not six. They were one
  until the bowsprit became a station: the moment a jib had a berth, a lateen fitted it and pulled
  better, so the choice made itself. `TRI` is jibs and staysails, `LAT` is lateens and the Bermuda
  mainsail. Splitting on what a sail *is* is not the size dimension the model threw out.
- **A spar is not a mast.** A jibboom goes on the bowsprit and nowhere else, and a topgallant mast
  never goes over the bow. Size alone would allow both, since a spar is small and small fits
  everything, so `mastFitsSocket` matches the sort of thing first and consults the size rung second.
  `SPAR_STATIONS` is which stations take one.
- **A studdingsail is not a berth.** It booms out beyond a square sail already set and its area comes
  off that sail, so `STU` is marked `additive` and the bench fails a berth that asks for one. It is
  wired as exactly that: an attachment on a sail (`studFitsSail`, `fitStud`), matched by the *level*
  of square canvas it extends rather than by berth number, its drive a share of its host's, and it
  comes loose the moment the host sail does. Only square and schooner rig carry the booms for one
  (`STUDDING_FAMILIES`): a boat's pole and a lateen yard have nothing to boom a sail out from.
  **They are laid up for now** (`STUDDING_ON` is false): they read as overdone, so no mast takes
  one, the shop, stock ships, the drawing and `rate()` all see none, and any a captain bought come
  off her ships on load and wait among her spares. The rows and every rule above stand, so bringing
  them back is that one line, plus refitting `KNOTS_PER_RATING` off `npm run catalogue`, which moves when they do.
- **Knots are a label on the speed rating, and the fight never reads them.** `rate().speed` stays a
  multiplier around 1 and `BASE_SPEED` stays what it is; `KNOTS_PER_RATING` turns the rating into a
  figure a captain can hold against something, fitted so a fully found ship lands near the `topSpeed`
  her reference row records. `npm run catalogue` fits the constant and prints each class's residual.
  `measure()` never sees knots, so nothing about strength or matchmaking moves when the constant does.
- **Handling is printed as a score out of 100, and nothing scores 100.** `rate().turn` stays a
  multiplier around 1 and the fight reads that; `handlingScore` divides it by `HANDLING_TOP` for
  every figure a captain reads, and `handlingPoints` turns a change in it into points for the "helps
  the helm by 3" lines. The constant is set so the best rig in the catalogue lands in the low
  nineties, the score is capped at 100 besides, and `npm run catalogue` rigs every class for the most
  handling she can reach and fails if one comes within reach of the cap. Raise the constant then;
  never lift the cap, and never print the raw rating to a player.
- **A sail's figure is what she does to this ship, from here.** Drive runs into a saturating curve
  against the hull's `canvas`, the berth fades it, and a studdingsail is a share of its host, so
  "adds 1.3 knots" is only true of one berth on one ship as she stands. `berthEffect` is the one
  reader: the outfitter shows the change fitting a sail would make, the yard shows what each sail
  aboard is worth, and neither prints a sail's `drive` as if it were a speed.
- **A part's `part` says what sort of thing it is; a sail's `kind` says which category.** They were
  one field, and the two meanings collided the moment the categories arrived.
- **The renderer draws up to five sails up a mast, and the bands are generated.** Three or fewer are
  the ones authored in `STATION_GEOM`, so the galleon is unchanged; a taller stack is that profile
  resampled and squeezed into the same air, because three sails already reach the masthead and there
  is nothing above them to extend into. Five is the ceiling and the bench holds the catalogue to it.
  Adding a row to `STATION_GEOM` is not how a sixth would be added.
- **A broadside is one ball a gun, spread over a moment, and laid as it bears.** Fifty balls leaving
  in the same instant cannot be told apart at any size they could be drawn, so every gun takes her
  own moment inside `volleyWindow`: several ports go off together, then a few more elsewhere, and
  what separates one ball from the next is the ground the one before made. A ship crosses better than
  a hull length while her side is firing, so every gun still to go takes that ground off its lay:
  without it a first rate at speed walked two thirds of her iron off the front of a hull she had laid
  dead. Do not cap the ball count to fix a drawing problem, and do not shorten the window to fix an
  accuracy one. Both were tried, and so was a strict roll from bow to stern, which fires the same
  guns in the same time and reads as a zip fastener.
- **Every gun she carried has a station, and a gun deck is not the upper works.** `histGuns / 2` is
  her broadside bearing for every class in the fleet, and `battery` says where those guns stood:
  gun decks lowest first, then her quarterdeck and forecastle after the plus. The two are unlike
  fittings and `hullform.js` lays them out as such. A gun deck is a continuous battery pierced
  through her side, so every tier runs the whole length of her, under the castles the way a lower
  deck really did; her upper works carried their guns in the open behind a bulwark, with no lidded
  port, which is what leaves a two-decker's waist bare. Do not read `decks` for this. It says how
  many decks carried guns and nothing about where, which is how a frigate came to draw two full
  tiers she never had and a first rate's quarterdeck ended up cut into her side.
- **A boat has no side to pierce.** A lidded port is cut through the topside under the deck above it,
  and a castle score of 1 is a hull with neither, so a gundalow through a Baltimore clipper carry
  their whole battery standing at the rail, which is the same fitting the upper works use and where
  a cutter's five guns really were. Drawn as ports they were a 4.4-deep opening in three feet of
  freeboard, hanging off her rail at the top and into her wales at the bottom.
- **A port is the size a port was, and her side is the cap rather than the figure.** `roomSpace` is
  in the reference for this: a gunport was framed on her room and space, so it runs a little over
  one frame space wide, worked in feet and brought into units by her own compression. Tiers hang
  from the rail downward with the calibre falling off as they rise, because her lower deck carried
  her heaviest guns, and the whole battery shrinks by one factor only if her side cannot carry it.
  Nothing exceeds the galleon's authored port, which is a ceiling no class reaches rather than
  anyone's figure. Fixed port sizes are what made a first rate's top tier one continuous smear.
- **A tier is cut for one deck, so it hangs PARALLEL to her sheer.** `drop` is how far under the
  sheer a row sits and it is the same figure the whole length of her, which `portZ()` is the one
  reader of. A fraction of the sheer is not the same thing and is what this was: a row at 0.21 of it
  rose a fifth as fast as the deck above it, so a first rate's lower battery went from 7.1 under her
  sheer amidships to 13.7 at her ends. There is no second rule beside it, the galleon included.
- **An open port means a gun is aboard, and an empty port is shut.** `rigSpec` carries her fitted
  broadside and she arms from the lowest deck up, the way a ship was armed, so a first rate with
  three guns shows three open ports on her lower deck and lids down everywhere else. Her ports are
  hers whatever she carries in them; the guns are what make her found. Guns run out one port in
  three on a big battery, one of each three chosen by a hash: fifty barrels a side is a centipede,
  a plain count laid a stripe down her side, and a free hash left eight ports bare together, which
  reads as unarmed rather than as housed. Above a dozen ports the barrel is drawn in fewer faces,
  because the menu plate is sorted per frame and a first rate's model is already the slowest thing
  in the game.
- **`npm run catalogue` before and after touching the catalogue.** A hull that cannot be rigged or
  carries a station the renderer cannot draw fails silently at runtime; the bench fails loudly. It
  prints the whole fleet side by side, which is the only way the numbers mean anything. It counts
  her ports as they come out drawn as well: a tier that overlaps itself, a port in her wales, or a
  class whose ports no longer add up to her guns are all faults, and all three were true of the
  fleet for as long as nothing counted them.
- `tools/promo.mjs` (`npm run promo`) draws the ad and store art in `promo/` through the same
  `drawGalleon` the icons use, and with `--play` plays a round for real frames to pick from. Its copy
  is player-facing and follows the rules below; its counts are read off the catalogue.
- `docs/SHIPYARD.md` is the design note for the shipyard: the model, what is deliberately not built
  yet, and the open questions. Read it before extending any of the above.

## The rule that outranks the others

**Clarity beats voice.** The game has a naval register and it is worth keeping, but a label whose
job is to tell a captain what a button does must do that job first. If a rewrite makes copy more
characterful and less clear, it is a worse rewrite. Mode descriptions in particular are meant to be
read and understood, not decoded.

## Player-facing text

These exist because the copy had accumulated machine tells. Anything a player reads follows them.

1. **No em dashes.** Rewrite the sentence rather than swapping in a hyphen.
2. **No interpunct separators.** Not `spd·turn·hp`, not `Lv0 · 45`. Use words, lines, or commas.
3. **No arrow notation.** `SIDE→hull` is documentation syntax, not something a captain reads.
4. **Vary the shape of parallel messages.** Three death lines written to one template read as filled
   slots however good the words are. Give each its own rhythm and length.
5. **Numerals, consistently.** `10 captains`, never `Ten captains` on one card and `10` on another.
6. **Every label says what it actually does, and no two say the same thing.** SIDE and FRONT both
   read `cannon dmg` for a long time, which told nobody which to spend on.
7. **Spell things out.** Prefer `Level 0` and `damage` over `Lv0` and `dmg`.

## Type treatment

Caps and letterspacing stopped meaning anything when everything had them. The split is by what the
text *is*, not by where it sits:

- **Caps** for the game's proper nouns: the title, both lines of it (`STERNCHASE` over
  `HELM & HULL`), the four mode names, and the six
  fight controls and what they hit (`MAST` `HULL` `CREW` `SIDE` `FRONT` `MUSKET`). Outcome headlines
  set in the display face at title size count here too, so `SUNK` and `LAST AFLOAT` keep their caps;
  they name the moment rather than instruct. **Screen titles and section titles are caps as well**,
  `THE YARD` and `HOW SHE SAILS` alike, so every heading in the game reads one way; `Slab` applies
  it as a transform, so a title built from a figure or a class name is written in the source as it
  is spoken.
- **Sentence case** for anything the player is told or asked: buttons, row labels, stat labels,
  prose. `Rematch`, not `REMATCH`; a mast's station on a row is `Main`, not `MAIN`.
- **A ship's name is whatever the catalogue says it is.** `Bermuda Sloop light` and `Baltimore
  Clipper` carry their capitals because the fleet was named that way on purpose. A class is a proper
  noun and the table is where it is spelled: do not sentence-case the `name` column to match the rule
  above. The eight rungs in `RATES` follow the same principle from the other side, being the navy's
  own words rather than the game's: `6th rate`, `Unrated heavy`.

Buttons take size over tracking. Wide letterspacing makes every control read as a headline.

## HUD and UI

- **Icons are drawn, never emoji.** Emoji render in the OS font, so the HUD changes shape between
  iOS, Android and Windows, and they sit wrong against hand-drawn canvas art. The HUD pills are DOM,
  so inline SVG is the right form.
- **An icon has to carry its meaning.** Pick the shape from what the number counts, not from what is
  nearest to hand in the emoji table.
- **Check every icon at 1x, in the game.** The HUD icons run 9px to 17px on a 16-unit grid, so a
  1-unit detail is under a pixel. A capture at deviceScaleFactor 6 will not tell you this, because it
  draws 72 device pixels for a 12px box.
- **Draw masses, not strokes, and cut detail out rather than drawing it in.** A hairline goes grey
  when it lands under a pixel; a shape knocked out of a filled body keeps full contrast at any size,
  and when it finally does fall under a pixel the body is still there to carry the meaning. The coin
  is the case: as a ring with a thin glyph inside it, it read at 12px as a wall clock, and the same
  coin as a filled disc with a skull cut out of it reads as a coin all the way down to 9px, where the
  skull has gone and a round gold mass is left.
- **An icon can go down a level of detail as it shrinks, but not down a meaning.** The skull on the
  coin loses its nose and teeth to the skull on the sunk counter, which has more room; it keeps the
  domed head, two sockets and a jaw, because that is the part that says skull. Decide what the icon
  must still be at 9px, and spend the units on that first.
- **Two shapes in one icon have to stay two shapes.** Size them alike and keep them clear of each
  other. The squall is a cloud over the ring the storm is closing on: a small cloud on a wide ring
  read as a chess pawn, a knob on a base, and a cloud tucked inside the ring fused into one lump. Two
  full-width shapes with air between them read as weather over a perimeter.
- **Counters that count the same thing should share a shape.** The purse and the sunk counter carry
  the same skull, once struck on a coin and once flying over crossed bones. Two unrelated drawings
  would make the player learn two marks for one idea.
- **The HUD has two layouts, and the canvas and the DOM place the radar off the same figures.**
  Upright, the counters sit over the bars, the repair rail runs the width of the screen under them,
  and the radar takes the top right corner. Sideways, which is the safe-area box being wider than
  tall (`useBox` in the DOM, the canvas less its insets on the other side), the rank and bars stay in
  the top left and the counters and the rail stack beside them, because a rail the width of a
  sideways screen ran across the middle of the sea. **The radar keeps its corner unless the fire
  buttons would reach up into it**, which is a test of height rather than of orientation: in Safari
  sideways they do and it steps inboard of them, from the home screen they do not and it stays.
  `HUD` and `radarRight` in `src/render/hud.js`, which the radar and the DOM both read, are the one statement of where the fixed pieces sit
  and of that test; do not put a second copy of a fire button's size in the radar's code. The
  repair rail fades while a ship is under it (`fadeRail`, written straight to the element each
  frame like the joystick's knob), because sideways it sits where the sea is fought on. The menus
  widen sideways as well (`SHELL_W_WIDE` in `Shell`, off the viewport), and the ship plate goes
  three abreast, her name to the left of her and her figures to the right. Sideways the camera
  also lets the map's boundary in only as far as `SIDE_PEEK`, the joystick's strip, where upright
  the long sides come as far as the square's edge.
- **Every control sits inside the safe area.** The viewport is `viewport-fit=cover`, so the sea runs
  under a phone's notch and home bar, and the HUD's wrapper and the menu shell are inset by
  `env(safe-area-inset-*)`. The canvas reads the wrapper's insets on resize to place the radar by the
  same edges. The game is a home-screen app (`public/manifest.webmanifest` and the meta tags in
  `index.html`), which is the only way to a full screen on an iPhone; `npm run icon` draws the icons,
  the favicon and the share card from a gaff-rigged cutter through the menu's own `drawGalleon`, so
  they are generated and never edited by hand.
- **Text is the size the source says, sideways as well as upright.** `index.css` sets
  `text-size-adjust: 100%`, because iOS Safari boosts the text in ordinary blocks when a phone turns
  sideways and leaves buttons alone: the GAME MODES heading and the descriptions grew while the mode
  names on the cards, which are buttons, did not, with all three set at one size. A size that looks
  wrong in one orientation only is that boost, not the source.
- **Border radius comes from a small set:** 3 for hairline bar fills, 10 for cards and buttons, 20
  for full-round pills. Do not invent a new one per component.
- **A double tap is a tap twice, and every element says so itself.** This is a game played with the
  thumbs, so two taps inside a few hundred milliseconds are ordinary play rather than a gesture.
  `index.css` sets `touch-action: manipulation` on `*`, because the element the browser reads is the
  one under the finger and a label inside a button inside a card is what gets hit. It has to be
  `touch-action`: `user-scalable=no` in the viewport meta is kept, since Android honours it and it
  spares the shell an accidental pinch, but iOS Safari ignores it on purpose, so it is not the fix
  and never was on an iPhone. The canvas,
  the joystick and the fire buttons override it with `none` inline, which is the play surface and
  belongs there, and so does the HUD's safe-area wrapper, which holds the fight's controls and
  nothing else, so every pill and rail button inherits `none`. Nothing that is an ancestor of a shop
  or menu screen may carry `none`: a `none` up the chain can stop the screen under a finger from
  scrolling. While a round is running there is a second line besides, in `App`: a `touchend` inside
  a double-tap's window is cancelled and a `gesturestart` refused, because iOS Safari has zoomed on
  a double tap with `touch-action` set, and sideways the counters sit where the thumbs drum.
  Nothing in the fight is driven by a click, so nothing is lost; the listener is off outside play.
- **Check a new colour against every ground it lands on.** HUD colours sit on the enemy bar's
  50%-black backing, on the player panel, on button grounds, and against open water. The mast bar
  was a teal that scored 1.41 against the sea and vanished into it; the obvious fix, a navy, scored
  1.01 against the bar's own dark backing, which would have made a full bar look empty.

## Checking work

A change to the engine runs `npm run sim-test` and `npm run determinism` before and after: the first
plays every mode to its end in Node, sails each round twice from one seed, and fails on a round that
ends differently the second time, which is how an unseeded random number or a figure read off the
screen shows itself. The second sails the recorded rounds in `tools/rounds.js` in Node, Chromium,
WebKit and Firefox and fails unless all four end every round on the same bits. A change to the hold's
rules runs `npm run hold-test`, and a change to `server/` runs `npm run server-test`, which needs
Docker locally.

Verify visual changes in the running game, not only in a standalone harness. A harness that
replicates the draw code is useful for iterating on geometry and for comparing before and after, but
it is a replica, and it can agree with itself while disagreeing with the game. When a screenshot
comes from a replica rather than a real frame, say so.

## Known gaps

Rules above that the code does not yet satisfy. Tracked cleanups, not exceptions.

- **Hull art is parametric, not bespoke.** Every class now draws on a hull modelled from her own
  reference proportions in `hullform.js`, at her own size, in her own timber, with her own stern
  type, in both views; the galleon is the authored anchor and her hull comes out unchanged, checked
  by pixel diff, her battery excepted, which is solved from her row like everybody else's.
  What no class has yet is hand-finished art of her own beyond what the parameters express:
  a fluyt's extreme tumblehome or a carrack's built-up works are still the shared family of shapes
  with different numbers. Refining a class means refining her form, not adding a size multiplier to
  the catalogue, which stays deliberately size-free.
- **Google sign-in has not been tried from the home-screen app on an iPhone.** A redirect out of a
  standalone web app is where that flow tends to break, so leave `GOOGLE_CLIENT_ID` unset in
  production until it has been, and email codes carry sign-in alone.
- **The catalogue's blurbs have still never been read at 1x.** Names are checked, and so are the part
  figures the shops print, but the shelves say what a part *does* rather than quoting its blurb, and
  the 38 hull rows have no blurb at all. So no line of one has been seen at a real width. Check them
  before anything starts showing them.

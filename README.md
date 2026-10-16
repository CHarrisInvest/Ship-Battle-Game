# Sternchase: Helm & Hull

Pirate ship combat on a tilted (isometric-ish) sea, rendered to a single HTML canvas from React.
The round itself is played by a plain JavaScript engine in `src/sim/`, which runs the same in a
browser and in Node; `src/SternchaseIso.jsx` is the screen around it, and `docs/ENGINE.md` says how
the two meet.

The repository is still called `Ship-Battle-Game`; the game is served at <https://sternchase.org/>.
"Broadside" appears throughout as the name of the side guns; that is the weapon,
not the game.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build    # production bundle into dist/
npm run preview  # serve the built bundle
```

```bash
npm run catalogue  # check the fleet is riggable and drawable, and print it
npm run purity     # check the engine imports and touches nothing it must not; a second
npm run sim-test   # play every mode to its end in plain Node, twice from each seed; seconds
npm run smoke      # play every mode headless to its end screen; about four minutes
```

`npm run sim-test` is the engine on its own, with no browser at all. It fails on a round that never
ends, a ship whose position or bars stop being numbers, a round that ends differently the second
time it is sailed from the same seed with the same inputs, or a repair that charges for something
other than what it puts back. The deploy runs it and the purity check before every build.

The smoke test needs a Chromium: `npx playwright install chromium` fetches one, or set `SMOKE_CHROME`
to an executable. It fails on a screen that throws, a mode that never ends, an end screen whose
column does not add up to what reached the hold, or a runtime error in any round, and it writes
every screen's picture and text to a folder it names. It says nothing about balance or feel; those
are read off `npm run catalogue` and played.

```bash
npm run icon       # redraw the home-screen icons in public/ from the menu's galleon
```

## Playing full screen

A phone browser keeps its address bar and tabs over the top of the sea. The game is set up as a
home-screen app so it can run without them: on an iPhone, open it in Safari, tap Share, then
**Add to Home Screen**, and the icon it puts there opens the game full screen. Android Chrome
offers the same from its menu (**Add to Home screen** or **Install app**), and the menu carries a
**Play full screen** button on browsers that let a page ask for it, which iPhone Safari does not.
The icons come from `npm run icon`, which draws the menu's galleon with the same Chromium the smoke
test uses.

## Deploying

The game is a static site on **Vercel**, and its server (accounts, the hold, voyage replays and
sailing with friends) is a Node service with Postgres on **Railway**. The browser only ever talks
to the game's own address: `api/proxy.js`, a Vercel edge function, forwards `/api/*` to the server,
so the login cookie is first-party. The one exception is the online socket, which Vercel cannot
carry, so it goes straight to Railway with a short-lived ticket.

There are two of everything. **Production** is branch `main`, served at `sternchase.org`, with the
Railway environment `production`. **Staging** is branch `staging`, served at
`staging.sternchase.org`, with the Railway environment `staging` and a Postgres of its own, so
nothing tried there touches a captain's real hold. A change reaches players by way of both, in that
order; see "The road to production" below.

### Railway: the server and its database

1. Make a project, and add **PostgreSQL** to it (the template, as it comes).
2. Add a service from this repository, branch `main`. In its settings:
   - start command `npm run server`, build command `node --version` (the server runs from source);
   - health check path `/health`;
   - generate a domain for it (Settings, Networking), e.g. `server-production-xxxx.up.railway.app`.
3. Its variables:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (a reference to the Postgres service) |
   | `BETTER_AUTH_SECRET` | a long random secret, e.g. `openssl rand -hex 32` |
   | `PROXY_SECRET` | another long random secret, the **same value** given to Vercel below |
   | `BETTER_AUTH_URL` | the game's address on Vercel, e.g. `https://sternchase.org` |
   | `CLIENT_ORIGINS` | the same address (comma-separate several) |
   | `API_PREFIX` | `/api` |
   | `PUBLIC_WS_URL` | `wss://<the Railway domain>/ws` |
   | `NODE_ENV` | `production` |

   The server makes its own tables on first boot. `https://<the Railway domain>/health` answers with
   the engine's fingerprint once it is up; any other route without the proxy's secret is refused.

   Leave `COOKIE_DOMAIN` unset. The proxy already makes the cookie first-party, and a cookie set on
   `sternchase.org` would be sent to `staging.sternchase.org` as well, where a server with another
   secret cannot read it and would fight it with a cookie of its own.

4. **The staging environment.** In the project's environment menu, add an environment named
   `staging`, duplicated from `production`, so it comes with a copy of the server service, a Postgres
   of its own (empty: volumes are not copied) and every variable. Then, with `staging` selected:
   - in the server service's settings, change its source branch to `staging` and generate a domain
     for it, e.g. `server-staging-xxxx.up.railway.app`;
   - set `BETTER_AUTH_URL` and `CLIENT_ORIGINS` to `https://staging.sternchase.org`,
     `PUBLIC_WS_URL` to `wss://<the staging Railway domain>/ws`, and give `BETTER_AUTH_SECRET` and
     `PROXY_SECRET` values of their own (never production's);
   - keep `RESEND_API_KEY` and `EMAIL_FROM` if codes should send from staging, and leave
     `GOOGLE_CLIENT_ID` unset unless the OAuth client is given
     `https://staging.sternchase.org/api/auth/callback/google` as a second redirect URI.

   Railway deploys each environment from its own branch on every push, so `staging` deploys when
   `staging` moves and `production` when `main` does.

### Vercel: the game

Import the repository and leave the project settings at their defaults: `vercel.json` names the
framework (Vite), the install and build commands, the `dist` output, the `/api` rewrite to the proxy
and the caching. Production is `main`; every other branch gets a preview. Two environment variables,
for the Production environment:

| Variable | Value |
| --- | --- |
| `API_UPSTREAM` | `https://<the Railway domain>` |
| `PROXY_SECRET` | the same secret as on Railway |

Each build runs `npm run purity` and `npm run sim-test` first, so a broken engine never ships. The
game and the server both fingerprint the engine; after a deploy that changes it, a page left open
is asked to reload rather than sail a round the server would replay under other rules.

To serve it from a domain of your own, add it under the Vercel project's Domains and set
`BETTER_AUTH_URL` and `CLIENT_ORIGINS` on Railway to it.

**The staging site** is the `staging` branch's preview deployment under a domain of its own:

1. Under the project's Domains, add `staging.sternchase.org` and assign it to the Git branch
   `staging` (the domain's branch field); at the DNS host, a `CNAME` for `staging` to
   `cname.vercel-dns.com`, the same as the apex was pointed. Vercel then serves every deployment of
   `staging` at that address and nowhere else.
2. Add the same two variables for the Preview environment with the branch selector set to
   `staging`: `API_UPSTREAM` as the staging Railway domain, `PROXY_SECRET` as the staging secret.
3. Add them a third time for the Preview environment with no branch, pointed at staging's server
   too, so a feature branch's preview plays against the staging server and never production's. A
   preview plays, but cannot save: the server trusts only `CLIENT_ORIGINS`.

`vercel.json` sends `X-Robots-Tag: noindex, nofollow` on the staging host, so a search engine that
finds it does not list it against the real site, whose address the page's canonical link names
anyway. `index.html`, the sitemap and `robots.txt` carry `sternchase.org` in the source and are
left as they are on staging: they are what the real site says, and the header outranks them.

### The road to production

```
feature branch  --pull request-->  staging  --promotion pull request-->  main
                                   staging.sternchase.org                sternchase.org
```

1. A change is a pull request into `staging`. CI (`.github/workflows/ci.yml`) runs on the pull
   request and again on the push once it is merged; Railway and Vercel deploy `staging` from it.
2. Play it on `staging.sternchase.org`. The staging server replays voyages and banks holds exactly
   as production does, into its own database.
3. Every push to `staging` opens one pull request from `staging` into `main`, titled "Promote
   staging to production" (`.github/workflows/promote.yml`), or leaves the one already open to carry
   the new commits. Merging it is the release; Railway and Vercel deploy `main` from the merge.

The promotion pull request is opened with the workflow's own token, which GitHub does not let start
the CI workflow on it; its commits were checked on `staging` and the merge is checked as a push to
`main`. For CI on the promotion pull request as well, add a fine-grained personal access token with
contents and pull-request write access as the repository secret `PROMOTE_TOKEN`. Either way the
repository setting "Allow GitHub Actions to create and approve pull requests" (Settings, Actions,
General) has to be on, and both branches are best protected so that only a pull request with CI
green can move them.

A fix that cannot wait goes to `main` by pull request and is merged back into `staging` right
after, so the two never drift. The staging Postgres is disposable: it can be reset from Railway
whenever a migration needs trying from a clean slate.

### Running it locally

`npm run dev` serves the game and forwards `/api` to a server on `localhost:8787`. To run one, with
Postgres in Docker:

```
docker run -d --name sternchase-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:17
DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres BETTER_AUTH_SECRET=dev-secret-that-is-long-enough \
  BETTER_AUTH_URL=http://localhost:5173 CLIENT_ORIGINS=http://localhost:5173 API_PREFIX=/api \
  PUBLIC_WS_URL=ws://localhost:8787/ws npm run server
```

The server's tests (`npm run server-test`, `client-test`, `online-test`) start a throwaway Postgres
in Docker themselves.

`.github/workflows/ci.yml` runs the engine's checks on every push to `main` and `staging` and on
every pull request, and the server's tests against a Postgres service, and publishes nothing:
Vercel and Railway deploy `main` and `staging` themselves.

The site is served from the domain root, so `vite.config.js` builds with `base: "/"`. Deploying
somewhere that serves it from a subpath needs that path set at build time, for example
`BASE_PATH=/Ship-Battle-Game/ npm run build`.

## Modes

- **Wave arena** — endless survival against a growing swarm. You open with an empty purse and one
  hunter on the water, a stock ship from the ladder a shade under your own (`ARENA_OPEN`). Kills bring
  reinforcements in from the edge of the map, spawned well clear of your bow: one for the first kill,
  then 1-2-1-2 through the fourth, then two for every kill after that up to the fleet cap. The second
  ship of a wave holds off five seconds before it sails in. Every second kill (`ARENA_STEP`) the next
  rung of the stock ladder comes out of the horizon, until the rungs reach `ARENA_CAP` of your own
  strength, a fifth over it, where the climb stops: from there the pressure is the count and never
  the ships. A captain with nothing under her on the ladder, which is the first ship, holds her
  opening hunter for `ARENA_HOLD` kills before the climb starts and climbs through her own class
  before the cap holds her. `arenaHunter` in `shipyard.js` is the rule and `npm run catalogue`
  prints the climb. Score by ships sunk.
- **Ladder arena** — one ship at a time, the whole stock ladder from the bottom, whatever you sail.
  The bottom rung is the plain gundalow and the top is the fully found first rate, and the rungs
  between are every stock ship in order of strength, so the classes interleave as their fits overlap
  and every rung is a new ship a shade harder than the last. Sink one and the next sails in from the
  horizon; sink the last and the round is won, with a purse for it (`winBonus`). Repairs are bought
  between rungs out of what you have taken, as in the wave arena. `ladderRung` in `shipyard.js` is
  the rule, `ladder()` is the order and `npm run catalogue` prints it. Score by rungs climbed.
- **Demolition derby** — ten captains and not a gun between them. Hulls are broken open by ramming
  alone, there is nothing to buy, and a squall closes on the middle of the sea. Last afloat wins.
- **Free-for-all** — last afloat wins, out of up to 10 rival captains in ships of your own rate at
  every standard of fitting out, or, in the starter gundalow, gundalows at every standard, since her
  rate holds cutters with five times her guns. The AI hunts whoever is weakest, weighing a rival's
  measured strength against its own (`PREY_STRENGTH`) as well as her wounds, and gangs up on a
  runaway leader. For the first
  `OPENING_WINDOW` seconds it simply takes the nearest hull, since nobody has a reputation yet. It
  also fires on ships it is not hunting when one drifts into a weapon's arc, with a per-captain pause
  afterwards so the sea isn't wall-to-wall powder smoke. A squall closes here too, later and wider
  than the derby's, because a wounded captain runs at a third of her health and a runner has two
  thousand paces of sea to do it in. Time afloat is not paid here: her guns pay her by the point, and
  outlasting the field pays a `winBonus` of 25 on top of what they took, which is smaller than the
  derby's because a free-for-all captain has been paid all round for the fighting that got her there.

AI ships reload on exactly the same cooldowns as the player in every mode that has guns; their only
handicap is a touch of spread on every shot.

A mode is a row in the `MODES` table rather than a name to compare against — `melee` (is every hull
hostile to every other, or only the player's), `ranked`, `lastAfloatWins`, `reinforcements`, `guns`,
`repairs`, `flees`, `storm`, what it pays for time afloat and for winning, plus the field size. The
simulation, the HUD, the menu cards, and the end screen all read those rules, so a new mode is a new
row rather than a dozen scattered checks that have to be taught about it.

### The weather

Two modes carry a closing ring, and the shape of it is a field on the mode row rather than a set of
globals, because what the ring has to leave room for is not the same thing in both. A shape is five
numbers — `grace`, `close`, `ring`, `hold`, `squeeze` — and the four times add up to how long a round
runs when nobody settles it sooner. `DERBY_WEATHER` is 18, 95, 190, 20, 35, which comes to 168
seconds; `FFA_WEATHER` is 40, 100, 300, 25, 35, which comes to 200.

It opens at `STORM_R0` — just past the far corners of the map, so closing bites at once rather than
spending its first seconds on empty water — holds there for `grace`, and takes `close` seconds to
shrink to `ring`, the working size. It closes on the middle of the map, which the island generator
leaves clear out to that mode's whole working ring plus `RING_CLEAR`: a headland in the eye of the
storm would be somewhere to hide from the one thing that stops anyone hiding.

Then, after `hold`, the eye itself shuts over `squeeze` seconds until there is no fair water left at
all. A working ring is not enough to settle a round on its own: a ram needs closing speed to count for
anything, and two ships penned in a pool a hundred paces across can mill about indefinitely without
ever getting the run at each other that would end it — left alone, better than two minutes of it.
Weather asks nobody for a run-up, so the last hull afloat is whoever has crew enough to outlast the
sea.

**The derby** is settled at the length of a bowsprit, and its ring is the size of the fight it is
forcing. Without cannon nothing can bring a mast down, so every hull holds the same top speed for the
whole match and a fleeing captain could never be run down: the squall is what makes the fight happen
at all, which is why it starts closing after 18 seconds.

**The free-for-all** is settled by gunfire, and a broadside carries better than two hundred paces. Pen
that fight into the derby's ring and every ship inside it lies under every other ship's guns from the
moment it closes, which is not a fight either, only a bonfire. So its ring works at 300 and takes
longer to get there: ten captains with guns thin themselves out long before the weather is what
settles anything, and the gunnery half of a round happens in open water. What the ring is there for is
the end of one — three wounded captains keeping their distance, or a hull running at a third of her
health across two thousand paces of sea.

The weather works on the crew, exposed on deck, rather than on the hull, and it is not an attack: no
captain is paid for it and it does not run through the damage path a ram does. It takes `STORM_BITE`
of her full crew a second, a tenth, whatever her class and however many hands she has left, so ten
seconds out in it is the ship for a gundalow and a first rate alike, and a dash across the weather
costs every hull the same share of her people. Exposure still builds over `STORM_RAMP` seconds and
sheds at `STORM_RECOVER` once she is back inside, but it drives an AI captain's urgency to get home
and the tint on the player's screen, not the bite.

The middle *pulls* an AI captain rather than fencing her away from the rail. Inside `STORM_HOME` of
the ring she fights wherever she likes; past that the course home bends her steering, hardest at the
edge (`STORM_PULL`); and once she is actually out in the weather her own exposure decides how hard, so
a shove into the rain is something she rides out and a pinning is something she has to fight her way
back from. It is a preference rather than an override on purpose — being fenced off the edge would
make her impossible to shoulder out there, and driving a rival into the weather and holding her in it
is a way to win a fight without ever holing her.

Both AIs steer through the same `weatherCourse()`, and the gunners have to: a free-for-all captain
runs from a wound rather than from the ring, and the rival who wounded her is behind her, so the
course that saves her from the guns is the course that sails her out of the round. The lean is
applied to the run home as well as to the chase.

Ram-only captains reason differently from gunners. They want a rival's beam, because that is where a
hull is staved in; they turn to meet a charge bow to bow, because that makes the blow a glance the
other ship has to share; and — since a rudder now goes heavy at a run — they ease the throttle to
swing the bow across before piling the speed back on, which is what makes an AI charge something you
can watch coming and step aside from. They also weigh whether they are gaining on a target at all:
with every ship the same speed, a stern chase is one nobody ever wins, and without that term a captain
will happily follow a fleeing rival across the whole sea while the beam of a ship crossing her bow
goes begging.

A captain gets out of a heap rather than grinding away in it. Jammed against another hull she is going
nowhere and so is everyone around her, so once she has been stuck like that a moment she peels out
along the course away from the hulls within `SHEER_LOOK` of her, runs `SHEER_TIME` in clear water to
gather way, and comes back for a proper charge — usually at somebody other than whoever she was
jammed against, since that is the hull she has just proved she cannot get a run at. About three
peel-offs in five pick a new target.

What times it is `baulkT`, the plain fact of being foul of a hull and making no ground, which is a far
better signal than any reckoning of closing speed: in a pile that reads high one frame and nothing the
next, while being stuck is simply true or not. Each captain's nerve scales how long she will put up
with it, so no two blink together — a pile that broke as one would only re-form. It is what keeps the
mode moving: without it, rounds ran the full distance and the closing storm had to finish them, and
with it they are settled by ramming inside a minute or so with the ring still wide open.

A chase she is not winning after `STALL_PATIENCE` seconds gets the same treatment from the other
direction — she takes the way off her and comes round inside instead of following a wake she can never
catch, since a slow hull turns far inside a fast one.

#### What time at sea pays

The derby pays for time afloat by the second (`timeCoins`), because there are no guns in it to pay
anybody with. Win, and she is paid for a whole round — `fullRound` — however early she settled it,
plus `winBonus` for being the last hull afloat: 175 and 75, so a win comes to 250 before a single
ram is counted. The free-for-all pays nothing for time. It did, at the derby's rate, and a captain
who sat in the middle of the ring and fired nothing was the last afloat at three minutes with 230
coins for it, against a tenth of that for a round of fighting; her guns pay her by the point, and a
win pays 25 on top.

`fullRound` is a set purse a shade above the full span of the derby's weather — 168 seconds — rather
than a figure that tracks the clock, so retuning that ring wants this looked at with it.

Settling it in forty seconds therefore pays the same purse as outlasting the weather for the full
span, which is to say it pays far better an hour: the time she saves is hers to spend on the next
round. The end screen lists the parts — what she fought for, what her time afloat was worth, and the
winner's bounty — so the tally adds up to what actually reaches the hold. The time row says "For a
full round at sea" when she is being paid for one, because a captain reading "For time at sea" beside
a clock showing 1:12 and a purse of 175 is owed the explanation.

## The hold

Coins sit at two depths, and keeping them apart is the whole of it:

- **A ship's purse** is what she takes during one battle. It buys repairs at sea and nothing else, and
  it goes down with her. Every mode opens it at nothing, so the first patch of a round is always paid
  for by something she did in it. This is the number in the HUD.
- **The hold** (`src/hold.js`) is the captain's, not the ship's. Every voyage that reaches an end
  screen banks what it *earned* — 25 a kill and one a point of damage dealt, a rammed hull included —
  and the total carries across every mode alike and through a reload, kept in `localStorage` under
  `sternchase.hold`.

Banking counts earnings, not leftovers, so a voyage banks whether you win it or sink: coins are earned
by fighting, and a captain who fought well and went down anyway earned them the same. Only a round
abandoned mid-fight — a reload, a closed tab — banks nothing, because nothing ended.

**Repairs are the exception, and they are the whole reason a purse matters.** What she pays the
carpenter at sea comes off what the voyage banks, so a captain who fought carelessly and patched her
way through has less to show for it than one who did not need to. Never below nothing, though: a bad
round costs a captain the round, not her savings. Since no mode hands out an opening purse, every coin
in it was earned in that round, and the end-of-voyage column reads straight down: what she took, less
what the carpenter took, is what reaches the hold.

The stored record is wider than the coin count on purpose, because a stat not recorded from the first
voyage can never be backfilled. Everything is kept twice: once as a lifetime total, and once under the
mode that earned it — voyages, wins, ships sunk, damage dealt, rams landed, time afloat, repairs
bought, coins paid to carpenters, coins banked, and per-mode bests. Twice rather than by totalling the
modes on demand, so a voyage banked under a mode name a later build no longer lists still counts
toward the lifetime figure instead of quietly leaving the sum. Repair spend is recorded rather than
derived, because unlike shore spending it never passes through `coins` and so cannot be reconstructed
from the ledger.

It is read through a small API rather than touched directly — `getHold`, `bankVoyage`, `spendFromHold`,
`resetHold`, `subscribeHold` — and a record written by an older build is folded field by field onto a
blank one, so an added stat never costs anyone their coins and a corrupt field costs only itself. If
`localStorage` refuses (private browsing, a full quota) the hold falls back to memory for the session
instead of failing.

`spendFromHold` is the door spending comes through: it refuses rather than overdraws, and keeps
`spent` alongside `coins` so the two always reconstruct what was earned. `HOLD_SHARE` scales what a
voyage deposits if the meta economy ever wants slowing down without touching the fight.

All of it is read on the menu: the hold panel carries the purse and the one line saying what it is,
and an **Achievements & Tallies** row into a screen that shows the lifetime overview and then a
breakdown per mode. What each mode shows follows what that mode is — a best finish where there are
placements, ships sunk in a voyage for the wave arena, the highest rung reached and ladders climbed
for the ladder arena, rams landed instead of repairs bought where there are no guns aboard, and no
carpenter's line at all in the derby, which repairs nothing. A record from before the arena split in
two is folded onto the wave arena on load (`MODE_RENAMED` in `hold.js`), so nothing a captain did
there is lost to the rename.

## Achievements

`src/achievements.js` is the list, and every entry is a **question asked of the hold** rather than a
flag written when it happens: a `count(hold)` and a goal, done when the first reaches the second.
Nothing about an achievement is stored. A captain who sank her first ship long before the file existed
holds the first rung of *Ships sunk* the moment she opens the screen, the tallies beside it can never
drift out of step because they are the same numbers, and adding one is a row rather than a row plus a
write in `bankVoyage` plus a migration for everyone who already played.

Most rows are **ladders**: one card with several goals climbed in order, so *Ships sunk* reads 1, then
10, then 25 and so on to 500 rather than being twelve cards that differ by a number. The ladders are
set out as one table at the head of the screen, a row each with the figure against the rung she is
on, which rung it is, what it pays and a bar of how far up it she is; the single goals follow as
cards. The count at the head of the screen is in rungs, so a ladder half climbed counts for half. A
single goal is a ladder of one.

The cost is worth stating: an achievement can only ask what the hold actually keeps. Totals and bests
are kept, so "sink fifty ships" is a row and "sink three in one voyage without touching the carpenter"
is not, because nothing counts that. Wanting one of those means first adding what it counts to the
record, the way the per-mode tallies were added, and then it too is a row. That is how the finer
tallies came to be kept: how each sinking was done (ram, guns or muskets), masts brought down, damage
the carpenter put back, and two judged on what the player did to one ship before she went, half of
each of her bars and her whole hull to the bow alone.

**Every rung pays coins into the hold**, from a table on the row. The one thing about achievements
that is stored is the ledger of payments: `paid` in the hold says how many rungs of each have been
paid for, and `settle` in `hold.js` runs on every write and once on load, pays every rung earned above
that, and moves the ledger up. So a rung is paid once, a rung earned in the yard is paid on the spot,
and a row added tomorrow pays for what she did last week. `bounties` is the running total, so the
purse reconstructs as earned plus bounties less spent, and the end screen prints what a voyage's
achievements paid apart from what the voyage was worth.

The screen is reached from a button above the tallies, which carries the earned count on its face so a
captain who only wanted the number does not have to open it.

## The shipyard

Built, and the fight reads all of it: the captain sails her own ship in every mode, every rival is a
stock ship matched to hers, and what she is comes from the yard between voyages. The yard is reached
from the ship on the menu, with the Boat Commission (hulls) and the Rigging Outfitter (masts, sails,
guns, spares) as its two doors. `docs/SHIPYARD.md` is the design note; the short version:

- `src/shipyard.js` is the catalogue and the maths. Hulls, masts, sails and guns as data, what fits
  what, and `rate()` turning a set of them into the figures a fight reads. It holds no state and
  imports nothing.
- A hull fixes maximum hull and crew, base speed and handling, how many guns of each kind she bears,
  the tons of iron she can carry, and her mast sockets with the rig families each takes. Her size
  comes from her reference row through `hullform.js`, never from the catalogue. A mast fits a socket
  of its family and size and carries a fixed set of berths decided when it was built. Every berth
  and every sail names one of seven categories, large square, small square, headsail, lateen, gaff,
  lugsail and studdingsail, and a sail fits a berth of its own category. Studdingsails are the
  exception and never fill a berth: one booms out beyond a square sail already set, so it attaches to
  that sail and comes off with it. Guns fit by the piece up to the hull's bearing and under her
  tonnage; `broadside` counts guns **a side**, mirrored, because that is how a volley fires, and runs
  1 on the gundalow to 50 on the first rate. Muskets come off the crew rather than being bought.
- Parts are catalogue *types*, and a captain owns *instances*. An instance is in one slot of a ship or
  in none of hers, so fifty ports still want fifty guns bought; but nothing she owns is exclusive to
  one hull, so the guns and canvas aboard the frigate are the same ones her sloop is found with. Only
  one ship goes to sea at a time, and what she owns, every ship she owns can carry.
- The yard lives in the same `localStorage` record as the coins, so a purchase moves both in one
  write. A record from before it existed folds forward and is granted a first ship. `shortfall()`
  answers what a ship still needs and how much of it the captain already owns, so a mast off another
  hull costs nothing to step and does not come out of that hull to do it.
- `src/galleon.js` draws a rig rather than *the* rig. `drawGalleon(ctx, w, h, deg, spec)` builds
  whatever is stepped and bent on; called without a spec it builds the galleon it always drew.
- **The menu ship is a control.** Her plate carries her name, her class and her figures, turns to any
  ship the captain owns, and opens the yard: what she rates, her rigging socket by socket with bare
  berths marked, her guns against what she bears and her tonnage, and what she still wants. Every
  row on the yard is a door into the outfitter, and "Sail her" is its own act rather than a side
  effect of buying or looking. The plate says so when the ship she sails has no sail bent on or no
  gun aboard.
- **Manoeuvrability is `hand`**, a hull figure separate from `speed`, moved by the sails she carries
  (`hand` again, negative on square canvas) and the guns weighing her down. `rate()` folds it into
  `turn`. In the fight the rudder also goes heavy with the way she carries.
- **A ship's rate is read off her ports, and her strength off her stat line.** `rateOf()` counts her
  broadside both sides and lands her on one of the eight rungs in `RATES`, the navy's own words, so a
  hull pierced for fifty a side is a first rate whatever she carries. `measure()` turns a rating into
  throw weight, endurance and mobility and blends them into one figure, which orders the stock
  ladder. Free-for-all fields her own rate (her own class, in the starter gundalow), the wave arena
  climbs the ladder from a shade under her strength to a fifth over it, the ladder arena walks the
  whole ladder from the bottom, and the derby matches on `ram`, which counts
  endurance and mobility and ignores guns nobody has aboard.
- **The hull table is one terse row per class**, expanded by `buildHull` with defaults, with masts
  written `station/size/family+family` and `order` defaulting to position. It holds 54 rows, 16 of
  them at sea, and `active` says which: inserting a class is inserting a row.
- **`fitOut(hullId, quality)` builds a coherent ship at a standard**, moving both the grade of part in
  each slot and how much of her is filled. `maximumLoadout` is this at 1. Stock opponents for a large
  catalogue are generated from it rather than written out and left to drift.
- **The catalogue is entered as tables.** `data/hulls.tsv` and `data/masts.tsv` are what a person
  edits, one row per class and per mast type; `npm run import` writes them into the generated blocks
  in `shipyard.js`. Tab separated so a spreadsheet exports straight in, and the generated block is
  committed so a diff still shows what changed. `npm run workbook` lays all four tables out as one
  .xlsx for editing in Numbers or Excel, and `npm run workbook:read` puts them back; the tables stay
  the source and nothing reads the workbook.
- **`npm run catalogue`** checks the fleet is riggable and drawable, then prints every class side by
  side: stat bands, what each rates bare and fully found, the same hull at rising quality, and the
  stock ladder. A socket no mast fits, a berth no sail fits or a station the renderer cannot draw all
  fail quietly at runtime, so the bench fails loudly instead and exits non-zero.
- **`STOCK` is the fleet the modes issue**, in the same id-shaped form as a stored ship. Both
  arenas climb `ladder()`, the wave arena from a shade under her and the ladder arena from the
  bottom; free-for-all fields
  `stockOfRate(n)`; the derby fields `peers(strength, tol, "ram")`. Nothing in the table declares a
  rate, so changing a fit moves that ship up or down the ladder on its own and cannot disagree with
  its own stat line.

`rate()` returns ratings, not speeds: dimensionless multipliers near 1 that the fight's own constants
get multiplied by when the shipyard opens, so adopting it is a substitution rather than a rebalance.

## Controls

Pointer/touch driven, so it works the same with a mouse or on a phone:

- **Virtual joystick** (bottom left) — steer and throttle.
- **SIDE / FRONT / MUSKET** (bottom right) — hold to fire; each has its own cooldown, range, and
  damages a different system. Absent in a mode that carries no guns.

**A double tap is a tap twice.** Fire, patch, fire again is ordinary play, and a phone reads two taps
inside a few hundred milliseconds as "zoom in on whatever is under the finger". `user-scalable=no` in
the viewport meta does not stop it: iOS Safari has ignored that since iOS 10, on the grounds that a
page should never be able to stop a reader zooming in. What every browser does honour is
`touch-action`, so `index.css` sets `manipulation` on every element — the value has to be on the
element under the finger, and a label inside a button inside a card is what actually gets hit.
Panning and pinch still work, so nothing a reader chooses to do is taken away; only the double-tap
gesture stops being a zoom. The canvas, the joystick and the fire buttons set the stronger `none`
inline, since a stray pan or pinch on the play surface mid-fight is worse still. The one thing that
must not carry `none` is an ancestor of a shop or menu screen: a `none` up the chain can stop the
screen under a finger from scrolling at all.
- **Repair rail** (top) — two buttons, priced on opposite principles because they are opposite jobs.
  **HULL** is a coin a point and nothing else: no base, no rate, no share of anything. A coin buys
  back exactly the damage a coin of gunnery earned, so a light patch is cheap and a purse short of the
  whole bill buys the part it reaches (`27 of 91`). Because the bill is her damage and nothing else it
  scales with her class without a scaling term anywhere: a hull with 250 points to lose can run up a
  bill of 200, and a cutter with 90 can never be charged more than 72. It stops at four fifths of her,
  because a carpenter at sea plugs shot holes and fishes a cracked timber while new planking and paid
  seams are a slipway's work, so the last fifth is unbuyable rather than dear and a hairline on the
  hull bar marks where the work ends.
  **MAST** is flat and it is a jury rig, because a mast is stepped or it is not: no half a mast, no
  half price, no part payment. What sets the price is the mast she carries rather than the damage she
  took: a coin a point of the nine tenths a jury mast puts back, `MAST_REBUILD_SHARE` of her mast's
  health, which runs from 50 coins for a gundalow to 1,336 for a first rate. What goes up is a spare spar and whatever
  canvas the locker holds, so it stops at nine tenths, and since speed and helm both read how much of
  her rig is standing that is 95% of her way and 92% of her helm: not the ship she was, but sailing
  again, with the same hairline on the mast bar saying where the work ends.
  **CREW cannot be repaired at all** — hands lost are lost, so the crew bar is a clock that runs one
  way for the length of a round, and it carries no mark because it has no repair to mark. A button
  with nothing to do says which reason it is: `Sound` where nothing needs mending, `Yard work` where
  she is mended as far as a carpenter goes; one she cannot yet afford shows the price muted, so there
  is a figure to save towards. Absent in a mode with
  nothing to buy, which is the derby: there, nothing is repaired or rebuilt at all and the stick is
  the only control on the screen.

A ship's rudder grows heavier the more way she carries. The loss is weighted to the top of her speed
range: under half stick it is within a few percent of what it ever was, so handling at close quarters
and turns from a standstill are left alone, and it reaches `RUDDER_HEAVY` only at a fresh ship's top
speed — where her turning circle widens from about one hull length to a little under one and a half,
and coming about takes 1.7s instead of 1.3s. It keys off the speed she is actually making rather than
the stick, so easing off the throttle hands the rudder back as she slows. Coming round hard costs
speed, and a charge at full sail is a commitment that can be read and dodged.

Ramming is a real attack, resolved from the geometry of the collision rather than from who started it:

- **A ram is worked out from the way a ship has actually made**, never from the speed her helmsman is
  asking for. The two part company whenever something is in the road: hulls pressed against one another
  are de-overlapped every frame, so they stand still in the water while the throttle still reads full
  ahead. Resolving a blow from that gave a stationary ship the weight of a flying one — a pair jammed
  bow to bow could sink a third that came to attack them, and the moment one of them turned away the
  other took her beam at full force without ever having moved. Each ship therefore measures the ground
  she truly covers, smoothed over about a fifteenth of a second, and a hull held on another's timbers
  loses her way and has to gather it again. Two ships locked bow to bow now trade nothing at all, and
  are a target rather than a threat to whoever comes to take advantage of them.
- **Closing speed** counts both ships' motion along the line of impact, so a head-on doubles it and a
  ship running from a chaser bleeds it away. Below `RAM_MIN_CLOSE` nothing happens. Above it, weight
  climbs to full weight at `RAM_FULL_CLOSE` (a fresh ship's top speed) and caps at `RAM_MAX_FORCE`.
- **You only ram with your bow.** Damage scales with the square of how bow-on you are, so a ship
  crossing or sliding along another does no damage however hard the hulls meet.
- **How hard the hulls met sets the blow**, on one curve (`RAM_CURVE`) for every angle alike. Harder
  is always worse, whoever you are and wherever it lands, so a ram is something a captain can judge
  before committing to it.
- **Where you land it sets the weight.** Square on the beam a hull is staved in (`RAM_BEAM`); caught
  on her bow or stern the blow glances along her fine ends (`RAM_FINE`).
- **A touch is not a ram.** Contact that would deal less than `RAM_GRAZE` does nothing at all: no
  damage, no cooldown spent, no lock on the pair. Kissing a hull at walking pace can never rob you of
  a charge you were lining up.
- **Bow to bow, the slower ship comes off worse.** When both ships are ramming each other the blow is
  shared out by how much way each had behind her, up to `RAM_MUTUAL_CAP`, so the ship with more speed
  drives through what the other has to absorb. Meet at the same speed and you split it evenly.
- **Speed is spent, not scaled.** Each ship loses the part of her way that was driving into the
  impact. Drive straight in and you stop dead; get caught across your course and you carry on, shoved
  off your line. Whoever put the least drive into it is the one thrown clear.
- **A pair must break apart to ram again**, `RAM_REARM_GAP` clear of each other, so nobody grinds
  damage out of hulls that are already touching — or, failing that, the lock lapses on its own after
  `RAM_LOCK_MAX`. Breaking clear used to be the only way out of it, which two ships circling one
  another never manage: they hold station inside the gap and the pair stays barred from ever trading
  another blow.

Two ships meeting bow to bow are both ramming, so both take it. A slow bump is just a nudge.

Hull against hull, a ship is her keel — a line `KEEL` long down her length — swelled by her beam, and
two ships foul when their keels come within `HULL_TOUCH`. Measuring keel to keel rather than centre to
centre is what keeps hulls out of each other: ships this long routinely cross well off the line
joining their centres, and a centre-to-centre test lets them slide through one another there. The same
measurement gives the contact normal a ram resolves along. Two ships lying beam to beam close to about
19px while two meeting bow to bow touch at 42px. De-overlap runs for every pair on the water, whatever
mode and whichever side they are on — consorts cannot ram each other, but no two hulls ever share the
same water.

For gunnery a hull is an ellipse (`HULL_A` × `HULL_B`). A shot is tested against it widened by the
ball's own radius, and along the whole path it flew that frame rather than at its new position — a musket ball crosses
more than the width of a hull in a slow frame, so a point test would let it pass clean through.
Presenting your bow or stern to a gun is therefore a genuinely smaller target than showing your side.

## The player's view

What a captain can see is a **square** laid on the middle of the screen. Its side is the shorter side
of the device — the width of a phone held upright, the height of one held sideways — and whatever
screen is left over beyond it simply shows more sea, behind the buttons. `VIEW` sets how much water
the square holds across, in world units; it is twice a broadside's reach, so anything that can shoot
at her is inside the square whichever way it lies from her. `MAX_ZOOM` caps the magnification, so a
screen much larger than a phone's shows more water rather than bigger ships.

Sizing the water to the screen instead left her sight of it lopsided, and different in each
orientation: an upright phone gave barely a broadside's width across and three times that up and
down, so a ship a little abeam was off the side of the screen while empty water ran away above and
below her.

The camera holds her in the middle and fills the rest of the view with sea, so the boundary is off
the edge of the screen until she is close to it. Coming in on a side, it is let `EDGE_PEEK` inside
the screen — a strip of open water, the rope, and its buoys, no more — and she comes off centre by
exactly as much. The edge slides into view and she slides toward it, which is what tells a captain
how much sea she has left on that hand. On an upright phone that puts her about 65px off the side of
the screen when she is hard against the wall, with the whole map in front of her.

Up and down, where the screen runs longer than the square, the boundary is let in as far as the edge
of the square instead — that strip of screen is the one the pills, the repair rail, the stick and
the gun buttons sit on, and it is hers to spend. It is what keeps her out from under them at the top
and bottom of the map, where she used to end up pinned against the glass.

## Damage model

Ships track three separate pools instead of one health bar:

| Pool | Damaged by | Effect when low |
| --- | --- | --- |
| `hull` | broadside cannons, rams | ship sinks at zero |
| `mast` | bow cannon | speed and turn rate fall off |
| `crew` | muskets, foul weather | musket output falls off; ship is lost at zero |

## Layout

```
index.html            # Vite entry
src/main.jsx          # React root
src/index.css         # full-bleed, no-scroll page shell
src/SternchaseIso.jsx  # the screen: menus, shipyard screens, HUD, end screen, and the frame loop
src/sim/              # the engine: world, step, ships, guns, rams, AI, weather, modes, the round's end
src/render/           # the canvas: camera, sea, islands, hulls, shot, smoke, radar, interpolation
src/input/            # the joystick and fire buttons, as the input record the engine reads
src/galleon.js        # the ship turning on the menu
src/hold.js           # coins, records and the yard, all outliving a round
src/achievements.js   # what a captain has done, worked out from the hold
src/shipyard.js       # what a captain can buy, and what it makes of her ship
docs/SHIPYARD.md      # design note for the shipyard groundwork
docs/ENGINE.md        # design note for the engine and how the screen drives it
vite.config.js
```

`galleon.js` defines the hull as 3-D stations and re-projects it to isometric on
every frame, so the menu ship genuinely turns rather than cycling sprite frames.
`drawGalleon(ctx, w, h, deg, spec)` draws one bearing of whatever rig `spec`
describes, or of the galleon the file was written around when given none; the
pivot is the hull centre at the waterline, so the ship holds the centre of the
box as it comes about. It honours `prefers-reduced-motion` by holding a
three-quarter view instead of turning. The model is rebuilt once per rig and
cached, so changing ships costs one build and every frame after it costs
nothing.

The game has no dependencies beyond React — all rendering is hand-rolled canvas drawing and all UI is
inline-styled, and the engine needs nothing at all, not even React.

### Tuning constants

The balance knobs sit in the engine, each beside the system it tunes (`src/sim/tables.js` holds the
ones several systems share), and the view's in `src/render/view.js`: `WORLD` and `TILT` for the arena
and camera, `VIEW`/`MAX_ZOOM` for how much sea the square view holds and `EDGE_PEEK` for how far the
boundary is let inside it, `BASE`/`HP_GAIN` for the health
pools, `WP` for per-weapon cooldown, projectile speed, and lifetime, `RAM_*` for ramming, and
`HULL_RATE` for what a point of hull damage costs to put right (deliberately 1), and
`MAST_REBUILD_SHARE` in `src/shipyard.js` for the flat price of a new mast as a share of her mast's
health. `BASE_SPEED` is a whole
ship's top speed and the yardstick the heavy rudder measures against; `RUDDER_HEAVY` is how much
rudder she loses at it and `RUDDER_CURVE` how late in the range the loss starts to bite — raising the
curve keeps more of her handling until she is truly running.

Arena pacing has its own block: `ARENA_START` (hunters at the opening, in both arenas), `ARENA_RAMP`
(the wave arena's reinforcements per kill for the opening kills, two a kill after it runs out),
`ARENA_SPAWN_CLEAR` (minimum distance a respawn keeps from the player), `ARENA_MAX_ENEMIES` (ceiling
on the swarm), and `ARENA_SPAWN_GAP` (how long the second ship of a wave holds off). What each arena
sends is on its mode row: `reinforce` and `fleetCap` say how many, `hunter` says which stock ship, and
the ladder arena's are one at a time off `ladderRung`. The climb's own knobs, `ARENA_OPEN`,
`ARENA_STEP`, `ARENA_HOLD` and `ARENA_CAP`, sit in `src/shipyard.js` beside `arenaHunter`. `OPENING_WINDOW`
sets how long free-for-all captains fight whoever is nearest before they start picking their prey.
`HOLD_SHARE` in `src/hold.js` is the one knob on the economy that outlives a round.

The derby has its own block: `DERBY_AI` (rivals, so ten captains start). The weather's bite and the
AI's answer to it are the `STORM_*` constants described above, shared by every mode that has one; the
shape of each ring is `DERBY_WEATHER` and `FFA_WEATHER`, read off the mode row.

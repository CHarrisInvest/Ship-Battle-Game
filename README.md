# Sternchase: Helm & Hull

Pirate ship combat on a tilted (isometric-ish) sea, rendered to a single HTML canvas from React.
`src/SternchaseIso.jsx` is the whole game and serves as the base for further development.

The repository is still called `Ship-Battle-Game`, which is where the Pages URL and the Vite base
path come from. "Broadside" appears throughout as the name of the side guns; that is the weapon,
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

## Deploying

Pushing to `main` builds the site and publishes it to GitHub Pages via
`.github/workflows/deploy.yml`:

<https://charrisinvest.github.io/Ship-Battle-Game/>

This requires Pages to be set to the **GitHub Actions** source once, under
Settings → Pages.

Because a project site is served from a subpath, `vite.config.js` sets
`base: "/Ship-Battle-Game/"` so the built asset URLs resolve. Deploying anywhere that
serves from the domain root instead — Netlify, Vercel, a plain static host — needs
`BASE_PATH=/ npm run build`.

## Modes

- **Arena** — endless survival against a growing swarm. You open with an empty purse and one hunter on
  the water, matched to your ship gun for gun and reload for reload. Kills bring reinforcements in from
  the edge of the map, spawned well clear of your bow: one for the first kill, then 1-2-1-2 through
  the fourth, then two for every kill after that up to the fleet cap. The second ship of a wave holds
  off five seconds before it sails in. Every hull on the water is the same hull, so the pressure comes
  from the count. Score by ships sunk.
- **Demolition derby** — ten captains and not a gun between them. Hulls are broken open by ramming
  alone, there is nothing to buy, and a squall closes on the middle of the sea. Last afloat wins.
- **Free-for-all** — last afloat wins, out of up to 10 rival captains starting equal, and equal is
  where they stay. The AI hunts whoever is weakest and gangs up on a runaway leader. For the first
  `OPENING_WINDOW` seconds it simply takes the nearest hull, since nobody has a reputation yet. It
  also fires on ships it is not hunting when one drifts into a weapon's arc, with a per-captain pause
  afterwards so the sea isn't wall-to-wall powder smoke. Outlasting the field pays a `winBonus` of 25
  on top of what her guns took, which is smaller than the derby's because a free-for-all captain has
  been paid all round for the fighting that got her there.

AI ships reload on exactly the same cooldowns as the player in every mode that has guns; their only
handicap is a touch of spread on every shot.

A mode is a row in the `MODES` table rather than a name to compare against — `melee` (is every hull
hostile to every other, or only the player's), `ranked`, `lastAfloatWins`, `reinforcements`, `guns`,
`repairs`, `flees`, `storm`, what it pays for time afloat and for winning, plus the field size. The
simulation, the HUD, the menu cards, and the end screen all read those rules, so a new mode is a new
row rather than a dozen scattered checks that have to be taught about it.

### The derby

Without cannon nothing can bring a mast down, so every hull holds the same top speed for the whole
match and a fleeing captain could never be run down. The squall is what makes the fight happen. It
opens at `STORM_R0` — just past the far corners of the map, so closing bites at once rather than
spending its first seconds on empty water — holds for `STORM_GRACE`, and takes `STORM_CLOSE` seconds
to shrink to `STORM_R1`, which leaves room for two ships to work but nowhere to hide. It closes on the
middle of the map, which the island generator always leaves clear.

Then, after `STORM_HOLD`, the eye itself shuts over `STORM_SQUEEZE` seconds until there is no fair
water left at all. A small ring is not enough to settle a round on its own: a ram needs closing speed
to count for anything, and two ships penned in a pool a hundred paces across can mill about
indefinitely without ever getting the run at each other that would end it — left alone, better than
two minutes of it. Weather asks nobody for a run-up, so the last hull afloat is whoever has crew
enough to outlast the sea.

The weather works on the crew, exposed on deck, rather than on the hull, and it is not an attack: no
captain is paid for it and it does not run through the damage path a ram does. Its bite starts at
`STORM_DPS_MIN` and climbs to `STORM_DPS_MAX` over `STORM_RAMP` seconds out in it, so a dash across
the weather costs a few hands and living out there costs about eight seconds and the ship. Come back
inside and the exposure sheds at `STORM_RECOVER` a second.

The middle *pulls* an AI captain rather than fencing her away from the rail. Inside `STORM_HOME` of
the ring she fights wherever she likes; past that the course home bends her steering, hardest at the
edge (`STORM_PULL`); and once she is actually out in the weather her own exposure decides how hard, so
a shove into the rain is something she rides out and a pinning is something she has to fight her way
back from. It is a preference rather than an override on purpose — being fenced off the edge would
make her impossible to shoulder out there, and driving a rival into the weather and holding her in it
is a way to win a fight without ever holing her.

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

#### What the derby pays

Staying afloat is most of the work, so it is paid by the second (`timeCoins`) on top of what a
captain's bow earns her. Win, and she is paid for a whole round — `fullRound` — however early she
settled it, plus `winBonus` for being the last hull afloat: 175 and 75, so a win comes to 250 before a
single ram is counted. Left alone a round actually runs `STORM_GRACE + STORM_CLOSE + STORM_HOLD +
STORM_SQUEEZE`, 168 seconds as the weather is tuned, so the winner's is a set purse a shade above the
clock rather than a figure that tracks it — retune the storm and this wants looking at.

Settling it in forty seconds therefore pays the same purse as outlasting the weather for the full
span, which is to say it pays far better an hour: the time she saves is hers to spend on the next
round. The end screen lists the parts — what she fought for, what her time afloat was worth, and the
winner's bounty — so the tally adds up to what actually reaches the hold.

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
and an **Achievements and Stats** row into a screen that shows the lifetime overview and then a
breakdown per mode. What each mode shows follows what that mode is — a best finish where there are
placements, ships sunk in a voyage for the arena, rams landed instead of repairs bought where there
are no guns aboard, and no carpenter's line at all in the derby, which repairs nothing.

## Achievements

`src/achievements.js` is the list, and every entry is a **question asked of the hold** rather than a
flag written when it happens: a `count(hold)` and a `goal`, done when the first reaches the second.
Nothing about an achievement is stored. A captain who sank her first ship long before the file existed
holds *First Sunk Ship* the moment she opens the screen, the tallies beside it can never drift out of
step because they are the same numbers, and adding one is a row rather than a row plus a write in
`bankVoyage` plus a migration for everyone who already played.

The cost is worth stating: an achievement can only ask what the hold actually keeps. Totals and bests
are kept, so "sink fifty ships" is a row and "sink three in one voyage without touching the carpenter"
is not, because nothing counts that. Wanting one of those means first adding what it counts to the
record, the way the per-mode tallies were added, and then it too is a row.

The screen is reached from a button above the tallies, which carries the earned count on its face so a
captain who only wanted the number does not have to open it.

## The shipyard

Groundwork only so far: the data model, the save format and the plumbing that lets the menu turn the
captain's own ship. There is no shipyard screen, and **the fight reads none of it yet**: every hull at
sea is still the same hull. `docs/SHIPYARD.md` is the design note; the short version:

- `src/shipyard.js` is the catalogue and the maths. Hulls, masts, sails and guns as data, what fits
  what, and `rate()` turning a set of them into the figures a fight would read. It holds no state and
  imports nothing.
- A hull fixes maximum hull and crew, base speed and handling, how many guns of each kind she bears,
  her mast sockets, and how big she is. A mast fits a socket and carries a fixed set of berths decided
  when it was built. Every berth and every sail names one of six categories, large square, small
  square, triangular, gaff, lugsail and studdingsail, and a sail fits a berth of its own category.
  Studdingsails are the exception and never fill a berth: one booms out beyond a square sail already
  set, so it wants an attachment to a sail rather than a place on a mast, and nothing models that yet.
  Guns fit by the piece up to the
  hull's bearing; `broadside` counts guns **a side**, mirrored, because that is how a volley fires, and
  runs 2 on the cutter to 10 on the galleon. Muskets come off the crew rather than being bought.
- Parts are catalogue *types*, and a captain owns *instances*. An instance is in one slot or in none,
  which is what lets rigging and guns move between ships and stops one suit of sails rigging three at
  once. Anything no ship references is loose in the hold, and loose is the inventory.
- The yard lives in the same `localStorage` record as the coins, so a purchase moves both in one
  write. A record from before it existed folds forward and is granted a first ship. `shortfall()`
  answers what a ship still needs and how much of it the captain already owns, so a spare mast off
  another hull costs nothing to step.
- `src/galleon.js` draws a rig rather than *the* rig. `drawGalleon(ctx, w, h, deg, spec)` builds
  whatever is stepped and bent on; called without a spec it builds the galleon it always drew.
- **The menu ship is a control.** Her plate carries the class she is and `Tap to edit`, and opens the
  yard: what she rates, her tier, her rigging socket by socket with bare berths marked, her guns
  against what she bears, and what she still wants. Reading only for now; buying and fitting get built
  into that screen.
- **Manoeuvrability is `hand`**, a hull figure separate from `speed`, moved by the sails she carries
  (`hand` again, negative on square canvas) and the guns weighing her down. `rate()` folds it into
  `turn`. In the fight the rudder also goes heavy with the way she carries.
- **A ship's tier comes off her stat line, not her class.** `measure()` turns a rating into throw
  weight, endurance and mobility, blends them into one figure, and `TIERS` bands that into five rungs.
  A fully found cutter genuinely outclasses a bare brig, so matching on class would call that an even
  fight. The derby matches on `ram` instead, which counts endurance and mobility and ignores guns
  nobody has aboard.
- **The hull table is one terse row per class**, expanded by `buildHull` with defaults, with masts
  written `station/size` and `order` defaulting to position. It is built for a fleet of around 38
  classes rather than the five it holds: inserting a class is inserting a row.
- **`fitOut(hullId, quality)` builds a coherent ship at a standard**, moving both the grade of part in
  each slot and how much of her is filled. `maximumLoadout` is this at 1. Stock opponents for a large
  catalogue are generated from it rather than written out and left to drift.
- **The catalogue is entered as tables.** `data/hulls.tsv` and `data/masts.tsv` are what a person
  edits, one row per class and per mast type; `npm run import` writes them into the generated blocks
  in `shipyard.js`. Tab separated so a spreadsheet exports straight in, and the generated block is
  committed so a diff still shows what changed.
- **`npm run catalogue`** checks the fleet is riggable and drawable, then prints every class side by
  side: stat bands, what each rates bare and fully found, the same hull at rising quality, and the
  stock ladder. A socket no mast fits, a berth no sail fits or a station the renderer cannot draw all
  fail quietly at runtime, so the bench fails loudly instead and exits non-zero.
- **`STOCK` is the fleet the modes issue**, in the same id-shaped form as a stored ship. Arena climbs
  `ladder()`; free-for-all fields `stockOfTier(n)`; the derby fields `peers(strength, tol, "ram")`.
  Nothing in the table declares a tier, so changing a fit moves that ship up or down the ladder on its
  own and cannot disagree with its own stat line. Not wired into any mode yet.

`rate()` returns ratings, not speeds: dimensionless multipliers near 1 that the fight's own constants
get multiplied by when the shipyard opens, so adopting it is a substitution rather than a rebalance.

## Controls

Pointer/touch driven, so it works the same with a mouse or on a phone:

- **Virtual joystick** (bottom left) — steer and throttle.
- **SIDE / FRONT / MUSKET** (bottom right) — hold to fire; each has its own cooldown, range, and
  damages a different system. Absent in a mode that carries no guns.
- **Repair rail** (top) — two buttons, priced on opposite principles because they are opposite jobs.
  **HULL** is a coin a point and nothing else: no base, no rate, no ceiling short of whole. A coin buys
  back exactly the damage a coin of gunnery earned, so a light patch is cheap and a purse short of the
  whole bill buys the part it reaches (`27 of 91`). Because the bill is her damage and nothing else it
  scales with her class without a scaling term anywhere: a hull with 250 points to lose can run up a
  bill of 250, and a cutter with 90 can never be charged more than 90.
  **MAST** is flat and puts the rig back whole, because a mast is stepped or it is not: no half a
  mast, no half price, no part payment. What sets the price is the rig she carries rather than the
  damage she took, at `RIG_REBUILD_SHARE` of what her whole rigging is worth. Since speed and helm
  both read how much of her rig is standing, a rebuilt mast hands back full sail at once.
  **CREW cannot be repaired at all** — hands lost are lost, so the crew bar is a clock that runs one
  way for the length of a round. A button with nothing to do reads `At the mark` or `Sound`; one she
  cannot yet afford shows the price muted, so there is a figure to save towards. Absent in a mode with
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
src/SternchaseIso.jsx  # game: simulation, canvas renderer, and UI
src/galleon.js        # the ship turning on the menu
src/hold.js           # coins, records and the yard, all outliving a round
src/achievements.js   # what a captain has done, worked out from the hold
src/shipyard.js       # what a captain can buy, and what it makes of her ship
docs/SHIPYARD.md      # design note for the shipyard groundwork
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
inline-styled, so `SternchaseIso.jsx` can be dropped into any React app as-is.

### Tuning constants

The balance knobs sit at the top of `src/SternchaseIso.jsx`: `WORLD` and `TILT` for the arena and
camera, `VIEW`/`MAX_ZOOM` for how much sea the square view holds and `EDGE_PEEK` for how far the
boundary is let inside it, `BASE`/`HP_GAIN` for the health
pools, `WP` for per-weapon cooldown, projectile speed, and lifetime, `RAM_*` for ramming, and
`HULL_RATE` for what a point of hull damage costs to put right (deliberately 1), and
`RIG_REBUILD_SHARE` in `src/shipyard.js` for the flat price of a new mast as a share of what her
rigging is worth. `BASE_SPEED` is a whole
ship's top speed and the yardstick the heavy rudder measures against; `RUDDER_HEAVY` is how much
rudder she loses at it and `RUDDER_CURVE` how late in the range the loss starts to bite — raising the
curve keeps more of her handling until she is truly running.

Arena pacing has its own block: `ARENA_START` (hunters at the opening), `ARENA_RAMP` (reinforcements
per kill for the opening kills, two a kill after it runs out), `ARENA_SPAWN_CLEAR` (minimum distance a
respawn keeps from the player), `ARENA_MAX_ENEMIES` (ceiling on the swarm), and `ARENA_SPAWN_GAP` (how
long the second ship of a wave holds off). `OPENING_WINDOW`
sets how long free-for-all captains fight whoever is nearest before they start picking their prey.
`HOLD_SHARE` in `src/hold.js` is the one knob on the economy that outlives a round.

The derby has its own block: `DERBY_AI` (rivals, so ten captains start) and the `STORM_*` constants
described above.

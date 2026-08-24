# The shipyard

Groundwork for buying and fitting ships. This is the foundation only: the data model, the persistence
and the plumbing that lets the menu turn the captain's own ship. There is no shipyard screen yet, and
the fight still puts every captain in the same hull.

What *has* changed at sea is that nothing is bought there any more. The five-track upgrade rail is
gone from the modes and from the AI, and repairs took its place: a purse now buys patches and nothing
else, out of the voyage's own takings, so what she spends staying afloat is what she does not bank.

The point of doing it this way round is that the parts of a feature that are expensive to change late
are the ones settled first. A stat that is not recorded from the beginning cannot be backfilled; a
save format that has to change costs everyone their progress; a renderer that can only draw one ship
has to be taken apart before it can draw two. Those three are done. Balance numbers, prices and art
are cheap to change and are deliberately left rough.

## Where things live

| | |
|---|---|
| `src/shipyard.js` | The catalogue and the maths. Hulls, masts, sails, guns as data; what fits what; what a set of them rates. No state, no storage, no imports. |
| `src/hold.js` | What a captain owns. The yard sits in the same record as the coins, so a purchase moves both in one write. |
| `src/galleon.js` | Draws a rig rather than *the* rig. Given a spec it builds the ship; given nothing it builds the galleon it always drew. |
| `src/SternchaseIso.jsx` | Passes the active ship's rig to the menu, and carries the repair rail that replaced the upgrade rail. |
| `data/hulls.tsv`, `data/masts.tsv` | The tables a person edits. One row per class and per mast type. |
| `tools/import.mjs` | `npm run import`. Writes those tables into the generated blocks in `shipyard.js`. |
| `tools/catalogue.mjs` | `npm run catalogue`. Checks the fleet is riggable and drawable, then prints every class side by side for calibration. |

## The model

Four kinds of thing, and the shape of each is what makes the shipyard behave the way the brief asks.

**Hulls** fix maximum hull and crew, base speed and handling, how many guns of each kind she bears,
and her mast sockets. A socket has a station along the keel (`fore`, `main`, `mizzen`) and a size.

**Masts** fit a socket of their own size or larger, and carry a fixed set of *berths* decided when the
mast is built. A berth names the cut and the size of the one sail that goes in it. That is what makes
buying a mast a choice of rig shape rather than a choice of size: `lateenMast` will carry one large
triangle and one small square for as long as it exists, and no amount of money changes it into a
topgallant.

**Sails** fit a berth of the same cut and the same size. This is the whole of "a sloop's triangular
canvas is no use on a square-rigged ship": a frigate has no triangular berth below her mizzen, so the
sail simply does not go in. Each sail has a `drive` (pull) and a `hand` (what it does to her helm).
Square canvas drives hardest and stiffens her; fore-and-aft canvas drives less and helps her round.

**Guns** fit by the piece up to the hull's bearing. `broadside` counts guns *a side*, because that is
how a volley fires, and runs 2 on the cutter to 10 on the galleon. Bow guns run 1 to 3. Muskets are
not bought at all: they come off the crew the hull musters, with swivels adding to the volley.

**Size** is deliberately absent. Classes differ in how big they are, but each hull is to be modelled
in its own right rather than scaled off one shape, so a class's size arrives with its art and there is
nothing here for the catalogue to multiply. Every rig is drawn on the one hull the renderer has, at the
one size it was drawn at.

Parts are catalogue **types**; a captain owns **instances**. `hold.js` keeps a flat table of every
spar, sail and gun owned, and a ship record says which instance sits in which slot. An instance is in
one slot or in none, never two, so fitting is a move: that is what lets rigging and guns travel
between hulls, and what stops one good suit of sails rigging three ships at once. Anything no ship
references is loose, and loose is the inventory.

## What the brief asked for, and where it landed

- **Buy hulls and components with the coins from any mode.** `hold.js` already banked coins from every
  mode into one record. The yard is a field of that record, and every writer spends through the same
  ledger, so `coins` and `spent` still reconstruct what was earned.
- **An inventory of interchangeable components.** `loosePartIds()`, and fitting as a move.
- **Start with one ship, a basic sail, one front gun and no broadside.** `STARTER` in `shipyard.js`.
  A cutter, a pole mast with one small square sail, one bow chaser. The first broadside gun a captain
  buys is the first time she can fire at anything abeam, and she should feel it.
- **Rigging and guns move ship to ship.** Falls out of instances.
- **A mast only ever carries the sails it was built for.** `berths`, fixed on the mast type.
- **Triangular and square, large and small.** `cut` and `size` on both berth and sail, checked as a
  pair. Smaller ships start on small sails; the head of a tall mast takes a small one.
- **Sails affect speed and agility differently.** `drive` and `hand`.
- **Hull type drives speed, and hull and crew maximums.** `speed`, `hand`, `canvas`, `maxHull`,
  `maxCrew`. `canvas` is the one worth pointing at: it is how much sail a hull *wants*, so the same
  suit drives a cutter hard and barely stirs a galleon. It is what makes a bigger hull a commitment
  rather than a straight upgrade, and why a half-rigged galleon is genuinely bad.
- **Diminishing returns past 2 sails on a mast, 3 on the main.** `canvasFalloff()`. The first two up a
  mast are worth their full drive, three on the main, and each one above that keeps 58% of the one
  below it. Note that no mast in the catalogue yet has a fourth berth, so the rule is in place before
  anything reaches it.
- **A stat range per ship, bare to fully found.** `statBand()`. Both ends are real loadouts run
  through the same `rate()` the fight will use, rather than a second set of numbers that can drift.
- **The menu ship is the captain's ship.** Done, and it is the part worth looking at.
- **Upgrades are gone from the modes and the AI.** Nothing is bought at sea but repairs. See below.
- **Ships tiered by their stat lines, and a stock fleet for the modes to issue.** `measure()`,
  `TIERS`, `STOCK` and the lookups each mode needs. See below.

## Ratings, not speeds

`rate()` returns dimensionless multipliers around 1, not world units. A well-found hull of any class
rates near 1 for speed and turn, so adopting it in the fight is multiplying `BASE_SPEED` and the turn
constant by a rating rather than replacing the numbers wholesale. Nothing about how the game feels
moves on the day the shipyard opens, and each hull can then be pulled around one at a time.

`maxHull` and `maxCrew` are the exception and come out in the same points the health bars already use.

## As it stands

Bare means one mast, one sail, one bow gun. Fully found means the dearest mast in every socket, the
dearest sail in every berth, every gun port filled.

| | price | speed | turn | hull | crew | broadside | bow | muskets |
|---|---|---|---|---|---|---|---|---|
| Cutter | 0 | 0.69 to 0.81 | 1.18 down to 0.98 | 90 | 55 | 0 to 2 | 1 | 2 to 3 |
| Sloop | 900 | 0.65 to 0.97 | 1.12 down to 0.88 | 120 | 72 | 0 to 4 | 1 | 3 to 4 |
| Brig | 2400 | 0.50 to 0.95 | 0.98 down to 0.75 | 155 | 96 | 0 to 6 | 1 to 2 | 4 to 5 |
| Frigate | 5200 | 0.44 to 0.94 | 0.89 down to 0.66 | 195 | 124 | 0 to 8 | 1 to 2 | 5 to 7 |
| Galleon | 9600 | 0.37 to 0.79 | 0.77 down to 0.57 | 250 | 155 | 0 to 10 | 1 to 3 | 6 to 9 |

Handling is the one stat that runs *backwards*: a ship carrying every gun she can bear under a full
press of square canvas is stiffer on the helm than the same hull with one sail and one gun. That is
the trade the shipyard exists to make, so `statBand()` reports which end the fully found ship sits at
and a card can say so rather than printing a range that looks like a mistake.

## The renderer

`buildShip()` used to be a list of literals: three masts at fixed heights, five calls to `sail()` with
hand-tuned corners, three stays written out end to end. Fine for one ship, useless for a shipyard.

It is now driven by data. A **station** owns the geometry belonging to the *place* a mast stands: the
x along the keel, the thickness of the pole, where the shrouds are made fast, and the bands of air a
sail occupies going up. A **mast** owns only its height. Put the two together and you have a rig.

Three things fall out of it that were hard-coded before and had to stop being:

- The pole is cut down to the canvas actually bent on it. Leave a mast at its nominal height and a
  boat carrying one small sail stands a bare spar twice the height of her rig, which reads as a mast
  that has lost its sails rather than a boat that never had them.
- The masthead pennant flies from the truck of the tallest mast stepped, and from nothing if there is
  none. It used to be pinned to the height the galleon's main mast happened to reach, which left it
  hanging in the sky above a cutter.
- Stays chain off the masts that are actually there, rather than running between fixed points where a
  mast used to be.

The station numbers are the galleon's own, so handing her rig back reproduces the ship this file has
always drawn. Verified against the pre-change code through the same renderer: 6 pixels of 177,952
differ, which is one stay moving 0.014 model units.

**Hull shapes per class are not drawn yet.** Every class turns on the galleon's hull for now; the rig
on top of it is the part that is real. A cutter therefore reads as a small rig on a large hull, which
is the most visible thing still outstanding.

## What replaced the upgrade rail

Nothing is bought at sea any more except repairs, so a ship is what she was when she sailed and what
she is comes from the shipyard between voyages. Every trace of the old five-track economy is out:
`TRACKS`, `COST`, `applyUpgrade`, `shipPower`, `HP_GAIN`, `ship.up`, the AI's shopping and its
per-captain bias, and the mode flag that switched it on.

Two AI decisions used to compare levels and now do not. Prey selection weighed a rival's guns against
its own, and a captain fled from a stronger ship as well as from her own wounds. With every hull at
sea identical both terms weighed exactly nothing, so they are gone rather than left in as dead
arithmetic. What is left is range, reputation, blood in the water, and the state of her own ship,
all of which are still true. They come back off the *loadout* when the shipyard reaches the fight,
which is a better comparison than levels ever were.

**Repairs** take the rail's place, in the modes that have a purse, and the two buttons are priced on
opposite principles because they are opposite jobs.

**Hull** is a coin a point, and by nothing else. No base, no rate, no share of anything, and no
ceiling short of whole. What she pays is exactly what the damage she is undoing was worth to the ship
that dealt it, which puts both halves of a round's economy in the same currency and lets a captain
read her own hull bar as a price.

Because the bill is her damage and nothing else, it scales with the class she is sailing without a
scaling term anywhere in it. A hull with 250 points to lose can run up a bill of 250; a cutter with 90
can never be charged more than 90. That property holds for whatever the fleet turns out to be, so
classes carrying far more than a hundred points need nothing added for their repairs to cost more. It
is not yet visible in play, because every ship in a fight still carries the same stock hull.

A ship barely scratched pays almost nothing, so there is no wrong moment to repair, and a captain who
cannot cover the bill buys as much of it as her purse reaches rather than being refused.

**Mast** is flat and puts the rig back whole. A mast is stepped or it is not: no half a mast, so no
half price and no part payment, and the charge is the same whether she lost the whole thing or sprung
it. What sets it is the rig she carries rather than the damage she took, at `RIG_REBUILD_SHARE` of
what her whole rigging is worth. That figure lives in `shipyard.js` rather than in the fight, because
it is derived from shop prices and moves the moment one of them does: `mastRebuildCost(loadout)`. It
runs from 12 coins for the starter's free pole and one topsail to 911 for a fully found frigate, which
is the intended shape. Because `speedCap` and `turnCap` both read how much of her rig is standing, a
rebuilt mast hands her back full sail in the same instant, and that is what makes it worth the money:
losing a mast is the one hit that takes a ship out of a fight while leaving her afloat.

Every hull in a fight carries the starter's rig today, so a rebuild costs everybody 12. `mastRebuild`
reads a ship's own loadout the day loadouts reach the fight, at one line and no other.

**Crew cannot be bought back at all.** Hands lost over the rail are lost, so the crew bar is a clock
that only runs one way for the length of a round. It is why musket fire and a spell in the weather are
worth avoiding rather than paying off afterwards, and it is the change that shortens a bad round most.

What makes it a decision rather than a tax is where the money comes from: **repairs are paid out of
the voyage's own takings, so every coin spent staying afloat is a coin that never reaches the hold.**
Fighting carefully is worth money. No mode hands out an opening purse, so every coin she can spend was
earned in that round and the end-of-voyage column reads straight down: what she took, less what the
carpenter took, is what reaches the hold. Never below nothing, though. A bad round costs a captain the
round, not her savings.

## Deliberately not done

- No shipyard screen. The model is what a screen is built against, and building the screen first would
  have fixed the model to whatever the first layout happened to need.
- **The fight still does not read the catalogue.** `rate()` is not wired to `speedCap`, `turnCap` or
  `sideDmg`, so every ship at sea is the same ship, and no mode issues from `STOCK` yet. That is the
  modes rework, and it is its own piece of work. The tiers and the stock fleet below say what each
  mode is *to* do; this is the wiring that lets it.
- No per-class hulls, and so no per-class size. Each one is to be modelled rather than scaled off the
  hull the renderer has, which is why there is no size figure in the catalogue to go stale first.
- No per-class hull art, and no sail designs or cloth patterns. Those hang off ids without touching
  any of the numbers here.
- No selling parts back. Easy to add; wanted a decision on whether it refunds in full first.

## Tiers, the stock fleet, and what each mode does with them

Settled. Every mode issues **stock ships**, and matches them to the player by **measured strength**
rather than by class.

**A tier comes off the stat line, not the class.** Using the hull's shelf position would have been
the obvious move and it is wrong: a fully found cutter genuinely outclasses a bare brig, so a mode
matching on class would call that an even fight. `measure()` takes what `rate()` already says about a
finished ship and returns three components kept deliberately separate, because different modes fight
on different ones:

| | |
|---|---|
| `throwWeight` | what she does to another ship in a second, guns and small arms together |
| `endurance` | what she can take before she stops |
| `mobility` | how well she gets to a fight and out of it |
| `overall` | the three blended, for a mode with guns |
| `ram` | endurance and mobility only, for a mode without |

The blend is geometric, so being hopeless at one thing is not paid for by being splendid at another.
`TIERS` bands `overall` into five rungs and `tierOf(loadout)` places a finished ship on one.

**`STOCK` is the fleet the game issues**, written in the same id-shaped form as a stored ship so
`resolve()` turns one into a loadout exactly as it does the player's. Nothing in that table declares a
tier: every rung is measured, so changing a fit moves the ship up or down the ladder on its own and
cannot disagree with its own stat line.

| ship | tier | overall | ram | throw | endurance | mobility |
|---|---|---|---|---|---|---|
| Bare cutter | 1 Coastal | 49.5 | 70.3 | 13.0 | 145 | 0.94 |
| Coastal cutter | 1 Coastal | 65.1 | 70.4 | 24.2 | 145 | 0.94 |
| Armed cutter | 2 Privateer | 78.8 | 69.6 | 37.9 | 145 | 0.90 |
| Plain sloop | 2 Privateer | 88.1 | 84.0 | 37.9 | 192 | 0.88 |
| Full sloop | 3 Cruiser | 113.4 | 85.8 | 65.7 | 192 | 0.94 |
| Plain brig | 3 Cruiser | 121.8 | 99.7 | 62.8 | 251 | 0.83 |
| Full brig | 4 Ship of the line | 162.2 | 99.0 | 121.5 | 251 | 0.81 |
| Plain frigate | 4 Ship of the line | 162.7 | 116.5 | 98.3 | 319 | 0.80 |
| Plain galleon | 4 Ship of the line | 176.9 | 131.1 | 100.7 | 405 | 0.68 |
| Full frigate | 5 Flagship | 199.2 | 116.8 | 155.4 | 319 | 0.81 |
| Full galleon | 5 Flagship | 239.8 | 131.4 | 200.4 | 405 | 0.69 |

The overlaps are the point and they came out of the numbers rather than being placed. A full sloop
outranks a bare brig. A full brig and a plain frigate are within a point of each other across two
classes. And the two measures genuinely disagree: under gunfire a plain galleon towers over a plain
brig, 177 to 122, while as ramming stock they are far closer at 131 to 100 — an armed cutter even
rates *below* a bare one for ramming, because her guns are dead weight in a match where nobody fires.

### What each mode is to do with it

- **Arena** climbs the ladder. Open on the weakest rung and work up through the stock fleet, so the
  mode escalates by putting harder ships on the water rather than more of the same one. `ladder()` is
  that list, in ascending strength.
- **Demolition derby** fields ships of similar stats, matched on `ram` rather than on tier, because
  tier is banded on `overall` and `overall` counts guns nobody has. `peers(strength, tol, "ram")`.
- **Free-for-all** fields stock ships of one tier: `stockOfTier(n)`. Equal without being identical,
  which is what having more than one ship per rung is for.
- **A ranked free-for-all**, later: win a rung to move up against the next. The ladder and the bands
  are the same ones, so this needs no new model, only a record of the highest rung a captain has won.

None of it is wired yet — the fight still issues one stock hull to everybody, because that is the
piece that needs `rate()` feeding the combat constants. What the modes were waiting on was a way to
say "an even fight" that survives the player bringing her own galleon, and that now exists.

## Room for forty classes

The catalogue is built for a fleet of around 38 classes rather than the five it currently holds, and
three things had to change shape for that to be true.

**One terse row per class.** A hull was seventeen lines of object literal; it is now six lines of the
figures that differ between ships, expanded by `buildHull` with defaults for everything that does not.
Masts are written `station/size` from the bow aft rather than as nested socket objects, and `order`
defaults to a class's position in the list, so inserting a class between two others is inserting a row
rather than renumbering everything below it. Forty classes is about 230 lines instead of 650.

**Fits are generated, not written out.** `fitOut(hullId, quality)` builds a coherent ship at a
standard: quality moves both the grade of part in each slot and how much of her is filled, because
how well found a ship is genuinely means both. A plain ship carries a course on each mast and leaves
the topgallant berth bare with half her ports empty; a full one has good cloth on every yard and a gun
in every port. `maximumLoadout` is this at 1. Two hand-written fits each for forty classes would be
eighty entries drifting out of step with the parts table every time a price moved.

**`npm run catalogue` checks the fleet and prints it.** A hull is a row of numbers and a row of
numbers can be quietly wrong in ways nothing else notices: a socket no mast fits, a berth no sail
fits, a station the renderer has never been taught to draw. None of those throw — they produce a ship
that cannot be rigged, or one that turns on the menu with a mast missing. With forty classes nobody
spots that by reading, so the bench spots it and exits non-zero. It was tested against a deliberately
broken pair of hulls and caught all nine faults in them.

Then it prints the whole fleet: the stat bands, what each class rates bare and fully found, what she
costs to fill out, the same hull at rising quality, and the stock ladder with tier occupancy. That
table is the calibration surface. The numbers only mean anything next to each other.

### What the shipyard screen will ask

`shortfall(rec, shipId)` answers "what does this ship still need, and how much of it do I already
own". Buying a hull gets you a hull; what makes it a ship is a mast in every socket, a sail in every
berth, and guns run out to what she bears. Each gap says which loose parts would go straight in and
what the cheapest catalogue part would cost, so a spare topmast off another ship costs nothing to
step. Berths on a mast not yet stepped are not counted, since quoting for sails on a mast she has not
chosen prices a rig she may not build.

The total is the cheapest *legal* fill, not a good rig: a pole mast is free and fits any socket, so a
bare frigate quotes nothing for masts and would get three bare poles. `fitOut` is what a decent fit
costs. A screen showing both tells a captain the floor and the ceiling.

### Getting them in

**Edit `data/hulls.tsv`, run `npm run import`, run `npm run catalogue`.** That is the loop, and it is
meant to be run dozens of times: the tables are tab separated so a spreadsheet exports straight into
them, `#` lines are comments, and blurbs can hold commas and apostrophes without quoting.

The import writes into `src/shipyard.js` between markers rather than the game reading a table at
runtime. Two reasons. `shipyard.js` imports nothing and holds no state, which is worth keeping, and a
CSV parser in the bundle to read a file that never changes while the game runs is machinery for
nothing. So the table is what a person edits, the source is what the game reads, and the importer
closes the gap. The generated block is committed, so a diff still shows what actually changed.

The importer writes; it does not judge. It fails on the things that make a row unreadable (a stray tab
so the columns do not line up, a duplicate id, a berth that is not `cut/size`) and leaves everything
else to the bench, which is the next command and the one that says whether the result is a fleet.

`data/masts.tsv` is the same for mast types, and the two go in together: a hull's socket sizes mean
nothing until masts exist that fit them, and the bench will say so.

### What the 38 will need

When the ship details arrive, each class needs: a name and a blurb, a price, hull and crew points,
`speed` and `hand` (her own contribution before canvas, both near 1), `canvas` (how much sail she
wants, which is what makes a big hull a commitment), `tons` (what she carries before the guns tell on
her handling), gun bearing as `[broadside a side, bow, swivel]`, and her masts as `station/size`.

Anything you would rather not place by hand can be left blank. `speed`, `hand`, `canvas` and `tons`
are abstract ratings around 1 rather than anything a real ship has written on it, and they can be
derived from her size, rig and role and then tuned against the bench. The columns a person actually
knows about a ship (how big, how many hands, how many guns, what rig, what she is for) are the ones
worth filling in first.

Three things to decide alongside them:

- **Mast types, which go in the same pass.** A mast's berths are fixed the moment it is built, so a
  fleet wants a type per configuration rather than one mast with a slot count: one through four square
  berths is four types. A four-berth mast is also the first thing that reaches the diminishing return
  past a third sail, which nothing has been able to do until now.
- **Stations beyond fore, main and mizzen.** Anything four-masted needs a new station name, and
  `galleon.js` needs geometry for it or that mast is silently left off the menu ship. The bench
  catches it; adding the geometry is a `STATION_GEOM` entry.
- **Sizes beyond small, medium and large.** `SIZES` is ordered and a mast fits its own size or larger,
  so a wide fleet may want a fourth rung rather than crowding forty classes into three.

`CUTS` now declares the vocabulary of sail cuts, `square`, `triangle` and `lug`, so a lugsail rig is a
row rather than a code change, and the bench catches a berth whose cut is a typo. The renderer draws
square and triangle as their own shapes; anything else falls back to square canvas, which is a
wrong-looking ship rather than a broken one, and the bench says which cuts are in that position.

## Open questions

Things a design document should settle, listed with what the code currently assumes so that agreeing
with it is as cheap as changing it.

1. **The economy.** Prices are placed relative to each other and are not tuned against what a voyage
   actually pays, and repairs now take a bite out of that too. At the current rate (25 a kill, a coin
   a point of damage, a derby win about 250) a sloop is roughly three voyages and a galleon roughly
   thirty, before the carpenter. Fully outfitting a cutter costs more than a bare sloop, which reads
   as "move up rather than max out your first boat" and may or may not be the intent. Forty classes
   need a price curve rather than five hand-placed numbers.
2. **Where the tier bands fall.** The five thresholds were placed against eleven stock ships, so the
   fleet lands two or three to a rung and the class overlaps straddle them. Nothing about how a fight
   actually plays went into them, and a catalogue eight times the size will fill the range
   differently. The band edges are the knob that decides who meets whom.
3. **Does the player's own ship sail in every mode, or only some?** The stock fleet settles what she
   is matched *against*. Whether free-for-all puts her in her own ship against a same-tier field, or
   issues her a stock one so the field really is identical, is a separate call and the modes rework
   needs it.
4. **How big should the classes actually get?** A question for whoever models the hulls, not for the
   catalogue. Worth settling early anyway: a galleon twice a cutter's length is a very large target in
   a sea 2000 across, and the fight's hull geometry, the collision ellipse and the camera all have an
   opinion about it.
5. **Stations and sizes beyond the three of each.** Any four-masted class needs a new station, and
   `galleon.js` needs geometry for it or that mast is silently left off the menu ship. A wide fleet
   may also want a fourth mast size rather than crowding forty classes into small, medium and large.
6. **Should the derby have repairs?** It has none today, because "only one hand needed" is that mode's
   whole promise and a rail is a second thing to think about. But trading coins for crew after a spell
   in the storm is a genuinely good decision, and the derby is the mode that pays by the second.
7. **Muskets.** Currently crew capacity over 26, plus half a musket per swivel, floor of 1. Gives 2 to
   9 across the fleet. The brief was unsure and this is a guess.
8. **Diminishing returns past a third sail** are unreachable until a mast has four berths. Worth
   confirming a four-berth mast is wanted before tuning the falloff.
9. **A sail's size versus its berth's slot.** A sail drawn in berth 1 takes berth 1's geometry, on the
   assumption that large sails sit low and small ones high. A mast that puts a large sail above a small
   one would draw wrong.
10. **Bowsprits.** Hulls carry a `bowsprit` flag and the renderer honours it, but nothing yet makes an
    upgraded bowsprit a purchasable part with a spritsail on it.
11. **Tier names.** `Coastal`, `Privateer`, `Cruiser`, `Ship of the line`, `Flagship` have not been
    read at 1x in the game, because nothing displays them. `Ship of the line` is much the longest and
    is the one to watch in a card.

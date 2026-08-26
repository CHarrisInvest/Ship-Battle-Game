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
| `src/shipref.js` | GENERATED. What each class was: her dimensions, her shape, her timber, her era. Nothing reads it; it is there for whoever models the hulls. |
| `src/hold.js` | What a captain owns. The yard sits in the same record as the coins, so a purchase moves both in one write. |
| `src/galleon.js` | Draws a rig rather than *the* rig. Given a spec it builds the ship; given nothing it builds the galleon it always drew. |
| `src/SternchaseIso.jsx` | The menu ship plate and the yard screen, plus the repair rail that replaced the upgrade rail. |
| `data/hulls.tsv`, `data/masts.tsv`, `data/sails.tsv`, `data/guns.tsv` | The tables a person edits. One row per class, per mast type, per sail and per gun. |
| `tools/import.mjs` | `npm run import`. Writes those tables into the generated blocks in `shipyard.js`. |
| `tools/catalogue.mjs` | `npm run catalogue`. Checks the fleet is riggable and drawable, then prints every class side by side for calibration. |

## The model

Four kinds of thing, and the shape of each is what makes the shipyard behave the way the brief asks.

**Hulls** fix maximum hull and crew, base speed and handling, how many guns of each kind she bears,
and her mast sockets. A socket has a station along the keel (`fore`, `main`, `mizzen`) and a size.

**Manoeuvrability is `hand`, and it is separate from `speed`.** Both are hull figures around 1, both
are columns in `data/hulls.tsv`, and nothing in the model runs one off the other: a cutter is 1.22 on
the helm and 1.08 on pace, a galleon 0.78 and 0.87. Three things then move it. Sails carry their own
`hand`, so square canvas stiffens her and fore-and-aft canvas helps her round; guns weigh her down by
`LOAD_BITE` as she fills her ports; and in the fight the rudder itself goes heavy with the way she
carries, so a ship at a run turns wider than the same ship at a crawl. `rate()` folds the first two
into `turn`, and the yard screen shows it as `Handling`.

The one part of handling that is *not* modelled is heft: every ship gathers way and loses it at the
same rate, so a galleon whose own blurb says she is slow to start and slow to stop is neither. That
wants either a column of its own or to come off `tons`, which already says what she carries.

**Masts** fit a socket of their own size or larger, and carry a fixed set of *berths* decided when the
mast is built. A berth names the *category* of the one sail that goes in it. That is what makes buying
a mast a choice of rig shape rather than a choice of size: `lateenMast` will carry one lateen and one
small square sail for as long as it exists, and no amount of money changes it into a topgallant.

A mast type is not tied to a station. A mast carrying three square sails is that mast wherever she
steps it, so a brig's fore and main are one part bought twice rather than two parts in the catalogue,
and only the size rung says where it can go. **Berths run deck upward, and a fore-and-aft driving sail
sharing the lowest level with a course takes berth 0**, square canvas above it. A spanker and a course
are both set at the deck, one abaft the mast and one on a yard across it, and the model holds one sail
to a band: putting the spanker lowest is what keeps a brig reading bottom to top the way she is
rigged, rather than flying her spanker over the topgallant.

A **spar** is not a mast. A jibboom goes on the bowsprit and nowhere else, and a topgallant mast never
goes over the bow. Size alone would allow both, since a spar is small and small fits everything, so
`mastFitsSocket` matches the sort of thing first and consults the size rung second.

**Sails** fit a berth of their own category, and that is the whole of the rule. This is also the whole
of "a sloop's triangular canvas is no use on a square-rigged ship": a frigate has no triangular berth
below her mizzen, so the sail simply does not go in. Each sail has a `drive` (pull) and a `hand` (what
it does to her helm). Square canvas drives hardest and stiffens her; fore-and-aft canvas drives less
and helps her round.

### The seven sail categories

`SAIL_KINDS` is the vocabulary, and a sail's `kind` is the only thing a berth asks about.

| | | |
|---|---|---|
| `LSQ` | Large square | Courses and lower topsails. The driving power, low on the mast. |
| `SSQ` | Small square | Topgallants, royals, skysails, spritsails. Light-air lift, high up. |
| `TRI` | Headsail | Jibs, flying jibs, staysails. Set on a stay forward: balance and pointing. |
| `LAT` | Lateen | Lateen yards and the tall Bermuda mainsail. Triangular canvas driving from a mast. |
| `GAF` | Gaff | Gaff mainsails, spankers, drivers, trysails. Fore-and-aft drive aft. |
| `LUG` | Lugsail | Dipping and standing lug, lug topsail. What a lugger drives on. |
| `STU` | Studdingsail | Boomed out beyond a square sail already set. Additive, and not a berth. |

Two things this settles that the code got wrong for a while.

**Area is not the category.** It was a pair for a while, a cut and a size, and crossing them produced
combinations no real rig has: `triangle` and `small` made a berth a jib and a staysail both filled and
a lateen did not, for no reason anybody could state. A topgallant is nearly four times a skysail and
both are `SSQ`; a flying jib is a scrap beside the staysail under it and both are `TRI`. The range
inside a category is carried by `drive`, which is where it belonged all along, and the fitting rule is
one comparison instead of two.

**A lateen is not a headsail**, and that is why there are seven categories rather than six. Both are
triangles and they were one category until the bowsprit became a station: the moment a jib had a berth
of its own a lateen fitted it, and a lateen pulls better than any staysail, so the choice made itself
and the berth was decoration. They do different work, a lateen driving from a mast and a jib
balancing her off a stay forward, so they are different categories. That is a split on what a sail
*is*, which is what the categories are for, and not the size dimension the model threw out.

**`STU` is not a berth**, and it is the one category that does not fit the model. A studdingsail booms
out beyond a square sail that is already set, and its area comes off that sail rather than off a place
in the rig: roughly half to four fifths of the square sail it extends. So it wants an attachment to a
sail, not a slot on a mast. Nothing models that yet, `SAIL_KINDS.STU` is marked `additive`, and the
bench refuses a berth that asks for one rather than letting a mast pretend otherwise.

A part carries `part`, one of `"mast"`, `"sail"` or `"gun"`, for what sort of thing it is. A sail also
carries `kind` for its category. Those were one field until the categories arrived and collided with
it, which is worth knowing when reading an old branch.

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
- **Start with one ship, ready to fight.** `STARTER` in `shipyard.js`: an armed launch, a sprit mast
  with one sail bent on, a light gun each side, a chaser on the bow and one swivel. Her broadside is
  FULL at one gun a side, which is all a launch bears, so a captain can fight from the moment the game
  opens. What she cannot do is fight anything much, and every gap in her is a gap the shipyard fills:
  the bowsprit she carries has no spar on it at all.
- **Rigging and guns move ship to ship.** Falls out of instances.
- **A mast only ever carries the sails it was built for.** `berths`, fixed on the mast type.
- **Various sail types.** Six categories, `LSQ` `SSQ` `TRI` `GAF` `LUG` `STU`, one on each berth and
  one on each sail, compared as a single key. The head of a tall mast takes a small square sail
  because that is what the berth up there asks for.
- **Sails affect speed and agility differently.** `drive` and `hand`.
- **Muskets come off the crew, and swivels correlate with them.** `rate()` returns one `muskets`
  figure: crew capacity over 26, plus one per swivel on the rail, floor of 1. Small arms are one thing
  aboard this ship rather than two, and that is settled — a swivel is never going to be a battery of
  its own, which is why `measure()` reads `muskets` and ignores the swivel volley sitting next to it.
  What a *better* swivel buys is written up below.
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

**`npm run catalogue` prints this table and there is no copy of it here**, because 38 classes is too
many to keep in step by hand and a stale figure in a design note is worse than none. The shape of it:
an armed launch has 100 hull points, 30 hands, one gun a side and rates about 0.6 on speed; a first
rate has 3,290, 950, twenty a side and rates 0.79 before canvas. Hull runs a factor of 33, and the
economy runs with it: coins are earned a point of damage and repairs are charged a point of damage,
so a bigger fleet pays proportionally more and costs proportionally more to patch, with no scaling
term anywhere.

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
- **Swivel quality.** Settled in intent, unbuilt, and with no numbers set: see below.

### What a better swivel is to buy

A swivel adds one ball to the volley whatever it cost. What quality buys, and how many quality swivels
she carries, is that the volley **hits harder and groups tighter off the bow**. Nothing does either
yet, but all three figures already exist in the fight, and they are all constants:

| | where it is now | what it becomes |
|---|---|---|
| count | `for (let i = 0; i < 6; i++)` in `fire()` | `rate().muskets` |
| damage | `musketDmg()`, a flat `3.2` | what one ball does, off the swivels aboard |
| spread | the `0.8` in that same line, an arc in radians | tightened by swivel quality and number |

The count one is worth doing on its own, ahead of any quality work, and is close to a bug already: a
flat six balls for every hull afloat means a cutter and a galleon throw the same volley, so the
`Muskets in a volley` figure the yard screen prints is a promise the fight does not keep. It also
means the musket half of `measure()` is calibrated to nothing in particular — `MUSKET_DPS` of 2.4 a
musket puts a 12-musket galleon at 28.8 against the fight's real 25.6, and a 2-musket cutter at 4.8
against the same 25.6.

One trap in the spread. That `0.8` has `noise` added to it, which is the AI's own aiming error and is
zero for the player. Tightening the spread must leave `noise` alone, or better swivels aboard the
player's ship would quietly make every rival captain a better shot as well.

`rate()` grows a musket damage and a musket spread beside the count, `measure()` multiplies by the
damage rather than its own constant, and the fight reads all three off the loadout. A swivel's
`damage` and `reload` in the catalogue are already there for the middle row. Nothing carries a
grouping figure, so that field arrives with the quality tiers rather than being guessed now.

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

**`STOCK` is the fleet the game issues**, and it is generated rather than written out. Every class
appears at three standards, plain, well found and fully found, built by `fitOut(hull, quality)`; a row
may still carry a hand-written `rig` and `guns` where a class wants a fit of her own, and `resolve()`
handles that one exactly as it handles the player's ship. 38 classes at three fits is 114 opponents,
which is not a table anybody keeps in step by hand: two hand-written fits per class would drift out of
step with the parts table every time a price moved, and every entry is a chance to name a sail that no
longer fits the berth it was written for. The bench checks the hand-written ones for exactly that.

Nothing declares a tier. Every rung is measured, so changing a fit moves the ship up or down the
ladder on its own and cannot disagree with its own stat line, and `npm run catalogue` prints the whole
ladder in ascending strength.

The overlaps are the point and they come out of the numbers rather than being placed. A fully found
cutter outranks a plain brig-sloop. And the two measures genuinely disagree: under gunfire a galleon
towers over a xebec, while as ramming stock they are far closer, and a ship's guns are dead weight in
a match where nobody fires.

**The tier bands have not been moved yet.** They were placed against eleven stock ships when the
catalogue held five classes, and `overall` now runs from about 43 to 856 rather than 50 to 240, so the
top band holds most of the fleet. Rebanding waits on the musket curve and the broadside columns, which
move `measure()`'s inputs: doing it before those would be work thrown away.

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

## Room for forty classes, and now holding 38

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

### The yard screen

The ship on the menu was decoration: the only picture of a captain's own ship in the game, and nothing
you could do with her. She is now a plate with her class on one side and `Tap to edit` on the other,
and the whole plate is the button, because a frame you have to hit the middle of feels broken on a
phone.

Tapping opens **the yard**, which is the reading half of the shipyard. Everything on it was already
worked out and had nowhere to be shown: what she rates, the tier that puts her in, her rigging socket
by socket with every berth named and every empty one marked bare, how many guns of each kind she bears
against how many she has, and what `shortfall()` says she still wants. Empty sockets and bare berths
are listed rather than skipped, because the gaps are the point of the screen.

Buying and fitting are not on it yet. The model behind them is complete, so what they are waiting on
is the design, and this is the screen they get built into rather than a placeholder to be thrown away.

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
so the columns do not line up, a duplicate id, a missing column) and leaves everything else to the
bench, which is the next command and the one that says whether the result is a fleet.

`data/masts.tsv` and `data/sails.tsv` are the same for mast and sail types, and the three go in
together: a hull's socket sizes mean nothing until masts exist that fit them, and a mast's berths mean
nothing until sails exist of those categories. The bench will say so in both directions.

### What the 38 needed

They are in. `data/hulls.tsv` now carries one row per class, and the gameplay columns are derived from
the reference figures beside them: hull points from the timber formula, crew from her battle
complement floored at 25, `speed` from her working speed under sail, `hand` from the handling
components less the rig and the crew (her sails carry the rig half themselves), `canvas` as
displacement to the two thirds, and `tons` the same way, moved by how fine she is. Prices came off
measured strength afterwards. Blurbs are empty for now.

The original note, for whoever adds the thirty-ninth: each class needs a name and a blurb, a price,
hull and crew points,
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
- ~~**Stations beyond fore, main and mizzen.**~~ Done. `bowsprit` and `bonaventure` are stations now,
  both drawn. A further one is still a `STATION_GEOM` entry and the bench still catches a station
  nobody has drawn.
- ~~**Sizes beyond small, medium and large.**~~ Done. `SIZES` runs `boat`, `small`, `medium`, `large`,
  `heavy`.

The six categories mean a lugsail mast or a gaff-rigged ketch is a row in `data/masts.tsv` rather than
a code change, and the bench catches a berth whose category is a typo. The renderer draws `LSQ`, `SSQ`
and `TRI` in shapes of their own; `GAF` and `LUG` fall back to square canvas until `galleon.js` learns
them, which is a wrong-looking ship rather than a broken one, and the bench prints which categories
are in that position rather than letting it pass unremarked.

## Open questions

Things a design document should settle, listed with what the code currently assumes so that agreeing
with it is as cheap as changing it.

1. **The economy.** The shelf is a curve now rather than five hand-placed numbers: price goes as
   measured strength to the power of about 2.07, anchored so a cutter is 2,500 and a first rate
   120,000, with the launch free because she is the ship a captain starts in. The first ten classes
   all come in under 600, which is the "play with a cheap boat before committing" opening that was
   asked for. What is NOT tuned is any of it against what a voyage actually pays: at a coin a point of
   damage a first rate is a hundred-odd good rounds.

   One shape, and the answer to it. **Fitting out costs roughly the same whatever she is**, from about
   2,800 for a launch to about 47,000 for a third rate, because a sail costs what it costs and a big
   ship differs only in having more berths to fill. Against a hull shelf that runs 0 to 120,000 that
   means outfitting dominates early and is a rounding error late: a captain's first three purchases
   are all rigging, and her last is a hull she can then barely afford to bend canvas on.

   **Advanced sails are what closes that**, and they are planned. There are two grades of most sails
   today, plain and fine; a dearer grade above them multiplies by BERTH COUNT, and berth count is the
   one thing that genuinely scales with the hull. A launch has two berths and a fully rigged first
   rate has seventeen, so lifting the top of the sail ladder raises a great ship's bill about eight
   times as fast as a boat's, which is the curve that is missing. It wants doing in the same pass as
   the economy rather than before it, since what a voyage pays decides how far the ladder should
   reach.

   What that does not touch is the bottom end: a launch still pays a few thousand to fill out against
   a 120 coin hoy. If the opening should be cheaper as well, the lever is a cheaper low grade of sail,
   not the hull prices.
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
5. ~~**Stations and sizes beyond the three of each.**~~ **Settled.** Five stations, `bowsprit` `fore`
   `main` `mizzen` `bonaventure`, and five sizes, `boat` `small` `medium` `large` `heavy`. The
   bowsprit is a station rather than a flag, which is what gave headsails somewhere to live; it takes
   a *spar* rather than a mast, and `mastFitsSocket` matches the sort of thing before the size rung so
   a jibboom cannot be somebody's main mast.
6. **Should the derby have repairs?** It has none today, because "only one hand needed" is that mode's
   whole promise and a rail is a second thing to think about. But trading coins for crew after a spell
   in the storm is a genuinely good decision, and the derby is the mode that pays by the second.
7. **The crew divisor.** Muskets are crew capacity over 26, and the 26 is a guess. It gives a 55 hand
   cutter two shots and a 155 hand galleon six before a single swivel is aboard, which feels about
   right and has never been played against a tuned fight. What a swivel adds is *not* an open
   question: see below.
8. **Diminishing returns past a third sail** are unreachable until a mast has four berths. Worth
   confirming a four-berth mast is wanted before tuning the falloff.
9. ~~**Four and five berth masts need the sail bands generated.**~~ **Done.** The authored bands are
   now a profile rather than a list: how a sail's span, belly and height change going up, plus the
   envelope the stack occupies. Any number of bands is that profile resampled and squeezed to fit, so
   a five sail mast reaches the same masthead a three sail mast does. Three or fewer are left exactly
   as authored, which keeps the galleon the ship she was and puts a single sail on the course band
   rather than stretching it up the pole. Five is the ceiling: past that a stack is stripes on a
   spar, and the bench fails a mast that asks for more. The bench also checks the generator itself,
   every stack at every station, since two bands run together is a sail behind a sail.
10. **A sail's size versus its berth's slot.** A sail drawn in berth 1 takes berth 1's geometry, on
    the assumption that large sails sit low and small ones high. A mast that puts a large sail above a
    small one would draw wrong.
11. ~~**Bowsprits.**~~ **Settled, and built.** The bowsprit is a station, the spar in it is a part with
    berths, and what goes on those berths is headsails or a spritsail. `galleon.js` draws both: a
    headsail is tacked to the spar, hoisted to the head of the foremost mast and sheeted home half way
    in, and square canvas on a bowsprit is slung under it on a yard athwart, the way a carrack carried
    hers. The hull's `bowsprit` flag still says whether she has the spar at all, which is what decides
    whether she has the socket to fit anything to.
12. **Tier names.** `Coastal`, `Privateer`, `Cruiser`, `Ship of the line`, `Flagship` have not been
    read at 1x in the game, because nothing displays them. `Ship of the line` is much the longest and
    is the one to watch in a card.

# The shipyard

Buying and fitting ships, and sailing what you bought. The data model, the persistence, the renderer
that draws whatever is stepped and bent on, the two shops a captain spends her coins in, and the
fight, which reads all of it: she sails her own ship in every mode, and every rival is a stock ship
matched to what hers measures.

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
| `src/shipref.js` | GENERATED. What each class was: her dimensions, her shape, her timber, her era. `hullform.js` reads it and nothing else does. |
| `src/hullform.js` | Each class's hull, modelled from her reference row: the menu's 3-D model and the hull at sea, size, collision, stern type and timber included. The galleon's numbers are the authored anchor. |
| `src/hold.js` | What a captain owns. The yard sits in the same record as the coins, so a purchase moves both in one write. |
| `src/galleon.js` | Draws a rig rather than *the* rig. Given a spec it builds the ship; given nothing it builds the galleon it always drew. |
| `src/SternchaseIso.jsx` | The menu ship plate, the yard, the Boat Commission and the Rigging Outfitter, plus the repair rail that replaced the upgrade rail. |
| `data/hulls.tsv`, `data/masts.tsv`, `data/sails.tsv`, `data/guns.tsv` | The tables a person edits. One row per class, per mast type, per sail and per gun. |
| `tools/import.mjs` | `npm run import`. Writes those tables into the generated blocks in `shipyard.js`. |
| `tools/catalogue.mjs` | `npm run catalogue`. Checks the fleet is riggable and drawable, then prints every class side by side for calibration. |
| `tools/workbook.mjs` | `npm run workbook` and `npm run workbook:read`. The same four tables as one spreadsheet, for editing the fleet in Numbers or Excel and reading it back. |
| `data/ships.xlsx` | GENERATED, and a convenience rather than a source. The workbook the two commands above write and read. |

## The model

Four kinds of thing, and the shape of each is what makes the shipyard behave the way the brief asks.

**Hulls** fix maximum hull and crew, base speed and handling, how many guns of each kind she bears,
and her mast sockets. A socket has a station (`bowsprit`, `fore`, `main`, `mizzen`, `bonaventure`) and
a size (`boat`, `small`, `medium`, `large`, `heavy`).

**Manoeuvrability is `hand`, and it is separate from `speed`.** Both are hull figures around 1, both
are columns in `data/hulls.tsv`, and nothing in the model runs one off the other: a cutter is 1.18 on
the helm and 0.97 on pace, a first rate 0.62 and 0.79, and a clipper is the fastest hull in the fleet
while turning worse than a corvette. Three things then move it. Sails carry their own
`hand`, so square canvas stiffens her and fore-and-aft canvas helps her round; guns weigh her down by
`LOAD_BITE` as she fills her ports; and in the fight the rudder itself goes heavy with the way she
carries, so a ship at a run turns wider than the same ship at a crawl. `rate()` folds the first two
into `turn`, and the yard screen shows it as `Handling`.

The one part of handling that is *not* modelled is heft: every ship gathers way and loses it at the
same rate, so a first rate of three thousand tons starts and stops like a ship's launch. That wants
either a column of its own or to come off `tons`, which already says what she carries.

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

**`STU` is not a berth**, and it is the one category that does not fit the berth model, so it got the
attachment it wanted instead. A studdingsail booms out beyond a square sail that is already set, and
its area comes off that sail rather than off a place in the rig: its `drive` in the table is a share
of its host's, half to four fifths, and `rate()` multiplies the two. A square sail carries at most
one, matched by `level`: which square sail up the mast it booms out from, counting square canvas from
the deck, so a lower studdingsail goes beside the lowest square sail even on a driver mast whose
course sits at berth 1 with a spanker under it. `studFitsSail` is the rule, `fitStud` in `hold.js` is
the move, and the stud comes loose the moment its host sail does. `fitOut` runs them out only near
fully found, because they are the last thing aboard rather than a step on the way. The bench still
refuses a berth that asks for `STU`, so a mast cannot pretend to carry studdingsails in a slot.

A part carries `part`, one of `"mast"`, `"sail"` or `"gun"`, for what sort of thing it is. A sail also
carries `kind` for its category. Those were one field until the categories arrived and collided with
it, which is worth knowing when reading an old branch.

**Guns** fit by the piece up to the hull's bearing. `broadside` counts guns *a side*, because that is
how a volley fires, and runs 1 on a gundalow to 50 on a first rate. Bow guns run 0 to 2. Muskets
are not bought at all: they come off the crew the hull musters, with swivels adding to the volley.

**One ball per gun, and every gun she has.** A volley was capped at ten balls a side once, with the
guns beyond that stacked into columns throwing one heavier ball apiece. Ten was as many as could be
told apart coming off one side, and no ship then bore more than twenty. It is the wrong answer at
fifty, and it was always an answer to a drawing problem rather than to a gunnery one, so `rate()`
returns `balls` (her gun count) and `perBall` (one gun's damage) and the fight solved the drawing
problem where it belonged. See **The rolling broadside** below.

**She cannot work iron she cannot carry.** `fitOut` takes the dearest piece a mount allows and then
steps the battery down a grade at a time until it fits under her tonnage, so a gundalow comes out with
three pounders, a light xebec with sixes, a corvette with long nines, a frigate with twenty-fours and
a first rate with thirty-twos. None of that is declared per class: it falls out of `tons`, which is
why fine-lined hulls carry lighter iron than beamy ones of the same displacement.

**`tons` is tons of iron**, in the same weights the guns are priced in, and the limit is the column
itself: a full battery of the gun she was built around, both sides, plus her chasers and her rail. It
was a dimensionless figure read against eight times itself once, which is a thing to know when reading
an old table: a column rewritten in real tons made the limit stop binding, and every hull in the fleet
could bear the heaviest gun in the shop until the multiplier came out.

**And no one piece heavier than her broadside.** The tonnage loop lightens whichever mount carries the
most, which is always the battery, so a boat could come out legal on total weight with four pounders
in the ports and a frigate's eighteen on the bow. A chaser is a gun on the same deck as the rest: if
her scantlings will not stand an eighteen abeam they will not stand one over the stem.

**Size** is deliberately absent from the catalogue, and it arrived where it belonged: with the art.
`hullform.js` models each class from her reference proportions, and her size in both views, and her
collision ellipse in the fight, come out of that model. There is still nothing in the catalogue for a
balance pass to multiply, which is the point.

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

**`npm run catalogue` prints this table and there is no copy of it here**, because a fleet this size is
too much to keep in step by hand and a stale figure in a design note is worse than none. The shape of
it: a gundalow has 100 hull points, 30 hands, one gun a side and rates 0.55 on speed; a first
rate has 2,699, 800, fifty a side and rates 0.79 before canvas. Hull runs a factor of 27, and the
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

**Hull shapes per class are drawn now.** `buildShip` takes a form from `hullform.js` beside the rig:
her own station table, castles or no castles, gunports counted off her historical battery, a windowed
gallery or a plain transom, and mast geometry scaled into her hull. The stern is the type the
reference names, not just windowed-or-not: a raking transom or an overhanging stern leans the after
stations out over the waterline the way the bow rake leans the stem, a square stern stays wide, a
scow barely narrows, and a round or pear tuck keeps some fullness. Her timber paints her: `species`
and `timber` from the reference become a per-channel cast over the wooden keys of the palette, so a
pine launch is pale and yellow, teak runs warm, live oak dark, and canvas, glass and flags keep their
colours; the same cast tints her hull and spars at sea. The galleon's form is the authored numbers
under the plain Oak identity cast, so she still builds the exact hull this file always drew, checked
by pixel diff, and a cutter is finally a small hull under a small rig. Her battery is the exception,
and deliberately: see **The anchor is pierced too** below.

### The volley

Every gun she has throws its own ball, which for a first rate is fifty a side and a hundred in the
water. Fired together they cannot be told apart: down the length of her they would sit two thirds of
a pace from each other, and the volley would read as one bar of iron however small the balls were
drawn. Nothing that can be done to a ball's size fixes that, because a ball small enough to fit is a
ball too small to see.

**So every gun takes her own moment**, drawn at random inside a window: several ports go off
together, a few more follow somewhere else along her side, and the whole broadside is away inside
`VOLLEY_MAX`. What separates one ball from the next is the ground the one before it has already
made, and what makes it read as a gun crew rather than a mechanism is that the moments are scattered.
It replaced a strict roll from one end to the other, which fired the same guns in the same time and
looked like a zip fastener running down her side. The window is `GUN_STAGGER` per gun up to the
ceiling, so a cutter's five go off in a twentieth of a second and still look simultaneous while a
first rate's fifty spread over a third of one. `stepVolley` fires each gun as her moment arrives, off
wherever the ship is by then, so a ship holding her course lays a straight bank of iron and a ship
under helm walks it across the water.

**A gun fires out of a port in her side**, so its flash and its smoke stand at the rail it fired over
rather than on her keel, and the flash is drawn in a pass of its own after every puff on the water.
Those ports are drawn now, all of them: see **Every gun has a port** below.
Both were wrong first time and both mattered more than they sound: the flash was amidships on her
centreline, where a gun deck is stores rather than gunports, and it was drawn in the order it was
made, so a pale yellow flash went under the white bank the next gun down the side put up. Fifty guns
going off left a bank with nothing in it, which is a ship in a fog rather than a ship firing. The
puff is small and stands just outside the rail for the same reason: one as wide as she is long
swallows her hull, her flashes and the first few paces of her shot.

**Her guns are laid as they bear**, and this is what keeps a spread volley from being a worse one.
She crosses better than a hull length while her side is firing, so a gun fired at the end of
the roll goes off from a long way ahead of where the first one did, and the whole volley walks off the
front of what she was pointed at: measured over a one-second roll, she put 38% of her iron into a hull
she had laid dead at full speed, against 85% before. Real crews answered this by laying each gun as it
bears, and so does she: the ground made since the order comes off the lay at `LAY_RANGE`. That
restores it to 88% at every speed and at every width of window, which is why `VOLLEY_MAX` could be
set from how the volley looks rather than from what it costs her. It is honestly wrong at any range but
that one, which is what laying a gun for a range you have guessed has always been worth.

**The ball is smaller than it was**: `r` 3.0 to 1.8, drawn at exactly the size it bites rather than
the seven tenths of it a fat ball could afford. That is the one real cost of the change and it falls
on the small ships, who gain no extra balls to make it up: a cutter delivers 0.93 of what she used to
against a hull laid dead. A first rate comes out at 1.03, the extra balls covering the smaller bite.

Measured at 60 frames a second through twenty seconds of eleven first rates firing both sides in
company, which is the heaviest field free-for-all can put up: about 1,100 balls and 1,100 puffs of
smoke a volley round. One puff to a gun rather than two, and a bigger, longer-standing one, is what
paid for it.

### Every gun has a port

`histGuns / 2` is exactly her `broadside` bearing for every class in the fleet, so `hullform.js` can
draw her whole battery from the reference alone and the ports agree with the guns that fire out of
them without the catalogue and the reference ever having to be introduced. She used to show one port
per dozen of her guns to a maximum of seven, which was a way of suggesting a battery on a hull that
had no room to draw one; she has the room.

### A gun deck is not the upper works

Where those guns stood is a second question, and reading `decks` for it was the wrong answer to it.
`decks` says how many of her decks carried guns and nothing about where on them, so a first rate's
fifty a side were split evenly over three tiers with the top one clipped to between her castle
breaks. Three things were wrong with that at once. A rate's number counts her quarterdeck and
forecastle guns, which never had a lidded port in the ship's side, so a dozen of them were pierced
through her topside. A frigate has one gun deck and `decks` said two, so she drew as a small ship of
the line. And the top tier, sixteen ports crammed into 0.58 of her length, came out spaced 2.8 apart
against a port 5.2 wide: not a row of ports but one continuous smear, which is also the one stretch
of a two-decker's side that historically had no ports in it at all.

`battery` replaces it, and it is her real establishment written deck by deck: `28/28/30+12/2` is a
first rate, `28+8/2` a frigate, `30+20` a spar-decked heavy frigate whose upper battery ran the
length of her, `10` a cutter. Gun decks before the plus, lowest first; her upper works after it,
quarterdeck then forecastle, or a single figure for a battery that ran right along her. The importer
checks the figures sum to `histGuns` and that every gun deck takes an even number, because nothing
downstream can tell that they do not.

The two are then drawn as the unlike fittings they were. A gun deck runs the whole length of her,
under the castles, in lidded ports of tan trim. Her upper works stand in the open behind a bulwark:
an opening in the rail with a short thick gun in it, sized off the bulwark it stands behind, which is
both what a carronade was and the only sort of barrel that still reads at the size a quarterdeck is
drawn. So a frigate has one battery and a few guns above it, a two-decker has two and an empty waist,
and a first rate is three tiers and a quarterdeck.

### A port is the size a port was

The authored port is 4.4 deep and 5.2 wide, which was fine on the one hull it was drawn for and
absurd on the rest: it is more than the whole freeboard of half this fleet, and three tiers of it
will not stand on any hull in the game. It is now the ceiling and not the figure.

The figure comes from `roomSpace`, which is in the reference for exactly this. A gunport was framed
on her room and space: the opening ran a little over one frame space wide and stood a little less
than that tall, so a first rate's two-foot frames gave her about three and a half feet across and a
cutter's twenty inches gave her under three. That is worked in feet and then brought into units by
the class's own compression, which is not the same on both axes, so the ports on any two ships are
to each other as the real ones were rather than as the drawing happens to be scaled.

Tiers hang from the rail downward, because that is where a deck is: the upper deck's ports sit just
under her sheer and each deck below stands off the one above it. The calibre falls off going up, her
lower deck having carried her heaviest guns, so each tier is drawn a little smaller than the one
below. That grading is most of what makes a three-decker read as three decks rather than as one
pattern repeated three times. If the sum of all that comes to more side than she has, the whole
battery shrinks by one factor, so the grading and the proportions survive a shallow hull.

The one figure here that is frankly the drawing's rather than the ship's is how far apart two tiers
stand. A real deck stood about two and a half port-depths above the one below, and `freeboard` in the
table is nothing like deep enough to carry three of those, so tiers are set as far apart as the hull
the game actually draws will allow. A first rate comes out with lower-deck ports 2.8 by 2.7, a clear
1.1 of timber between tiers and her lowest sill 1.4 above the water; that sill is 31% of the way up
her side, against about 28% on Victory.

### A tier is cut for one deck, so it hangs parallel to her sheer

`drop` is how far under the sheer a row of ports sits, and it is the same figure at every station
along her, so each deck's ports follow the sweep of the deck they belong to. `portZ()` is the one
reader, which is why the bench and the plate cannot come to different answers about where a port is.
There is no second rule beside it. The galleon carried a fraction of the sheer for as long as her
four ports were authored numbers, and she is pierced from her own row now, so the fraction is gone.

A fraction of the sheer is not the same thing at all, and it is what every derived class had. Her
sheer sweeps up at the ends, so a row at 0.83 of it rose only 83% as fast as the deck above it and a
row at 0.21 only 21% as fast: the rows sagged away from their own deck lines toward bow and stern.
Measured as how far each port's head sat under the sheer, amidships against at the ends:

| class | tier | drop under the sheer | port depth |
| --- | --- | --- | --- |
| 1st rate | lower | 7.11 to 13.67 | 2.67 |
| 1st rate | middle | 3.52 to 7.16 | 2.32 |
| 1st rate | upper | 0.41 to 1.52 | 2.02 |
| 3rd rate | lower | 3.89 to 9.49 | 2.60 |
| 5th rate | gun deck | 0.41 to 1.98 | 2.53 |
| Corvette | gun deck | 0.42 to 2.01 | 2.47 |

A first rate's lower battery dived two and a half times the depth of the port itself over her run,
and even a flush-decked corvette's single row finished a whole port's depth further below her rail at
her ends than amidships. A real gun deck's sheer runs near enough parallel to the rail's. Every one
of those figures is now flat, and the bench measures the wander and fails a tier that moves more than
half a port's depth against the sheer: put the fraction back and it reports eleven classes.

It also settles the waterline guard, which was quietly eating ports back when a fifth rate drew 6 of
her 10 lower ports and a heavy frigate 8 of 13. A row at a fraction of the sheer dives at the fine
ends, toward the water; a row at a constant drop rises with the sheer, away from it. So clear
amidships is now clear everywhere, which is the whole of what the solve has to prove. The guard stays
as the net it was, and `npm run catalogue` counts what comes out drawn against what she carried.

### A boat is not pierced at all

A lidded port is cut through the topside under the deck above it, and a hull with a castle score of 1
has neither: her deck is her only deck and her guns stood on it, behind a rail low enough to fire
over. So a gundalow through a Baltimore clipper carry their whole battery as open positions along the
rail, which is the fitting the upper works already use and where a cutter's five guns really were.
Sized to her side they were correct and tiny; sized as the galleon's they were a 4.4-deep opening in
three feet of freeboard, hanging off her rail at the top and into her wales at the bottom. Standing
at the rail they read against the sky rather than against dark timber, which is also the first time
these five have looked like the boats they are.

### The anchor is pierced too

The galleon showed four ports a side, at an authored size and an authored fraction of her sheer. That
is a 130-foot ship pierced for eight guns, and worse than the number, it made the anchor the one hull
in the game the port rules did not apply to. An anchor that has to be excused from the rules cannot
be used to check them, which is the whole of what an anchor is for.

So `GALLEON_REF` is her row, and her ports come out of `portsOf` like everybody else's. Her hull,
castles, bow, bowsprit and mast geometry stay the literal numbers this game has always drawn; only
the battery is solved. She is 130 ft on deck with 38 ft of beam, four masts with a bonaventure mizzen
and a windowed gallery stern, which is an English or Spanish great galleon of about 1590 and some 600
to 700 tons. Ark Royal was 37 ft in the beam and carried 55 guns, Revenge 32 ft and 46, Elizabeth
Jonas 56, and those counts include a great many small pieces standing in the castles rather than
carriage guns in ports, which is what the figures after the plus are for. Her row reads `22/16+6/2`:
46 guns, 11 a side on her lower deck and 8 on her upper, with 3 on her quarterdeck and 1 on her
forecastle. Ports 3.14 by 2.67 low and 2.73 by 2.32 above, 5.15 of timber between one port and the
next, 1.25 between the tiers, her lowest sill 5.67 above the water and both drops flat the length of
her.

Two things followed. `portZ()` lost its second branch, since nothing carries a fraction of the sheer
any more. And she crossed the twelve-port line, so she draws with the cheap five-sided barrel and one
gun in three run out, like everything else of her size; the ten-sided gun with a bore is now what a
cutter through a brigantine shows rather than what the galleon shows.

She is also audited by `npm run catalogue` with the rest of the fleet now. She is in no catalogue and
no captain can buy her, so the one check she sits out is the one against a `broadside` she does not
have.

### An open port means a gun is aboard

`rigSpec` carries her fitted broadside now, which is the one thing in it that is not rigging and is
there for the same reason the rest is: a ship shows what she has got. She arms from the lowest deck
up, the way a ship was armed, main battery first and quarterdeck last. An armed port is open, a black
square in tan trim, which is what says gun deck at this size; an empty one is shut, a lid of mid brown
in the same trim, lighter than the planking above the wale and darker than the strake, so a shut port
still reads as a port. At 1x the difference is a pale dot where there was a dark one, and a first rate
with a fifth of her guns aboard is visibly a first rate with a fifth of her guns aboard. Her ports are
hers whatever she carries in them, which is what makes her a first rate; the guns are what make her a
found one, and that is now something a captain can see from the menu rather than only read in the
shop.

Which ports have their guns RUN OUT is a separate question, and the answer is one of each three,
chosen by a hash of the group. `%3` on the running count laid a stripe down her side that stepped
between the tiers like a zip fastener. A free hash of the port's own number fixed that and left eight
ports together with nothing run out, which reads as a stretch of her side she has not armed rather
than as guns housed. One per group of three keeps the count exactly where the face budget wants it and
bounds the bare stretch at four, while the hash still puts two guns side by side here and none for a
few ports there.

Two things had to give for that to be free. **Guns are housed until they are wanted**: a big battery
runs out one gun in three and shows the rest as the port alone, because fifty barrels a side is a
fringe of grey spines rather than a wall of gunports, and the black square in tan trim is what says
gun deck at this size anyway. And **a barrel is drawn in fewer faces where there are many of them**:
a ten-sided gun over four segments is seventy faces, nothing on a ship showing four ports and seven
thousand on a first rate showing a hundred. Together those put the menu plate back exactly where it
was: 99.9ms a frame for a fully found first rate against 100.0ms before the change, and 16.8ms
against 16.7ms for a cutter.

All of the above cost nothing either, measured the same way on a slower machine: a fully found first
rate runs 48.7 to 51.4ms a frame against 50.4ms before any of it, and a cutter 43.0 to 43.8 against
41.8, which is inside the noise in both directions. Her upper works add fourteen guns to a first rate and
every one of them is run out; the tiers below shed the fourteen ports that were standing in for them;
a shut lid costs exactly what the open port it replaces did; and the five boats stopped drawing ports
altogether.

**The menu plate is slow, and it was slow before this.** A hundred milliseconds a frame is ten frames
a second for the biggest ship in the game, on a model that is built once and cached: the cost is
transforming, sorting and filling every face, every frame, and a first rate has a great many. It
wants a look, and it wants one whatever happens to her gunports.

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

**Hull** is a coin a point, and by nothing else. No base, no rate and no share of anything. What she
pays is exactly what the damage she is undoing was worth to the ship that dealt it, which puts both
halves of a round's economy in the same currency and lets a captain read her own hull bar as a price.

It stops at four fifths of her, `HULL_PATCH_CAP`. A carpenter at sea works out of the hold: he plugs
shot holes, fishes a cracked timber and pumps her out, and sound planking and freshly paid seams are a
slipway's work. So the last fifth is not dearer, it is unbuyable, and a ship that has been in a fight
carries it until the voyage ends. That is the difference between the hull and the rig, which is why
the mast beside it does go back to whole: a mast is a spar to be swayed up, and a hull is the ship
herself. Damage above the cap is never quoted and the hull is never clamped anywhere else, so a
captain who has taken nothing is never pulled down to it, and the hull bar carries a hairline at the
cap so a bar that will not fill says why on itself.

Because the bill is her damage and nothing else, it scales with the class she is sailing without a
scaling term anywhere in it. A hull with 250 points to lose can run up a bill of 200, four fifths of
her; a cutter with 90 can never be charged more than 72. That property holds for whatever the fleet turns out to be, so
classes carrying far more than a hundred points need nothing added for their repairs to cost more. It
is not yet visible in play, because every ship in a fight still carries the same stock hull.

A ship barely scratched pays almost nothing, so there is no wrong moment to repair, and a captain who
cannot cover the bill buys as much of it as her purse reaches rather than being refused. The button
goes dead for two different reasons and says which: `Sound` where she has taken nothing worth mending,
`Yard work` where what is left of the damage is past a carpenter.

**Mast** is flat and puts the rig back whole. A mast is stepped or it is not: no half a mast, so no
half price and no part payment, and the charge is the same whether she lost the whole thing or sprung
it. What sets it is the rig she carries rather than the damage she took, at `RIG_REBUILD_SHARE` of
what her whole rigging is worth. That figure lives in `shipyard.js` rather than in the fight, because
it is derived from shop prices and moves the moment one of them does: `mastRebuildCost(loadout)`. It
runs from 12 coins for the starter's free pole and one topsail to 911 for a fully found frigate, which
is the intended shape. Because `speedCap` and `turnCap` both read how much of her rig is standing, a
rebuilt mast hands her back full sail in the same instant, and that is what makes it worth the money:
losing a mast is the one hit that takes a ship out of a fight while leaving her afloat.

Every hull in a fight brings her own rig now, so the bill is hers: about 34 coins for the starter's
sprit mast and one sail, and 2,600 for a fully rigged third rate.

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

- ~~No shipyard screen.~~ Built, and built against a finished model, which is what waiting bought: the
  Boat Commission and the Rigging Outfitter are two doors off the yard, and both are UI over calls
  that already existed. Nothing in `hold.js` changed to make them work.
- ~~**The fight still does not read the catalogue.**~~ Done. `rate()` feeds `speedCap`, `turnCap`,
  both gun damages, the volley's shape and all three bars, and every mode issues from `STOCK`.
- ~~No per-class hulls, and so no per-class size.~~ Built: `hullform.js` models every class from her
  reference row, menu and sea alike, and her size and collision ellipse come with the model. There is
  still no size figure in the catalogue, which is why none can go stale.
- No sail designs or cloth patterns. Those hang off ids without touching any of the numbers here.
- No selling parts back. Easy to add; wanted a decision on whether it refunds in full first.
- ~~**No hull blurbs.**~~ The sixteen classes at sea each carry one now, written with the fleet rather
  than invented for the rows that had none. `blurb` remains an optional column and the shops still
  sell a class on her figures; the line is there for a card that wants prose. None of them has been
  read at 1x yet.
- **No mortars, and so no vertical fire.** A bomb vessel's real weapon is two mortars that lob over a
  shore, which is a second kind of weapon rather than a row in `data/guns.tsv`: it wants an arc, a
  fall of shot and a mount that is not one of the three she bears. She sails with her 3 guns a side
  meanwhile, which is what the reference gives her broadside anyway. A future consideration.
- ~~**Swivel quality.**~~ Built: three grades on the rail, and what quality buys is a volley that
  hits harder and groups tighter, never one more ball. See below.

### What a better swivel is to buy

A swivel adds one ball to the volley whatever it cost. What quality buys, and how many quality swivels
she carries, is that the volley **hits harder and groups tighter off the bow**. Nothing does either
yet, but all three figures already exist in the fight, and they are all constants:

| | where it is now | what it becomes |
|---|---|---|
| count | ~~a flat six~~ `rate().muskets`, done | 1 on a yawl to 14 on a first rate |
| damage | `musketDmg()`, a flat `3.2` | what one ball does, off the swivels aboard |
| spread | the `0.8` in that same line, an arc in radians | tightened by swivel quality and number |

The count is done, which was the one worth doing on its own: it was close to a bug, since a
flat six balls for every hull afloat meant a cutter and a galleon threw the same volley, so the
`Muskets in a volley` figure the yard screen prints is a promise the fight does not keep. It also
means the musket half of `measure()` is calibrated to nothing in particular — `MUSKET_DPS` of 2.4 a
musket puts a 12-musket galleon at 28.8 against the fight's real 25.6, and a 2-musket cutter at 4.8
against the same 25.6.

One trap in the spread. That `0.8` has `noise` added to it, which is the AI's own aiming error and is
zero for the player. Tightening the spread must leave `noise` alone, or better swivels aboard the
player's ship would quietly make every rival captain a better shot as well.

**All three rows are done now.** `rate()` returns `musketDamage` and `musketSpread` beside the count,
and the fight reads all three off the loadout with `noise` left untouched. One ball's damage is the
average over what actually throws it: a hand's musket carries `MUSKET_BALL` (3.2, the flat the fight
used to hard-code) and a swivel carries its own catalogue `damage`, so a plain rail is exactly what
it always was and every swivel aboard pulls the figure up. The spread averages the same way over
`group`, a new column in `data/guns.tsv` that is blank on every mount but the swivel: a musket keeps
the whole `MUSKET_ARC` and a swivel holds its own `group` share of one, so quality and number both
pull the volley in and the hands keep it from ever closing to a point. When the 14-ball cap bites the
hands give way and every swivel still fires, because a mounted gun does not queue for elbow room —
which is also what keeps a bought part from doing nothing, the trap the half-musket fell into.

Three grades on the rail now: the swivel gun, the bronze swivel and the long swivel, told apart by
`damage` and `group`. `measure()` multiplies the count by `musketDamage` at `MUSKET_VOLLEYS` a second
rather than by its old flat `MUSKET_DPS`; the pace is set so a plain ball still measures the 2.4 a
musket the blend was placed with, and only better iron on the rail moves a ship's strength.

## Rates, the stock fleet, and what each mode does with them

Every mode issues **stock ships**. Who a captain meets is her **rate**; the order they arrive in is
**measured strength**. Those are two different questions and the code answers them separately.

**A rate is her ports, counted as the navy counted them:** her broadside, both sides, so a hull
pierced for fifty a side is a hundred-gun ship and a first rate. Chasers and swivels are no part of
it, which is why every band edge is a whole number of guns a side. `RATES` holds the eight rungs,
`gunsBorne(hull)` counts them and `rateOf(hull)` places her. It is read off `guns.broadside` and
never written down anywhere, so a class cannot be handed a rating her ports do not support.

**Strength is still measured off the stat line**, and it is not the rate: a first rate with half her
ports empty is a first rate, badly found. `measure()` takes what `rate()` already says about a
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
It orders the stock ladder, matches the derby, and is the figure the yard prints beside her rating.

The eight rungs, and every one of them occupied by the fleet as it stands:

| Rung | Guns borne | Classes |
|---|---|---|
| Unrated light | up to 10 | Gundalow, Bermuda Sloop light, Sloop light, Cutter light |
| Unrated heavy | 11 to 19 | Baltimore Clipper, Brigantine, Xebec light |
| 6th rate | 20 to 31 | Corvette, 6th rate |
| 5th rate | 32 to 49 | Xebec heavy, 5th rate |
| 4th rate | 50 to 63 | Heavy frigate, 4th rate |
| 3rd rate | 64 to 89 | 3rd rate |
| 2nd rate | 90 to 99 | 2nd rate |
| 1st rate | 100 and up | 1st rate |

The rungs were numbered and nameless before, and the reason was good while a rung was a band of
blended strength: eight names had to be read against one another to mean anything, where `tier 6`
sorted itself. A rate is the navy's own word for the same ship and arrives already meaning something,
and the two unrated rungs below the rated six are where most of a career is spent.

**`STOCK` is the fleet the game issues**, and it is generated rather than written out. Every class
appears at three standards, plain, well found and fully found, built by `fitOut(hull, quality)`; a row
may still carry a hand-written `rig` and `guns` where a class wants a fit of her own, and `resolve()`
handles that one exactly as it handles the player's ship. 16 classes at three fits is 48 opponents,
which is not a table anybody keeps in step by hand: two hand-written fits per class would drift out of
step with the parts table every time a price moved, and every entry is a chance to name a sail that no
longer fits the berth it was written for. The bench checks the hand-written ones for exactly that.

Nothing declares a rate or a rung. A rate comes off her ports and her place in the ladder off her
stat line, so neither can be written down to disagree with the ship it describes, and `npm run catalogue` prints the whole
ladder in ascending strength.

The overlaps are the point and they come out of the numbers rather than being placed. A fully found
cutter outranks a plain brig-sloop. And the two measures genuinely disagree: under gunfire a galleon
towers over a xebec, while as ramming stock they are far closer, and a ship's guns are dead weight in
a match where nobody fires.

**The bands are gun counts now, so they do not need rebanding as `measure()` moves.** That was the
standing worry while the rungs were strength bands: `overall` runs from about 49 to 1090 across the
current fleet, and any change to the musket curve or the volley moved every edge. A rung
is a count of ports, and ports do not move when a formula does.

### What each mode is to do with it

- **Arena** climbs the ladder. Open on the weakest rung and work up through the stock fleet, so the
  mode escalates by putting harder ships on the water rather than more of the same one. `ladder()` is
  that list, in ascending strength.
- **Demolition derby** fields ships of similar stats, matched on `ram` rather than on rate, because a
  rate is a count of guns and nobody in that mode has one aboard. `peers(strength, tol, "ram")`.
- **Free-for-all** fields stock ships of her own rate: `stockOfRate(rung)`. Ships of her own sort of
  ship at every standard of fitting out, which is equal without being identical.
- **A ranked free-for-all**, later: win a rung to move up against the next. The ladder and the bands
  are the same ones, so this needs no new model, only a record of the highest rung a captain has won.

All of it is wired. A starting captain in a gundalow meets sloops and cutters at every standard of
fitting out; the same captain in a third rate meets third rates, plain, well found and fully found.
Neither field is written down anywhere: one comes off her ports and the other off her stat line. **She sails her own ship in every mode**, which settles the open question
below: the field is matched to her rather than her being issued a stock hull, because that is what the
measures were built to make possible and because being beaten in a ship you chose is the point.

## Room for forty classes, and now holding 16 at sea

The catalogue is built for a fleet of around 40 classes rather than the five it started with, and
three things had to change shape for that to be true. It holds 54 rows now, 16 of them at sea.

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

Buying and fitting are through the two doors under it, and they are two rather than one because they
are different decisions: a hull is a rare purchase a captain saves for, a rig is a dozen small ones,
and one screen would bury the second in the first.

### The Boat Commission

The hull shelf, arranged four ways, because a captain shopping for a hull is asking one of four
different questions: **all by price**, by **price range**, by **masts**, and by **sails needed**.
Price is the tie-break through all of them, so every group climbs the same way.

The fourth is worth a note, because it is not what it was first asked for. "Group by sail types
needed" is not a question this model can answer: which CATEGORIES a hull wants is decided by the mast
a captain steps in her, not by the hull, and both honest readings of it collapse (28 of 38 classes
land in one group by what their sockets could take, 23 by what they carry fully found). What a
shopper is actually asking is what it will cost to bend canvas on her, and that IS a fact about the
hull: a class with seventeen berths is a fortune to fill however cheap she was to buy. So the shelf
groups on the number of sails a full rig wants, which comes out 6, 6, 6, 9 and 11 across the bands.

A row opens rather than opening a screen, so two classes can be compared without leaving the list.
Open, it is her whole stat line at both ends: what she is bare, which is what the coins actually buy,
and what she becomes fully found, which is what the outfitter will charge for afterwards. Handling is
printed "1.16 down to 1.05" rather than as a plain range, because it runs backwards and a range that
falls reads as a mistake.

Commissioning her makes her the ship you sail. Leaving the old one active would point the outfitter at
the wrong hull, and the list of ships below switches back in one tap.

### The Rigging Outfitter

Masts, sails and guns for the ship she is sailing, with a toggle at the head rather than two doors,
because filling out a new hull means moving between them a dozen times.

Every slot is a row that opens on what could go in it, and **what she already owns is in the same list
as what the shop sells**, told apart by their right-hand ends: a part in the hold reads "1 in the
hold" in green and costs nothing, a part in the shop reads its price. That is the whole difference
between them, so they are one list rather than two a captain has to compare. Spare rigging off a ship
she no longer sails is the reason instances move between hulls at all, and this is where it shows.

The rows say what a part *does* rather than what it is called: a mast lists the sails it will carry, a
sail what it pulls and what it costs the helm, a gun what it throws and how fast.

**A battery is bought and stripped by the battery.** Fifty ports a side is fifty taps through a
picker, and fifty rows in the fitted list all saying the same three words. So guns of one sort are
one row with what she has of them, "take one off" and "take them all off" beside it, and there is a
"fill her empty ports" row that puts one gun in every one of them, out of what she already owns
first and then out of her purse until it runs out. Masts and sails stay one slot to a row: a rig is
a different sort of choice, and every socket on her takes something different.

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

### The same tables as a spreadsheet

Forty-six columns across thirty-eight classes is a lot to hold in a text editor, and comparing two
figures eight columns apart is exactly what a spreadsheet is for. So the four tables also travel as
one workbook:

```
npm run workbook       writes data/ships.xlsx from the four tables
                       edit it in Numbers or Excel, export back over the same file
npm run workbook:read  writes the four tables back from data/ships.xlsx
npm run import && npm run catalogue
```

**The TSVs remain the source.** The workbook is a way of editing them and nothing reads it: `import`
still reads the tables, the tables are what git diffs, and a change that never comes back through
`workbook:read` never happened. Two sheets ride along in front of the four: a Read me carrying each
table's comment block, because that is where the columns are documented and a spreadsheet has
nowhere else to put it, and a Columns sheet that is the legend.

**The legend is parsed, not written.** Every column is already documented at the head of its own
table as `# name  what it is`, so the Columns sheet reads those definitions rather than keeping a
second set to disagree with them, and `npm run workbook` reports any column nothing has said
anything about. Its third column, whether a figure is read by the fight, by the drawing, or by
nothing yet, comes from asking `hullform.js` which reference fields it actually touches: a list kept
here would go stale the first time somebody drew a hull from her deadrise. The `(drawn)` marks in
`hulls.tsv` are checked against that same answer and reported when the two fall out of step.

Reading back is deliberately narrow. It takes the four sheets by name, matches columns by their
header so they may be reordered, skips blank rows, and keeps a figure spelled the way the table
spelled it, so a height of `0.60` survives a trip through a program that thinks it is 0.6 and a round
trip with no edits in it produces no diff. A formula comes back as the value it worked out. Colour,
comments, extra sheets and extra columns are not read at all.

What it checks is what the importer and the bench cannot say clearly: a missing column, a row with
figures and no id, two rows sharing one, an id that is not a plain word (ids become object keys, so a
space in one writes a source file that will not parse). Nothing is written unless every sheet is
clean. Then it warns if a row `STARTER` names has been deleted, because a first ship that cannot be
built is a fault nobody meets until a new captain opens the game.

`tools/xlsx.mjs` writes and reads the .xlsx itself, in about three hundred lines over `node:zlib`.
An .xlsx is a zip of XML and the repository has six packages in it; a workbook opened twice a month
is not a seventh.

### What the fleet needed

They are in. `data/hulls.tsv` carries one row per class, sailing or laid up, and the gameplay columns
are derived from the reference figures beside them: hull points from the timber formula, crew from her battle
complement floored at 25, `speed` from her working speed under sail, `hand` from the handling
components less the rig and the crew (her sails carry the rig half themselves), `canvas` as
displacement to the two thirds, and `tons` the same way, moved by how fine she is. Prices came off
measured strength afterwards.

The original note, for whoever adds the next class: she needs a name, a price,
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
a code change, and the bench catches a berth whose category is a typo. Every berth-filling category
draws in a shape of its own now: `LSQ` and `SSQ` as square canvas, `TRI` and `LAT` as the triangle,
`GAF` as the four-sided sail on a gaff abaft the mast, and `LUG` on its slung, raking yard. The two
fore-and-aft quads stack in the air of the square bands, so a topsail of either sort sits over its
mainsail; a mast carrying nothing but fore-and-aft canvas stretches the stack up the pole the way a
lateen takes its whole band; and a driving sail's boom stays down at the deck and stops where the
quarterdeck wall or the next mast astern would meet it. The bench still prints which categories fall
back to square canvas, which is now none.

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
2. ~~**Where the tier bands fall.**~~ **Settled.** Eight rungs, and **the edges are geometric**: evenly
   spaced in ratio from the weakest stock ship to the strongest rather than in plain steps. `measure()`
   blends its parts geometrically, so a fixed multiple of strength is what one rung ought to mean
   across a fleet running a factor of fifteen, and 75 to 105 is the same step up as 405 to 565.
   Occupancy over the 114 stock ships comes out 18, 17, 18, 19, 12, 14, 10 and 6, thinning at the top
   because only a handful of classes reach it. Still nothing about how a fight actually plays has gone
   into them, which is the part that wants the fight wired first.
3. ~~**Does the player's own ship sail in every mode, or only some?**~~ **Settled: every mode.** The
   field is matched to her instead, which is what the measures were built to make possible, and being
   beaten in a ship you chose is the point of choosing one. Free-for-all fields her own tier, so the
   fight is equal without being identical; the derby matches on `ram`, because `overall` counts guns
   nobody in that mode has aboard; arena aims a shade under her and raises the bar with every sinking.
4. ~~**How big should the classes actually get?**~~ **Settled, with the compression the worry asked
   for.** Real lengths run a factor of nearly nine and the sea is 2000 across, so both views raise
   the size ratio to a power below one, anchored on the galleon: at sea the fleet runs from a 16-unit
   launch to a 52-unit first rate around the 36 every hull used to share, and the collision ellipse
   is each hull's own drawn size. Whether the big rates are now too big a target is a balance
   question for play, and the lever is `SEA_POW` in `hullform.js`, one number.
5. ~~**Stations and sizes beyond the three of each.**~~ **Settled.** Five stations, `bowsprit` `fore`
   `main` `mizzen` `bonaventure`, and five sizes, `boat` `small` `medium` `large` `heavy`. The
   bowsprit is a station rather than a flag, which is what gave headsails somewhere to live; it takes
   a *spar* rather than a mast, and `mastFitsSocket` matches the sort of thing before the size rung so
   a jibboom cannot be somebody's main mast.
6. **Should the derby have repairs?** It has none today, because "only one hand needed" is that mode's
   whole promise and a rail is a second thing to think about. But trading coins for crew after a spell
   in the storm is a genuinely good decision, and the derby is the mode that pays by the second.
7. ~~**The crew divisor.**~~ **Settled, and it is not a divisor.** Crew runs from a dozen hands to nine
   hundred and fifty, a range of eighty, and one musket a head or anything near it ends with a
   three-decker throwing a volley nobody can count. So the count goes as the SQUARE ROOT of the crew:
   a ship twice manned does not put twice the muskets over the rail, because only so many of them fit
   at it. Twelve hands buy the first, which gives a yawl one, a brig three, a heavy frigate six and a
   first rate eight before a swivel is aboard. The volley is capped at 14 including swivels, and the
   swivel bearings in `data/hulls.tsv` are set so the biggest ships reach exactly that with every
   swivel mounted: a swivel that adds nothing is a swivel nobody buys, which is the same trap the
   half-musket fell into.
8. **Diminishing returns past a third sail** are reachable now, and untuned. Four and five berth masts
   exist, so a fore-mast royal keeps 34% of its drive and a skysail 20%, against 58% and 34% on the
   main. That is the rule working as written; whether those are the right numbers has never been
   played. A skysail at 0.12 drive and 20% falloff is worth 0.023, which is a sail bought for the look
   of it, and that may be exactly right.
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
12. ~~**Tier names.**~~ **Reopened and settled the other way: the rungs are rates, and rates have
    names.** A nameless number was right while a rung was a band of blended strength invented for this
    game. It is wrong now that a rung is a count of guns borne, because that is the navy's own rating
    and it already has the names: a captain arrives knowing roughly what a third rate is, which is
    more than `tier 6` ever told her. The yard screen reads "Cutter light, Unrated light, and she
    measures 115 as she stands"; the shop card reads "Rated: 6th rate". Both want checking at 1x.

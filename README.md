# Ship Battle Game — Broadside

Pirate ship combat on a tilted (isometric-ish) sea, rendered to a single HTML canvas from React.
`src/BroadsideIso.jsx` is the whole game and serves as the base for further development.

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

- **Arena** — endless survival against a growing swarm. You open with 50 coins and one hunter on the
  water, matched to your ship gun for gun and reload for reload. Kills bring reinforcements in from
  the edge of the map, spawned well clear of your bow: one for the first kill, then 1-2-1-2 through
  the fourth, then two for every kill after that up to the fleet cap. The second ship of a wave holds
  off five seconds before it sails in. Enemies always spawn at base strength and never upgrade, so
  the pressure comes from the count. Score by ships sunk.
- **Demolition derby** — ten captains and not a gun between them. Hulls are broken open by ramming
  alone, there is nothing to buy, and a squall closes on the middle of the sea. Last afloat wins.
- **Free-for-all** — up to 10 rival captains starting equal. The AI upgrades like a real player, hunts
  whoever is weakest, and gangs up on a runaway leader. For the first `OPENING_WINDOW` seconds it
  simply takes the nearest hull, since nobody has a reputation yet. It also fires on ships it is not
  hunting when one drifts into a weapon's arc, with a per-captain pause afterwards so the sea isn't
  wall-to-wall powder smoke. Last afloat wins.

AI ships reload on exactly the same cooldowns as the player in every mode that has guns; their only
handicap is a touch of spread on every shot.

A mode is a row in the `MODES` table rather than a name to compare against — `melee` (is every hull
hostile to every other, or only the player's), `ranked`, `lastAfloatWins`, `reinforcements`, `guns`,
`upgrades`, `flees`, `storm`, plus the field size and opening purse. The simulation, the HUD, the
menu cards, and the end screen all read those rules, so a new mode is a new row rather than a dozen
scattered checks that have to be taught about it.

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

The clock that asks *am I getting anywhere with this?* runs against whichever hull a captain is
engaged with, the one she is chasing and the one charging her alike. A chase she is not winning after
`STALL_PATIENCE` seconds, and she takes the way off her and comes round inside instead — a slow hull
turns far inside a fast one, so easing the throttle is what lets her cut the corner and force the
meeting. A face-off she is not winning after `FACEOFF_HOLD` seconds, and she puts the helm over:
`SHEER_ANGLE` off the other ship's bearing for `SHEER_TIME`, which buys sea room for a fresh run.

That second case is why the clock covers both. Turning to meet a charge is right — showing your beam
is how a hull gets staved in — but two captains who both do it settle into a mutual circle, full sail,
both bows pointed inward, closing at a couple of paces a second. Measured before the cap existed:
locks of 51, 68 and 76 seconds with not a blow landed either way, because a ram needs closing speed
and a circle has none. Patience is scaled by each captain's nerve so no two blink at the same moment —
if they did, the pair would break as one and fall straight back into the same circle. Blinking has its
price, of course: she shows her beam to get the bow round, and a captain who reads it can make her
pay for it.

## The hold

Coins sit at two depths, and keeping them apart is the whole of it:

- **A ship's purse** is what she carries into one battle. It buys her upgrades at sea and goes down
  with her. Arena opens one at `ARENA_START_COINS`; the other modes open at nothing. This is the
  number in the HUD.
- **The hold** (`src/hold.js`) is the captain's, not the ship's. Every voyage that reaches an end
  screen banks what it *earned* — 25 a kill and one a point of damage dealt, a rammed hull included —
  and the total carries across every mode alike and through a reload, kept in `localStorage` under
  `broadside.hold`.

Banking counts earnings, not leftovers, so an upgrade bought at sea costs nothing ashore and there is
never a reason to sit on coins you could be fighting with. A voyage banks whether you win it or sink:
coins are earned by fighting, and a captain who fought well and went down anyway earned them the same.
Only a round abandoned mid-fight — a reload, a closed tab — banks nothing, because nothing ended.
Arena's opening purse is a loan against the round rather than earnings, so it never reaches the hold.

The stored record is wider than the coin count on purpose: lifetime voyages, ships sunk, damage, time
afloat, and per-mode bests, because a stat not recorded from the first voyage can never be backfilled.
It is read through a small API rather than touched directly — `getHold`, `bankVoyage`, `spendFromHold`,
`resetHold`, `subscribeHold` — and a record written by an older build is folded field by field onto a
blank one, so an added stat never costs anyone their coins and a corrupt field costs only itself. If
`localStorage` refuses (private browsing, a full quota) the hold falls back to memory for the session
instead of failing.

Nothing spends from it yet. `spendFromHold` is the door the rest of it comes through: it refuses
rather than overdraws, and keeps `spent` alongside `coins` so the two always reconstruct what was
earned. `HOLD_SHARE` scales what a voyage deposits if the meta economy ever wants slowing down without
touching the fight.

## Controls

Pointer/touch driven, so it works the same with a mouse or on a phone:

- **Virtual joystick** (bottom left) — steer and throttle.
- **SIDE / FRONT / MUSKET** (bottom right) — hold to fire; each has its own cooldown, range, and
  damages a different system. Absent in a mode that carries no guns.
- **Upgrade rail** (top) — spend gold across MAST, HULL, CREW, SIDE, FRONT. Costs scale `45 × 1.55^level`.
  Absent in a mode with nothing to buy, which leaves the stick as the only control on the screen.

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
src/BroadsideIso.jsx  # game: simulation, canvas renderer, and UI
src/galleon.js        # the galleon turning on the menu
src/hold.js           # coins and records that outlive a single round
vite.config.js
```

`galleon.js` defines the hull as 3-D stations and re-projects it to isometric on
every frame, so the menu ship genuinely turns rather than cycling sprite frames.
`drawGalleon(ctx, w, h, deg)` draws one bearing; the pivot is the hull centre at
the waterline, so the ship holds the centre of the box as it comes about. It
honours `prefers-reduced-motion` by holding a three-quarter view instead of
turning.

The game has no dependencies beyond React — all rendering is hand-rolled canvas drawing and all UI is
inline-styled, so `BroadsideIso.jsx` can be dropped into any React app as-is.

### Tuning constants

The balance knobs sit at the top of `src/BroadsideIso.jsx`: `WORLD` and `TILT` for the arena and
camera, `BASE`/`HP_GAIN` for the health pools, `WP` for per-weapon cooldown, projectile speed, and
lifetime, `RAM_*` for ramming, and `TRACKS`/`COST` for the upgrade economy. `BASE_SPEED` is a fresh
ship's top speed and the yardstick the heavy rudder measures against; `RUDDER_HEAVY` is how much
rudder she loses at it and `RUDDER_CURVE` how late in the range the loss starts to bite — raising the
curve keeps more of her handling until she is truly running.

Arena pacing has its own block: `ARENA_START` (hunters at the opening), `ARENA_RAMP` (reinforcements
per kill for the opening kills, two a kill after it runs out), `ARENA_SPAWN_CLEAR` (minimum distance a
respawn keeps from the player), `ARENA_MAX_ENEMIES` (ceiling on the swarm), `ARENA_SPAWN_GAP` (how long
the second ship of a wave holds off), and `ARENA_START_COINS` (the opening purse). `OPENING_WINDOW`
sets how long free-for-all captains fight whoever is nearest before they start picking their prey.
`HOLD_SHARE` in `src/hold.js` is the one knob on the economy that outlives a round.

The derby has its own block: `DERBY_AI` (rivals, so ten captains start) and the `STORM_*` constants
described above.

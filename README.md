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
- **Free-for-all** — up to 10 rival captains starting equal. The AI upgrades like a real player, hunts
  whoever is weakest, and gangs up on a runaway leader. For the first `OPENING_WINDOW` seconds it
  simply takes the nearest hull, since nobody has a reputation yet. It also fires on ships it is not
  hunting when one drifts into a weapon's arc, with a per-captain pause afterwards so the sea isn't
  wall-to-wall powder smoke. Last afloat wins.

AI ships reload on exactly the same cooldowns as the player in both modes; their only handicap is a
touch of spread on every shot.

## Controls

Pointer/touch driven, so it works the same with a mouse or on a phone:

- **Virtual joystick** (bottom left) — steer and throttle.
- **SIDE / FRONT / MUSKET** (bottom right) — hold to fire; each has its own cooldown, range, and
  damages a different system.
- **Upgrade rail** (top) — spend gold across MAST, HULL, CREW, SIDE, FRONT. Costs scale `45 × 1.55^level`.

Ramming is a real attack, resolved from the geometry of the collision rather than from who started it:

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
  damage out of hulls that are already touching.

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
| `crew` | muskets | musket output falls off |

## Layout

```
index.html            # Vite entry
src/main.jsx          # React root
src/index.css         # full-bleed, no-scroll page shell
src/BroadsideIso.jsx  # game: simulation, canvas renderer, and UI
src/galleon.js        # the galleon turning on the menu
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
lifetime, `RAM_*` for ramming, and `TRACKS`/`COST` for the upgrade economy.

Arena pacing has its own block: `ARENA_START` (hunters at the opening), `ARENA_RAMP` (reinforcements
per kill for the opening kills, two a kill after it runs out), `ARENA_SPAWN_CLEAR` (minimum distance a
respawn keeps from the player), `ARENA_MAX_ENEMIES` (ceiling on the swarm), `ARENA_SPAWN_GAP` (how long
the second ship of a wave holds off), and `ARENA_START_COINS` (the opening purse). `OPENING_WINDOW`
sets how long free-for-all captains fight whoever is nearest before they start picking their prey.

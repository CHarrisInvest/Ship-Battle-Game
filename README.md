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

Ramming is a real attack: close bow-first above the minimum closing speed to deal hull damage and
knock the target back. The ship that lands the ram drives through it: she is thrown far less than the
one that wears it, but her bow eats the impact and she loses nearly all her way, so a ram always costs
the attacker her speed and can't be leaned on repeatedly. The ship that is struck is shoved hard yet
carries on with some of her way. Two ships meeting bow to bow are both rammers and both take the full
impact. A slow bump is just a nudge.

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

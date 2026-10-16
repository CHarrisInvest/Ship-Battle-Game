# The three.js sea: design and module contract

Date: 2026-10-15. Branch: `claude/three-renderer`. Approach "A": one three.js scene, one ship model
everywhere.

## What it is

The Canvas 2D drawing of the fight is replaced by a three.js scene in a **soft toon** style:
smooth-shaded 3D lit in a few gentle cel bands (`MeshToonMaterial` on a 4-step gradient ramp), soft
shadows from one warm key light, a cool hemisphere fill, and stylized water with foam caps. The
palette does not change: `src/render/palette.js` and the timber casts from `hullform.js` are the
colours, so it is the same game with depth and light under it, not a new art direction.

The engine (`src/sim/`) is untouched. three.js is never imported from `src/sim/`, and
`npm run purity` would fail the day it was.

## The parts

### One renderer API, two renderers

`createRenderer3d(webglCanvas, overlayCanvas)` in `src/render3d/renderer3d.js` returns the API the
2D `createRenderer(canvas)` always has: `resize(hudRect)`, `follow(ship, alpha)`,
`render(world, fx, { live, input, alpha })`, `under(rect, world)`, `tick(dt)`, plus `dispose()`.
`SternchaseIso.jsx` creates it once in the frame loop's effect and the loop itself is unchanged.

**Fallback.** `createRenderer3d` throws at once when the browser cannot give a canvas WebGL (tested
on a throwaway canvas before either real one is touched), and the screen then builds the 2D renderer
on the overlay canvas, which the 3D renderer only takes after its own WebGL canvas is standing. This
is a capability test, not per-visitor content: every browser that can draw it gets the same picture.

### The overlay

Marks for the captain to read stay flat and crisp on a transparent 2D canvas stacked over the WebGL
one (`pointer-events: none`, `touch-action: none`, same box): the bars, rank and name over each
rival, the aiming guides, the words off a sinking (`fx.texts`), the storm's edge, the vignette and
the radar. They are not rewritten: `src/render3d/overlay.js` holds the one copy and **the 2D renderer
draws with it too**, so a bar sits over the same hull in both.

### The camera, matched to the pixel

The 2D sea is a tilted orthographic view: world `(x, y, z)` lands at
`((x - cam.x) * zoom, ((y - cam.y) * TILT - z * ZUP) * zoom)` CSS pixels, with `TILT = 0.6` and
`ZUP = 0.8`. That is exactly an orthographic camera looking up the screen and down at
`asin(TILT)` (about 37 degrees) below the horizon, frustum `Vw` by `Vh` world units hung from the
top left of the screen. `src/render3d/camera.js` builds it; `npm run camera-check` projects points on
the water and up a mast through it against the 2D formula on five screens and five positions and
fails on a hundredth of a pixel. The follow, the edge clamping (`SIDE_PEEK`, `EDGE_PEEK`), the square
and `under` were moved into `src/render/view.js` (`createView`, `sizeView`, `followView`, `blend`,
`shipUnder`) and both renderers call them, so play feel, aiming and the rail's fade are one piece of
arithmetic.

**Axes.** Engine `(x, y, z)` is three `(x, z, y)`: three Y is up, three Z runs down the screen
toward the viewer. `toThree(x, y, z)` in camera.js is the one place the swap is written. One world
unit is one three unit.

### One ship model

`buildShip` in `galleon.js` has always built a real 3D face list from the class's form and her rig
spec. `src/render3d/shipmodel.js` turns that same list into GPU geometry, and it is **the** ship: at
sea (scaled to her sea length) and on the menu (in menu units). Every class keeps her own hull,
timber, ports, castles and rig because they come from the same `rigSpec` and `hullForm`.

- Faces are convex polygons, fanned into triangles, coloured per vertex from the face colour, with
  normals smoothed across seams flatter than 38 degrees so a hull rolls into bands instead of facets.
- A double-sided face (canvas, flags) is emitted twice, the back reversed in its own back colour,
  so every material is front-sided and shadows work from both sides.
- With a depth buffer, drawGalleon's painter's tricks (`bias`, `sink`, `nearW`, the short spar
  segments, `cull`) are simply not read.
- galleon.js now tags each face with a `part` ("mast0" foremost, "mast1", ..., "bowsprit" for the
  spar, "sprit" for what is set on it, none for the hull), so each is its own mesh and a mast can
  come down on its own. `shipFaces(spec)` is the new export that hands the list over. drawGalleon
  and every export `tools/catalogue.mjs` reads are unchanged.
- Scale at sea: `hullForm(id).sea.L / (2 * menu.Lh)`, which is 0.3 for the galleon (120 menu units
  long, 36 at sea). Her beam comes out at her sea `W` to within a few hundredths, so the model
  matches her collision ellipse.

### Quality tiers

`pickQuality()` in renderer3d.js picks from what the device says it can do: a touch device with
fewer than 6 cores, or any device reporting under 4 GB, draws **low**; everything else **high**.
Nothing about who or where the visitor is enters into it.

| | high | low |
|---|---|---|
| shadows | PCF soft, 2048 map | none |
| antialias | yes | no |
| WebGL pixel ratio cap | 2 | 1.5 |
| `particles` share | 1 | 0.5 |
| `water` | "full" | "simple" |

The overlay keeps the 2D renderer's cap of 2 so its text stays sharp. The goal is 60 fps on a mid
phone.

### Lifetime

Ship geometry is cached per (spec, units, scale) and shared by every instance, bounded at 32 builds.
Materials are cached per option set in `toon.js` and shared. `dispose()` on the renderer disposes
every layer, the ship cache, the toon cache and the WebGLRenderer. It deliberately does not force the
context lost: React's StrictMode mounts the effect twice in development, and the second mount takes
the same canvas.

## MODULE CONTRACT

Six owners build in parallel on this commit. Signatures below are exact; a change to any of them is
a change to this document first.

### The shared `ctx`

Built once by renderer3d.js and handed to every layer factory. Read its members; never replace them.
`view` and `dt` change in place every frame.

```js
ctx = {
  THREE,            // the three namespace, so a layer need not import it (it may)
  scene,            // THREE.Scene
  renderer,         // THREE.WebGLRenderer
  camera,           // THREE.OrthographicCamera, already synced to `view` before any layer updates
  view,             // the view.js view: { Wd, Hd, dpr, zoom, Vw, Vh, Vsq, safe:{l,t,r,b}, cam:{x,y} }
  quality,          // { tier: "high"|"low", shadows, shadowMapSize, antialias, pixelRatio,
                    //   particles: 1|0.5, water: "full"|"simple" }
  sun,              // the key THREE.DirectionalLight (castShadow on the high tier)
  clock,            // { t }: seconds of drawing, advanced by tick(dt)
  dt,               // the last frame's dt in seconds (capped at 0.05 by the loop)
  palette,          // C from src/render/palette.js
  aiColors,         // AI_COLORS from src/render/palette.js
  toon: {
    material(opts), // toonMaterial: shared MeshToonMaterial on the ramp (see toon.js)
    flat(opts),     // flatMaterial: shared unlit MeshBasicMaterial
    ramp(),         // the shared gradient DataTexture
    color(hex),     // THREE.Color from sRGB hex
    LIGHTING,       // the key and fill figures the look is tuned under
  },
  shipModel,        // shipModel(spec, { units, seaLength }) from shipmodel.js
  lookOf,           // lookOf(fx, s) from src/render/effects.js: fill, stroke, cols, flash, roll, rollPhase, ...
  blend,            // blend(s, alpha) -> { x, y, h }: where a ship is drawn between steps
  toThree,          // toThree(x, y, z = 0, out?) -> THREE.Vector3(x, z, y)
  ground(pad = 0),  // the water on screen in engine units: { x0, y0, x1, y1, cx, cy }
}
```

Per frame, renderer3d.js does, in order: sync the camera to the view, place the key light and its
shadow camera over the view, `islands.update`, `water.update`, `ships.update`, `effects.update`,
render the scene, then draw the overlay.

### src/render3d/renderer3d.js — foundation (done)

- `createRenderer3d(webglCanvas, overlayCanvas, { quality }?) -> { resize(hudRect), follow(ship, alpha), render(world, fx, { live, input, alpha }), under(rect, world), tick(dt), dispose(), kind: "3d" }`
- `pickQuality() -> quality`
- `webglAvailable() -> boolean`
- Owns the WebGLRenderer, scene, lights, camera, quality, overlay canvas, and the layer calls.

### src/render3d/camera.js — foundation (done)

- `createCamera() -> THREE.OrthographicCamera` at the sea's pitch (`PITCH = -asin(TILT)`)
- `syncCamera(camera, view) -> camera`
- `toThree(x, y, z = 0, out?) -> THREE.Vector3`
- `viewGround(view, pad = 0) -> { x0, y0, x1, y1, cx, cy }`
- `projectThree(camera, view, vec3) -> [px, py]` (CSS pixels; for checks)
- Re-exports `TILT, ZUP, createView, sizeView, followView, blend, toScreen, SX, SY` from view.js.
- Checked by `npm run camera-check` (`tools/three-camera-check.mjs`).

### src/render3d/toon.js — foundation (done)

- `TOON_STEPS = [0.42, 0.62, 0.84, 1.0]`, `toonRamp() -> DataTexture`
- `toonMaterial(opts) -> MeshToonMaterial` (shared). `opts`: `color` (sRGB hex or Color),
  `vertexColors`, `side`, `emissive` (hex, a light floor), `transparent`, `opacity`, `depthWrite`.
  A string is shorthand for `{ color }`.
- `flatMaterial(opts) -> MeshBasicMaterial` (shared; `color`, `vertexColors`, `transparent`,
  `opacity`, `depthWrite`)
- `color(hex)`, `LIGHTING`, `disposeToon()`; re-exports `C`, `AI_COLORS`.
- **Shared means shared**: clone a material before changing it for one object, and dispose the clone.

### src/render3d/shipmodel.js — foundation (done)

- `shipModel(spec, { units = "sea", seaLength }?) -> { group, parts: { hull, bowsprit, sprit, masts: [mesh...] }, materials, scale, height, length, beam, key, dispose() }`
- `shipMaterials() -> [timber, canvas, flag]` (shared toon materials, the mesh group order)
- `clearShipModels()`
- `spec` is `rigSpec(loadout)` from shipyard.js, or null for the galleon.
- **Model frame**: three X toward her bow, three Y up from the waterline, three Z abeam (engine +v,
  starboard); origin amidships at the waterline. To sail her at engine `(x, y)` on heading `h` with
  heel `roll` (as the 2D renderer rolls her): `group.position.set(x, 0, y)` and
  `group.rotation.set(-roll, -h, 0, "YXZ")`.
- Each mesh has material groups 0 timber (vertex colour), 1 canvas (vertex colour, light floor),
  2 flags (one colour: give a ship a clone of `materials[2]` to fly her livery). All meshes cast and
  receive shadows. `height` is the top of the rig over the waterline in the units asked for.
- Geometry is cached and shared; `dispose()` only detaches the instance.

### src/render3d/overlay.js — foundation (done)

- `drawOverlay(ctx2d, view, world, fx, opts, clock, labelOf)`: the whole overlay pass for 3D.
- Shared with the 2D renderer: `worldSpace(ctx2d, view)`, `screenSpace(ctx2d, view)`,
  `arcGuides(ctx2d, view, ship, alpha, input)`, `shipLabel(ctx2d, view, ship, { gx, gy, h, roll, topZ }, world, fx)`,
  `floatTexts(ctx2d, view, fx)`, `stormEllipse(view, world)`, `stormEdge(ctx2d, view, world, clock)`,
  `vignette(ctx2d, view, fx)`, `radar(ctx2d, view, world, fx, clock)`.

### src/render3d/ships.js — ships agent

- `createShipLayer(scene, ctx) -> { update(world, fx, alpha, dt), labelOf(s, alpha), dispose() }`
- Reads: `world.ships` (`id, alive, x, y, px, py, heading, pHeading, loadout, mastDown, spdCur,
  hullA, hullB, turnVel`), `fx.me`, `lookOf(fx, s)` (`fill`, `cols`, `flash`, `roll`, `rollPhase`),
  `fx` events already turned into `look.flash` and the `sunk` texts.
- Adds: one `shipModel(rigSpec(s.loadout))` per ship afloat, placed by `blend`, heeled by
  `look.roll + sin(look.rollPhase * 1.2) * 0.05` (the 2D heel), her livery (`look.fill`, gold for
  `fx.me`) on her flags and a trim, the white hit flash from `look.flash`, the masts and sprit struck
  on `mastDown` (a stump left), a sinking (she settles and lists rather than vanishing; keep her model
  a moment after `alive` goes false), the bow wave by speed, and her shadow (the sun's, on the high
  tier; a soft blob on the low).
- `labelOf(s, alpha)` returns `{ gx, gy, h, roll, topZ }`: her keel in view space (`SX`, `SY` of the
  blended position), heading, the heel as drawn, and `height + 6` of her model. The overlay hangs her
  bars from it.
- Stub in place: each ship as her model with heel and mast-down.

### src/render3d/water.js — water agent

- `createWaterLayer(scene, ctx) -> { update(world, fx, alpha, dt, clock), dispose() }`
- Reads: `ctx.view` / `ctx.ground()` for what is on screen, `ctx.quality.water`, `world.rules.storm`
  and `world.stormR`, `world.islands` (shore foam), `fx.wakes` (`{ x, y, life, max }`), `clock`.
- Adds: the sea surface (toon-lit shader plane, gentle swell, hashed foam caps that break on their
  own cycles as the 2D caps do), the deeper water past the map with the rope and buoys every 400 on
  the boundary, the storm's darkening outside `stormR` and its rain, the wakes, and foam where the
  water meets each island. The sea's colours are `C.water`, `C.waterEdge`, `C.shallows`,
  `C.beachRim`, `C.foam`. The water stays at three Y = 0 on average so hulls sit in it.
- Stub in place: flat open water over the arena and the deeper colour beyond.

### src/render3d/effects3d.js — effects agent

- `createEffectsLayer(scene, ctx) -> { update(world, fx, alpha, dt), dispose() }`
- Reads: `world.shots` (`{ x, y, vx, vy, r, kind }`, drawn `TICK * (1 - alpha)` back along the
  flight, at `3 / ZUP` over the water as the 2D sea drew them; drawn radius
  `r * (WP[kind].draw ?? SHOT_DRAW)`), `fx.parts` (`puff`, `ring`, `spark`, `muzzle`, with `x, y,
  life, max`, and `r0, r1, col, ang` where the kind has them), `ctx.quality.particles`.
- Adds: balls with their light and smoke trail, musket streaks, smoke puffs as soft billboards that
  swell and thin, muzzle flashes drawn over the smoke, rings and splashes on the water, sparks and
  splinters. Instanced; no per-particle meshes.
- Stub in place: shots as instanced dark spheres.

### src/render3d/islands.js — islands agent

- `createIslandLayer(scene, ctx) -> { update(world), dispose() }`
- Reads: `world.islands` (`{ x, y, r, verts }`: `verts[k]` is the radius at bearing `k / n` of a
  turn, as a share of `r`). Build once per `world.islands` array (it is new each round).
- Adds: the shallows bank (1.30 r) and beach rim (1.08 r), the sand with relief, the grass inland
  (0.72 r), and the planting from `genFoliage(isl.r, isl.verts, { rng: seedFrom(isl.x, isl.y, isl.r) })`
  in `src/render/foliage.js` as meshes (palms and bushes, instanced), all toon-lit and in palette.
- Stub in place: flat rings of shallows, rim, sand and grass.

### src/render3d/menuship.js — menu agent

- `createMenuShip(canvas) -> { resize(w, h, dpr), draw(spec, deg), dispose() }`: one turning ship in
  a box, framed as drawGalleon frames it (bearing 0 bow to the lower right, waterline amidships at
  0.71 of the height, the class's `menu.span` filling the width).
- Built on `shipModel(spec, { units: "menu" })` under an orthographic camera at drawGalleon's iso
  angle (view from `(1, 1, 1)` in menu axes), toon-lit, transparent background.
- Owns `MenuGalleon` in SternchaseIso.jsx (only that component), and moves `tools/icon.mjs` and
  `tools/promo.mjs` onto it, reading pixels from WebGL with `preserveDrawingBuffer` or `toDataURL`.
- Stub in place: the same API, painting drawGalleon on a 2D context.

## What is deliberately not in this pass

- The 2D renderer stays as the fallback and is not deleted.
- No post-processing (outlines, bloom). The bands and the palette carry the look.
- Context loss is survived by letting the browser restore the context; nothing is rebuilt by hand.

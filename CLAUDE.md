# Sternchase: Helm & Hull

An isometric age-of-sail combat game. Canvas 2D, React shell, no engine.

The game is Sternchase; `Helm & Hull` is the second line of the title and never stands alone. The
repository keeps its old name, `Ship-Battle-Game`, which is what the Pages URL and the Vite base path
are built from. `broadside` in the code is the side guns, not the old title, and stays.

- `src/SternchaseIso.jsx` is the game: state, AI, rendering, and the React HUD.
- `src/galleon.js` draws the rotating ship on the menu. It draws a rig rather than *the* rig:
  `drawGalleon(ctx, w, h, deg, spec)` builds whatever is stepped and bent on, and falls back to the
  galleon it was written around when given no spec.
- `src/shipyard.js` is the catalogue and the maths for buying ships and parts. Hulls, masts, sails
  and guns as data, what fits what, and `rate()` turning a set of them into the figures a fight
  reads. It holds no state, touches no storage and imports nothing, and it should stay that way.
- **A ship's tier is measured, never declared.** `measure()` derives it from the stat line `rate()`
  gives, so a fully found cutter outranks a bare brig and the two cannot disagree. A hull's `order` is
  its place on the shop shelf and is a different thing: do not match opponents on it. Nothing in
  `STOCK` carries a tier of its own for the same reason.
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
- `src/hold.js` persists coins, lifetime stats and the yard to localStorage. Nothing else is saved;
  worlds and islands are generated fresh every match.
- `src/achievements.js` is the achievement list, and **an achievement is a question asked of the hold,
  never a stored flag**: a `count(hold)` and a `goal`. So one added tomorrow credits what a captain
  did last week, and it can only ask what the hold actually keeps. Wanting one the record cannot
  answer means adding what it counts to `hold.js` first, then the achievement is a row.
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
- **A mast type is a shape of rig, not a station.** A mast carrying three square sails is that mast
  wherever it is stepped, so a brig's fore and main are one part bought twice. Only the size rung
  says where it can go. Berths run deck upward, and a fore-and-aft driving sail sharing the lowest
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
  comes loose the moment the host sail does.
- **A part's `part` says what sort of thing it is; a sail's `kind` says which category.** They were
  one field, and the two meanings collided the moment the categories arrived.
- **The renderer draws up to five sails up a mast, and the bands are generated.** Three or fewer are
  the ones authored in `STATION_GEOM`, so the galleon is unchanged; a taller stack is that profile
  resampled and squeezed into the same air, because three sails already reach the masthead and there
  is nothing above them to extend into. Five is the ceiling and the bench holds the catalogue to it.
  Adding a row to `STATION_GEOM` is not how a sixth would be added.
- **`npm run catalogue` before and after touching the catalogue.** A hull that cannot be rigged or
  carries a station the renderer cannot draw fails silently at runtime; the bench fails loudly. It
  prints the whole fleet side by side, which is the only way the numbers mean anything.
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
  `HELM & HULL`), the three mode names, and the five
  ship systems (`MAST` `HULL` `CREW` `SIDE` `FRONT`). Outcome headlines set in the display face at
  title size count here too, so `SUNK` and `LAST AFLOAT` keep their caps; they name the moment
  rather than instruct.
- **Sentence case** for anything the player is told or asked: buttons, section headers, stat labels,
  prose. `Rematch`, not `REMATCH`.

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
- **Border radius comes from a small set:** 3 for hairline bar fills, 10 for cards and buttons, 20
  for full-round pills. Do not invent a new one per component.
- **Check a new colour against every ground it lands on.** HUD colours sit on the enemy bar's
  50%-black backing, on the player panel, on button grounds, and against open water. The mast bar
  was a teal that scored 1.41 against the sea and vanished into it; the obvious fix, a navy, scored
  1.01 against the bar's own dark backing, which would have made a full bar look empty.

## Checking work

Verify visual changes in the running game, not only in a standalone harness. A harness that
replicates the draw code is useful for iterating on geometry and for comparing before and after, but
it is a replica, and it can agree with itself while disagreeing with the game. When a screenshot
comes from a replica rather than a real frame, say so.

## Known gaps

Rules above that the code does not yet satisfy. Tracked cleanups, not exceptions.

- **Hull art is parametric, not bespoke.** Every class now draws on a hull modelled from her own
  reference proportions in `hullform.js`, at her own size, in her own timber, with her own stern
  type, in both views; the galleon is the authored anchor and comes out unchanged, checked by pixel
  diff. What no class has yet is hand-finished art of her own beyond what the parameters express:
  a fluyt's extreme tumblehome or a carrack's built-up works are still the shared family of shapes
  with different numbers. Refining a class means refining her form, not adding a size multiplier to
  the catalogue, which stays deliberately size-free.
- **The catalogue's blurbs have still never been read at 1x.** Names are checked, and so are the part
  figures the shops print, but the shelves say what a part *does* rather than quoting its blurb, and
  the 38 hull rows have no blurb at all. So no line of one has been seen at a real width. Check them
  before anything starts showing them.

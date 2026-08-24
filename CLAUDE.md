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
- `src/hold.js` persists coins, lifetime stats and the yard to localStorage. Nothing else is saved;
  worlds and islands are generated fresh every match.
- **Nothing is bought at sea but repairs.** A ship is what she was when she sailed; what she is comes
  from the shipyard between voyages. Repairs are paid out of the voyage's own takings, so a coin spent
  on the carpenter is a coin that never reaches the hold. If you find yourself adding a stat that
  grows mid-round, that is the upgrade rail coming back and it was deliberately removed.
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

- **Hull art is one hull, at one size.** The menu turns the captain's own rig, but every class turns
  it on the galleon's hull, so a cutter reads as a small rig on a large ship. Each class is to be
  modelled in its own right rather than scaled off this one, so its size comes with its art: do not
  add a size multiplier to the catalogue in the meantime. `STATION_GEOM` in `galleon.js` is where a
  hull's mast positions live.
- **The catalogue's names and blurbs have not been read at 1x in the game.** They follow the copy
  rules above on the page, but nothing displays them yet, so no line has been checked for length in
  a real card. Check them when the shipyard screen exists rather than trusting them now.

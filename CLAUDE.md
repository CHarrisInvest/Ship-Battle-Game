# Broadside

An isometric age-of-sail combat game. Canvas 2D, React shell, no engine.

- `src/BroadsideIso.jsx` is the game: state, AI, rendering, and the React HUD.
- `src/galleon.js` draws the rotating ship on the menu.
- `src/hold.js` persists coins and lifetime stats to localStorage. Nothing else is saved;
  worlds and islands are generated fresh every match.

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

- **Caps** for the game's proper nouns: the title `BROADSIDE`, the three mode names, and the five
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
- **One to three shapes per icon, and check them at 1x.** The HUD icons run 9px to 17px on a 16-unit
  grid, so a 1-unit detail is under a pixel. The squall went from a cloud with a broken ring and
  three rain strokes, to a cloud with two fat wedges, to a single bolt, because at 12px a cloud has
  no silhouette left to recognise and whatever hangs under it merges into the same lump. A capture at
  deviceScaleFactor 6 will not tell you this, because it draws 72 device pixels for a 12px box.
- **Draw masses, not strokes, and cut detail out rather than drawing it in.** A hairline goes grey
  when it lands under a pixel; a shape knocked out of a filled body keeps full contrast at any size,
  and when it finally does fall under a pixel the body is still there to carry the meaning. The coin
  is the case: as a ring with a thin glyph inside it, it read at 12px as a wall clock, and the same
  coin as a filled disc with the stamp cut out of it reads as a coin all the way down to 9px, where
  the stamp has gone and a round gold mass is left.
- **Counters that count the same thing should share a shape.** Rivals afloat and rivals sunk are the
  same mast and sail, once upright over a hull and once heeled over with the hull already gone under
  a waterline. Two unrelated drawings would make the player learn two icons for one idea.
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

None open. The last one was the emoji HUD; it is now four drawn icons.

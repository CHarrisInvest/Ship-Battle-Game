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
  ship systems (`MAST` `HULL` `CREW` `SIDE` `FRONT`).
- **Sentence case** for anything the player is told or asked: buttons, section headers, stat labels,
  prose. `Rematch`, not `REMATCH`.

Buttons take size over tracking. Wide letterspacing makes every control read as a headline.

## HUD and UI

- **Icons are drawn, never emoji.** Emoji render in the OS font, so the HUD changes shape between
  iOS, Android and Windows, and they sit wrong against hand-drawn canvas art. The HUD pills are DOM,
  so inline SVG is the right form.
- **An icon has to carry its meaning.** Pick the shape from what the number counts, not from what is
  nearest to hand in the emoji table.
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

Rules above that the code does not yet satisfy. Both are tracked cleanups, not exceptions.

- **Emoji, 11 instances.** Coins, ships sunk, ships remaining, and the storm pill still use emoji.
  Note that the sunk counter uses an anchor, which does not communicate "sunk" at all.
- **Border radius.** `9` and `12` are still in use and should collapse into `10`.

/**
 * WHERE THE FIXED PIECES OF THE HUD SIT.
 *
 * The fire buttons and the joystick are DOM, and the radar is drawn on the canvas, so the two sides
 * have to agree on the figures without seeing each other. They are named once here: the canvas
 * places the radar off them and the HUD keeps its top row clear of where the radar will be.
 *
 * The screen has two layouts, chosen on its shape. Upright, the counters sit over the bars in the
 * top left, the repair rail runs the width of the screen under them, and the radar takes the top
 * right corner. Sideways there is no width to spare and no height to lose: a rail the width of the
 * screen ran straight across the middle of the sea. So the rank and bars stay in the top left, and
 * beside them the counters and the repair rail stack in the room before the radar.
 *
 * The radar keeps its corner unless the fire buttons would reach up into it. Three buttons stacked
 * from the bottom edge stand 188 tall, so on a phone in Safari, where the address bar and tabs
 * leave under 300 of height, their top is inside the radar's square and the radar steps inboard of
 * them; from the home screen, with the whole height, the two clear each other and it stays put.
 * That is a test of height rather than of orientation, worked out in `radarRight`.
 *
 * Both sides measure the same box: the DOM its safe-area wrapper, the canvas its own size less the
 * insets read off that wrapper, so the two never disagree about where the radar is.
 */
export const HUD = { pad: 10, radar: 96, fireW: 66, fireH: 56, fireRight: 20, fireBottom: 26, fireGap: 10 };
// How far in from the right edge the radar's right side sits, for a safe-area box w by h. The
// ordinary margin, unless there are fire buttons and their column's top would land inside the
// radar's square plus one gap; then it clears the column.
export const radarRight = (w, h, guns) => {
  if (!guns) return HUD.pad;
  const fireTop = h - HUD.fireBottom - (3 * HUD.fireH + 2 * HUD.fireGap);
  return fireTop < HUD.pad + HUD.radar + HUD.fireGap ? HUD.fireRight + HUD.fireW + HUD.fireGap : HUD.pad;
};

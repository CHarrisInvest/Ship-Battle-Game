/**
 * THE GAME'S MARK — the one ship the icons, the share card and the promotional art all draw.
 *
 * A Cutter light, fully found: two cut gaff mainsails on a gaff mast and two cut jibs on a jibboom,
 * seen off her port bow. Read by `npm run icon` and `npm run promo`, so the home-screen icon and
 * every advertisement show the same ship at the same bearing.
 */

// The ship: her class, and what is stepped and bent on, socket by socket from the bow.
export const MARK = {
  hull: "cutter",
  rig: [
    { mast: "jibboom", sails: ["jibFine", "jibFine"] },
    { mast: "gaffMast", sails: ["gaffMainFine", "gaffMainFine"] },
  ],
  gun: "gun3", // in every broadside port she is pierced for
};

// Her bearing: bow towards the viewer's right, sails filling towards us, which spreads the jib
// clear of the mainsail rather than laying one over the other.
export const MARK_DEG = 345;

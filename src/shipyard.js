/**
 * THE SHIPYARD — what a captain can buy, and what it makes of her ship.
 *
 * This file is the whole catalogue and none of the game. It holds no state, touches no storage, and
 * imports nothing: a hull is a row of numbers, a mast is a row of numbers, and `rate()` turns a set
 * of them into the handful of figures a fight actually reads. `hold.js` owns what a captain has
 * bought; `SternchaseIso.jsx` owns what happens at sea; both ask here what a part *is*.
 *
 * Four kinds of thing, and the shape of each decides how the shipyard behaves:
 *
 *   HULLS   a ship class. Fixes maximum hull and crew, the base speed and handling, how many guns
 *           of each kind she can bear, and — the important one — her mast sockets.
 *   MASTS   fitted into a socket. A mast is bought as a whole and its sail berths are fixed at the
 *           moment it is built: a mast that carries one lateen sail will never carry two square
 *           ones. Choosing a mast is choosing a shape of rig, not just a size.
 *   SAILS   fitted into a berth. A berth states a cut (square or triangle) and a size, and only a
 *           sail matching both goes in it, which is why a sloop's triangular canvas is no use on a
 *           square-rigged frigate and why the head of a tall mast wants a small sail.
 *   GUNS    fitted by the piece up to the hull's bearing. Muskets are not bought: they come off the
 *           crew she can muster, with the swivels adding to the weight of small arms.
 *
 * Parts are catalogue *types*. A captain owns *instances* of them, which is `hold.js`'s business,
 * and an instance moves between ships freely — the rule that rigging and guns travel is a rule
 * about instances, so nothing here needs to know about it.
 *
 * Nothing in this file is wired into combat yet. `rate()` returns ratings, not speeds: dimensionless
 * multipliers around 1 that the fight's own constants will be multiplied by when the shipyard opens,
 * so adopting it is one substitution rather than a rebalance of everything at once.
 */

/* ---------------------------------------------------------------------------------------------- */
/* Sockets and berths                                                                              */
/* ---------------------------------------------------------------------------------------------- */

// Socket sizes are ordered, and a mast fits a socket of its own size or larger. A small mast in a
// large socket is a legal, poor choice rather than an error, which keeps the first upgrade a captain
// can afford from being blocked by a socket she cannot fill properly yet.
export const SIZES = ["small", "medium", "large"];
const sizeRank = (s) => SIZES.indexOf(s);

// Where a socket sits along the keel. The main mast is the tall one amidships and carries the
// loosest diminishing return; fore and mizzen are shorter and tire sooner. Anything four-masted needs
// a name added here AND geometry in `galleon.js`, or that mast is silently left off the menu ship.
export const STATIONS = ["fore", "main", "mizzen"];

// How a sail is cut, which is the only thing that decides whether it goes in a berth. Declared rather
// than left implicit in the rows so adding a rig is a data change and the bench can check for typos:
// a berth wanting a `sqaure` sail would otherwise just be a berth nothing ever fits.
export const CUTS = ["square", "triangle", "lug"];

/* ---------------------------------------------------------------------------------------------- */
/* Hulls                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

/**
 * One row per class, and there are going to be a great many of them.
 *
 * `speed` and `hand` are the hull's own contribution, before a stitch of canvas: the lines of her,
 * and how she answers her rudder. `canvas` is how much sail she wants to move properly, so the same
 * suit of sails drives a cutter hard and barely stirs a galleon. That one number is what makes a big
 * hull a commitment rather than a straight upgrade.
 *
 * `guns` is `[broadside, bow, swivel]`, and broadside counts guns *a side*, mirrored, because that is
 * how she fires: the number in the shipyard is the number that goes off in one volley.
 *
 * `masts` is where she can step one, written `station/size` from the bow aft. The station is also the
 * socket's name, so a class carries at most one mast at each, which is what a rig actually is.
 *
 * `order` is her place on the shop shelf and defaults to her place in this list, so adding a class
 * between two others is inserting a row rather than renumbering everything below it. It is *not* a
 * tier: a tier is measured from a finished ship, and a bare galleon is the last class on the shelf
 * and a second-rung ship at the same time.
 *
 * How big she is is deliberately not a number here. Classes differ in size, but each hull is to be
 * modelled in its own right rather than scaled off one shape, so her size arrives with her art and
 * there is nothing for the catalogue to multiply.
 */
/* generated:hulls -- edit data/hulls.tsv and run `npm run import` */
const FLEET = [
  {
    id: "cutter", name: "Cutter", price: 0,
    blurb: "One mast, a handful of guns, and nothing spare. She turns inside anything afloat.",
    hull: 90, crew: 55, speed: 1.08, hand: 1.22, canvas: 1, tons: 1,
    guns: [2, 1, 1], masts: ["main/small"], bowsprit: false,
  },
  {
    id: "sloop", name: "Sloop", price: 900,
    blurb: "Still one mast, but a tall one, and enough deck to work four guns a side.",
    hull: 120, crew: 72, speed: 1.13, hand: 1.15, canvas: 1.35, tons: 1.5,
    guns: [4, 1, 2], masts: ["main/medium"],
  },
  {
    id: "brig", name: "Brig", price: 2400,
    blurb: "Two masts and a real broadside. The first hull that can take a beating and answer it.",
    hull: 155, crew: 96, speed: 1, hand: 1, canvas: 2.1, tons: 2.4,
    guns: [6, 2, 3], masts: ["fore/medium", "main/large"],
  },
  {
    id: "frigate", name: "Frigate", price: 5200,
    blurb: "Three masts, eight guns a side, and the speed to choose her fights.",
    hull: 195, crew: 124, speed: 0.97, hand: 0.9, canvas: 2.9, tons: 3.4,
    guns: [8, 2, 4], masts: ["fore/large", "main/large", "mizzen/medium"],
  },
  {
    id: "galleon", name: "Galleon", price: 9600,
    blurb: "Ten guns a side and a crew to work them. Slow to start, and slow to stop.",
    hull: 250, crew: 155, speed: 0.87, hand: 0.78, canvas: 3.8, tons: 4.6,
    guns: [10, 3, 6], masts: ["fore/large", "main/large", "mizzen/medium"],
  },
];
/* end:hulls */

// `tons` is what she can carry before the guns start telling on her handling. Every row gets these
// unless it says otherwise, so a class only states what is true of it in particular.
const HULL_DEFAULTS = { bowsprit: true, tons: 1, canvas: 1, speed: 1, hand: 1 };

function buildHull(row, index) {
  const r = { ...HULL_DEFAULTS, ...row };
  const [broadside = 0, bow = 0, swivel = 0] = r.guns || [];
  return {
    id: r.id,
    name: r.name,
    blurb: r.blurb,
    order: r.order ?? index,
    price: r.price,
    maxHull: r.hull,
    maxCrew: r.crew,
    speed: r.speed,
    hand: r.hand,
    canvas: r.canvas,
    tons: r.tons,
    bowsprit: r.bowsprit,
    guns: { broadside, bow, swivel },
    sockets: (r.masts || []).map((m) => {
      const [station, size] = m.split("/");
      return { id: station, station, size };
    }),
  };
}

export const HULLS = Object.fromEntries(FLEET.map((row, i) => [row.id, buildHull(row, i)]));

// Shop order, which is not the same thing as a tier: `order` says where a class sits on the shelf,
// and a tier is measured from a finished ship. A bare galleon is the fifth class and a second-tier
// ship at the same time, and both of those are true.
export const HULL_LIST = Object.values(HULLS).sort((a, b) => a.order - b.order);

/* ---------------------------------------------------------------------------------------------- */
/* Masts                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

/**
 * `berths` is the whole point of a mast and it never changes after the build. Each berth names the
 * cut and size of the one sail that goes in it, listed from the deck up, so the last berth on a tall
 * mast is the small sail at the head. Buying a mast is buying a shape.
 *
 * `size` is the smallest socket the mast fits. `height` is how tall she stands as a share of a full
 * mast at her station, which is the one thing the renderer takes from a mast; where the shrouds and
 * stays land belongs to the station she is stepped in, so `galleon.js` owns it.
 */
/* generated:masts -- edit data/masts.tsv and run `npm run import` */
export const MASTS = {
  poleMast: {
    id: "poleMast",
    kind: "mast",
    name: "Pole mast",
    price: 0,
    blurb: "A single spar and a single sail. Everything starts here.",
    size: "small",
    height: 0.62,
    berths: [{ cut: "square", size: "small" }],
  },
  bermudaMast: {
    id: "bermudaMast",
    kind: "mast",
    name: "Bermuda mast",
    price: 320,
    blurb: "Tall and bare, cut for one big triangular sail. Points closer to the wind than square canvas.",
    size: "small",
    height: 0.86,
    berths: [{ cut: "triangle", size: "large" }],
  },
  lowerMast: {
    id: "lowerMast",
    kind: "mast",
    name: "Lower mast",
    price: 420,
    blurb: "One heavy square sail on a stout pole. The plain way to move a big hull.",
    size: "medium",
    height: 0.7,
    berths: [{ cut: "square", size: "large" }],
  },
  lateenMast: {
    id: "lateenMast",
    kind: "mast",
    name: "Lateen mast",
    price: 760,
    blurb: "A long raking yard for the after station, with room for a small square sail above it.",
    size: "medium",
    height: 0.74,
    berths: [
      { cut: "triangle", size: "large" },
      { cut: "square", size: "small" },
    ],
  },
  topmast: {
    id: "topmast",
    kind: "mast",
    name: "Topmast",
    price: 980,
    blurb: "A lower mast with a second spar fidded above it: a course below, a topsail over.",
    size: "medium",
    height: 0.88,
    berths: [
      { cut: "square", size: "large" },
      { cut: "square", size: "small" },
    ],
  },
  topgallantMast: {
    id: "topgallantMast",
    kind: "mast",
    name: "Topgallant mast",
    price: 2100,
    blurb: "Three spars, and the highest sail is a small one. Every hand aboard is up there in a blow.",
    size: "large",
    height: 1,
    berths: [
      { cut: "square", size: "large" },
      { cut: "square", size: "small" },
      { cut: "square", size: "small" },
    ],
  },
};
/* end:masts */

export const MAST_LIST = Object.values(MASTS);

/* ---------------------------------------------------------------------------------------------- */
/* Sails                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

/**
 * `drive` is what the sail pulls and `hand` is what it costs or gives in handling. Square canvas
 * drives hardest and makes a ship stiffer to turn; fore-and-aft canvas drives less and helps her
 * round, which is the trade that makes a sloop's rig worth having on a sloop and worth nothing on a
 * frigate that cannot fit it.
 *
 * Two grades of each cut and size: the plain one a captain can afford early, and a fine one that is
 * strictly better and priced accordingly. Designs and cloth patterns are cosmetic and come later;
 * they hang off `id` without touching these numbers.
 */
export const SAILS = {
  course: {
    id: "course",
    kind: "sail",
    name: "Square course",
    price: 180,
    blurb: "The big lower sail. Plain flax, and it pulls.",
    cut: "square",
    size: "large",
    drive: 1.0,
    hand: -0.10,
  },
  courseFine: {
    id: "courseFine",
    kind: "sail",
    name: "Duck canvas course",
    price: 640,
    blurb: "The same sail in heavier cloth. Holds its shape when the plain one is bellying out of it.",
    cut: "square",
    size: "large",
    drive: 1.32,
    hand: -0.08,
  },
  topsail: {
    id: "topsail",
    kind: "sail",
    name: "Square topsail",
    price: 120,
    blurb: "Half the cloth of a course, and it sits where the wind is cleaner.",
    cut: "square",
    size: "small",
    drive: 0.58,
    hand: -0.04,
  },
  topsailFine: {
    id: "topsailFine",
    kind: "sail",
    name: "Duck canvas topsail",
    price: 430,
    blurb: "A topsail worth setting in weather that would split the plain one.",
    cut: "square",
    size: "small",
    drive: 0.78,
    hand: -0.03,
  },
  lateen: {
    id: "lateen",
    kind: "sail",
    name: "Lateen sail",
    price: 210,
    blurb: "A long triangle on a raking yard. Less pull than a course, and she comes round on it.",
    cut: "triangle",
    size: "large",
    drive: 0.72,
    hand: 0.14,
  },
  lateenFine: {
    id: "lateenFine",
    kind: "sail",
    name: "Cut lateen sail",
    price: 720,
    blurb: "Cut flat rather than full, so it holds an edge to the wind the plain one spills.",
    cut: "triangle",
    size: "large",
    drive: 0.95,
    hand: 0.18,
  },
  staysail: {
    id: "staysail",
    kind: "sail",
    name: "Staysail",
    price: 130,
    blurb: "A small triangle set on a stay. Not much pull, and she feels it in the rudder.",
    cut: "triangle",
    size: "small",
    drive: 0.40,
    hand: 0.12,
  },
  staysailFine: {
    id: "staysailFine",
    kind: "sail",
    name: "Cut staysail",
    price: 460,
    blurb: "The staysail a captain keeps when she changes ships.",
    cut: "triangle",
    size: "small",
    drive: 0.55,
    hand: 0.15,
  },
};

export const SAIL_LIST = Object.values(SAILS);

/* ---------------------------------------------------------------------------------------------- */
/* Guns                                                                                            */
/* ---------------------------------------------------------------------------------------------- */

/**
 * `mount` says which of the hull's counts a gun draws against. `weight` is what she carries for it,
 * and enough of it takes the edge off her handling: a fully gunned hull is a slower hull, which is
 * the reason to leave a port empty.
 *
 * Muskets are not here. Small arms come off the crew, in `rate()`.
 */
export const GUNS = {
  carriageGun: {
    id: "carriageGun",
    kind: "gun",
    name: "Carriage gun",
    price: 260,
    blurb: "The gun a broadside is made of. Fires fast enough to keep a hull holed.",
    mount: "broadside",
    damage: 9,
    reload: 1.6,
    weight: 1.0,
  },
  demiCannon: {
    id: "demiCannon",
    kind: "gun",
    name: "Demi-cannon",
    price: 880,
    blurb: "Heavier iron, slower to serve. One of these does what two carriage guns do, in one blow.",
    mount: "broadside",
    damage: 16,
    reload: 2.2,
    weight: 1.9,
  },
  bowChaser: {
    id: "bowChaser",
    kind: "gun",
    name: "Bow chaser",
    price: 240,
    blurb: "Points where the bow points. Aimed high, it brings a rig down.",
    mount: "bow",
    damage: 9,
    reload: 1.1,
    weight: 0.9,
  },
  longNine: {
    id: "longNine",
    kind: "gun",
    name: "Long nine",
    price: 810,
    blurb: "A long barrel on the bow. Reaches further than anything else aboard and hits what it reaches.",
    mount: "bow",
    damage: 15,
    reload: 1.35,
    weight: 1.6,
  },
  swivelGun: {
    id: "swivelGun",
    kind: "gun",
    name: "Swivel gun",
    price: 190,
    blurb: "Mounted on the rail and served by one hand. Clears a deck rather than holing a hull.",
    mount: "swivel",
    damage: 5,
    reload: 0.8,
    weight: 0.35,
  },
};

export const GUN_LIST = Object.values(GUNS);

/** Every catalogue part a captain can own an instance of, in one table, keyed by id. */
export const PARTS = { ...MASTS, ...SAILS, ...GUNS };
export const partType = (id) => PARTS[id] || null;
export const hullType = (id) => HULLS[id] || null;

/* ---------------------------------------------------------------------------------------------- */
/* Fitting rules                                                                                   */
/* ---------------------------------------------------------------------------------------------- */

export const socketOf = (hull, socketId) => hull.sockets.find((s) => s.id === socketId) || null;

/** A mast goes in a socket of its own size or larger. */
export function mastFitsSocket(mast, socket) {
  if (!mast || !socket || mast.kind !== "mast") return false;
  return sizeRank(mast.size) <= sizeRank(socket.size);
}

/** A sail goes in a berth of the same cut and the same size. Neither is negotiable. */
export function sailFitsBerth(sail, berth) {
  if (!sail || !berth || sail.kind !== "sail") return false;
  return sail.cut === berth.cut && sail.size === berth.size;
}

/** Every berth on a mast, as `{ index, cut, size }`, deck upward. */
export function berthsOf(mast) {
  return mast ? mast.berths.map((b, index) => ({ index, ...b })) : [];
}

/** Masts in the catalogue that would go in this socket, cheapest first. */
export function mastsForSocket(socket) {
  return MAST_LIST.filter((m) => mastFitsSocket(m, socket)).sort((a, b) => a.price - b.price);
}

/** Sails in the catalogue that would go in this berth, cheapest first. */
export function sailsForBerth(berth) {
  return SAIL_LIST.filter((s) => sailFitsBerth(s, berth)).sort((a, b) => a.price - b.price);
}

/** Guns in the catalogue for one of the hull's mounts, cheapest first. */
export function gunsForMount(mount) {
  return GUN_LIST.filter((g) => g.mount === mount).sort((a, b) => a.price - b.price);
}

/* ---------------------------------------------------------------------------------------------- */
/* Diminishing returns on canvas                                                                   */
/* ---------------------------------------------------------------------------------------------- */

// Sails stacked up one mast stop paying their way: the higher cloth is working in the lee of what is
// under it and the ship is carrying weight aloft for it. The first two on a mast are worth their
// full drive, three on the main, and everything above that is scaled down. `FREE` is that allowance
// and `FADE` is what each further sail keeps of the one below it.
const FREE_MAIN = 3;
const FREE_OTHER = 2;
const FADE = 0.58;

/**
 * What the `n`-th sail up a mast is actually worth, counting from 0 at the deck. Below the
 * allowance it is worth all of itself; above it, each one keeps `FADE` of the last.
 */
export function canvasFalloff(index, station) {
  const free = station === "main" ? FREE_MAIN : FREE_OTHER;
  return index < free ? 1 : Math.pow(FADE, index - free + 1);
}

/* ---------------------------------------------------------------------------------------------- */
/* Loadout                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

/**
 * A loadout is the resolved form of a ship: catalogue objects rather than ids, which is what `rate()`
 * and the renderer both want. `hold.js` stores ids and calls `resolve()` to get one of these.
 *
 *   {
 *     hull:  HULLS.brig,
 *     rig:   { main: { mast: MASTS.topmast, sails: [SAILS.course, null] }, ... },
 *     guns:  { broadside: [GUNS.carriageGun, ...], bow: [...], swivel: [...] },
 *   }
 *
 * A missing mast is `null` and an empty berth is `null`, so a half-fitted ship is a normal loadout
 * and not a special case: the shipyard has to be able to rate a ship a captain is midway through
 * buying, or the stat panel goes blank exactly when she is deciding what to spend on.
 */
export function emptyLoadout(hullId) {
  const hull = hullType(hullId) || HULLS.cutter;
  const rig = {};
  for (const socket of hull.sockets) rig[socket.id] = { mast: null, sails: [] };
  return { hull, rig, guns: { broadside: [], bow: [], swivel: [] } };
}

/** Sails fitted to one socket, padded out to the berths its mast actually has. */
function sailsOn(entry) {
  if (!entry || !entry.mast) return [];
  return entry.mast.berths.map((_, i) => entry.sails[i] || null);
}

/* ---------------------------------------------------------------------------------------------- */
/* Rating                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

// A hull under canvas approaches a top speed rather than climbing to one, so drive is fed through a
// saturating curve against the hull's own appetite for sail. BARE is what she makes under no canvas
// at all, which is not nothing: she still has steerage way.
const BARE = 0.30;
const UNDER_SAIL = 0.92; // added to BARE as drive runs away, so a well-rigged hull rates a little over 1
const HAND_PER_POINT = 0.16; // how much a point of sail handling moves her turn rate
const LOAD_BITE = 0.22; // handling lost when she is loaded to her tonnage in guns
const CREW_PER_MUSKET = 26; // hands to work one musket in a volley
const SWIVEL_MUSKETS = 0.5; // and what a swivel adds to the weight of small arms

const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);

/**
 * Turn a loadout into the numbers a fight reads.
 *
 * Everything here is a rating: `speed` and `turn` come out near 1 for a decently rigged hull of any
 * class, so the game multiplies its own `BASE_SPEED` and turn constants by them and nothing about
 * the feel of the fight moves the day the shipyard opens. `hull` and `crew` are the exception and
 * come out in the same points the health bars already use.
 */
export function rate(loadout) {
  const hull = loadout.hull;

  // canvas, mast by mast, with the higher sails discounted
  let drive = 0;
  let hand = 0;
  let sails = 0;
  for (const socket of hull.sockets) {
    const entry = loadout.rig[socket.id];
    const set = sailsOn(entry);
    set.forEach((sail, i) => {
      if (!sail) return;
      const k = canvasFalloff(i, socket.station);
      drive += sail.drive * k;
      hand += sail.hand * k;
      sails += 1;
    });
  }

  const guns = {
    broadside: loadout.guns.broadside.filter(Boolean),
    bow: loadout.guns.bow.filter(Boolean),
    swivel: loadout.guns.swivel.filter(Boolean),
  };
  const weight = sum(guns.broadside, (g) => g.weight * 2) + sum(guns.bow, (g) => g.weight) + sum(guns.swivel, (g) => g.weight);
  const load = Math.min(1, weight / (hull.tons * 8));

  const pull = drive / (drive + hull.canvas);
  const speed = hull.speed * (BARE + UNDER_SAIL * pull);
  const turn = hull.hand * (1 + hand * HAND_PER_POINT) * (1 - LOAD_BITE * load);

  // Small arms are the crew, not a purchase. A hull that musters more hands puts more muskets over
  // the rail, and the swivels on her rail count toward the same volley.
  const muskets = Math.max(1, Math.round(hull.maxCrew / CREW_PER_MUSKET + guns.swivel.length * SWIVEL_MUSKETS));

  const volley = (list) => ({
    count: list.length,
    damage: sum(list, (g) => g.damage),
    // a mixed battery reloads at the pace of its slowest piece, which is what serving it really means
    reload: list.length ? Math.max(...list.map((g) => g.reload)) : 0,
  });

  return {
    hull: hull.maxHull,
    crew: hull.maxCrew,
    speed,
    turn,
    drive,
    sails,
    weight,
    load,
    broadside: volley(guns.broadside),
    bow: volley(guns.bow),
    swivel: volley(guns.swivel),
    muskets,
  };
}

/** What her rigging is worth: every mast and every sail aboard, at what they cost to buy. */
export function riggingValue(loadout) {
  let total = 0;
  for (const socket of loadout.hull.sockets) {
    const entry = loadout.rig[socket.id];
    if (!entry || !entry.mast) continue;
    total += entry.mast.price;
    for (const sail of sailsOn(entry)) if (sail) total += sail.price;
  }
  return total;
}

/** What a loadout is worth in coins: the hull, her whole rigging, and every gun aboard her. */
export function loadoutValue(loadout) {
  let total = loadout.hull.price + riggingValue(loadout);
  for (const mount of ["broadside", "bow", "swivel"]) {
    for (const gun of loadout.guns[mount]) if (gun) total += gun.price;
  }
  return total;
}

/**
 * What it costs to step a new mast at sea: a tenth of what her whole rigging is worth.
 *
 * There is no base and no per-point charge. A mast is stepped or it is not, so the price is flat
 * whether she lost the whole thing or sprung it, and what sets it is the rig she is carrying rather
 * than the damage she took. A captain who has spent two thousand coins getting a topgallant aloft
 * pays to put it back; one sailing a free pole and a single topsail pays almost nothing, which is
 * right, because that is nearly all a new rig would cost her anyway.
 *
 * It lives here rather than in the fight because it is a fact about the catalogue: it is derived from
 * shop prices, and it moves the moment a price does.
 */
export const RIG_REBUILD_SHARE = 0.10;
export const mastRebuildCost = (loadout) => Math.ceil(RIG_REBUILD_SHARE * riggingValue(loadout));

/* ---------------------------------------------------------------------------------------------- */
/* Stat ranges                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

const cheapest = (list) => list.slice().sort((a, b) => a.price - b.price)[0] || null;

/**
 * The barest legal ship of a class: one mast in her main socket carrying one sail, one bow gun, and
 * nothing else. This is the left-hand end of the range on a ship card, and it is also what a captain
 * gets when she buys a bare hull.
 */
export function minimumLoadout(hullId) {
  const lo = emptyLoadout(hullId);
  const socket = socketOf(lo.hull, "main") || lo.hull.sockets[0];
  const mast = cheapest(mastsForSocket(socket));
  if (mast) {
    lo.rig[socket.id].mast = mast;
    const berth = berthsOf(mast)[0];
    lo.rig[socket.id].sails = [berth ? cheapest(sailsForBerth(berth)) : null];
  }
  const chaser = cheapest(gunsForMount("bow"));
  if (chaser && lo.hull.guns.bow > 0) lo.guns.bow = [chaser];
  return lo;
}

/**
 * A coherent ship of this class, fitted out to a standard.
 *
 * `quality` runs 0 to 1 and moves two things at once, because how well found a ship is genuinely
 * means both: which grade of part goes in each slot, and how much of her is filled at all. A plain
 * ship carries a course on each mast and leaves the topgallant berth bare with half her ports empty;
 * a full one has good cloth on every yard and a gun in every port.
 *
 * This exists because the stock fleet has to scale. Writing out a plain and a full fit by hand for
 * five classes was fine; doing it for a catalogue of forty is not, and hand-written fits drift out of
 * step with the parts table the moment a price moves. `maximumLoadout` is this at 1.
 */
export function fitOut(hullId, quality = 1) {
  const q = Math.min(1, Math.max(0, quality));
  // parts are graded by what they cost, so price order is quality order
  const grade = (list) => {
    if (!list.length) return null;
    const sorted = list.slice().sort((a, b) => a.price - b.price);
    return sorted[Math.round(q * (sorted.length - 1))];
  };
  const lo = emptyLoadout(hullId);

  for (const socket of lo.hull.sockets) {
    const mast = grade(mastsForSocket(socket));
    if (!mast) continue;
    lo.rig[socket.id].mast = mast;
    const berths = berthsOf(mast);
    // canvas is bent on from the deck up, so a half-found ship is missing her topsails rather than
    // her courses. At least one sail always, or she is not a ship under way.
    const bent = Math.max(1, Math.ceil(q * berths.length));
    lo.rig[socket.id].sails = berths.map((b, i) => (i < bent ? grade(sailsForBerth(b)) : null));
  }

  for (const mount of ["broadside", "bow", "swivel"]) {
    const cap = lo.hull.guns[mount];
    if (!cap) continue;
    const piece = grade(gunsForMount(mount));
    if (!piece) continue;
    // she runs out what she can serve. Broadside and bow keep a floor of one, because a ship of the
    // class with no guns at all on a mount she has ports for is not a plain ship, it is a wreck;
    // swivels are genuinely optional and a cheap ship carries none.
    const floor = mount === "swivel" ? 0 : 1;
    const n = Math.max(floor, Math.round(q * cap));
    lo.guns[mount] = Array.from({ length: n }, () => piece);
  }
  return lo;
}

/**
 * The best she can be made: the dearest mast that fits every socket, the dearest sail in every berth
 * of it, and every gun port filled with the heaviest piece. The right-hand end of the range.
 */
export const maximumLoadout = (hullId) => fitOut(hullId, 1);

/**
 * The pair of ratings a ship card shows, so a captain sees what a class is at its barest and what it
 * becomes fully found. Both ends are real loadouts run through the same `rate()` the fight will use,
 * rather than a second set of numbers that can drift away from it.
 */
export function statRange(hullId) {
  return { bare: rate(minimumLoadout(hullId)), found: rate(maximumLoadout(hullId)) };
}

// The stats a ship card puts a range on, and how to read one out of a rating.
const BANDED = {
  speed: (r) => r.speed,
  turn: (r) => r.turn,
  hull: (r) => r.hull,
  crew: (r) => r.crew,
  broadside: (r) => r.broadside.count,
  bow: (r) => r.bow.count,
  swivel: (r) => r.swivel.count,
  muskets: (r) => r.muskets,
};

/**
 * The same two ends, per stat, put in order.
 *
 * They do not all run the same way. Hull, crew and every gun count rise from bare to fully found,
 * but handling *falls*: a ship carrying every gun she can bear and a full press of square canvas is
 * stiffer on the helm than the same hull with one sail and one gun. That is the trade the shipyard
 * exists to make, and a card that printed `1.18 to 0.98` as a range would read as a mistake. Each
 * stat comes back as low and high with a flag saying which end the fully found ship sits at, so the
 * card can show the range honestly and say when spending costs her something.
 */
export function statBand(hullId) {
  const { bare, found } = statRange(hullId);
  const band = {};
  for (const [key, read] of Object.entries(BANDED)) {
    const a = read(bare), b = read(found);
    band[key] = { bare: a, found: b, low: Math.min(a, b), high: Math.max(a, b), rises: b >= a };
  }
  return band;
}

/** What filling out a bare hull of this class costs, on top of the hull itself. */
export function outfitCost(hullId) {
  const bare = HULLS[hullId] ? HULLS[hullId].price : 0;
  return loadoutValue(maximumLoadout(hullId)) - bare;
}

/* ---------------------------------------------------------------------------------------------- */
/* How strong a ship is                                                                            */
/* ---------------------------------------------------------------------------------------------- */

/**
 * A ship's tier comes off her stat line, not off her class.
 *
 * Tempting to use the hull's `tier` for matchmaking and wrong: that number orders the *catalogue*,
 * and a fully found cutter genuinely outclasses a bare brig. A mode that wants "the same tier" or
 * "similar stats" has to compare finished ships, so the comparison is made from what `rate()` already
 * says about a loadout and nothing else.
 *
 * Three components, kept separate because different modes care about different ones:
 *
 *   throwWeight  what she does to another ship in a second, guns and small arms together
 *   endurance    what she can take before she stops
 *   mobility     how well she gets to the fight and out of it
 *
 * The derby has no guns at all, so throw weight is meaningless there and `ram` is the figure it wants
 * instead: what she can take and how hard she can bring it, which is the whole of a ramming match.
 *
 * Swivels count once. `rate()` folds them into `muskets`, so the separate swivel volley is a count of
 * what is fitted rather than a second battery, and reading both would arm every big hull twice.
 */
const MUSKET_DPS = 2.4; // one musket in a volley, averaged over its reload
const BOTH_SIDES = 2; // a broadside goes off both sides at once

// Round numbers, near a middling ship, chosen so the components come out around 1 and can be blended.
// They set the scale of the answer and nothing else: moving them all moves every ship together.
const REF = { throwWeight: 40, endurance: 250, mobility: 0.85 };
// Weights on the blend. Guns and staying power carry it about equally; being able to choose your
// range matters, but less than either, because a fast ship that cannot hurt anything still loses.
const MIX = { throwWeight: 0.44, endurance: 0.41, mobility: 0.15 };

export function measure(r) {
  const dps = (v) => (v.count ? v.damage / v.reload : 0);
  const throwWeight = dps(r.broadside) * BOTH_SIDES + dps(r.bow) + r.muskets * MUSKET_DPS;
  const endurance = r.hull + r.crew;
  const mobility = (r.speed + r.turn) / 2;

  // A geometric blend, so being hopeless at one thing is not paid for by being splendid at another:
  // a hull with a great battery and no crew to work her should not rate alongside a whole ship. It
  // needs every component to be above zero, and every one of them is — `muskets` has a floor of 1,
  // and a hull with no canvas still carries steerage way.
  const norm = (v, k) => Math.pow(v / REF[k], MIX[k]);
  const overall = 100 * norm(throwWeight, "throwWeight") * norm(endurance, "endurance") * norm(mobility, "mobility");

  // The derby's measure: no guns aboard, so what matters is what she can take and how hard she can
  // put her bow into somebody. Weighted to endurance, because in a ramming match the ship still
  // floating is the ship that wins.
  const ram = 100 * Math.pow(endurance / REF.endurance, 0.7) * Math.pow(mobility / REF.mobility, 0.3);

  return { throwWeight, endurance, mobility, overall, ram };
}

/**
 * Bands over `overall`. A tier is a rung, not a class: two different hulls fitted to the same
 * strength are the same tier and belong in the same fight.
 *
 * `from` is the bottom of the band. The last one has no top, so a ship fitted beyond anything in the
 * catalogue still lands somewhere rather than falling off the end.
 *
 * These names have not been read at 1x in the game, because nothing displays them yet.
 */
export const TIERS = [
  { tier: 1, name: "Coastal", from: 0 },
  { tier: 2, name: "Privateer", from: 78 },
  { tier: 3, name: "Cruiser", from: 108 },
  { tier: 4, name: "Ship of the line", from: 142 },
  { tier: 5, name: "Flagship", from: 180 },
];

/** The band a strength figure falls in. */
export function tierAt(overall) {
  let found = TIERS[0];
  for (const t of TIERS) if (overall >= t.from) found = t;
  return found;
}

/** The band a finished ship falls in, straight from her loadout. */
export const tierOf = (loadout) => tierAt(measure(rate(loadout)).overall);

/* ---------------------------------------------------------------------------------------------- */
/* The stock fleet                                                                                 */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Ships the game issues rather than ships a captain buys: the opponents a mode puts on the water, and
 * the rungs arena climbs. Written in the same id-shaped form as a stored ship, so `resolve()` turns
 * one into a loadout exactly as it does for the player's own.
 *
 * Two of most classes, a plain fit and a full one, because the interesting fights are the ones where
 * the classes overlap: a full sloop is a harder ship than a plain brig, and a mode that matches on
 * strength rather than on class will put them against each other.
 *
 * Nothing here says what tier a ship is. That is measured, so a fit changed in this table moves the
 * ship up or down the ladder on its own and cannot disagree with its own stat line.
 */
export const STOCK = [
  {
    id: "cutterBare",
    name: "Bare cutter",
    blurb: "One sail, one gun on the bow, and nothing else aboard.",
    hull: "cutter",
    rig: { main: { mast: "poleMast", sails: ["topsail"] } },
    guns: { broadside: [], bow: ["bowChaser"], swivel: [] },
  },
  {
    id: "cutterCoastal",
    name: "Coastal cutter",
    blurb: "Better cloth than she needs and one gun a side. Somebody's first command.",
    hull: "cutter",
    rig: { main: { mast: "poleMast", sails: ["topsailFine"] } },
    guns: { broadside: ["carriageGun"], bow: ["bowChaser"], swivel: [] },
  },
  {
    id: "cutterArmed",
    name: "Armed cutter",
    blurb: "A working boat with a gun each side. Quick, and she bites.",
    hull: "cutter",
    rig: { main: { mast: "bermudaMast", sails: ["lateen"] } },
    guns: { broadside: ["carriageGun", "carriageGun"], bow: ["bowChaser"], swivel: ["swivelGun"] },
  },
  {
    id: "sloopPlain",
    name: "Plain sloop",
    blurb: "Tall triangular canvas and two guns a side. She comes round faster than she should.",
    hull: "sloop",
    rig: { main: { mast: "bermudaMast", sails: ["lateen"] } },
    guns: { broadside: ["carriageGun", "carriageGun"], bow: ["bowChaser"], swivel: ["swivelGun"] },
  },
  {
    id: "sloopFull",
    name: "Full sloop",
    blurb: "Square rigged for pace instead, with four guns a side and a long gun forward.",
    hull: "sloop",
    rig: { main: { mast: "topmast", sails: ["courseFine", "topsailFine"] } },
    guns: {
      broadside: ["carriageGun", "carriageGun", "carriageGun", "carriageGun"],
      bow: ["longNine"],
      swivel: ["swivelGun", "swivelGun"],
    },
  },
  {
    id: "brigPlain",
    name: "Plain brig",
    blurb: "Two masts, four guns a side, and enough timber to stand in a fight.",
    hull: "brig",
    rig: {
      fore: { mast: "lowerMast", sails: ["course"] },
      main: { mast: "topmast", sails: ["course", "topsail"] },
    },
    guns: {
      broadside: ["carriageGun", "carriageGun", "carriageGun", "carriageGun"],
      bow: ["bowChaser"],
      swivel: ["swivelGun"],
    },
  },
  {
    id: "brigFull",
    name: "Full brig",
    blurb: "Heavy iron on both sides and good cloth above. Slow to sink and slow to forgive.",
    hull: "brig",
    rig: {
      fore: { mast: "lowerMast", sails: ["courseFine"] },
      main: { mast: "topmast", sails: ["courseFine", "topsailFine"] },
    },
    guns: {
      broadside: ["demiCannon", "demiCannon", "demiCannon", "demiCannon", "demiCannon", "demiCannon"],
      bow: ["longNine", "longNine"],
      swivel: ["swivelGun", "swivelGun", "swivelGun"],
    },
  },
  {
    id: "frigatePlain",
    name: "Plain frigate",
    blurb: "Three masts and six guns a side, sailed by people with somewhere to be.",
    hull: "frigate",
    rig: {
      fore: { mast: "topmast", sails: ["course", "topsail"] },
      main: { mast: "topmast", sails: ["course", "topsail"] },
      mizzen: { mast: "lateenMast", sails: ["lateen", "topsail"] },
    },
    guns: {
      broadside: ["carriageGun", "carriageGun", "carriageGun", "carriageGun", "carriageGun", "carriageGun"],
      bow: ["bowChaser", "bowChaser"],
      swivel: ["swivelGun", "swivelGun"],
    },
  },
  {
    id: "frigateFull",
    name: "Full frigate",
    blurb: "Every port filled, every spar crossed. She picks her fight and she keeps it.",
    hull: "frigate",
    rig: {
      fore: { mast: "topgallantMast", sails: ["courseFine", "topsailFine", "topsailFine"] },
      main: { mast: "topgallantMast", sails: ["courseFine", "topsailFine", "topsailFine"] },
      mizzen: { mast: "lateenMast", sails: ["lateenFine", "topsailFine"] },
    },
    guns: {
      broadside: Array.from({ length: 8 }, () => "demiCannon"),
      bow: ["longNine", "longNine"],
      swivel: Array.from({ length: 4 }, () => "swivelGun"),
    },
  },
  {
    id: "galleonPlain",
    name: "Plain galleon",
    blurb: "A great deal of ship and not enough guns to justify her. Hard to sink all the same.",
    hull: "galleon",
    rig: {
      fore: { mast: "topmast", sails: ["course", "topsail"] },
      main: { mast: "topmast", sails: ["course", "topsail"] },
      mizzen: { mast: "lateenMast", sails: ["lateen", null] },
    },
    guns: {
      broadside: Array.from({ length: 6 }, () => "carriageGun"),
      bow: ["bowChaser", "bowChaser"],
      swivel: Array.from({ length: 3 }, () => "swivelGun"),
    },
  },
  {
    id: "galleonFull",
    name: "Full galleon",
    blurb: "Ten heavy guns a side and a crew to work them. Nothing afloat wants her attention.",
    hull: "galleon",
    rig: {
      fore: { mast: "topmast", sails: ["courseFine", "topsailFine"] },
      main: { mast: "topgallantMast", sails: ["courseFine", "topsailFine", "topsailFine"] },
      mizzen: { mast: "lateenMast", sails: ["lateenFine", "topsailFine"] },
    },
    guns: {
      broadside: Array.from({ length: 10 }, () => "demiCannon"),
      bow: ["longNine", "longNine", "longNine"],
      swivel: Array.from({ length: 6 }, () => "swivelGun"),
    },
  },
];

const STOCK_BY_ID = Object.fromEntries(STOCK.map((s) => [s.id, s]));
export const stockShip = (id) => STOCK_BY_ID[id] || null;

/** A stock ship's resolved loadout, its rating and its measure, worked out once and kept. */
const sized = new Map();
export function stockStats(id) {
  if (!sized.has(id)) {
    const s = stockShip(id);
    if (!s) return null;
    const loadout = resolve(s);
    const rating = rate(loadout);
    const m = measure(rating);
    sized.set(id, { ...s, loadout, rating, measure: m, tier: tierAt(m.overall).tier });
  }
  return sized.get(id);
}

/**
 * The stock fleet in ascending order of strength. This is arena's ladder: open on the weakest rung
 * and work up, so the mode escalates by putting harder ships on the water rather than more of the
 * same one.
 */
let rungs = null;
export function ladder() {
  if (!rungs) rungs = STOCK.map((s) => stockStats(s.id)).sort((a, b) => a.measure.overall - b.measure.overall);
  return rungs;
}

/** Every stock ship in one tier. A field of these is what free-for-all wants: equal, and not identical. */
export const stockOfTier = (tier) => ladder().filter((s) => s.tier === tier);

/**
 * Stock ships within `tolerance` of a given strength, by whichever measure the mode fights on.
 *
 * `key` is `overall` for a mode with guns and `ram` for one without, which is the difference between
 * "an even fight" in free-for-all and in the derby: a galleon and a frigate are miles apart under
 * gunfire and much closer when the only weapon is a bow.
 */
export function peers(strength, tolerance = 0.12, key = "overall") {
  return ladder().filter((s) => Math.abs(s.measure[key] - strength) <= strength * tolerance);
}

/* ---------------------------------------------------------------------------------------------- */
/* The first ship                                                                                  */
/* ---------------------------------------------------------------------------------------------- */

/**
 * What a captain has on her first day: a cutter, a pole mast with one small square sail on it, and a
 * single bow chaser. No broadside at all, so the first gun she buys is the first time she can fire
 * at anything abeam of her, and she feels it.
 *
 * Returned as ids rather than objects, because this is what `hold.js` writes into a fresh record.
 */
export const STARTER = {
  hull: "cutter",
  rig: { main: { mast: "poleMast", sails: ["topsail"] } },
  guns: { broadside: [], bow: ["bowChaser"], swivel: [] },
};

/* ---------------------------------------------------------------------------------------------- */
/* Resolving a stored ship                                                                         */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Turn the id-shaped record `hold.js` keeps into a loadout of catalogue objects, dropping anything
 * the catalogue no longer recognises or that no longer fits. A record written by an older build
 * therefore loses only the parts that actually went away, the same way the hold folds a stat it does
 * not know about rather than throwing the record out.
 *
 * `lookup` turns whatever the store holds in a slot into a catalogue id. The store keeps part
 * *instances*, so it passes a function that reads the instance's type; a plain record of ids passes
 * nothing and the ids are used as they stand.
 */
export function resolve(record, lookup) {
  const id = lookup || ((x) => x);
  const lo = emptyLoadout(record && record.hull);
  if (!record) return lo;

  for (const socket of lo.hull.sockets) {
    const src = (record.rig && record.rig[socket.id]) || null;
    if (!src) continue;
    const mast = partType(id(src.mast));
    if (!mastFitsSocket(mast, socket)) continue;
    lo.rig[socket.id].mast = mast;
    lo.rig[socket.id].sails = berthsOf(mast).map((berth, i) => {
      const sail = partType(id((src.sails || [])[i]));
      return sailFitsBerth(sail, berth) ? sail : null;
    });
  }

  for (const mount of ["broadside", "bow", "swivel"]) {
    const want = ((record.guns && record.guns[mount]) || []).map((x) => partType(id(x)));
    lo.guns[mount] = want.filter((g) => g && g.mount === mount).slice(0, lo.hull.guns[mount]);
  }
  return lo;
}

/* ---------------------------------------------------------------------------------------------- */
/* The rig, for drawing                                                                            */
/* ---------------------------------------------------------------------------------------------- */

/**
 * What the menu ship needs to know, and nothing else: where masts stand, how tall they are, and what
 * hangs on them. `galleon.js` turns this into geometry; the shipyard has no opinion about how a sail
 * is drawn, only that there is one and what cut it is.
 *
 * Hulls per class are still to be modelled, so every class is drawn on the one hull the renderer has,
 * at the one size it was drawn at. The rig on top of it is real: a cutter with one small sail draws
 * one small sail.
 */
export function rigSpec(loadout) {
  const masts = [];
  for (const socket of loadout.hull.sockets) {
    const entry = loadout.rig[socket.id];
    if (!entry || !entry.mast) continue;
    masts.push({
      station: socket.station,
      height: entry.mast.height,
      sails: sailsOn(entry).map((sail, i) =>
        sail ? { cut: sail.cut, size: sail.size, berth: i } : null,
      ).filter(Boolean),
    });
  }
  return { hull: loadout.hull.id, bowsprit: loadout.hull.bowsprit, masts };
}

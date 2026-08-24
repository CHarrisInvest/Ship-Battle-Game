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
// loosest diminishing return; fore and mizzen are shorter and tire sooner.
export const STATIONS = ["fore", "main", "mizzen"];

/* ---------------------------------------------------------------------------------------------- */
/* Hulls                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

/**
 * `speed` and `hand` are the hull's own contribution, before a stitch of canvas: the lines of her,
 * and how she answers her rudder. `canvas` is how much sail she wants to move properly, so the same
 * suit of sails drives a cutter hard and barely stirs a galleon. That one number is what makes a big
 * hull a commitment rather than a straight upgrade.
 *
 * `broadside` is guns *a side*, mirrored, because that is how she fires: the number in the shipyard
 * is the number that goes off in one volley. It runs 2 on the first hull to 10 on the last.
 *
 * `scale` is how big she is, and the cutter sets it at 1: the hull the game is drawn and balanced
 * around today is a small ship, and every class above her is bigger rather than the same boat with
 * better numbers. The menu draws at this scale already. The fight's own hull geometry — `HULL_L`,
 * `HULL_W`, `SHIP_R` and the collision ellipse — is still the cutter's at 1 and multiplies by it when
 * the shipyard is wired in, which is when a galleon starts taking up the sea room a galleon should.
 */
export const HULLS = {
  cutter: {
    id: "cutter",
    name: "Cutter",
    tier: 0,
    price: 0, // the ship a captain starts with, and the only one that is not bought
    blurb: "One mast, a handful of guns, and nothing spare. She turns inside anything afloat.",
    maxHull: 90,
    maxCrew: 55,
    speed: 1.08,
    hand: 1.22,
    canvas: 1.0,
    tons: 1.0, // what she can carry before the guns start telling on her handling
    scale: 1.0, // the hull the game is drawn around today, and the yardstick every other is cut to
    guns: { broadside: 2, bow: 1, swivel: 1 },
    bowsprit: false,
    sockets: [{ id: "main", station: "main", size: "small" }],
  },
  sloop: {
    id: "sloop",
    name: "Sloop",
    tier: 1,
    price: 900,
    blurb: "Still one mast, but a tall one, and enough deck to work four guns a side.",
    maxHull: 120,
    maxCrew: 72,
    speed: 1.13,
    hand: 1.15,
    canvas: 1.35,
    tons: 1.5,
    scale: 1.18,
    guns: { broadside: 4, bow: 1, swivel: 2 },
    bowsprit: true,
    sockets: [{ id: "main", station: "main", size: "medium" }],
  },
  brig: {
    id: "brig",
    name: "Brig",
    tier: 2,
    price: 2400,
    blurb: "Two masts and a real broadside. The first hull that can take a beating and answer it.",
    maxHull: 155,
    maxCrew: 96,
    speed: 1.0,
    hand: 1.0,
    canvas: 2.1,
    tons: 2.4,
    scale: 1.40,
    guns: { broadside: 6, bow: 2, swivel: 3 },
    bowsprit: true,
    sockets: [
      { id: "fore", station: "fore", size: "medium" },
      { id: "main", station: "main", size: "large" },
    ],
  },
  frigate: {
    id: "frigate",
    name: "Frigate",
    tier: 3,
    price: 5200,
    blurb: "Three masts, eight guns a side, and the speed to choose her fights.",
    maxHull: 195,
    maxCrew: 124,
    speed: 0.97,
    hand: 0.9,
    canvas: 2.9,
    tons: 3.4,
    scale: 1.65,
    guns: { broadside: 8, bow: 2, swivel: 4 },
    bowsprit: true,
    sockets: [
      { id: "fore", station: "fore", size: "large" },
      { id: "main", station: "main", size: "large" },
      { id: "mizzen", station: "mizzen", size: "medium" },
    ],
  },
  galleon: {
    id: "galleon",
    name: "Galleon",
    tier: 4,
    price: 9600,
    blurb: "Ten guns a side and a crew to work them. Slow to start, and slow to stop.",
    maxHull: 250,
    maxCrew: 155,
    speed: 0.87,
    hand: 0.78,
    canvas: 3.8,
    tons: 4.6,
    scale: 1.95,
    guns: { broadside: 10, bow: 3, swivel: 6 },
    bowsprit: true,
    sockets: [
      { id: "fore", station: "fore", size: "large" },
      { id: "main", station: "main", size: "large" },
      { id: "mizzen", station: "mizzen", size: "medium" },
    ],
  },
};

export const HULL_LIST = Object.values(HULLS).sort((a, b) => a.tier - b.tier);

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
export const MASTS = {
  poleMast: {
    id: "poleMast",
    kind: "mast",
    name: "Pole mast",
    price: 0, // she comes with one; the shipyard prices a replacement at nothing so a lost rig is not a wall
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
    height: 0.70,
    berths: [{ cut: "square", size: "large" }],
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
    height: 1.0,
    berths: [
      { cut: "square", size: "large" },
      { cut: "square", size: "small" },
      { cut: "square", size: "small" },
    ],
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
};

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

/** What a loadout is worth in coins: the hull, every mast, every sail, every gun aboard her. */
export function loadoutValue(loadout) {
  let total = loadout.hull.price;
  for (const socket of loadout.hull.sockets) {
    const entry = loadout.rig[socket.id];
    if (!entry || !entry.mast) continue;
    total += entry.mast.price;
    for (const sail of sailsOn(entry)) if (sail) total += sail.price;
  }
  for (const mount of ["broadside", "bow", "swivel"]) {
    for (const gun of loadout.guns[mount]) if (gun) total += gun.price;
  }
  return total;
}

/* ---------------------------------------------------------------------------------------------- */
/* Stat ranges                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

const cheapest = (list) => list.slice().sort((a, b) => a.price - b.price)[0] || null;
const dearest = (list) => list.slice().sort((a, b) => b.price - a.price)[0] || null;

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
 * The best she can be made: the dearest mast that fits every socket, the dearest sail in every berth
 * of it, and every gun port filled with the heaviest piece. The right-hand end of the range.
 */
export function maximumLoadout(hullId) {
  const lo = emptyLoadout(hullId);
  for (const socket of lo.hull.sockets) {
    const mast = dearest(mastsForSocket(socket));
    if (!mast) continue;
    lo.rig[socket.id].mast = mast;
    lo.rig[socket.id].sails = berthsOf(mast).map((b) => dearest(sailsForBerth(b)));
  }
  for (const mount of ["broadside", "bow", "swivel"]) {
    const best = dearest(gunsForMount(mount));
    if (!best) continue;
    lo.guns[mount] = Array.from({ length: lo.hull.guns[mount] }, () => best);
  }
  return lo;
}

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
 * Hull *shapes* per class are still to be designed, so every class is drawn on the one hull the
 * renderer has, but the `scale` it is drawn at is real, and so is the rig: a cutter with one small
 * sail draws one small sail on a small hull.
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
  return { hull: loadout.hull.id, scale: loadout.hull.scale, bowsprit: loadout.hull.bowsprit, masts };
}

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
 *   SAILS   fitted into a berth. A berth names one of the sail categories and only a sail of that
 *           category goes in it, which is why a sloop's lateen is no use on a square-rigged frigate
 *           and why the head of a tall mast wants a small square sail.
 *   GUNS    fitted by the piece up to the hull's bearing. Muskets are not bought: they come off the
 *           crew she can muster, with the swivels adding to the weight of small arms.
 *
 * Parts are catalogue *types*. A captain owns *instances* of them, which is `hold.js`'s business,
 * and an instance moves between ships freely — the rule that rigging and guns travel is a rule
 * about instances, so nothing here needs to know about it.
 *
 * Every part carries `part`, which is one of `"mast"`, `"sail"` or `"gun"` and says what sort of
 * thing it is. A sail also carries `kind`, which is its sail category and is a different question
 * with a different answer: `part: "sail", kind: "LSQ"`. They were one field for a while and the two
 * meanings collided the moment the categories arrived, so they are two fields now.
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
// Five rungs rather than three, because the fleet runs from a ship's launch to a first rate and
// crowding that into small, medium and large would put a yawl's spar and a three-decker's main mast
// in the same rung. `boat` is the bottom and `heavy` the top.
export const SIZES = ["boat", "small", "medium", "large", "heavy"];
const sizeRank = (s) => SIZES.indexOf(s);

/**
 * Where a socket sits along the keel, from the bow aft.
 *
 * The main mast is the tall one amidships and carries the loosest diminishing return; fore and
 * mizzen are shorter and tire sooner. `bonaventure` is the fourth mast of a carrack or a great
 * galleon, stepped on the poop abaft the mizzen.
 *
 * `bowsprit` is a station too, and it is the odd one: it is a spar over the bow rather than a mast on
 * a deck. What goes in it is headsails, which nearly every class in the fleet carries and which had
 * nowhere to live while the bowsprit was a flag on the hull. The shipyard treats it exactly like the
 * others (a socket, a spar fitted to it, berths on the spar) and `galleon.js` draws it differently,
 * which is where that difference belongs.
 *
 * A name added here needs geometry in `galleon.js` or that mast is silently left off the menu ship.
 * The bench checks both directions.
 */
export const STATIONS = ["bowsprit", "fore", "main", "mizzen", "bonaventure"];

/** Stations that carry a spar rather than a mast. What fits one is decided by `mastFitsSocket`. */
export const SPAR_STATIONS = new Set(["bowsprit"]);

/**
 * THE SAIL CATEGORIES, and the only thing that decides whether a sail goes in a berth.
 *
 * A berth names one of these and a sail belongs to one, and that is the whole of the fitting rule.
 * It used to be a pair, a cut and a size, which produced combinations no real rig has: a `triangle`
 * and a `small` crossed to make a berth that a jib and a staysail both filled and a lateen did not,
 * for no reason anybody could state. Named categories say the same thing without the phantoms, and a
 * mast's berths read as what a rigger would call them.
 *
 * A LATEEN IS NOT A HEADSAIL, which is why there are seven of these and not six. Both are triangles
 * and they were one category until the bowsprit became a station: the moment a jib had a berth of its
 * own, a lateen fitted it, and since a lateen pulls better than any staysail that is a free win
 * rather than a choice. They are different sails doing different work — a lateen is driving canvas
 * bent to a mast, a jib is set on a stay forward to balance her — so they are different categories.
 * That is a category split and not the size dimension the model threw out: a lateen and a staysail
 * differ in what they are, not in how big they are.
 *
 * Area is NOT the category. A topgallant is nearly four times a skysail and both are SSQ; a flying jib
 * is a scrap beside the fore staysail under it and both are TRI. What a sail pulls is its own figure,
 * so the range inside a category is carried by `drive` rather than by splitting the category.
 *
 * STU is the odd one and is marked `additive`. A studdingsail is not a berth on a mast: it booms out
 * beyond a square sail already set, and its area comes off that sail rather than off a place in the
 * rig. Nothing models that yet, so the bench refuses a berth that asks for one rather than letting a
 * mast pretend to carry studdingsails in a slot.
 */
export const SAIL_KINDS = {
  LSQ: { id: "LSQ", name: "Large square", blurb: "Courses and lower topsails. The driving power, low on the mast." },
  SSQ: { id: "SSQ", name: "Small square", blurb: "Topgallants, royals, skysails and spritsails. Light-air lift." },
  TRI: { id: "TRI", name: "Headsail", blurb: "Jibs, flying jibs and staysails. Set on a stay forward, for balance and pointing." },
  LAT: { id: "LAT", name: "Lateen", blurb: "Lateen yards and the tall Bermuda mainsail. Triangular canvas driving from a mast of its own." },
  GAF: { id: "GAF", name: "Gaff", blurb: "Spankers, drivers and gaff mainsails. Fore-and-aft drive aft." },
  LUG: { id: "LUG", name: "Lugsail", blurb: "Four sided, on a slung yard. What a lugger drives on." },
  STU: { id: "STU", name: "Studdingsail", additive: true, blurb: "Boomed out beyond a square sail, for light airs." },
};
export const KIND_LIST = Object.values(SAIL_KINDS);
export const kindOf = (id) => SAIL_KINDS[id] || null;

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
    guns: [4, 1, 2], masts: ["bowsprit/small", "main/medium"],
  },
  {
    id: "brig", name: "Brig", price: 2400,
    blurb: "Two masts and a real broadside. The first hull that can take a beating and answer it.",
    hull: 155, crew: 96, speed: 1, hand: 1, canvas: 2.1, tons: 2.4,
    guns: [6, 2, 3], masts: ["bowsprit/small", "fore/medium", "main/large"],
  },
  {
    id: "frigate", name: "Frigate", price: 5200,
    blurb: "Three masts, eight guns a side, and the speed to choose her fights.",
    hull: 195, crew: 124, speed: 0.97, hand: 0.9, canvas: 2.9, tons: 3.4,
    guns: [8, 2, 4], masts: ["bowsprit/medium", "fore/large", "main/large", "mizzen/medium"],
  },
  {
    id: "galleon", name: "Galleon", price: 9600,
    blurb: "Ten guns a side and a crew to work them. Slow to start, and slow to stop.",
    hull: 250, crew: 155, speed: 0.87, hand: 0.78, canvas: 3.8, tons: 4.6,
    guns: [10, 3, 6], masts: ["bowsprit/medium", "fore/large", "main/heavy", "mizzen/medium", "bonaventure/small"],
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
      // the bowsprit takes a spar and every other station takes a mast, which is a fact about the
      // place rather than something a row has to say twice
      return { id: station, station, size, spar: SPAR_STATIONS.has(station) };
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
 * category of the one sail that goes in it, listed from the deck up, so the last berth on a tall
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
    part: "mast",
    name: "Pole mast",
    price: 0,
    blurb: "A single spar and a single sail. Everything starts here.",
    size: "small",
    height: 0.62,
    berths: [{ kind: "SSQ" }],
  },
  bermudaMast: {
    id: "bermudaMast",
    part: "mast",
    name: "Bermuda mast",
    price: 320,
    blurb: "Tall and bare, cut for one big triangular sail. Points closer to the wind than square canvas.",
    size: "small",
    height: 0.86,
    berths: [{ kind: "LAT" }],
  },
  lowerMast: {
    id: "lowerMast",
    part: "mast",
    name: "Lower mast",
    price: 420,
    blurb: "One heavy square sail on a stout pole. The plain way to move a big hull.",
    size: "medium",
    height: 0.7,
    berths: [{ kind: "LSQ" }],
  },
  lateenMast: {
    id: "lateenMast",
    part: "mast",
    name: "Lateen mast",
    price: 760,
    blurb: "A long raking yard for the after station, with room for a small square sail above it.",
    size: "medium",
    height: 0.74,
    berths: [{ kind: "LAT" }, { kind: "SSQ" }],
  },
  topmast: {
    id: "topmast",
    part: "mast",
    name: "Topmast",
    price: 980,
    blurb: "A lower mast with a second spar fidded above it: a course below, a topsail over.",
    size: "medium",
    height: 0.88,
    berths: [{ kind: "LSQ" }, { kind: "SSQ" }],
  },
  topgallantMast: {
    id: "topgallantMast",
    part: "mast",
    name: "Topgallant mast",
    price: 2100,
    blurb: "Three spars, and the highest sail is a small one. Every hand aboard is up there in a blow.",
    size: "large",
    height: 1,
    berths: [{ kind: "LSQ" }, { kind: "SSQ" }, { kind: "SSQ" }],
  },
  royalMast: {
    id: "royalMast",
    part: "mast",
    name: "Royal mast",
    price: 3400,
    blurb: "Four yards crossed, and a royal above the topgallant. A press of canvas for a ship that can carry it.",
    size: "large",
    height: 1,
    berths: [{ kind: "LSQ" }, { kind: "SSQ" }, { kind: "SSQ" }, { kind: "SSQ" }],
  },
  skysailMast: {
    id: "skysailMast",
    part: "mast",
    name: "Skysail mast",
    price: 5200,
    blurb: "Five yards, the last of them a handkerchief in the clouds. Only the tallest hulls can step one.",
    size: "heavy",
    height: 1,
    berths: [{ kind: "LSQ" }, { kind: "SSQ" }, { kind: "SSQ" }, { kind: "SSQ" }, { kind: "SSQ" }],
  },
  standingBowsprit: {
    id: "standingBowsprit",
    part: "mast",
    name: "Standing bowsprit",
    price: 140,
    blurb: "The spar over her stem, with a staysail hanked to it. Enough to balance her helm.",
    size: "boat",
    spar: true,
    height: 0.55,
    berths: [{ kind: "TRI" }],
  },
  jibboom: {
    id: "jibboom",
    part: "mast",
    name: "Jibboom",
    price: 520,
    blurb: "Run out beyond the bowsprit, for a jib outside the staysail.",
    size: "small",
    spar: true,
    height: 0.8,
    berths: [{ kind: "TRI" }, { kind: "TRI" }],
  },
  flyingJibboom: {
    id: "flyingJibboom",
    part: "mast",
    name: "Flying jibboom",
    price: 1250,
    blurb: "The whole head of her: staysail, jib and a flying jib at the boom end.",
    size: "medium",
    spar: true,
    height: 1,
    berths: [{ kind: "TRI" }, { kind: "TRI" }, { kind: "TRI" }],
  },
  spritsailYard: {
    id: "spritsailYard",
    part: "mast",
    name: "Spritsail yard",
    price: 380,
    blurb: "A yard slung under the bowsprit, the way a carrack carried hers.",
    size: "small",
    spar: true,
    height: 0.7,
    berths: [{ kind: "SSQ" }],
  },
  spritTopmast: {
    id: "spritTopmast",
    part: "mast",
    name: "Sprit topmast",
    price: 900,
    blurb: "A spritsail and a sprit-topsail above it. Old-fashioned, and it pulls her head round.",
    size: "medium",
    spar: true,
    height: 0.95,
    berths: [{ kind: "SSQ" }, { kind: "SSQ" }],
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
 * `kind` is the sail's category and the only thing a berth asks about. Two grades of each so far:
 * the plain one a captain can afford early, and a fine one that is strictly better and priced
 * accordingly. Designs and cloth patterns are cosmetic and come later; they hang off `id` without
 * touching these numbers.
 */
/* generated:sails -- edit data/sails.tsv and run `npm run import` */
export const SAILS = {
  course: {
    id: "course",
    part: "sail",
    kind: "LSQ",
    name: "Square course",
    price: 180,
    blurb: "The big lower sail. Plain flax, and it pulls.",
    drive: 1,
    hand: -0.1,
  },
  courseFine: {
    id: "courseFine",
    part: "sail",
    kind: "LSQ",
    name: "Duck canvas course",
    price: 640,
    blurb: "The same sail in heavier cloth. Holds its shape when the plain one is bellying out of it.",
    drive: 1.32,
    hand: -0.08,
  },
  topsail: {
    id: "topsail",
    part: "sail",
    kind: "SSQ",
    name: "Square topsail",
    price: 120,
    blurb: "Half the cloth of a course, and it sits where the wind is cleaner.",
    drive: 0.58,
    hand: -0.04,
  },
  topsailFine: {
    id: "topsailFine",
    part: "sail",
    kind: "SSQ",
    name: "Duck canvas topsail",
    price: 430,
    blurb: "A topsail worth setting in weather that would split the plain one.",
    drive: 0.78,
    hand: -0.03,
  },
  staysail: {
    id: "staysail",
    part: "sail",
    kind: "TRI",
    name: "Staysail",
    price: 130,
    blurb: "A small triangle set on a stay. Not much pull, and she feels it in the rudder.",
    drive: 0.4,
    hand: 0.12,
  },
  staysailFine: {
    id: "staysailFine",
    part: "sail",
    kind: "TRI",
    name: "Cut staysail",
    price: 460,
    blurb: "The staysail a captain keeps when she changes ships.",
    drive: 0.55,
    hand: 0.15,
  },
  lateen: {
    id: "lateen",
    part: "sail",
    kind: "LAT",
    name: "Lateen sail",
    price: 210,
    blurb: "A long triangle on a raking yard. Less pull than a course, and she comes round on it.",
    drive: 0.72,
    hand: 0.14,
  },
  lateenFine: {
    id: "lateenFine",
    part: "sail",
    kind: "LAT",
    name: "Cut lateen sail",
    price: 720,
    blurb: "Cut flat rather than full, so it holds an edge to the wind the plain one spills.",
    drive: 0.95,
    hand: 0.18,
  },
};
/* end:sails */

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
    part: "gun",
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
    part: "gun",
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
    part: "gun",
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
    part: "gun",
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
    part: "gun",
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

/**
 * A mast goes in a socket of its own size or larger, and a spar goes on the bowsprit.
 *
 * The second half of that arrived with the bowsprit. Size alone would let a jibboom be stepped as a
 * main mast and a topgallant mast be run out over the bow, because a spar is small and small fits
 * everything: the same phantom the sail categories were built to stop, one level up. A spar and a
 * mast are different sorts of thing, so they are matched as such and the size rung is only consulted
 * once they agree.
 */
export function mastFitsSocket(mast, socket) {
  if (!mast || !socket || mast.part !== "mast") return false;
  if (!!mast.spar !== !!socket.spar) return false;
  return sizeRank(mast.size) <= sizeRank(socket.size);
}

/** A sail goes in a berth of its own category, and that is the whole of the rule. */
export function sailFitsBerth(sail, berth) {
  if (!sail || !berth || sail.part !== "sail") return false;
  return sail.kind === berth.kind;
}

/** Every berth on a mast, as `{ index, kind }`, deck upward. */
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

/**
 * A SWIVEL IS ONE MORE SHOT IN THE VOLLEY, and that is settled rather than provisional.
 *
 * Small arms are one thing aboard this ship: the hands at the rail and the swivels on it fire
 * together, and `muskets` is the whole of it. A swivel is not a battery of its own and is not going to
 * become one, which is why `measure()` reads `muskets` and ignores the swivel volley `rate()` returns
 * beside it — reading both would arm every big hull twice.
 *
 * One for one, not the half it started at. Half reads sensibly on paper (a swivel is worth rather more
 * than a musket, but one hand serves it and that hand is off the rail) and behaves badly in a
 * shipyard, because the count is rounded to whole shots: the first swivel a captain bought could move
 * nothing she could see and the second move it by one. A part that does nothing until you own two of
 * it is a part nobody buys.
 *
 * A better swivel, and more of them, is to make the volley HIT HARDER and GROUP TIGHTER off the bow.
 * Not add to the count: one swivel is one ball whatever it cost. Nothing does either yet, and the
 * numbers to do it with have not been set, but all three figures already exist in the fight as
 * constants, which is where they come from and what they are today:
 *
 *   count    `for (let i = 0; i < 6; i++)` in `fire()`. A flat six balls for every hull afloat, so a
 *            cutter and a galleon throw the same volley and the `muskets` figure the yard screen
 *            prints is a promise the fight does not keep. Substituting `rate().muskets` is the first
 *            of these and is worth doing on its own, before any of the quality work.
 *   damage   `musketDmg()`, a flat 3.2, beside `sideDmg()` and `frontDmg()` which are flat too.
 *            Becomes what one ball does, off the swivels aboard.
 *   spread   the `0.8` in that same line: the arc in radians the six balls are scattered across,
 *            about 23 degrees either side of the bow. This is the one to tighten. Note it is added
 *            to `noise`, the AI's own aiming error, so tightening the spread must not tighten that
 *            as well or better swivels would quietly make every rival captain a better shot.
 *
 * `rate()` grows a musket damage and a musket spread beside the count, `measure()` multiplies by the
 * damage instead of its own `MUSKET_DPS`, and the fight reads all three off the loadout. A swivel's
 * `damage` and `reload` in the catalogue are the numbers waiting on the second of those; nothing
 * carries a grouping figure yet, so that field arrives with the quality tiers.
 */
const SWIVEL_MUSKETS = 1;

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
 * Swivels count once, through `muskets`. They are part of the small-arms volley by design and never a
 * battery of their own, so the swivel volley `rate()` returns is a count of what is fitted and nothing
 * reads its damage: adding it here would arm every big hull twice. See `SWIVEL_MUSKETS`.
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
 * is drawn, only that there is one and what category it belongs to.
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
        sail ? { kind: sail.kind, berth: i } : null,
      ).filter(Boolean),
    });
  }
  return { hull: loadout.hull.id, bowsprit: loadout.hull.bowsprit, masts };
}

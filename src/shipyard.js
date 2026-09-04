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
 * rig. It is modelled as exactly that, an attachment to a sail (see `studFitsSail`), and the bench
 * still refuses a berth that asks for one rather than letting a mast pretend to carry studdingsails
 * in a slot.
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
 * How big she is is deliberately not a number here. Her size arrived with her art: `hullform.js`
 * models each class from her reference proportions and both views read it there, so there is still
 * nothing for the catalogue to multiply.
 */
/* generated:hulls -- edit data/hulls.tsv and run `npm run import` */
const FLEET = [
  {
    id: "gundalow", name: "Gundalow", price: 0,
    blurb: "A raft with a mast and one gun. She floats, she fires, and she is yours.",
    hull: 100, crew: 30, speed: 0.55, hand: 0.65, canvas: 0.18, tons: 2,
    guns: [1, 1, 1], masts: ["main/small"], bowsprit: false,
  },
  {
    id: "bermudaSloop", name: "Bermuda Sloop light", price: 900,
    blurb: "One raking mast and a deep heel aft. Nothing this small goes faster.",
    hull: 137, crew: 30, speed: 0.97, hand: 1.22, canvas: 0.28, tons: 6.6,
    guns: [3, 1, 1], masts: ["bowsprit/small", "main/medium"],
  },
  {
    id: "sloop", name: "Sloop light", price: 1400,
    blurb: "A single mast on a hull with some beam under it. She answers the helm sweetly.",
    hull: 149, crew: 40, speed: 0.91, hand: 1.24, canvas: 0.34, tons: 8.1,
    guns: [4, 1, 1], masts: ["bowsprit/small", "main/medium"],
  },
  {
    id: "cutter", name: "Cutter light", price: 2300,
    blurb: "Broad, deep and stiff, with more sail than a boat her size has any right to.",
    hull: 167, crew: 45, speed: 0.94, hand: 1.26, canvas: 0.4, tons: 9.7,
    guns: [5, 1, 1], masts: ["bowsprit/small", "main/medium"],
  },
  {
    id: "baltimoreClipper", name: "Baltimore Clipper", price: 3200,
    blurb: "Two raked masts on a hull cut like a knife. She outruns ships that outgun her.",
    hull: 255, crew: 60, speed: 1.09, hand: 1.16, canvas: 0.72, tons: 16.8,
    guns: [6, 1, 1], masts: ["bowsprit/small", "fore/medium", "main/medium"],
  },
  {
    id: "brigantine", name: "Brigantine", price: 4400,
    blurb: "Square on the fore and fore and aft on the main. She will do most things well enough.",
    hull: 311, crew: 70, speed: 0.85, hand: 0.97, canvas: 0.92, tons: 17.4,
    guns: [7, 1, 1], masts: ["bowsprit/small", "fore/medium", "main/medium"],
  },
  {
    id: "xebecLight", name: "Xebec light", price: 6200,
    blurb: "Long, low and lateen rigged, with a crew that would rather board you than shoot.",
    hull: 277, crew: 180, speed: 0.97, hand: 1.07, canvas: 0.8, tons: 20,
    guns: [9, 1, 1], masts: ["bowsprit/small", "fore/medium", "main/medium"],
  },
  {
    id: "corvette", name: "Corvette", price: 9000,
    blurb: "Three masts and one flush deck of guns. The smallest ship that looks like a warship.",
    hull: 504, crew: 130, speed: 0.91, hand: 0.95, canvas: 1.46, tons: 29.9,
    guns: [10, 1, 2], masts: ["bowsprit/medium", "fore/large", "main/large", "mizzen/medium"],
  },
  {
    id: "sixthRate", name: "6th rate", price: 12500,
    blurb: "Rated at last, and the smallest thing a post captain will admit to commanding.",
    hull: 647, crew: 155, speed: 0.88, hand: 0.89, canvas: 1.81, tons: 45.4,
    guns: [12, 2, 2], masts: ["bowsprit/medium", "fore/large", "main/large", "mizzen/medium"],
  },
  {
    id: "xebecHeavy", name: "Xebec heavy", price: 18000,
    blurb: "The same corsair hull grown a third mast and a great many more men.",
    hull: 568, crew: 320, speed: 0.94, hand: 0.99, canvas: 1.6, tons: 44,
    guns: [16, 2, 3], masts: ["bowsprit/medium", "fore/large", "main/large", "mizzen/medium"],
  },
  {
    id: "fifthRate", name: "5th rate", price: 25000,
    blurb: "A whole deck of eighteens and the legs to choose her own fight.",
    hull: 1128, crew: 260, speed: 1, hand: 0.83, canvas: 2.83, tons: 96.3,
    guns: [19, 2, 3], masts: ["bowsprit/large", "fore/heavy", "main/heavy", "mizzen/large"],
  },
  {
    id: "heavyFrigate", name: "Heavy frigate", price: 48000,
    blurb: "Live oak frames set close enough that round shot comes off her sides.",
    hull: 1721, crew: 420, speed: 1.03, hand: 0.74, canvas: 3.8, tons: 135,
    guns: [25, 2, 3], masts: ["bowsprit/large", "fore/heavy", "main/heavy", "mizzen/large"],
  },
  {
    id: "fourthRate", name: "4th rate", price: 35000,
    blurb: "Two decks of guns on a hull too slow to run and too light for the line.",
    hull: 1305, crew: 390, speed: 0.85, hand: 0.76, canvas: 3.18, tons: 142,
    guns: [27, 2, 4], masts: ["bowsprit/large", "fore/heavy", "main/heavy", "mizzen/large"],
  },
  {
    id: "thirdRate", name: "3rd rate", price: 58000,
    blurb: "Sixty four guns, and the smallest ship anyone will put in the line of battle.",
    hull: 1812, crew: 500, speed: 0.88, hand: 0.7, canvas: 4.13, tons: 175,
    guns: [32, 2, 5], masts: ["bowsprit/large", "fore/heavy", "main/heavy", "mizzen/large"],
  },
  {
    id: "secondRate", name: "2nd rate", price: 80000,
    blurb: "Three decks of iron. She is slow, she is enormous, and nothing wants her attention.",
    hull: 2421, crew: 700, speed: 0.79, hand: 0.68, canvas: 5.12, tons: 259.4,
    guns: [45, 2, 6], masts: ["bowsprit/large", "fore/heavy", "main/heavy", "mizzen/large"],
  },
  {
    id: "firstRate", name: "1st rate", price: 100000,
    blurb: "A hundred guns and a flag at the main. There is nothing above her.",
    hull: 2699, crew: 800, speed: 0.79, hand: 0.62, canvas: 5.68, tons: 297.7,
    guns: [50, 2, 6], masts: ["bowsprit/large", "fore/heavy", "main/heavy", "mizzen/large"],
  },
];
/* end:hulls */

// `tons` is the weight of iron she can bear, in the tons the guns are weighed in. Every row gets
// these unless it says otherwise, so a class only states what is true of it in particular. A tonnage
// of 1 is a boat that can mount almost nothing, which is the right way for a missing figure to fail.
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
    blurb: "A single spar and a single square sail. Everything starts here.",
    size: "boat",
    height: 0.6,
    berths: [{ kind: "LSQ" }],
  },
  spritMast: {
    id: "spritMast",
    part: "mast",
    name: "Sprit mast",
    price: 80,
    blurb: "A sprit across one four sided sail. What a boat carries, and what one hand can manage.",
    size: "boat",
    height: 0.56,
    berths: [{ kind: "GAF" }],
  },
  lugMast: {
    id: "lugMast",
    part: "mast",
    name: "Lug mast",
    price: 110,
    blurb: "A short mast for one lugsail. Cheap, quick, and the whole rig of a fishing boat.",
    size: "boat",
    height: 0.58,
    berths: [{ kind: "LUG" }],
  },
  lateenYard: {
    id: "lateenYard",
    part: "mast",
    name: "Lateen yard",
    price: 260,
    blurb: "A long raking yard and one triangular sail. The Mediterranean answer to everything.",
    size: "small",
    height: 0.76,
    berths: [{ kind: "LAT" }],
  },
  bermudaMast: {
    id: "bermudaMast",
    part: "mast",
    name: "Bermuda mast",
    price: 340,
    blurb: "Tall and bare, cut for one big triangular sail. Points closer to the wind than square canvas.",
    size: "small",
    height: 0.86,
    berths: [{ kind: "LAT" }],
  },
  gaffMast: {
    id: "gaffMast",
    part: "mast",
    name: "Gaff mast",
    price: 290,
    blurb: "A gaff mainsail and a topsail in the space above it. The working rig of a smack.",
    size: "small",
    height: 0.72,
    berths: [{ kind: "GAF" }, { kind: "GAF" }],
  },
  lugTopmast: {
    id: "lugTopmast",
    part: "mast",
    name: "Lug topmast",
    price: 320,
    blurb: "A standing lug with a second small one over it, for a lugger that means to outrun somebody.",
    size: "small",
    height: 0.74,
    berths: [{ kind: "LUG" }, { kind: "LUG" }],
  },
  lowerMast: {
    id: "lowerMast",
    part: "mast",
    name: "Lower mast",
    price: 420,
    blurb: "One heavy square sail on a stout pole. The plain way to move a big hull.",
    size: "medium",
    height: 0.68,
    berths: [{ kind: "LSQ" }],
  },
  lateenMast: {
    id: "lateenMast",
    part: "mast",
    name: "Lateen mast",
    price: 760,
    blurb: "A long raking yard for the after station, with room for a small square sail above it.",
    size: "medium",
    height: 0.78,
    berths: [{ kind: "LAT" }, { kind: "SSQ" }],
  },
  topmast: {
    id: "topmast",
    part: "mast",
    name: "Topmast",
    price: 980,
    blurb: "A lower mast with a second spar fidded above it: a course below, a topsail over.",
    size: "medium",
    height: 0.86,
    berths: [{ kind: "LSQ" }, { kind: "LSQ" }],
  },
  schoonerMast: {
    id: "schoonerMast",
    part: "mast",
    name: "Schooner mast",
    price: 1050,
    blurb: "A gaff sail low and a square topsail over it. Weatherly, and quick in stays.",
    size: "medium",
    height: 0.84,
    berths: [{ kind: "GAF" }, { kind: "LSQ" }],
  },
  driverMast: {
    id: "driverMast",
    part: "mast",
    name: "Driver mast",
    price: 1420,
    blurb: "A fore-and-aft driver at the deck with square canvas over it. What a cutter carries, and what a ship steers on aft.",
    size: "medium",
    height: 0.9,
    berths: [{ kind: "GAF" }, { kind: "LSQ" }, { kind: "SSQ" }],
  },
  topgallantMast: {
    id: "topgallantMast",
    part: "mast",
    name: "Topgallant mast",
    price: 2100,
    blurb: "Three spars, and the highest sail is a small one. Every hand aboard is up there in a blow.",
    size: "large",
    height: 0.94,
    berths: [{ kind: "LSQ" }, { kind: "LSQ" }, { kind: "SSQ" }],
  },
  driverRoyalMast: {
    id: "driverRoyalMast",
    part: "mast",
    name: "Driver royal mast",
    price: 2900,
    blurb: "A driver below and three square sails over it, the last a royal. A frigate's mizzen.",
    size: "large",
    height: 0.96,
    berths: [{ kind: "GAF" }, { kind: "LSQ" }, { kind: "SSQ" }, { kind: "SSQ" }],
  },
  spankerMast: {
    id: "spankerMast",
    part: "mast",
    name: "Spanker mast",
    price: 3400,
    blurb: "Spanker, course, topsail and topgallant. The after mast of anything that fights in a line.",
    size: "large",
    height: 0.97,
    berths: [{ kind: "GAF" }, { kind: "LSQ" }, { kind: "LSQ" }, { kind: "SSQ" }],
  },
  royalMast: {
    id: "royalMast",
    part: "mast",
    name: "Royal mast",
    price: 3600,
    blurb: "Four yards crossed and a royal above the topgallant. A press of canvas for a ship that can carry it.",
    size: "large",
    height: 0.98,
    berths: [{ kind: "LSQ" }, { kind: "LSQ" }, { kind: "SSQ" }, { kind: "SSQ" }],
  },
  skysailMast: {
    id: "skysailMast",
    part: "mast",
    name: "Skysail mast",
    price: 5400,
    blurb: "Five yards, the last of them a handkerchief in the clouds. Only the tallest hulls can step one.",
    size: "heavy",
    height: 1,
    berths: [{ kind: "LSQ" }, { kind: "LSQ" }, { kind: "SSQ" }, { kind: "SSQ" }, { kind: "SSQ" }],
  },
  spankerRoyalMast: {
    id: "spankerRoyalMast",
    part: "mast",
    name: "Spanker royal mast",
    price: 5800,
    blurb: "Everything a mast can carry, with a spanker under it. There is nothing above this one.",
    size: "heavy",
    height: 1,
    berths: [{ kind: "GAF" }, { kind: "LSQ" }, { kind: "LSQ" }, { kind: "SSQ" }, { kind: "SSQ" }],
  },
  standingBowsprit: {
    id: "standingBowsprit",
    part: "mast",
    name: "Standing bowsprit",
    price: 140,
    blurb: "The spar over her stem with one staysail hanked to it. Enough to balance her helm.",
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
    blurb: "The whole head of her: staysail, jib, and a flying jib at the boom end.",
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
    blurb: "A spritsail and a sprit-topsail above it. Old fashioned, and it pulls her head round.",
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
    kind: "LSQ",
    name: "Square topsail",
    price: 150,
    blurb: "The sail over the course, and the one she works hardest. Seven tenths of the cloth below it.",
    drive: 0.7,
    hand: -0.07,
  },
  topsailFine: {
    id: "topsailFine",
    part: "sail",
    kind: "LSQ",
    name: "Duck canvas topsail",
    price: 520,
    blurb: "A topsail worth setting in weather that would split the plain one.",
    drive: 0.92,
    hand: -0.06,
  },
  topgallant: {
    id: "topgallant",
    part: "sail",
    kind: "SSQ",
    name: "Topgallant",
    price: 120,
    blurb: "Third sail up, where the wind is cleaner and every hand aboard is a long way from the deck.",
    drive: 0.4,
    hand: -0.04,
  },
  topgallantFine: {
    id: "topgallantFine",
    part: "sail",
    kind: "SSQ",
    name: "Duck canvas topgallant",
    price: 430,
    blurb: "Heavy cloth where it is worth having. She carries it later into a blow.",
    drive: 0.53,
    hand: -0.03,
  },
  royal: {
    id: "royal",
    part: "sail",
    kind: "SSQ",
    name: "Royal",
    price: 90,
    blurb: "A small sail over the topgallant, for a captain in a hurry and a sea that will allow it.",
    drive: 0.22,
    hand: -0.02,
  },
  royalFine: {
    id: "royalFine",
    part: "sail",
    kind: "SSQ",
    name: "Duck canvas royal",
    price: 320,
    blurb: "The royal a ship keeps set after the plain one would have come in.",
    drive: 0.29,
    hand: -0.02,
  },
  skysail: {
    id: "skysail",
    part: "sail",
    kind: "SSQ",
    name: "Skysail",
    price: 70,
    blurb: "A handkerchief in the clouds. It pulls very little and it looks magnificent.",
    drive: 0.12,
    hand: -0.01,
  },
  skysailFine: {
    id: "skysailFine",
    part: "sail",
    kind: "SSQ",
    name: "Duck canvas skysail",
    price: 250,
    blurb: "Heavier cloth at the very top of the rig, where the plain one is first to blow out.",
    drive: 0.16,
    hand: -0.01,
  },
  spritsail: {
    id: "spritsail",
    part: "sail",
    kind: "SSQ",
    name: "Spritsail",
    price: 130,
    blurb: "Slung under the bowsprit on a yard athwart. Old fashioned, and it drags her head round.",
    drive: 0.25,
    hand: -0.05,
  },
  spritsailFine: {
    id: "spritsailFine",
    part: "sail",
    kind: "SSQ",
    name: "Duck canvas spritsail",
    price: 400,
    blurb: "Stouter cloth under the spar, where every sea that comes over the bow lands on it.",
    drive: 0.33,
    hand: -0.04,
  },
  staysail: {
    id: "staysail",
    part: "sail",
    kind: "TRI",
    name: "Staysail",
    price: 130,
    blurb: "A small triangle set on a stay. Not much pull, and she feels it in the rudder.",
    drive: 0.15,
    hand: 0.12,
  },
  staysailFine: {
    id: "staysailFine",
    part: "sail",
    kind: "TRI",
    name: "Cut staysail",
    price: 460,
    blurb: "The staysail a captain keeps when she changes ships.",
    drive: 0.2,
    hand: 0.15,
  },
  jib: {
    id: "jib",
    part: "sail",
    kind: "TRI",
    name: "Jib",
    price: 190,
    blurb: "Set out on the bowsprit. What balances her head against everything she carries aft.",
    drive: 0.22,
    hand: 0.14,
  },
  jibFine: {
    id: "jibFine",
    part: "sail",
    kind: "TRI",
    name: "Cut jib",
    price: 620,
    blurb: "Cut flat rather than full, so it holds an edge to the wind the plain one spills.",
    drive: 0.29,
    hand: 0.17,
  },
  flyingJib: {
    id: "flyingJib",
    part: "sail",
    kind: "TRI",
    name: "Flying jib",
    price: 150,
    blurb: "Right out at the boom end. The last scrap of canvas anybody sets forward.",
    drive: 0.12,
    hand: 0.09,
  },
  flyingJibFine: {
    id: "flyingJibFine",
    part: "sail",
    kind: "TRI",
    name: "Cut flying jib",
    price: 530,
    blurb: "Cut flat for the boom end, so it keeps an edge where the plain one flogs.",
    drive: 0.16,
    hand: 0.11,
  },
  lateen: {
    id: "lateen",
    part: "sail",
    kind: "LAT",
    name: "Lateen sail",
    price: 210,
    blurb: "A long triangle on a raking yard. Less pull than a course, and she comes round on it.",
    drive: 0.65,
    hand: 0.14,
  },
  lateenFine: {
    id: "lateenFine",
    part: "sail",
    kind: "LAT",
    name: "Cut lateen sail",
    price: 720,
    blurb: "Cut flat rather than full. A xebec runs down what she pleases under one of these.",
    drive: 0.86,
    hand: 0.18,
  },
  bermudaMain: {
    id: "bermudaMain",
    part: "sail",
    kind: "LAT",
    name: "Bermuda mainsail",
    price: 380,
    blurb: "One tall triangle and no yard at all. Points closer to the wind than square canvas can.",
    drive: 0.85,
    hand: 0.2,
  },
  bermudaMainFine: {
    id: "bermudaMainFine",
    part: "sail",
    kind: "LAT",
    name: "Cut Bermuda mainsail",
    price: 980,
    blurb: "The sail a sloop is really for. She will weather anything of her own size.",
    drive: 1.1,
    hand: 0.24,
  },
  gaffMain: {
    id: "gaffMain",
    part: "sail",
    kind: "GAF",
    name: "Gaff mainsail",
    price: 260,
    blurb: "Four sided, on a gaff abaft the mast. Handy, and one watch can take it in.",
    drive: 0.62,
    hand: 0.16,
  },
  gaffMainFine: {
    id: "gaffMainFine",
    part: "sail",
    kind: "GAF",
    name: "Cut gaff mainsail",
    price: 780,
    blurb: "The same sail in cloth that keeps its shape on a long board.",
    drive: 0.82,
    hand: 0.2,
  },
  gaffTopsail: {
    id: "gaffTopsail",
    part: "sail",
    kind: "GAF",
    name: "Gaff topsail",
    price: 110,
    blurb: "A scrap above the gaff, filling the space nothing else reaches.",
    drive: 0.18,
    hand: 0.08,
  },
  gaffTopsailFine: {
    id: "gaffTopsailFine",
    part: "sail",
    kind: "GAF",
    name: "Cut gaff topsail",
    price: 390,
    blurb: "The same scrap cut to stand, so the space over the gaff keeps pulling in a blow.",
    drive: 0.24,
    hand: 0.1,
  },
  spanker: {
    id: "spanker",
    part: "sail",
    kind: "GAF",
    name: "Spanker",
    price: 300,
    blurb: "The fore-and-aft sail on her after mast. She steers on it as much as on the rudder.",
    drive: 0.45,
    hand: 0.18,
  },
  spankerFine: {
    id: "spankerFine",
    part: "sail",
    kind: "GAF",
    name: "Cut spanker",
    price: 840,
    blurb: "A spanker worth keeping set when the square canvas has come in.",
    drive: 0.6,
    hand: 0.22,
  },
  trysail: {
    id: "trysail",
    part: "sail",
    kind: "GAF",
    name: "Trysail",
    price: 200,
    blurb: "Small, heavy, and bent to a little mast of its own. What she wears when it is blowing.",
    drive: 0.3,
    hand: 0.14,
  },
  trysailFine: {
    id: "trysailFine",
    part: "sail",
    kind: "GAF",
    name: "Storm trysail",
    price: 700,
    blurb: "The best cloth aboard, in the smallest sail. She rides out weather under this and nothing else.",
    drive: 0.4,
    hand: 0.17,
  },
  dippingLug: {
    id: "dippingLug",
    part: "sail",
    kind: "LUG",
    name: "Dipping lug",
    price: 190,
    blurb: "Four sided on a slung yard, and the yard comes round the mast on every tack.",
    drive: 0.45,
    hand: 0.12,
  },
  dippingLugFine: {
    id: "dippingLugFine",
    part: "sail",
    kind: "LUG",
    name: "Cut dipping lug",
    price: 600,
    blurb: "Better cloth on the same yard. Worth the work of dipping it round on every tack.",
    drive: 0.59,
    hand: 0.15,
  },
  standingLug: {
    id: "standingLug",
    part: "sail",
    kind: "LUG",
    name: "Standing lug",
    price: 210,
    blurb: "The lug that stays where it is put. Slower than a dipping lug and far less work.",
    drive: 0.5,
    hand: 0.14,
  },
  standingLugFine: {
    id: "standingLugFine",
    part: "sail",
    kind: "LUG",
    name: "Cut standing lug",
    price: 640,
    blurb: "The sail a Channel lugger shows a revenue cutter her heels under.",
    drive: 0.66,
    hand: 0.17,
  },
  lugTopsail: {
    id: "lugTopsail",
    part: "sail",
    kind: "LUG",
    name: "Lug topsail",
    price: 100,
    blurb: "A small lug over the mainsail, set flying in light airs.",
    drive: 0.18,
    hand: 0.07,
  },
  lugTopsailFine: {
    id: "lugTopsailFine",
    part: "sail",
    kind: "LUG",
    name: "Cut lug topsail",
    price: 350,
    blurb: "Flat cut and light, and it stays drawing after the plain one has come in.",
    drive: 0.24,
    hand: 0.09,
  },
  lowerStudding: {
    id: "lowerStudding",
    part: "sail",
    kind: "STU",
    name: "Lower studdingsail",
    price: 240,
    blurb: "Boomed out beyond the course in light airs. Half the course again, off two spars and a lot of patience.",
    drive: 0.55,
    hand: -0.03,
    level: 0,
  },
  topmastStudding: {
    id: "topmastStudding",
    part: "sail",
    kind: "STU",
    name: "Topmast studdingsail",
    price: 220,
    blurb: "Set beside the topsail, and the biggest of the three. What a ship cracks on when she means to run something down.",
    drive: 0.7,
    hand: -0.02,
    level: 1,
  },
  topgallantStudding: {
    id: "topgallantStudding",
    part: "sail",
    kind: "STU",
    name: "Topgallant studdingsail",
    price: 150,
    blurb: "High and light, beside the topgallant. The last of a full press, and the first to come in.",
    drive: 0.65,
    hand: -0.01,
    level: 2,
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
/* generated:guns -- edit data/guns.tsv and run `npm run import` */
export const GUNS = {
  gun3: {
    id: "gun3",
    part: "gun",
    name: "3-pounder",
    price: 55,
    blurb: "The lightest iron that is still a gun. A boat can stand it and little else can.",
    mount: "broadside",
    damage: 5.2,
    reload: 1.32,
    weight: 0.35,
  },
  gun4: {
    id: "gun4",
    part: "gun",
    name: "4-pounder",
    price: 80,
    blurb: "A small piece for a small hull. Two of them do what one real gun does.",
    mount: "broadside",
    damage: 6,
    reload: 1.41,
    weight: 0.6,
  },
  gun6: {
    id: "gun6",
    part: "gun",
    name: "6-pounder",
    price: 130,
    blurb: "The gun a working broadside is made of. Quick to serve and quick to reload.",
    mount: "broadside",
    damage: 7.3,
    reload: 1.5,
    weight: 0.85,
  },
  gun8: {
    id: "gun8",
    part: "gun",
    name: "8-pounder",
    price: 180,
    blurb: "A little more iron for the same port. She feels the weight but not badly.",
    mount: "broadside",
    damage: 8.5,
    reload: 1.57,
    weight: 1.05,
  },
  gun9long: {
    id: "gun9long",
    part: "gun",
    name: "Long 9-pounder",
    price: 335,
    blurb: "A long barrel on a light ball. It reaches further than anything of its weight.",
    mount: "broadside",
    damage: 9,
    reload: 1.65,
    weight: 1.3,
  },
  gun12: {
    id: "gun12",
    part: "gun",
    name: "12-pounder",
    price: 295,
    blurb: "The upper deck gun of a ship of the line, and the main battery of a small one.",
    mount: "broadside",
    damage: 10.4,
    reload: 1.79,
    weight: 1.7,
  },
  gun18: {
    id: "gun18",
    part: "gun",
    name: "18-pounder",
    price: 480,
    blurb: "A frigate's gun. Enough iron to open a hull at the range she wants to fight.",
    mount: "broadside",
    damage: 12.7,
    reload: 1.94,
    weight: 2.1,
  },
  gun24: {
    id: "gun24",
    part: "gun",
    name: "24-pounder",
    price: 680,
    blurb: "Lower deck weight. Slow to run out, and it tells every time it goes off.",
    mount: "broadside",
    damage: 14.7,
    reload: 2.08,
    weight: 2.5,
  },
  gun32: {
    id: "gun32",
    part: "gun",
    name: "32-pounder",
    price: 960,
    blurb: "The heaviest gun that goes to sea in numbers. It breaks frames, not planks.",
    mount: "broadside",
    damage: 17,
    reload: 2.16,
    weight: 2.75,
  },
  gun36: {
    id: "gun36",
    part: "gun",
    name: "36-pounder",
    price: 1105,
    blurb: "French weight of metal. One tier of these is most of what she can carry.",
    mount: "broadside",
    damage: 18,
    reload: 2.34,
    weight: 3.25,
  },
  bow6: {
    id: "bow6",
    part: "gun",
    name: "6-pounder chaser",
    price: 200,
    blurb: "A light chaser that points where the bow points. Cheap, and it is something.",
    mount: "bow",
    damage: 7.7,
    reload: 1.25,
    weight: 0.9,
  },
  bow8: {
    id: "bow8",
    part: "gun",
    name: "8-pounder chaser",
    price: 290,
    blurb: "A chaser with a little more weight behind the ball.",
    mount: "bow",
    damage: 8.9,
    reload: 1.3,
    weight: 1.1,
  },
  bow9long: {
    id: "bow9long",
    part: "gun",
    name: "Long 9-pounder chaser",
    price: 500,
    blurb: "A long barrel on the bow. Reaches further than anything else aboard.",
    mount: "bow",
    damage: 9.5,
    reload: 1.35,
    weight: 1.4,
  },
  bow12: {
    id: "bow12",
    part: "gun",
    name: "12-pounder chaser",
    price: 780,
    blurb: "Heavy enough to hurt a hull at the range a chase is fought at.",
    mount: "bow",
    damage: 10.9,
    reload: 1.45,
    weight: 1.8,
  },
  bow18: {
    id: "bow18",
    part: "gun",
    name: "18-pounder chaser",
    price: 1500,
    blurb: "A frigate's chaser. Iron enough to open a stern at a distance.",
    mount: "bow",
    damage: 13.3,
    reload: 1.6,
    weight: 2.25,
  },
  swivelGun: {
    id: "swivelGun",
    part: "gun",
    name: "Swivel gun",
    price: 250,
    blurb: "Mounted on the rail and served by one hand. Clears a deck rather than holing a hull.",
    mount: "swivel",
    damage: 5,
    reload: 0.8,
    weight: 0.15,
    group: 1,
  },
  bronzeSwivel: {
    id: "bronzeSwivel",
    part: "gun",
    name: "Bronze swivel",
    price: 620,
    blurb: "Cast true, so the ball goes where it was pointed. The volley lands closer to the bow.",
    mount: "swivel",
    damage: 6.5,
    reload: 0.8,
    weight: 0.15,
    group: 0.8,
  },
  longSwivel: {
    id: "longSwivel",
    part: "gun",
    name: "Long swivel",
    price: 1150,
    blurb: "A longer barrel on the same mount. It hits harder and throws truer than anything on the rail.",
    mount: "swivel",
    damage: 8,
    reload: 0.8,
    weight: 0.18,
    group: 0.62,
  },
};
/* end:guns */

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

/**
 * A STUDDINGSAIL IS NOT A BERTH, and this is the attachment it wanted instead.
 *
 * It booms out beyond a square sail that is already set, and its area comes off that sail: a square
 * sail carries at most one studdingsail, the stud's `drive` is a share of its host's, and it goes
 * loose the moment the host does. What decides which stud goes on which sail is the LEVEL of square
 * canvas up the mast, counting from the deck: a lower studdingsail booms out from the lowest square
 * sail, a topmast studdingsail from the one over it, a topgallant studdingsail from the third. The
 * berth number is deliberately not the level, because a driver mast's lowest square sail sits at
 * berth 1 with a spanker under it, and it is still the sail a lower studdingsail belongs beside.
 */
export function squareLevel(mast, berthIndex) {
  const berth = mast && mast.berths[berthIndex];
  if (!berth || (berth.kind !== "LSQ" && berth.kind !== "SSQ")) return null;
  let level = 0;
  for (let i = 0; i < berthIndex; i++) {
    const k = mast.berths[i].kind;
    if (k === "LSQ" || k === "SSQ") level++;
  }
  return level;
}

/** Whether this studdingsail booms out from the sail in that berth: a stud of the berth's own level, on a square sail actually set. */
export function studFitsSail(stud, mast, berthIndex, sail) {
  if (!stud || stud.part !== "sail" || stud.kind !== "STU") return false;
  if (!sail || (sail.kind !== "LSQ" && sail.kind !== "SSQ")) return false;
  const level = squareLevel(mast, berthIndex);
  return level != null && stud.level === level;
}

/** Studdingsails in the catalogue that would boom out from this berth's sail, cheapest first. */
export function studsForBerth(mast, berthIndex) {
  const level = squareLevel(mast, berthIndex);
  if (level == null) return [];
  return SAIL_LIST.filter((s) => s.kind === "STU" && s.level === level).sort((a, b) => a.price - b.price);
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
  // an unknown class falls back to the first on the shelf rather than to a named one, so the
  // catalogue can be reordered or rewritten without a dangling id in here
  const hull = hullType(hullId) || HULL_LIST[0];
  const rig = {};
  for (const socket of hull.sockets) rig[socket.id] = { mast: null, sails: [], studs: [] };
  return { hull, rig, guns: { broadside: [], bow: [], swivel: [] } };
}

/** Sails fitted to one socket, padded out to the berths its mast actually has. */
function sailsOn(entry) {
  if (!entry || !entry.mast) return [];
  return entry.mast.berths.map((_, i) => entry.sails[i] || null);
}

/** The studdingsails boomed out from those sails, padded the same way. */
function studsOn(entry) {
  if (!entry || !entry.mast) return [];
  return entry.mast.berths.map((_, i) => (entry.studs || [])[i] || null);
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
/**
 * SMALL ARMS COME OFF THE CREW, AND NOT IN PROPORTION TO THEM.
 *
 * A dozen hands in a boat and nine hundred and fifty in a first rate is a range of eighty, and one
 * musket a head, or anything close to it, ends with a three-decker throwing a volley nobody can read
 * and a boat throwing nothing. So the count goes as the SQUARE ROOT of the crew: a ship twice manned
 * does not put twice the muskets over the rail, because only so many of them fit at it, and the rest
 * are working the guns, the pumps and the yards.
 *
 * `CREW_PER_FIRST` is the hands that buy the first musket and sets where the curve starts. It gives a
 * yawl one, a brig three, a heavy frigate six and a first rate eight, which is a figure a captain can
 * hold in her head at every size of ship.
 */
const CREW_PER_FIRST = 12;
/**
 * The most balls in one volley, hands and swivels together.
 *
 * It is a ceiling on a number the player reads, not a balance knob: past about this many the volley
 * stops being countable and becomes a texture. The swivel bearings in `data/hulls.tsv` are set so the
 * biggest ships reach it exactly with every swivel mounted and nothing goes over, because a swivel
 * that adds nothing is a swivel nobody buys, which is the same trap the half-musket fell into below.
 */
const MUSKET_CAP = 14;

// Her rig's share of her hull, in health-bar points. 0.55 is the ratio the fight was tuned around
// when every ship at sea was 100 hull and 55 mast, kept so that adopting the catalogue moves what a
// ship IS without moving what dismasting one is worth.
const MAST_SHARE = 0.55;

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
 * WHAT A BETTER SWIVEL BUYS is that the volley hits harder and groups tighter off the bow. Never a
 * ball on the count: one swivel is one shot whatever it cost. Both halves come out of `rate()` now:
 *
 *   damage   `musketDamage`, what one ball of the volley carries. A hand's musket throws
 *            `MUSKET_BALL` and a swivel throws its own catalogue `damage`, so the figure is the
 *            average over the balls actually going out: no swivels leaves it exactly at 3.2, the flat
 *            the fight used to hard-code.
 *   spread   `musketSpread`, the arc the volley is scattered across. A musket scatters over the full
 *            `MUSKET_ARC`; a swivel is laid on its mount and scatters over its own `group` share of
 *            it, so the volley's arc is the ball-weighted average and quality and number both pull it
 *            in. It can never reach zero: the hands at the rail keep their whole scatter however fine
 *            the iron beside them is. The fight adds its own `noise` for an AI captain's aim, and
 *            that stays out of here on purpose: a better swivel aboard the player must not quietly
 *            make every rival a better shot.
 *
 * When the cap bites, the HANDS give way, never the swivels: only so many men fit at the rail, and a
 * mounted gun does not queue for elbow room. That is also the accounting that keeps a bought part
 * from doing nothing.
 */
const SWIVEL_MUSKETS = 1;
const MUSKET_BALL = 3.2; // what one hand's musket takes off a crew, the flat the fight was tuned on
const MUSKET_ARC = 0.8; // the arc a musket volley scatters over, in radians, about 23 degrees a side

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
    const studs = studsOn(entry);
    set.forEach((sail, i) => {
      if (!sail) return;
      const k = canvasFalloff(i, socket.station);
      drive += sail.drive * k;
      hand += sail.hand * k;
      sails += 1;
      // a studdingsail's area comes off the sail it booms out from, so its drive is a share of its
      // host's and it fades up the mast exactly as the host does
      const stud = studs[i];
      if (stud) {
        drive += stud.drive * sail.drive * k;
        hand += stud.hand * k;
        sails += 1;
      }
    });
  }

  const guns = {
    broadside: loadout.guns.broadside.filter(Boolean),
    bow: loadout.guns.bow.filter(Boolean),
    swivel: loadout.guns.swivel.filter(Boolean),
  };
  const weight = sum(guns.broadside, (g) => g.weight * 2) + sum(guns.bow, (g) => g.weight) + sum(guns.swivel, (g) => g.weight);
  const load = Math.min(1, weight / hull.tons);

  const pull = drive / (drive + hull.canvas);
  const speed = hull.speed * (BARE + UNDER_SAIL * pull);
  const turn = hull.hand * (1 + hand * HAND_PER_POINT) * (1 - LOAD_BITE * load);

  // Small arms are the crew, not a purchase. A hull that musters more hands puts more muskets over
  // the rail, though not in proportion to them, and the swivels on her rail fire in the same volley.
  const muskets = Math.min(
    MUSKET_CAP,
    Math.max(1, Math.floor(Math.sqrt(hull.maxCrew / CREW_PER_FIRST)) + guns.swivel.length * SWIVEL_MUSKETS),
  );
  // The hands give way at the rail before a mounted gun does, so under the cap every swivel still
  // fires and the balance of the volley is muskets.
  const swivelBalls = Math.min(guns.swivel.length, muskets);
  const handBalls = muskets - swivelBalls;
  const firing = guns.swivel.slice(0, swivelBalls);
  const swivelThrow = sum(firing, (g) => g.damage);
  // One ball of the volley, averaged over what is actually throwing it: 3.2 with nothing on the
  // rail, and pulled up by every swivel aboard because a swivel ball outweighs a musket's.
  const musketDamage = (handBalls * MUSKET_BALL + swivelThrow) / muskets;
  // The arc the volley scatters over. A musket keeps its whole scatter; a swivel is laid on its
  // mount and holds its own `group` share of one, so quality and number both pull the volley in
  // and the muskets keep it from ever closing to a point.
  const musketSpread = (MUSKET_ARC * (handBalls + sum(firing, (g) => g.group ?? 1))) / muskets;

  /**
   * ONE BALL PER GUN, and every gun she has.
   *
   * A volley used to be capped at ten balls a side, with the guns beyond that stacked into columns
   * throwing one heavier ball apiece: ten was as many as could be told apart coming off one side,
   * and no ship then bore more than twenty. It is the wrong answer now that a first rate bears
   * fifty, and it was always an answer to a drawing problem rather than to a gunnery one. The fight
   * solved the drawing problem properly instead, by firing her guns in sequence down her side, so
   * what separates one ball from the next is the moment it left rather than the room beside it.
   *
   * So `balls` is her gun count and `perBall` is one gun's damage. Total damage is what it always
   * was: the same iron, in as many pieces as there are guns to throw it.
   */
  const volley = (list) => {
    const count = list.length;
    const damage = sum(list, (g) => g.damage);
    return {
      count,
      damage,
      balls: count,
      perBall: count ? damage / count : 0,
      // a mixed battery reloads at the pace of its slowest piece, which is what serving it really means
      reload: count ? Math.max(...list.map((g) => g.reload)) : 0,
    };
  };

  return {
    hull: hull.maxHull,
    crew: hull.maxCrew,
    // What her rig can take before it comes down, in the same points the mast bar already uses. Off
    // her hull rather than off the canvas actually bent on, which is the obvious refinement and the
    // wrong one to guess at: a bare ship would be quicker to dismast than a full-rigged one, which is
    // true, and would also mean a captain buying sails made herself easier to cripple, which is not
    // the trade the shipyard is for. A share of the hull keeps the ratio the fight is tuned around at
    // every size of ship.
    mast: Math.round(hull.maxHull * MAST_SHARE),
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
    musketDamage,
    musketSpread,
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
    for (const stud of studsOn(entry)) if (stud) total += stud.price;
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
 * What it costs to step a new mast at sea: seven coins in every hundred her rigging is worth.
 *
 * There is no base and no per-point charge. A mast is stepped or it is not, so the price is flat
 * whether she lost the whole thing or sprung it, and what sets it is the rig she is carrying rather
 * than the damage she took. A captain who has spent two thousand coins getting a topgallant aloft
 * pays to put it back; one sailing a free pole and a single topsail pays almost nothing, which is
 * right, because that is nearly all a new rig would cost her anyway.
 *
 * It was a tenth while the work put her rig back whole. What she buys at sea is a jury rig, a spare
 * spar and what the sail locker holds, and it leaves her a tenth short of the ship she sailed, so the
 * price came down with it: a little over two thirds of the old figure for nine tenths of a rig. She
 * is paying the boatswain rather than the yard.
 *
 * It lives here rather than in the fight because it is a fact about the catalogue: it is derived from
 * shop prices, and it moves the moment a price does.
 */
export const RIG_REBUILD_SHARE = 0.07;
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
    // a ship close to fully found flies her studdingsails: they boom out beyond square canvas
    // already set, so they are the last thing aboard rather than a step on the way
    if (q >= 0.85) {
      lo.rig[socket.id].studs = berths.map((b, i) =>
        lo.rig[socket.id].sails[i] ? grade(studsForBerth(mast, i)) : null,
      );
    }
  }

  const mounts = ["broadside", "bow", "swivel"];
  const chosen = {};
  for (const mount of mounts) {
    const cap = lo.hull.guns[mount];
    if (!cap) continue;
    const pieces = gunsForMount(mount);
    const piece = grade(pieces);
    if (!piece) continue;
    // she runs out what she can serve. Broadside and bow keep a floor of one, because a ship of the
    // class with no guns at all on a mount she has ports for is not a plain ship, it is a wreck;
    // swivels are genuinely optional and a cheap ship carries none.
    const floor = mount === "swivel" ? 0 : 1;
    chosen[mount] = { pieces, piece, n: Math.max(floor, Math.round(q * cap)) };
  }

  /* SHE CANNOT WORK IRON SHE CANNOT CARRY. A gundalow with thirty-six pounders a side is not a
     well-found gundalow, she is a raft with her gunwales under water, and taking the dearest piece a
     mount allows was giving every boat in the fleet the heaviest gun in the shop. Her tonnage already
     says what she can stand, so the battery steps down a grade at a time until it fits under it.
     Fine-lined hulls come out carrying lighter iron than beamy ones of the same size, which is what
     `tons` was derived to mean.

     `tons` IS TONS OF IRON, in the same weights the guns are priced in, so the limit is the column
     itself and nothing is multiplied by anything. It used to be a dimensionless figure read against
     eight times itself, which meant a table written in real tons quietly stopped binding: every hull
     in the fleet could bear the heaviest gun in the shop and this loop never ran. */
  const carried = () =>
    mounts.reduce((t, m) => t + (chosen[m] ? chosen[m].piece.weight * chosen[m].n * (m === "broadside" ? 2 : 1) : 0), 0);
  const limit = lo.hull.tons;
  for (let guard = 0; guard < 24 && carried() > limit; guard++) {
    // lighten whichever mount is carrying the most, so a heavy broadside gives way before a chaser
    let worst = null;
    for (const m of mounts) {
      const c = chosen[m];
      if (!c) continue;
      const next = c.pieces.filter((g) => g.weight < c.piece.weight).sort((a, b) => b.weight - a.weight)[0];
      if (!next) continue;
      const borne = c.piece.weight * c.n * (m === "broadside" ? 2 : 1);
      if (!worst || borne > worst.borne) worst = { mount: m, borne, next };
    }
    if (!worst) break; // she is over her tonnage with the lightest iron in the shop, and that is her problem
    chosen[worst.mount].piece = worst.next;
  }

  /* AND NO ONE PIECE HEAVIER THAN HER BROADSIDE. The tonnage loop above lightens whichever mount is
     carrying the most, which is always the battery, because a broadside is counted twice and there
     are twenty of it. So a boat could come out under her tonnage with four pounders in the ports and
     a frigate's eighteen on the bow: her total weight was legal and the single gun on it was not.
     A chaser is a gun on the same deck as the rest, and if her scantlings will not stand an eighteen
     abeam they will not stand one over the stem either. Cap it at the piece she carries a side and
     let her keep the lightest in the shop when nothing is light enough. */
  const abeam = chosen.broadside && chosen.broadside.piece;
  if (abeam && chosen.bow) {
    const c = chosen.bow;
    if (c.piece.weight > abeam.weight) {
      const fits = c.pieces.filter((g) => g.weight <= abeam.weight).sort((a, b) => b.weight - a.weight)[0];
      c.piece = fits || c.pieces.slice().sort((a, b) => a.weight - b.weight)[0];
    }
  }

  for (const mount of mounts) {
    const c = chosen[mount];
    if (c) lo.guns[mount] = Array.from({ length: c.n }, () => c.piece);
  }
  return lo;
}

/**
 * The best she can be made: the dearest mast that fits every socket, the dearest sail in every berth
 * of it, and every gun port filled with the heaviest piece she can carry. The right-hand end of the
 * range.
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
 * Swivels count once, through `muskets` and the `musketDamage` they pull up. They are part of the
 * small-arms volley by design and never a battery of their own, so the swivel volley `rate()` returns
 * is a count of what is fitted and nothing reads its damage: adding it here would arm every big hull
 * twice. See `SWIVEL_MUSKETS`.
 */
// Volleys a second the rail keeps up. A plain musket ball at this pace is the 2.4 a musket the blend
// was placed with, so a ship with no swivels measures exactly what she did before quality existed and
// only better iron on the rail moves her.
const MUSKET_VOLLEYS = 0.75;
const BOTH_SIDES = 2; // a broadside goes off both sides at once

// Round numbers, near a middling ship, chosen so the components come out around 1 and can be blended.
// They set the scale of the answer and nothing else: moving them all moves every ship together.
const REF = { throwWeight: 40, endurance: 250, mobility: 0.85 };
// Weights on the blend. Guns and staying power carry it about equally; being able to choose your
// range matters, but less than either, because a fast ship that cannot hurt anything still loses.
const MIX = { throwWeight: 0.44, endurance: 0.41, mobility: 0.15 };

export function measure(r) {
  const dps = (v) => (v.count ? v.damage / v.reload : 0);
  const throwWeight =
    dps(r.broadside) * BOTH_SIDES + dps(r.bow) + r.muskets * (r.musketDamage ?? MUSKET_BALL) * MUSKET_VOLLEYS;
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
 * HER RATE: the eight rungs, and what a captain is told she is sailing.
 *
 * A rate is her main battery counted the way the navy counted it: the guns she bears, both sides
 * together, so a hull pierced for fifty a side is a hundred-gun ship and a first rate. Chasers and
 * swivels are no part of it, which is both how a rating was reckoned and why the edges fall where
 * they do: every one of them is a whole number of guns a side.
 *
 * IT IS MEASURED FROM HER PORTS AND NEVER DECLARED. No row anywhere carries a rate of its own; it
 * comes off `guns.broadside`, so a class cannot be handed a rating her ports do not support, and
 * widening a hull's bearing moves her rate with it. What a rate is NOT is her strength. A first rate
 * with half her ports empty is a first rate, badly found, and `measure()` is what says she will lose:
 * the two answer different questions and both are read, the rate for who she meets and the measure
 * for the order they come in.
 *
 * The rungs were numbered and nameless once, and the reason was good: eight names had to be read
 * against one another to mean anything, where `tier 6` sorted itself. That held while a rung was a
 * band of blended strength and stood for nothing outside the game. A rate is the navy's own word for
 * the same ship, a captain arrives already knowing roughly what a third rate is, and the two unrated
 * rungs below the rated six are where most of a career is actually spent.
 */
export const RATES = [
  { rung: 1, name: "Unrated light", from: 0 },
  { rung: 2, name: "Unrated heavy", from: 11 },
  { rung: 3, name: "6th rate", from: 20 },
  { rung: 4, name: "5th rate", from: 32 },
  { rung: 5, name: "4th rate", from: 50 },
  { rung: 6, name: "3rd rate", from: 64 },
  { rung: 7, name: "2nd rate", from: 90 },
  { rung: 8, name: "1st rate", from: 100 },
];

/** The guns she bears, counted as a rating counts them: her broadside, both sides. */
export const gunsBorne = (hull) => hull.guns.broadside * 2;

/** The rung a gun count falls on. The top rung has no ceiling, so nothing falls off the end. */
export function rateAt(guns) {
  let found = RATES[0];
  for (const r of RATES) if (guns >= r.from) found = r;
  return found;
}

/** What a hull is rated, straight off her ports. */
export const rateOf = (hull) => rateAt(gunsBorne(hull));

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
 * Nothing here says what rate a ship is. It is read off the ports of the hull she is built on, so a
 * fit changed in this table moves her strength without ever moving her rating, which is exactly the
 * difference between how well found she is and what she was built to be.
 */
/**
 * The fleet is generated rather than written out, at three standards apiece.
 *
 * Two hand-written fits for five classes was fine; for 38 it would be 114 entries drifting out of
 * step with the parts table every time a price moved, and every one of them a chance to name a sail
 * that no longer fits the berth it was written for. `fitOut(hull, quality)` builds a coherent ship at
 * a standard instead, so a class added to `data/hulls.tsv` brings her opponents with her.
 *
 * A row may still carry a hand-written `rig` and `guns` where a class wants a fit of her own, and
 * `resolve()` handles it exactly as it handles the player's ship. The bench checks those name parts
 * that actually fit.
 *
 * Nothing here declares a rate: it comes off her hull's ports, and her place in the ladder comes off
 * her stat line, so neither can be written down here to disagree with the ship it describes.
 */
const STANDARDS = [
  { key: "plain", label: "plain", quality: 0.35 },
  { key: "found", label: "well found", quality: 0.7 },
  { key: "full", label: "fully found", quality: 1 },
];

export const STOCK = HULL_LIST.flatMap((hull) =>
  STANDARDS.map((s) => ({
    id: `${hull.id}_${s.key}`,
    // her class first, then the standard she is fitted to. The other way round reads as a title and
    // capitalises badly: "Plain Baltimore clipper" fights the proper noun in the middle of it.
    name: `${hull.name}, ${s.label}`,
    hull: hull.id,
    quality: s.quality,
  })),
);

const STOCK_BY_ID = Object.fromEntries(STOCK.map((s) => [s.id, s]));
export const stockShip = (id) => STOCK_BY_ID[id] || null;

/**
 * What a stock ship is actually carrying: a fit built to her standard, or the parts she names if she
 * is one of the hand-written ones. Both come out as an ordinary loadout, so nothing downstream needs
 * to know which sort she was.
 */
export const stockLoadout = (s) => (s.quality != null ? fitOut(s.hull, s.quality) : resolve(s));

/** A stock ship's resolved loadout, its rating and its measure, worked out once and kept. */
const sized = new Map();
export function stockStats(id) {
  if (!sized.has(id)) {
    const s = stockShip(id);
    if (!s) return null;
    const loadout = stockLoadout(s);
    const rating = rate(loadout);
    const m = measure(rating);
    sized.set(id, { ...s, loadout, rating, measure: m, rate: rateOf(loadout.hull) });
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

/** Every stock ship of one rate. A field of these is what free-for-all wants: equal, and not identical. */
export const stockOfRate = (rung) => ladder().filter((s) => s.rate.rung === rung);

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
 * What a captain has on her first day: a gundalow, a sprit mast with one sail bent on, the lightest
 * gun in the shop each side and a chaser on the bow.
 *
 * That is her broadside FULL. A gundalow bears one gun a side and she has it, so a captain can fight
 * the moment the game opens rather than working out why nothing happens when she fires abeam. What
 * she cannot do is fight anything much: every gap in this ship is a gap the shipyard fills, and her
 * rail is bare, because a swivel is the first thing worth buying and a first purchase a captain makes
 * herself teaches the shop better than one she was given.
 *
 * Returned as ids rather than objects, because this is what `hold.js` writes into a fresh record.
 */
export const STARTER = {
  hull: "gundalow",
  rig: { main: { mast: "spritMast", sails: ["gaffMain"] } },
  guns: { broadside: ["gun3"], bow: ["bow6"], swivel: [] },
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
    // a studdingsail only stands while its host sail does, so one recorded against a berth that
    // came back empty is dropped the same way a sail that no longer fits is
    lo.rig[socket.id].studs = berthsOf(mast).map((berth, i) => {
      const stud = partType(id((src.studs || [])[i]));
      return studFitsSail(stud, mast, i, lo.rig[socket.id].sails[i]) ? stud : null;
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
 * The hull the rig stands on is the class's own: the renderer reads the spec's `hull` id against
 * `hullform.js` and builds her model at her size. The rig on top is real the same way: a cutter with
 * one small sail draws one small sail.
 *
 * `guns` is the one thing here that is not rigging, and it is here for the same reason the rest is:
 * a ship shows what she has got. It is her fitted broadside a side, and the renderer shuts the lid
 * on every port she has not filled, so a first rate with three guns aboard is visibly a first rate
 * with three guns aboard. Her ports are hers whatever she carries in them, which is what makes her
 * a first rate; the guns are what make her a found one.
 */
export function rigSpec(loadout) {
  const masts = [];
  for (const socket of loadout.hull.sockets) {
    const entry = loadout.rig[socket.id];
    if (!entry || !entry.mast) continue;
    const studs = studsOn(entry);
    masts.push({
      station: socket.station,
      height: entry.mast.height,
      // `stud` says a studdingsail is boomed out beyond this sail, which the renderer draws as an
      // extension of the sail rather than a sail of its own, because that is what it is
      sails: sailsOn(entry).map((sail, i) =>
        sail ? { kind: sail.kind, berth: i, ...(studs[i] ? { stud: true } : {}) } : null,
      ).filter(Boolean),
    });
  }
  return {
    hull: loadout.hull.id,
    bowsprit: loadout.hull.bowsprit,
    masts,
    guns: (loadout.guns.broadside || []).length,
  };
}

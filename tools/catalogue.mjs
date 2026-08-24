/**
 * THE CATALOGUE BENCH — `npm run catalogue`
 *
 * Two jobs, and the first one is the reason it exists.
 *
 * It CHECKS the fleet. A hull is a row of numbers, and a row of numbers can be quietly wrong in ways
 * nothing else notices: a socket no mast in the catalogue fits, a berth no sail fits, a station the
 * renderer has never been taught to draw. None of those throw. They just produce a ship that cannot
 * be rigged, or one that turns on the menu with a mast missing, and with a catalogue of forty classes
 * nobody is going to spot that by reading. Anything wrong is printed and the exit code goes to 1.
 *
 * Then it PRINTS the fleet, because the numbers in `shipyard.js` are the ones that want calibrating
 * and they are only meaningful next to each other. What a class is at her barest and fully found,
 * what she costs to fill out, and where she lands on the tier ladder against everyone else.
 *
 * It imports the real modules. There is no second copy of the maths here to disagree with the game.
 */

import {
  HULLS, HULL_LIST, STATIONS, CUTS, MAST_LIST, SAIL_LIST, GUN_LIST,
  mastsForSocket, sailsForBerth, berthsOf, gunsForMount,
  rate, measure, statBand, fitOut, minimumLoadout, maximumLoadout, loadoutValue, outfitCost,
  TIERS, tierAt, ladder, stockOfTier, resolve, STARTER, STOCK, riggingValue, mastRebuildCost,
} from "../src/shipyard.js";
import { RIG_STATIONS, RIG_CUTS } from "../src/galleon.js";

// A set, not a list. The same fault reached from forty hulls is one fault about one part, and a
// bench that printed it forty times would bury the other thirty-nine.
const problems = new Set();
const fault = (where, what) => problems.add(`${where}: ${what}`);

const n1 = (v) => v.toFixed(1);
const n2 = (v) => v.toFixed(2);
const pad = (v, w) => String(v).padEnd(w);
const num = (v, w) => String(v).padStart(w);

/* ---- checks ---------------------------------------------------------------------------------- */

const seen = new Set();
for (const h of HULL_LIST) {
  const where = `hull "${h.id}"`;
  if (seen.has(h.id)) fault(where, "duplicate id");
  seen.add(h.id);

  if (!h.name) fault(where, "no name");
  if (!(h.maxHull > 0) || !(h.maxCrew > 0)) fault(where, `hull ${h.maxHull} and crew ${h.maxCrew} must both be above zero`);
  if (!(h.canvas > 0)) fault(where, "canvas must be above zero, or she can never be driven");
  if (!(h.tons > 0)) fault(where, "tons must be above zero, or every gun aboard cripples her");
  if (!h.sockets.length) fault(where, "no mast sockets, so she can never carry a sail");
  if (h.guns.broadside < 0 || h.guns.bow < 0 || h.guns.swivel < 0) fault(where, "negative gun bearing");
  if (h.guns.broadside === 0 && h.guns.bow === 0) fault(where, "bears no guns at all on either mount");

  const stations = new Set();
  for (const s of h.sockets) {
    const at = `${where} socket "${s.id}"`;
    if (stations.has(s.station)) fault(at, `two masts at station "${s.station}"`);
    stations.add(s.station);
    if (!STATIONS.includes(s.station)) fault(at, `station "${s.station}" is not in STATIONS`);
    if (!RIG_STATIONS.includes(s.station)) {
      fault(at, `the renderer cannot draw a mast at "${s.station}" (it knows ${RIG_STATIONS.join(", ")}), so this mast would be missing from the menu ship`);
    }
    if (!mastsForSocket(s).length) fault(at, `size "${s.size}" fits no mast in the catalogue`);
  }

  // she has to be riggable in practice, not only in principle
  const found = maximumLoadout(h.id);
  const r = rate(found);
  if (!(r.sails > 0)) fault(where, "fully found, she still carries no sail");
  if (r.broadside.count !== h.guns.broadside) fault(where, `fully found she runs out ${r.broadside.count} broadside guns, not the ${h.guns.broadside} she bears`);
}

for (const mount of ["broadside", "bow", "swivel"]) {
  if (!gunsForMount(mount).length) fault("guns", `nothing in the catalogue mounts on "${mount}"`);
}
for (const s of STOCK) {
  if (!HULLS[s.hull]) fault(`stock "${s.id}"`, `unknown hull "${s.hull}"`);
}
for (const st of STATIONS) {
  if (!RIG_STATIONS.includes(st)) fault("stations", `"${st}" is declared but the renderer cannot draw it`);
}

// Masts are checked once each rather than once per socket they happen to fit. A berth no sail fits is
// a fact about the mast, and a cut nobody declared is almost always a typo: neither throws, they just
// produce a berth that stays empty forever.
for (const m of MAST_LIST) {
  if (!m.berths.length) fault(`mast "${m.id}"`, "no berths, so she can carry no sail at all");
  for (const b of berthsOf(m)) {
    if (!CUTS.includes(b.cut)) fault(`mast "${m.id}"`, `berth ${b.index} has cut "${b.cut}", which is not in CUTS`);
    if (!sailsForBerth(b).length) fault(`mast "${m.id}"`, `berth ${b.index} wants a ${b.size} ${b.cut} sail and the catalogue has none`);
  }
}
for (const s of SAIL_LIST) {
  if (!CUTS.includes(s.cut)) fault(`sail "${s.id}"`, `cut "${s.cut}" is not in CUTS`);
}
const undrawn = CUTS.filter((c) => !RIG_CUTS.includes(c) && SAIL_LIST.some((s) => s.cut === c));


/* ---- the fleet ------------------------------------------------------------------------------- */

console.log(`\nPARTS  ${MAST_LIST.length} masts, ${SAIL_LIST.length} sails, ${GUN_LIST.length} guns`);
console.log(`STATIONS  ${STATIONS.join(", ")}   drawn: ${RIG_STATIONS.join(", ")}`);
console.log(`CUTS      ${CUTS.join(", ")}   drawn as their own shape: ${RIG_CUTS.join(", ")}`);
if (undrawn.length) {
  console.log(`          note: ${undrawn.join(", ")} will draw as square canvas until galleon.js learns the shape`);
}

console.log(`\nTHE FLEET  (${HULL_LIST.length} classes)`);
console.log("  class        price   masts                    guns a side/bow/sw   bare  ->  found   tier   outfit");
for (const h of HULL_LIST) {
  const bare = measure(rate(minimumLoadout(h.id)));
  const found = measure(rate(maximumLoadout(h.id)));
  const rig = h.sockets.map((s) => `${s.station}/${s.size[0]}`).join(" ");
  console.log(
    "  " + pad(h.name, 12),
    num(h.price, 6),
    " " + pad(rig, 24),
    pad(`${h.guns.broadside}/${h.guns.bow}/${h.guns.swivel}`, 20),
    num(n1(bare.overall), 5), " -> ", num(n1(found.overall), 6),
    num(`${tierAt(bare.overall).tier}-${tierAt(found.overall).tier}`, 6),
    num(outfitCost(h.id), 8),
  );
}

console.log("\nSTAT BANDS  (fully found is the second figure; handling runs backwards on purpose)");
console.log("  class         speed          turn           hull  crew   broadside   muskets");
for (const h of HULL_LIST) {
  const b = statBand(h.id);
  const span = (k, f = n2) => `${f(b[k].bare)} to ${f(b[k].found)}`;
  console.log(
    "  " + pad(h.name, 12),
    pad(span("speed"), 14),
    pad(span("turn"), 14),
    num(b.hull.found, 4), num(b.crew.found, 5),
    num(`${b.broadside.low} to ${b.broadside.high}`, 11),
    num(`${b.muskets.low} to ${b.muskets.high}`, 9),
  );
}

console.log("\nFITTED OUT  (the same hull at rising quality, which is what a stock opponent is built from)");
console.log("  class        " + [0, 0.25, 0.5, 0.75, 1].map((q) => num(`q${q}`, 8)).join(""));
for (const h of HULL_LIST) {
  const row = [0, 0.25, 0.5, 0.75, 1].map((q) => num(n1(measure(rate(fitOut(h.id, q))).overall), 8)).join("");
  console.log("  " + pad(h.name, 12) + row);
}

console.log("\nTHE STOCK LADDER  (what the modes issue, in ascending strength)");
console.log("  ship             tier               overall     ram   throw  endurance  mobility    value   rigging  rebuild");
for (const s of ladder()) {
  console.log(
    "  " + pad(s.name, 16),
    pad(`${s.tier} ${tierAt(s.measure.overall).name}`, 18),
    num(n1(s.measure.overall), 7),
    num(n1(s.measure.ram), 7),
    num(n1(s.measure.throwWeight), 7),
    num(s.measure.endurance, 10),
    num(n2(s.measure.mobility), 9),
    num(loadoutValue(s.loadout), 8),
    num(riggingValue(s.loadout), 9),
    num(mastRebuildCost(s.loadout), 8),
  );
}

console.log("\nTIER OCCUPANCY");
for (const t of TIERS) {
  const inTier = stockOfTier(t.tier);
  console.log(`  ${t.tier} ${pad(t.name, 17)} from ${num(t.from, 4)}   ${inTier.map((s) => s.name).join(", ") || "(nothing stocked at this rung)"}`);
  if (!inTier.length) fault("tiers", `rung ${t.tier} (${t.name}) has no stock ship, so no mode can field one`);
}

const first = resolve(STARTER);
const start = measure(rate(first));
console.log(`\nTHE FIRST SHIP  overall ${n1(start.overall)}, ram ${n1(start.ram)}, tier ${tierAt(start.overall).tier}`);
console.log(`  her rigging is worth ${riggingValue(first)}, so a new mast at sea costs her ${mastRebuildCost(first)}.`);
console.log("  Every hull in a fight carries this rig today, so that is what a mast rebuild costs anybody.");

/* ---- verdict --------------------------------------------------------------------------------- */

if (problems.size) {
  console.log(`\n${problems.size} PROBLEM${problems.size === 1 ? "" : "S"}`);
  for (const p of problems) console.log("  " + p);
  process.exit(1);
}
console.log("\nThe catalogue is sound.\n");

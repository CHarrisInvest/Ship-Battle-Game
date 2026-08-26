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
  HULLS, HULL_LIST, STATIONS, SAIL_KINDS, KIND_LIST, MAST_LIST, SAIL_LIST, GUN_LIST,
  mastsForSocket, sailsForBerth, berthsOf, gunsForMount,
  rate, measure, statBand, fitOut, minimumLoadout, maximumLoadout, loadoutValue, outfitCost,
  TIERS, tierAt, ladder, stockOfTier, resolve, STARTER, STOCK, riggingValue, mastRebuildCost,
} from "../src/shipyard.js";
import { RIG_STATIONS, RIG_KINDS, RIG_BERTHS, rigBands } from "../src/galleon.js";

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
/* A stock ship names its parts by id, and `resolve()` drops anything that does not fit rather than
   throwing: that is right at runtime, where an old save must not take the record down with it, and
   wrong here, where it means a hand-written opponent quietly sails with a berth empty and a stat line
   nobody meant. Moving `topsail` from one category to another is all it takes. So every part a stock
   ship names has to actually land in the slot it was named for. */
for (const s of STOCK) {
  const where = `stock "${s.id}"`;
  if (!HULLS[s.hull]) { fault(where, `unknown hull "${s.hull}"`); continue; }
  const lo = resolve(s);
  for (const socket of HULLS[s.hull].sockets) {
    const named = (s.rig && s.rig[socket.id]) || null;
    if (!named) continue;
    const fitted = lo.rig[socket.id];
    if (named.mast && !fitted.mast) {
      fault(where, `"${named.mast}" does not fit the ${socket.station} socket, so she sails with nothing stepped there`);
      continue;
    }
    (named.sails || []).forEach((sailId, i) => {
      if (!sailId || fitted.sails[i]) return;
      const berth = fitted.mast ? fitted.mast.berths[i] : null;
      fault(where, `"${sailId}" does not fit berth ${i} of "${named.mast}"${berth ? `, which wants ${berth.kind}` : ""}, so that berth is bare`);
    });
  }
  for (const mount of ["broadside", "bow", "swivel"]) {
    const named = ((s.guns && s.guns[mount]) || []).length;
    if (lo.guns[mount].length !== named) {
      fault(where, `carries ${named} on the ${mount} and only ${lo.guns[mount].length} of them fit`);
    }
  }
}
for (const st of STATIONS) {
  if (!RIG_STATIONS.includes(st)) fault("stations", `"${st}" is declared but the renderer cannot draw it`);
}

// Every sail up a mast has to land somewhere of its own. The bands are generated
// from the authored profile now rather than clamped to the last one, and a
// generator that ran two of them together would put a sail behind another sail:
// paid for, drawn, and invisible, which is the fault the clamp used to produce
// and the only one this file cannot see from the catalogue alone.
for (const st of RIG_STATIONS) {
  for (let n = 1; n <= RIG_BERTHS; n++) {
    const bands = rigBands(st, n);
    if (!bands) { fault(`station "${st}"`, `has no geometry for a stack of ${n}`); continue; }
    for (const [cut, list] of Object.entries(bands)) {
      if (list.length !== n) fault(`station "${st}"`, `${n} ${cut} sails come back as ${list.length} bands`);
      list.forEach((b, i) => {
        if (!(b.zt > b.zb)) fault(`station "${st}"`, `${cut} band ${i} of ${n} has no height`);
        // triangular canvas overlaps by nature: a jib and a staysail share the
        // same air. Square yards must not, or one hides behind another.
        if (cut === "square" && i > 0 && b.zb < list[i - 1].zt - 1e-9) {
          fault(`station "${st}"`, `${cut} band ${i} of ${n} starts inside band ${i - 1}, so that sail draws over the one below it`);
        }
      });
    }
  }
}

// Masts are checked once each rather than once per socket they happen to fit. A berth no sail fits is
// a fact about the mast, and a category nobody declared is almost always a typo: neither throws, they
// just produce a berth that stays empty forever.
for (const m of MAST_LIST) {
  if (!m.berths.length) fault(`mast "${m.id}"`, "no berths, so she can carry no sail at all");
  if (m.berths.length > RIG_BERTHS) {
    fault(`mast "${m.id}"`, `carries ${m.berths.length} sails and the renderer places ${RIG_BERTHS} up one mast. The bands are generated and squeezed into the air the authored ones occupy, so the limit is where the squeeze stops being worth drawing rather than a row that can be added: past it a stack is stripes on a pole`);
  }
  for (const b of berthsOf(m)) {
    const kind = SAIL_KINDS[b.kind];
    if (!kind) {
      fault(`mast "${m.id}"`, `berth ${b.index} asks for "${b.kind}", which is not one of the sail categories (${KIND_LIST.map((k) => k.id).join(", ")})`);
      continue;
    }
    // A studdingsail booms out beyond a square sail already set and its area comes off that sail, so
    // it attaches to a sail rather than filling a place in the rig. Nothing models that yet, and a
    // berth asking for one would let a mast pretend otherwise.
    if (kind.additive) {
      fault(`mast "${m.id}"`, `berth ${b.index} asks for ${kind.id}, and a ${kind.name.toLowerCase()} is not a berth: it booms out beyond a square sail that is already set, so it wants an attachment to a sail rather than a place on the mast`);
      continue;
    }
    if (!sailsForBerth(b).length) fault(`mast "${m.id}"`, `berth ${b.index} wants a ${kind.name.toLowerCase()} sail and the catalogue has none`);
  }
}
for (const s of SAIL_LIST) {
  if (!SAIL_KINDS[s.kind]) fault(`sail "${s.id}"`, `category "${s.kind}" is not one of the sail categories`);
}
const undrawn = KIND_LIST.filter((k) => !RIG_KINDS.includes(k.id) && SAIL_LIST.some((s) => s.kind === k.id)).map((k) => k.id);


/* ---- the fleet ------------------------------------------------------------------------------- */

console.log(`\nPARTS  ${MAST_LIST.length} masts, ${SAIL_LIST.length} sails, ${GUN_LIST.length} guns`);
console.log(`STATIONS  ${STATIONS.join(", ")}   drawn: ${RIG_STATIONS.join(", ")}`);
console.log(`SAILS     ${KIND_LIST.map((k) => k.id + (k.additive ? "*" : "")).join(", ")}   drawn as their own shape: ${RIG_KINDS.join(", ")}   (* attaches to a sail, never a berth)`);
console.log(`BERTHS    the renderer can place ${RIG_BERTHS} sails up one mast in different places`);
if (undrawn.length) {
  console.log(`          note: ${undrawn.join(", ")} will draw as square canvas until galleon.js learns the shape`);
}

console.log(`\nTHE FLEET  (${HULL_LIST.length} classes)`);
console.log("  " + pad("class", 19) + num("price", 7) + " " + pad("masts", 46) + pad("guns a side/bow/sw", 20) + num("bare", 5) + " -> " + num("found", 6) + num("tier", 6) + num("outfit", 8));
for (const h of HULL_LIST) {
  const bare = measure(rate(minimumLoadout(h.id)));
  const found = measure(rate(maximumLoadout(h.id)));
  const rig = h.sockets.map((s) => `${s.station}/${s.size[0]}`).join(" ");
  console.log(
    "  " + pad(h.name, 19),
    num(h.price, 7),
    " " + pad(rig, 46),
    pad(`${h.guns.broadside}/${h.guns.bow}/${h.guns.swivel}`, 20),
    num(n1(bare.overall), 5), " -> ", num(n1(found.overall), 6),
    num(`${tierAt(bare.overall).tier}-${tierAt(found.overall).tier}`, 6),
    num(outfitCost(h.id), 8),
  );
}

console.log("\nSTAT BANDS  (fully found is the second figure; handling runs backwards on purpose)");
console.log("  " + pad("class", 19) + pad("speed", 14) + pad("turn", 14) + num("hull", 4) + num("crew", 5) + num("broadside", 11) + num("muskets", 9));
for (const h of HULL_LIST) {
  const b = statBand(h.id);
  const span = (k, f = n2) => `${f(b[k].bare)} to ${f(b[k].found)}`;
  console.log(
    "  " + pad(h.name, 19),
    pad(span("speed"), 14),
    pad(span("turn"), 14),
    num(b.hull.found, 4), num(b.crew.found, 5),
    num(`${b.broadside.low} to ${b.broadside.high}`, 11),
    num(`${b.muskets.low} to ${b.muskets.high}`, 9),
  );
}

console.log("\nFITTED OUT  (the same hull at rising quality, which is what a stock opponent is built from)");
console.log("  class              " + [0, 0.25, 0.5, 0.75, 1].map((q) => num(`q${q}`, 8)).join(""));
for (const h of HULL_LIST) {
  const row = [0, 0.25, 0.5, 0.75, 1].map((q) => num(n1(measure(rate(fitOut(h.id, q))).overall), 8)).join("");
  console.log("  " + pad(h.name, 19) + row);
}

console.log("\nTHE STOCK LADDER  (what the modes issue, in ascending strength)");
console.log("  " + pad("ship", 26) + num("tier", 6) + num("overall", 8) + num("ram", 7) + num("throw", 7) + num("endurance", 10) + num("mobility", 9) + num("value", 8) + num("rigging", 9) + num("rebuild", 8));
for (const s of ladder()) {
  console.log(
    "  " + pad(s.name, 26),
    num(s.tier, 6),
    num(n1(s.measure.overall), 8),
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
  const names = inTier.map((s) => s.name);
  const shown = names.slice(0, 3).join("; ") + (names.length > 3 ? ` and ${names.length - 3} more` : "");
  console.log(`  tier ${t.tier}  from ${num(t.from, 4)}  ${num(names.length, 4)} ships   ${shown || "(nothing stocked at this rung)"}`);
  if (!inTier.length) fault("tiers", `rung ${t.tier} has no stock ship, so no mode can field one`);
}

const first = resolve(STARTER);
const start = measure(rate(first));
console.log(`\nTHE FIRST SHIP  overall ${n1(start.overall)}, ram ${n1(start.ram)}, tier ${tierAt(start.overall).tier}`);
console.log(`  her rigging is worth ${riggingValue(first)}, so a new mast at sea costs her ${mastRebuildCost(first)}.`);
console.log("  Every hull in a fight brings her own rig, so that is what a rebuild costs HER and nobody else.");

/* ---- verdict --------------------------------------------------------------------------------- */

if (problems.size) {
  console.log(`\n${problems.size} PROBLEM${problems.size === 1 ? "" : "S"}`);
  for (const p of problems) console.log("  " + p);
  process.exit(1);
}
console.log("\nThe catalogue is sound.\n");

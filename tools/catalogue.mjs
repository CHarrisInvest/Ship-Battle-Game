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
 * what she costs to fill out, what she is rated, and where she lands against everyone else.
 *
 * It imports the real modules. There is no second copy of the maths here to disagree with the game.
 */

import {
  HULLS, HULL_LIST, STATIONS, SAIL_KINDS, KIND_LIST, MAST_LIST, SAIL_LIST, GUN_LIST,
  mastsForSocket, sailsForBerth, berthsOf, gunsForMount,
  rate, measure, statBand, fitOut, minimumLoadout, maximumLoadout, loadoutValue, outfitCost,
  RATES, rateOf, gunsBorne, ladder, stockOfRate, resolve, STARTER, STOCK, riggingValue, mastRebuildCost,
  squareLevel,
} from "../src/shipyard.js";
import { RIG_STATIONS, RIG_KINDS, RIG_BERTHS, rigBands } from "../src/galleon.js";
import { hullForm, DEFAULT_FORM, parseBattery } from "../src/hullform.js";
import { HULL_REF } from "../src/shipref.js";

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

  // every class draws on a hull modelled from her own reference row; one without a row falls back
  // to the galleon's, which is exactly the every-ship-is-the-galleon fault the forms exist to end
  if (h.id !== "galleon" && hullForm(h.id) === DEFAULT_FORM) {
    fault(where, "no reference row in shipref.js, so she draws on the galleon's hull at the galleon's size");
  }

  // she has to be riggable in practice, not only in principle
  const found = maximumLoadout(h.id);
  const r = rate(found);
  if (!(r.sails > 0)) fault(where, "fully found, she still carries no sail");
  if (r.broadside.count !== h.guns.broadside) fault(where, `fully found she runs out ${r.broadside.count} broadside guns, not the ${h.guns.broadside} she bears`);
}

/**
 * HER BATTERY, AS IT COMES OUT DRAWN.
 *
 * None of this throws and none of it is visible from the catalogue: a tier whose ports overlap each
 * other draws as one continuous smear rather than a row, a port sitting in her wales draws as a hole
 * at the waterline, and a class whose ports do not add up to her guns is the "every gun has a port"
 * rule quietly broken. All three were true of the fleet before `battery` existed, and every one of
 * them survived because nothing counted. This counts.
 */
const portAudit = [];
for (const h of HULL_LIST) {
  const ref = HULL_REF[h.id];
  const form = hullForm(h.id);
  if (!ref || form === DEFAULT_FORM) continue;
  const where = `hull "${h.id}"`;
  const { ST, ports } = form.menu;
  const sheerAt = (x) => {
    let i = 0;
    while (i < ST.length - 2 && ST[i + 1][0] < x) i++;
    const t = Math.max(0, Math.min(1, (x - ST[i][0]) / (ST[i + 1][0] - ST[i][0] || 1)));
    return ST[i][2] + (ST[i + 1][2] - ST[i][2]) * t;
  };

  const borne = ports.rows.reduce((n, r) => n + r.xs.length, 0);
  const above = ports.works.reduce((n, r) => n + r.xs.length, 0);
  const bat = parseBattery(ref);
  const meant = bat.decks.reduce((a, b) => a + b, 0) + bat.works.reduce((a, b) => a + b, 0);
  if (borne + above !== meant) {
    fault(where, `carried ${meant * 2} guns and stands ${(borne + above) * 2} of them: her battery says ${ref.battery} and something in the layout is dropping guns`);
  }
  if (borne !== h.guns.broadside - above) {
    fault(where, `bears ${h.guns.broadside} a side and shows ${borne} gun-deck ports with ${above} on her upper works, so a gun she can buy has nowhere to fire from`);
  }

  let low = Infinity, tightX = Infinity, tightZ = Infinity;
  ports.rows.forEach((r, i) => {
    for (const x of r.xs) low = Math.min(low, sheerAt(x) * r.f - r.hh);
    if (r.xs.length > 1) tightX = Math.min(tightX, r.xs[1] - r.xs[0] - 2 * r.hw);
    // tiers are placed as a fraction of the sheer, so they close up where the side is shallowest
    if (i) {
      const p = ports.rows[i - 1];
      for (const x of r.xs) tightZ = Math.min(tightZ, (r.f - p.f) * sheerAt(x) - r.hh - p.hh);
    }
  });
  if (low < 0.45) fault(where, `her lowest port sits ${n2(low)} above the water, which the renderer refuses to draw`);
  if (tightX < 0) fault(where, `her ports overlap their neighbours along a deck by ${n2(-tightX)}, so a tier draws as one smear rather than a row of ports`);
  if (tightZ < 0) fault(where, `two of her tiers overlap by ${n2(-tightZ)}, so one tier draws through the other`);
  // A hull with no castle has no topside to pierce, so her guns stand on her deck. One drawn both
  // ways would be a boat with ports cut into three feet of freeboard, or a ship of the line with her
  // whole battery sitting on her rail.
  if (ref.castle < 2 && ports.rows.length) fault(where, "is an open boat and drawn with ports cut in her side");
  if (ref.castle >= 2 && !ports.rows.length) fault(where, "has a built-up deck and no gun deck pierced under it");
  portAudit.push({ h, ref, ports, borne, above, low, tightX, tightZ });
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
  // a studdingsail attaches by the level of square canvas it booms out from, so one without a level
  // fits nothing and one nothing reaches is a part nobody can use
  if (s.kind === "STU") {
    if (!(s.level >= 0)) {
      fault(`sail "${s.id}"`, "a studdingsail needs `level`: which square sail up the mast it booms out from");
    } else if (!MAST_LIST.some((m) => m.berths.some((_, i) => squareLevel(m, i) === s.level))) {
      fault(`sail "${s.id}"`, `no mast in the catalogue carries square canvas at level ${s.level}, so it can never be run out`);
    }
  }
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
console.log("  " + pad("class", 19) + num("price", 7) + " " + pad("masts", 46) + pad("guns a side/bow/sw", 20) + num("bare", 5) + " -> " + num("found", 6) + "  " + pad("rated", 15) + num("outfit", 8));
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
    "  " + pad(`${rateOf(h).name}, ${gunsBorne(h)}`, 15),
    num(outfitCost(h.id), 8),
  );
}

console.log("\nHER BATTERY  (ports a side by tier, lowest first, then the guns standing on her decks)");
console.log("  " + pad("class", 19) + pad("battery", 16) + pad("pierced for", 20) + pad("on her decks", 30) + pad("port, lowest tier", 19) + num("clear", 7) + num("tiers", 7) + num("sill", 6));
for (const a of portAudit) {
  const low = a.ports.rows[0];
  const tiers = a.ports.rows.length ? a.ports.rows.map((r) => `${r.xs.length}`).join(" over ") + " a side" : "nothing";
  const where = { rail: "at her rail", aft: "aft", fore: "forward" };
  const above = a.ports.works.map((w) => `${w.xs.length} ${where[w.deck]}`).join(", ");
  console.log(
    "  " + pad(a.h.name, 19),
    pad(String(a.ref.battery), 16),
    pad(tiers, 20),
    pad(above || "none", 30),
    pad(low ? `${n2(2 * low.hw)} by ${n2(2 * low.hh)}` : "none", 19),
    num(Number.isFinite(a.tightX) ? n2(a.tightX) : "one", 7),
    num(Number.isFinite(a.tightZ) ? n2(a.tightZ) : "one", 7),
    num(Number.isFinite(a.low) ? n2(a.low) : "none", 6),
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
console.log("  " + pad("ship", 32) + pad("rated", 15) + num("overall", 8) + num("ram", 7) + num("throw", 7) + num("endurance", 10) + num("mobility", 9) + num("value", 8) + num("rigging", 9) + num("rebuild", 8));
for (const s of ladder()) {
  console.log(
    "  " + pad(s.name, 32),
    pad(s.rate.name, 15),
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

console.log("\nTHE RATES  (a rung is a count of guns borne, both sides, and every class sits on one)");
for (const r of RATES) {
  const classes = HULL_LIST.filter((h) => rateOf(h).rung === r.rung);
  const top = RATES[r.rung] ? `to ${RATES[r.rung].from - 1}` : "and up";
  const names = classes.map((h) => `${h.name} (${gunsBorne(h)})`).join("; ");
  console.log(`  ${pad(r.name, 15)} ${num(r.from, 4)} ${pad(top, 8)} ${num(classes.length, 3)} class${classes.length === 1 ? "" : "es"}  ${names || "(no class is rated here)"}`);
  // A rung with no class on it is a hole in the ladder rather than a fault: the fleet is edited a
  // row at a time and a rung fills the moment a hull is pierced for the guns. What IS a fault is a
  // rung a mode would field from and cannot, and that is the stock check below.
  if (classes.length && !stockOfRate(r.rung).length) fault("rates", `no stock ship is rated ${r.name}, so no mode can field one`);
}

const first = resolve(STARTER);
const start = measure(rate(first));
console.log(`\nTHE FIRST SHIP  ${rateOf(first.hull).name}, overall ${n1(start.overall)}, ram ${n1(start.ram)}`);
console.log(`  her rigging is worth ${riggingValue(first)}, so a new mast at sea costs her ${mastRebuildCost(first)}.`);
console.log("  Every hull in a fight brings her own rig, so that is what a rebuild costs HER and nobody else.");

/* ---- verdict --------------------------------------------------------------------------------- */

if (problems.size) {
  console.log(`\n${problems.size} PROBLEM${problems.size === 1 ? "" : "S"}`);
  for (const p of problems) console.log("  " + p);
  process.exit(1);
}
console.log("\nThe catalogue is sound.\n");

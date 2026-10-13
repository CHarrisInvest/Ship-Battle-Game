/**
 * THE HOLD TEST — `npm run hold-test`
 *
 * The hold's rules live in `src/holdrules.js` as pure functions, so the browser can answer a captain
 * at once and the server can decide what really happened by running the same rules on its own copy.
 * This holds them to that, in Node with no browser:
 *
 *   every shop action applies as the shipyard always did, and refuses what it always refused;
 *   an action handed junk (from step 3 its arguments come off the network) returns null and never
 *   throws, and never leaves a record `sanitize` would change;
 *   no action edits the record it was handed, which would corrupt the store's copy and the server's;
 *   a write pays any achievement rung that is owed, as `settle` always did on every write;
 *
 * and then the store, `src/hold.js`, over an in-memory localStorage: it still exports everything the
 * screen imports, every write through it is the rule's answer, a refusal writes nothing and tells
 * nobody, and what it saves reads back after a reload.
 */

import { HULLS, PARTS, STARTER } from "../src/shipyard.js";
import * as R from "../src/holdrules.js";

const failures = [];
const fail = (what) => { failures.push(what); console.log("  FAIL  " + what); };
const ok = (what) => console.log("  ok    " + what);
const check = (cond, what) => (cond ? ok(what) : fail(what));
const json = (v) => JSON.stringify(v);

// ---- the rules -------------------------------------------------------------------------------------

const fresh = () => R.blank();
const rich = (coins = 1e6) => ({ ...R.blank(), coins });
const act = (rec, name, ...args) => R.applyAction(rec, name, args);

{
  const rec = fresh();
  const ship = rec.yard.ships[rec.yard.active];
  check(ship && ship.hull === STARTER.hull, "a blank record carries the starter, and sails her");
  check(json(R.settle(rec).rec) === json(rec), "a blank record owes nothing");
  check(json(R.sanitize(JSON.parse(json(rec)))) === json(rec), "a blank record survives sanitize unchanged");
}

{
  check(!("bank" in R.ACTIONS) && !("spend" in R.ACTIONS), "banking and spending are not shop actions");
  check(act(fresh(), "bank", { earned: 1e6 }) === null, "a voyage cannot be banked through applyAction");
  check(act(fresh(), "toString") === null && act(fresh(), "__proto__") === null, "inherited names are not actions");
  check(R.applyAction(fresh(), "buyPart", "gun3") === null, "args that are not a list are refused");
}

// Every action, applied: the coins and the yard move the way the shipyard always moved them.
{
  let rec = rich(10000);
  const before = rec.coins;
  const bought = act(rec, "buyPart", "gun3");
  check(bought && bought.rec.coins === before - PARTS.gun3.price && bought.rec.yard.parts[bought.part]?.type === "gun3",
    "buyPart takes the price and puts one loose gun in the hold");
  rec = bought.rec;

  const sold = act(rec, "sellPart", bought.part);
  check(sold && sold.rec.coins === before && !sold.rec.yard.parts[bought.part] && sold.rec.spent === 0,
    "sellPart refunds in full and takes the price back off what was spent");

  const hull = act(rec, "buyShip", "sloop");
  check(hull && hull.rec.yard.ships[hull.ship]?.hull === "sloop" && hull.rec.coins === rec.coins - HULLS.sloop.price,
    "buyShip takes the hull's price and adds her bare");
  rec = hull.rec;
  const sloop = hull.ship;
  check(Object.values(rec.yard.ships[sloop].rig).every((s) => !s.mast) && rec.yard.ships[sloop].guns.broadside.length === 0,
    "a bought hull comes with no rig and no guns");

  const named = act(rec, "nameShip", sloop, "  Royal   Sovereign  ");
  check(named && named.rec.yard.ships[sloop].name === "Royal Sovereign" && R.shipName(named.rec, sloop) === "Royal Sovereign",
    "nameShip keeps the name as cleanName leaves it");
  rec = named.rec;

  const active = act(rec, "setActiveShip", sloop);
  check(active && active.rec.yard.active === sloop, "setActiveShip moves which ship she sails");
  rec = active.rec;

  const filled = act(rec, "fitOwned", sloop);
  check(filled && filled.fitted > 0, `fitOwned fits what is lying loose (${filled && filled.fitted} parts)`);
  rec = filled.rec;
  const gunId = rec.yard.ships[sloop].guns.broadside[0];
  check(!!gunId, "a gun went aboard her broadside");

  const off = act(rec, "unfitGun", sloop, gunId);
  check(off && !off.rec.yard.ships[sloop].guns.broadside.includes(gunId) && off.rec.yard.parts[gunId],
    "unfitGun takes a gun off her rail and keeps it in the hold");
  const on = act(off.rec, "fitGun", sloop, "broadside", gunId);
  check(on && on.rec.yard.ships[sloop].guns.broadside.includes(gunId), "fitGun runs it out again");

  // the starter's mast and sail, moved by hand: unstep it, step it again, bend the sail back on
  const starterId = Object.keys(rec.yard.ships).find((id) => rec.yard.ships[id].hull === STARTER.hull);
  const socket = Object.keys(rec.yard.ships[starterId].rig)[0];
  const slot = rec.yard.ships[starterId].rig[socket];
  const bare = act(rec, "fitMast", starterId, socket, null);
  check(bare && !bare.rec.yard.ships[starterId].rig[socket].mast, "fitMast with null unsteps the mast");
  const stepped = act(bare.rec, "fitMast", starterId, socket, slot.mast);
  check(stepped && stepped.rec.yard.ships[starterId].rig[socket].mast === slot.mast, "fitMast steps it again");
  const bent = act(stepped.rec, "fitSail", starterId, socket, 0, slot.sails[0]);
  check(bent && bent.rec.yard.ships[starterId].rig[socket].sails[0] === slot.sails[0], "fitSail bends a sail on");
  // studdingsails are laid up, so a stud is always refused: the action is wired and says no
  check(act(bent.rec, "fitStud", starterId, socket, 0, slot.sails[0]) === null, "fitStud refuses a part that is not a studdingsail");
}

// Refusals: what the shipyard always refused.
{
  const poor = fresh();
  check(act(poor, "buyShip", "firstRate") === null, "a hull she cannot afford is refused");
  check(act(rich(), "buyShip", "noSuchHull") === null, "a hull that does not exist is refused");
  check(act(rich(), "buyPart", "noSuchPart") === null, "a part that does not exist is refused");
  const r = act(rich(), "buyPart", "gun3");
  const ship = r.rec.yard.active;
  check(act(r.rec, "fitGun", ship, "bow", r.part) === null, "a broadside gun is refused at the bow");
  // past her tonnage: fill a gundalow's ports with the heaviest broadside guns there are
  const heavy = Object.values(PARTS).filter((p) => p.part === "gun" && p.mount === "broadside").sort((a, b) => b.price - a.price)[0];
  const h = act(rich(), "buyPart", heavy.id);
  check(act(h.rec, "fitGun", h.rec.yard.active, "broadside", h.part) === null || HULLS[STARTER.hull].tons >= 2 * heavy.tons,
    `a gun past her tonnage is refused (${heavy.id} on a ${STARTER.hull})`);
}

// Junk: from step 3 the arguments come off the network.
{
  const JUNK = [[], [null], [{}], ["nope", "nope", 3, "x"], [1e9, -1, NaN, Infinity], [{ toString: () => "s1" }], ["__proto__", "constructor"]];
  let threw = 0, dirty = 0, applied = 0;
  for (const name of Object.keys(R.ACTIONS)) {
    for (const args of JUNK) {
      let out;
      try { out = R.applyAction(rich(), name, args); } catch (e) { threw++; fail(`${name}(${json(args)}) threw: ${e.message}`); continue; }
      if (out) {
        applied++;
        if (json(R.sanitize(JSON.parse(json(out.rec)))) !== json(out.rec)) { dirty++; fail(`${name}(${json(args)}) left a record sanitize would change`); }
      }
    }
  }
  check(!threw && !dirty, `every action takes junk without throwing or leaving a bad record (${applied} of them still did something legal)`);
}

// Junk beside real ids: a real ship, socket and part in some places and junk in the rest, which is
// what a crafted request looks like. Every action, every position: no throw, and whatever comes back
// can be written down (a record JSON cannot hold would fail the server's write) and reads back.
{
  const base = act(act(rich(), "buyShip", "sloop").rec, "buyPart", "gun3").rec;
  const ship = base.yard.active;
  const socket = Object.keys(base.yard.ships[ship].rig)[0];
  const slot = base.yard.ships[ship].rig[socket];
  const REAL = [ship, socket, 0, slot.mast, slot.sails[0], base.yard.ships[ship].guns.broadside[0], "broadside", null];
  const JUNK = [undefined, null, "__proto__", "constructor", "toString", "", 1, -1, 1.5, 1e9, 2 ** 53, NaN, [], {}, "bow", "swivel"];
  let threw = 0, broken = 0, tried = 0;
  for (const name of Object.keys(R.ACTIONS)) {
    for (let width = 1; width <= 4; width++) {
      for (let at = 0; at < width; at++) {
        for (const real of REAL) {
          for (const junk of JUNK) {
            const args = Array.from({ length: width }, (_, i) => (i === at ? junk : i === 0 ? ship : real));
            tried++;
            let out;
            try { out = R.applyAction(base, name, args); } catch (e) { threw++; if (threw < 4) fail(`${name}(${String(args)}) threw: ${e.message}`); continue; }
            if (!out) continue;
            let text;
            try { text = json(out.rec); } catch (e) { broken++; if (broken < 4) fail(`${name}(${String(args)}) built a record JSON cannot hold: ${e.message}`); continue; }
            if (text.length > 1e6 || json(R.sanitize(JSON.parse(text))) !== json(R.sanitize(R.sanitize(JSON.parse(text))))) {
              broken++; if (broken < 4) fail(`${name}(${String(args)}) built a record that does not read back`);
            }
          }
        }
      }
    }
  }
  check(!threw && !broken, `real ids beside junk never throw or build a bad record (${tried} calls)`);
}

// Purity: no action edits the record it was handed.
{
  const base = act(act(rich(), "buyShip", "sloop").rec, "buyPart", "gun3").rec;
  const sloop = Object.keys(base.yard.ships).find((id) => base.yard.ships[id].hull === "sloop");
  const loose = Object.keys(base.yard.parts).find((pid) => base.yard.parts[pid].type === "gun3" && !Object.values(base.yard.ships).some((s) => s.guns.broadside.includes(pid)));
  const CALLS = [
    ["buyPart", "gun4"], ["sellPart", loose], ["buyShip", "bermudaSloop"], ["nameShip", sloop, "Swift"],
    ["setActiveShip", sloop], ["fitOwned", sloop], ["fitGun", sloop, "broadside", loose], ["unfitGun", base.yard.active, loose],
    ["fitMast", base.yard.active, Object.keys(base.yard.ships[base.yard.active].rig)[0], null],
  ];
  let touched = 0;
  for (const [name, ...args] of CALLS) {
    const snap = json(base);
    R.applyAction(base, name, args);
    if (json(base) !== snap) { touched++; fail(`${name} edited the record it was handed`); }
  }
  check(!touched, `no action edits the record it was handed (${CALLS.length} actions)`);
}

// Settlement: a write pays what is owed.
{
  const won = R.bank(fresh(), { mode: "ffa", earned: 400, kills: 1, won: true, rank: 1, time: 60 });
  check(won.banked === R.voyageValue(400, 0) && won.rec.coins >= won.banked, `bank adds what voyageValue says (${won.banked})`);
  check(won.bounty > 0 && won.rec.bounties === won.bounty, `a voyage that sinks her first ship pays its rung (${won.bounty})`);
  check(json(R.settle(won.rec).rec) === json(won.rec), "and what bank returns is already settled");

  // a record with a rung earned but not paid, the way an old record or a new achievement leaves one
  const owed = R.sanitize({ ...JSON.parse(json(fresh())), coins: 1000, lifetime: { ...fresh().lifetime, sunk: 1 } });
  check(owed.bounties === 0, "a sanitized record is not settled by sanitize itself");
  const paid = act(owed, "buyPart", "gun3");
  check(paid && paid.rec.bounties > 0 && paid.rec.coins === 1000 - PARTS.gun3.price + paid.rec.bounties,
    "a shop action pays the rung that was owed, in the record it returns");

  check(R.spend(fresh(), 10) === null && R.spend(rich(100), 40).rec.coins === 60, "spend refuses what she does not have");
}

// ---- the store ---------------------------------------------------------------------------------------

const memory = () => {
  const m = new Map();
  let writes = 0;
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { writes++; m.set(k, String(v)); },
    removeItem: (k) => m.delete(k),
    get writes() { return writes; },
    dump: () => Object.fromEntries(m),
  };
};

const storage = memory();
globalThis.window = { localStorage: storage, addEventListener() {} };
const H = await import("../src/hold.js");

{
  const WANTS = [
    "getHold", "bankVoyage", "subscribeHold", "modeRecord", "shipLoadout", "shortfall",
    "buyShip", "buyPart", "fitMast", "fitSail", "fitStud", "fitGun", "unfitGun", "setActiveShip", "spareParts", "ownedShips", "partOf",
    "shipName", "nameShip", "fitOwned", "ownedFill", "NAME_LIMIT", "readiness", "sellPart", "refundOf",
    "holdIsPersistent", "spendFromHold", "getYard", "voyageValue", "cleanName", "HOLD_SHARE", "REFUND_SHARE",
  ];
  const missing = WANTS.filter((k) => !(k in H));
  check(!missing.length, `the store still exports everything the screen reads${missing.length ? ` (missing ${missing.join(", ")})` : ""}`);
}

{
  // A script of writes through the store, each compared with the rule applied to the record before it.
  let calls = 0;
  const unsub = H.subscribeHold(() => calls++);
  const step = (label, run, rule) => {
    const before = H.getHold();
    const want = rule(before);
    const got = run();
    const after = H.getHold();
    const same = want ? json(after) === json(want.rec) : json(after) === json(before);
    if (!same) fail(`${label}: the store's record is not the rule's`);
    return got;
  };

  const banked = step("bankVoyage", () => H.bankVoyage({ mode: "ffa", earned: 20000, kills: 2, won: true, rank: 1, time: 90 }),
    (r) => R.bank(r, { mode: "ffa", earned: 20000, kills: 2, won: true, rank: 1, time: 90 }));
  check(banked && banked.hold && typeof banked.banked === "number" && typeof banked.bounty === "number" && Array.isArray(banked.rungs),
    "bankVoyage returns { hold, banked, bounty, rungs }");

  const part = step("buyPart", () => H.buyPart("gun4"), (r) => act(r, "buyPart", "gun4"));
  check(part && part.hold && typeof part.part === "string", "buyPart returns { hold, part }");
  const ship = step("buyShip", () => H.buyShip("sloop"), (r) => act(r, "buyShip", "sloop"));
  check(ship && ship.hold && typeof ship.ship === "string", "buyShip returns { hold, ship }");
  const named = step("nameShip", () => H.nameShip(ship.ship, "Swift"), (r) => act(r, "nameShip", ship.ship, "Swift"));
  check(named && named.yard && named.yard.ships[ship.ship].name === "Swift", "nameShip returns the record");
  const fitted = step("fitOwned", () => H.fitOwned(ship.ship), (r) => act(r, "fitOwned", ship.ship));
  check(fitted && fitted.hold && fitted.fitted > 0, "fitOwned returns { hold, fitted }");
  const gun = H.getHold().yard.ships[ship.ship].guns.broadside[0];
  step("unfitGun", () => H.unfitGun(ship.ship, gun), (r) => act(r, "unfitGun", ship.ship, gun));
  step("fitGun", () => H.fitGun(ship.ship, "broadside", gun), (r) => act(r, "fitGun", ship.ship, "broadside", gun));
  step("setActiveShip", () => H.setActiveShip(ship.ship), (r) => act(r, "setActiveShip", ship.ship));
  step("sellPart", () => H.sellPart(part.part), (r) => act(r, "sellPart", part.part));
  ok("every write through the store is the rule's answer on the record before it");

  // A refusal writes nothing and tells nobody.
  const snap = json(H.getHold());
  const writes = storage.writes, heard = calls;
  check(H.buyShip("firstRate") === null && H.fitGun("nope", "broadside", "nope") === null, "a refused write returns null");
  check(json(H.getHold()) === snap && storage.writes === writes && calls === heard, "and saves nothing and tells no subscriber");
  unsub();

  // What was saved reads back after a reload.
  const saved = JSON.parse(storage.dump()["sternchase.hold"]);
  check(json(R.sanitize(saved)) === json(H.getHold()), "what the store saved sanitizes to what it holds");
  const again = await import("../src/hold.js?reload=1");
  check(json(again.getHold()) === json(H.getHold()), "and a reload reads the same record back");
}

if (failures.length) {
  console.log(`\n${failures.length} FAILURE${failures.length === 1 ? "" : "S"}`);
  process.exit(1);
}
console.log("\nThe hold keeps its rules.\n");

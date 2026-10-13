/**
 * THE CARPENTER: what a repair at sea puts back, and what it costs.
 */

import { mastRebuildCost } from "../shipyard.js";
import { STOCK_LOADOUT } from "./ships.js";

/**
 * REPAIRS — the one thing a purse buys at sea, and the only reason to carry coins into a fight.
 *
 * Two buttons, and they are priced on opposite principles because they are opposite jobs.
 *
 * HULL is bought by the point, and by nothing else. A coin buys back a point of damage: no base, no
 * rate and no share of anything. What she pays is exactly what the damage she is undoing was worth to
 * the ship that dealt it, which puts both halves of a round's economy in the same currency and means
 * a captain can read her own hull bar as a price.
 *
 * What it will not buy is a whole ship. A carpenter at sea works with what is in the hold: he plugs
 * shot holes, fishes a cracked timber and pumps her out, and that stops at `HULL_PATCH_CAP`. Sound
 * planking, a new strake and her seams paid afresh are a slipway's work, so the last fifth of her
 * hull waits for the yard however deep her purse is. A ship that has been in a fight carries it until
 * the voyage ends, which is the difference between the hull and the rig: a mast is a spar to be
 * swayed up and a hull is the ship herself.
 *
 * Because the bill is her damage and nothing else, it scales with the class she is sailing without a
 * scaling term anywhere: a hull with two hundred and fifty points to lose can run up a bill of two
 * hundred, four fifths of her, and the cutter that has ninety can never be charged more than
 * seventy-two. Bigger ships cost more to keep afloat because there is more of them to hole.
 *
 * Two things follow and both are the point: a ship barely scratched pays almost nothing, so there is
 * no wrong moment to repair, and a captain who cannot cover the whole bill buys as much of it as her
 * purse reaches rather than being refused, which matters most in the round where she is down to her
 * last coins and still taking fire.
 *
 * MAST is flat, and it is a jury rig. A mast is stepped or it is not: there is no half a mast, so
 * there is no half price and no part payment, and the charge is the same whether she lost the whole
 * thing or sprung it. What sets the price is the mast she carries rather than the damage she took: a
 * coin a point of the rig the jury mast puts back, `MAST_REBUILD_SHARE` of her mast's health, which is
 * the shipyard's figure and not the fight's.
 *
 * What goes up is a spare spar swayed up with what the sail locker holds, not the suit she sailed
 * with, so it stops at `MAST_JURY_CAP` the way the hull stops at its own. Because speed and helm both
 * read how much of her rig is standing, that is nineteen twentieths of her way and a little over nine
 * tenths of her helm: not the ship she was, but sailing again, and that is what makes it worth the
 * money. Losing a mast is the one hit that takes a ship out of a fight while leaving her afloat, and
 * a jury rig is the difference between limping and drifting.
 *
 * CREW cannot be bought back at all. Hands lost over the rail are lost, and no coin brings them
 * back, so the crew bar is a clock that only runs one way for the length of a round. It is why
 * musket fire and a spell in the weather are worth avoiding rather than paying off afterwards.
 *
 * What makes any of it a decision rather than a tax is where the money comes from. Repairs are paid
 * out of the voyage's own takings, so every coin spent staying afloat is a coin that does not reach
 * the hold and does not buy a ship. Fighting carefully is worth money.
 */
export const HULL_RATE = 1; // a coin a point. Deliberately 1, and the one place to change it if it ever moves

/**
 * How much of her hull the carpenter can put back at sea, and the one place that figure lives.
 *
 * Damage above the cap is not cheaper, it is unbuyable: the quote stops at the cap, the button stops
 * offering, and nothing anywhere else clamps the hull, so a captain who never takes a hit is never
 * pulled down to it. A repair only ever raises her towards the cap and never above it.
 */
export const HULL_PATCH_CAP = 0.8;
/** The most hull a purse can reach on this ship. Whole is a shipyard's business. */
export const patchCap = (s) => s.maxHull * HULL_PATCH_CAP;

/**
 * How much of her rig a jury mast is worth, and the reason the mast button no longer promises whole.
 *
 * A spare spar fished and swayed up carries sail again, but it is not the mast that came out of her
 * and the canvas on it is whatever the locker held. She is nine tenths of a ship, which `speedCap`
 * and `turnCap` read as nineteen twentieths of her way and a little over nine tenths of her helm.
 * `MAST_REBUILD_SHARE` in the shipyard is priced for exactly that nine tenths, a coin a point, so a
 * captain pays for the rig she gets back and never more than her mast is worth.
 */
export const MAST_JURY_CAP = 0.9;
/** The most rig a purse can reach on this ship. The last tenth is stepped in a yard, not at sea. */
export const juryCap = (s) => s.maxMast * MAST_JURY_CAP;

/**
 * What a new mast costs at sea: nine tenths of her own mast's health, a coin a point.
 *
 * Every ship afloat brings her own loadout, so the bill is hers: a first rate's mast is a first
 * rate's mast to put back, and a gundalow's costs a gundalow's. The starter's rig is the fallback for a hull that somehow reaches the water without one,
 * which nothing should do.
 */
export const mastRebuild = (s) => mastRebuildCost(s.loadout || STOCK_LOADOUT);

/**
 * What one repair would put back and what it would cost. Everything the rail needs to draw itself and
 * everything `repair()` needs to charge for, worked out in one place so the button cannot promise
 * something different from what the purchase does.
 *
 * `afford` is what her purse actually reaches. For the hull that can be part of the bill; for the
 * mast it is the whole price or nothing, because half a mast is not a thing.
 *
 * Both are quoted against their cap rather than against her full bar, so a captain is never charged
 * for work that cannot be done at sea. `label` is why a dead button is dead, and the two reasons are
 * different news: she has taken nothing worth mending, or what is left of the damage needs a yard.
 */
export function repairQuote(s, sys) {
  if (sys === "hull") {
    const points = Math.max(0, patchCap(s) - s.hull);
    const cost = Math.ceil(points * HULL_RATE);
    return {
      points,
      cost,
      afford: Math.min(cost, Math.floor(s.coins)),
      whole: points <= 0.001,
      label: s.hull >= s.maxHull - 0.001 ? "Sound" : "Yard work",
      part: true,
    };
  }
  const cost = mastRebuild(s);
  const points = Math.max(0, juryCap(s) - s.mast);
  const whole = points <= 0.001;
  return {
    points,
    cost,
    afford: Math.floor(s.coins) >= cost ? cost : 0,
    whole,
    label: s.mast >= s.maxMast - 0.001 ? "Sound" : "Yard work",
    part: false,
  };
}

/**
 * Carry out one repair and charge her purse for it.
 *
 * The hull takes as much of the bill as she can pay and rises by that share of the work, and the work
 * on offer ends at `patchCap`: a full bill bought outright leaves her at four fifths and no further.
 * The mast is all or nothing and goes to `juryCap` in one step, which hands her back nearly all her
 * sail in the same instant, because `speedCap` and `turnCap` both read how much of her rig is
 * standing.
 *
 * `repaired` is banked apart from `coins` because the two answer different questions at the end of a
 * round: what she has left, and what she spent staying afloat. Only the second comes off her
 * earnings.
 */
export function repair(s, sys) {
  const q = repairQuote(s, sys);
  if (q.whole || q.afford <= 0) return 0;
  const before = s[sys];
  if (sys === "hull") {
    s.hull = Math.min(patchCap(s), s.hull + q.points * (q.afford / q.cost));
  } else {
    s.mast = juryCap(s);
    // A rig re-stepped is a rig again. Without this a mast shot away stayed away however much canvas
    // she bent on, and the one repair worth buying most was the one that did nothing. A jury mast is
    // still a mast, so it clears the flag as a proper one did: what she is short is the last tenth of
    // her rig, not her rig.
    s.mastDown = false;
  }
  s.coins -= q.afford;
  s.repaired += q.afford;
  s.patches += 1;
  // the points the work put back, the twin of `dmgDealt` on the other side of the ledger
  s.healed += Math.max(0, s[sys] - before);
  return q.afford;
}

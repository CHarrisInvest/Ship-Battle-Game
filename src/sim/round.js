/**
 * THE ROUND: what a blow and a sinking pay and who they are credited to, the standings in a ranked
 * mode, when the round is over and who won it, and what a voyage has earned.
 */

import { hunterOf, reinforcementsOf } from "./modes.js";
import { isHuman, shipOf } from "./ships.js";

// What a sinking pays her killer, as a share of the hull that went down. A quarter of a ship's
// launch is the flat 25 the game paid when every hull afloat was worth a hundred points.
export const KILL_SHARE = 0.25;

/**
 * What a player has earned so far, which is what the end screen prints and what reaches the
 * hold. A winner is paid as a winner, so it is only final once the round is over.
 */
export function voyageStats(world, playerId) {
  const p = shipOf(world, playerId), r = world.rules;
  const won = world.result.winners.some((w) => w.playerId === playerId);
  const time = world.time || 0;
  const paidInFull = !!(won && r.fullRound); // she ended it early; she is paid as though she had not
  const timePay = Math.round((paidInFull ? r.fullRound : time) * r.timeCoins);
  const winPay = won ? r.winBonus : 0;
  const fought = Math.round(p.earned || 0);
  const repaired = Math.round(p.repaired || 0);
  const total = fought + timePay + winPay;
  return {
    time,
    kills: p.kills || 0,
    dmg: Math.round(p.dmgDealt || 0),
    coins: fought, // what her bow and her guns took
    patches: p.patches || 0,
    repaired, // ...and what she handed straight back to the carpenter, all of it her own money
    rams: p.rams || 0,
    dismasted: p.dismasted || 0,
    healed: Math.round(p.healed || 0),
    sunkByRam: p.sunkBy.ram, sunkByGuns: p.sunkBy.broadside, sunkByMuskets: p.sunkBy.musket,
    rammedWhole: p.rammedWhole || 0,
    wornDown: p.wornDown || 0,
    timePay, winPay, paidInFull,
    total,
  };
}

/**
 * THE ROUND ENDS ONCE, HERE, at the end of the step. Hits and the weather only mark ships dead;
 * nothing inside a hit handler ends the round, because a step is not over when a hull goes
 * under. A rival's ball already in the air can still find the player after her last rival sank,
 * and the storm can take the last two crews on one tick, and each of those used to raise both
 * ends at once: a win banked, then a sinking painted over it. So the step plays out and one
 * question is asked of what it left. A sinking outranks a win: if she is not afloat she was not
 * the last afloat, whatever else went down beside her.
 */
export function judge(world) {
  if (world.result.over) return;
  const humans = world.ships.filter(isHuman);
  const standing = world.ships.filter((s) => s.alive).length;
  const sunk = humans.filter((s) => !s.alive);
  let winners = [], losers = [];
  if (sunk.length) {
    // a round has one human in it, so her sinking is the end of it; a world with several would
    // have to say whose round goes on
    const together = world.rules.lastAfloatWins && standing === 0;
    losers = sunk.map((s) => ({ playerId: s.playerId, rank: world.rules.ranked ? standing + 1 : 0, cause: together ? "together" : s._deathBar || "hull" }));
  } else if (
    (world.rules.lastAfloatWins && standing === 1) ||
    // the ladder is climbed when there is no rung left to send, which the same rule the spawner
    // reads says by sending nothing
    (world.rules.ladder && !hunterOf(world.rules, world.playerStrength, world.sunk))
  ) {
    winners = humans.map((s) => ({ playerId: s.playerId, rank: world.rules.ranked ? 1 : 0 }));
  } else return;
  world.result = { over: true, winners, losers, field: world.fieldSize };
  world.events.push({ type: "round_over", result: world.result });
}

/**
 * The bounty on a sinking: a quarter of what she was, so it scales with the fleet the way the
 * rest of the economy already does.
 *
 * A coin is earned a point of damage and a coin is charged a point of damage, so putting a first
 * rate under pays twenty-seven times what a gundalow pays and costs twenty-seven times as much to
 * undo, with no scaling term anywhere in either. The bounty was the one flat term left, and
 * against a class worth three thousand points of hull a flat 25 was a rounding error rather than
 * the reward for finishing her. A quarter of her hull comes to exactly 25 on the smallest ship
 * in the fleet, so nothing moved at the bottom of it.
 */
export function killShip(world, s, attacker, cause, standing = !!(attacker && attacker.alive)) {
  if (attacker && standing) {
    const bounty = Math.round(KILL_SHARE * s.maxHull);
    attacker.coins += bounty;
    attacker.earned += bounty;
    attacker.kills = (attacker.kills || 0) + 1;
    if (cause in attacker.sunkBy) attacker.sunkBy[cause] += 1;
    if (isHuman(attacker)) {
      // Both are judged on what the player did to her and not on the state she went down in,
      // because in a melee her bars carry every rival's work and the storm's besides. Worn down
      // is half of each of her three bars off the player's own guns and bow; by the bow alone is
      // her whole hull gone to the player's ram, with a hair of tolerance for the float sum.
      const b = s.byPlayer;
      const half = (got, max) => max <= 0 || got >= max * 0.5;
      if (half(b.hull, s.maxHull) && half(b.mast, s.maxMast) && half(b.crew, s.maxCrew)) attacker.wornDown += 1;
      if (cause === "ram" && b.ram >= s.maxHull - 1e-6) attacker.rammedWhole += 1;
    }
  }
  world.events.push({ type: "sunk", shipId: s.id, by: attacker ? attacker.id : null, cause: s._deathBar, x: s.x, y: s.y });
  // she is marked and left where she lies; `judge` reads the step when it is over
  if (isHuman(s)) { s.alive = false; return; }
  const i = world.ships.indexOf(s);
  if (i >= 0) world.ships.splice(i, 1);
  for (const o of world.ships) o.locked.delete(s); // she is on the bottom; nobody is fouled on her
  if (world.rules.reinforcements) {
    world.sunk += 1;
    world.spawnQueue = Math.min(world.spawnQueue + reinforcementsOf(world.rules, world.sunk), world.rules.fleetCap);
    world.spawnT = 0; // lead ship of the wave sails in at once, the next one waits out the gap
  }
}

export function canHit(world, owner, target) {
  if (!target.alive || target === owner) return false;
  if (world.rules.melee) return true;
  return owner.controller !== target.controller;
}

/**
 * One hit landing. `cause` names what landed it, `ram` or the weapon kind on the ball, and it is
 * carried because the bar alone cannot say: a ram and a broadside both stave in the hull, and
 * the record wants to know which one finished her.
 */
export function applyHit(world, target, bar, amt, attacker, cause, standing = !!(attacker && attacker.alive), x = target.x, y = target.y) {
  const before = target[bar];
  target[bar] = Math.max(0, before - amt);
  // Credited as what she actually lost, not what was thrown, so the sum over every hit she took
  // is her whole bar and a single ball cannot overshoot it. That goes for the coins as well as
  // the tallies: a coin a point is the promise the repair rail makes, and a ram worth seven
  // hundred landing on a boat with a hundred to lose was being paid the seven hundred.
  const took = before - target[bar];
  // said before anything it leads to, so a ball that sinks her breaks on her timbers first
  world.events.push({ type: "hit", targetId: target.id, bar, dmg: took, x, y, by: attacker ? attacker.id : null, cause });
  // `standing` is whether the attacker counts for the credit. It is her being afloat, unless the
  // caller says otherwise: two bows meeting resolve both blows, and the second is still hers
  // even if the first has just put her under.
  if (attacker && standing) {
    attacker.coins += took;
    attacker.earned += took;
    attacker.dmgDealt = (attacker.dmgDealt || 0) + took;
    if (isHuman(attacker)) {
      target.byPlayer[bar] += took;
      if (cause === "ram") target.byPlayer.ram += took;
    }
  }
  if (bar === "mast" && before > 0 && target[bar] <= 0 && !target.mastDown) {
    target.mastDown = true;
    if (attacker && standing) attacker.dismasted += 1;
    world.events.push({ type: "dismasted", shipId: target.id, by: attacker ? attacker.id : null, x: target.x, y: target.y });
  }
  if ((bar === "hull" || bar === "crew") && target[bar] <= 0 && target.alive) {
    target._deathBar = bar;
    killShip(world, target, attacker, cause, standing);
  }
}

export function computeMeta(world) {
  if (!world.rules.ranked) return;
  const alive = world.ships.filter((s) => s.alive);
  alive.sort((a, b) => b.earned - a.earned || b.coins - a.coins);
  alive.forEach((s, i) => (s.rank = i + 1));
  world.leader = alive[0] || null;
  world.aliveCount = alive.length;
  world.avgEarned = alive.reduce((t, s) => t + s.earned, 0) / Math.max(1, alive.length);
}

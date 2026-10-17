/**
 * THE ROUND: what a blow and a sinking pay and who they are credited to, the standings in a ranked
 * mode, when the round is over and who won it, and what a voyage has earned.
 */

import { hunterOf, reinforcementsOf } from "./modes.js";
import { isHuman, shipOf } from "./ships.js";
import { SIDES } from "./tables.js";

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
  // a captain who has gone under is paid for the time she was afloat, not for the round's
  const time = (p.placed ? p.sankAt : world.time) || 0;
  const paidInFull = !!(won && r.fullRound); // she ended it early; she is paid as though she had not
  const timePay = Math.round((paidInFull ? r.fullRound : time) * r.timeCoins);
  // a side wins for every captain of it, and one who went under before the end is paid the smaller
  // purse; where the last afloat wins, a winner is always afloat
  const winPay = won ? (p.alive ? r.winBonus : r.sunkWinBonus) : 0;
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
 * A fingerprint of the ships: where each is, which way she heads, how fast, and her three bars. A
 * round stepped by two engines from the same seed and the same inputs prints the same, so an online
 * browser compares its own against the server's every few seconds to know it is still in step.
 */
export function shipsPrint(world) {
  let h = 0x811c9dc5;
  const text = JSON.stringify(world.ships.map((s) => [s.id, s.x, s.y, s.heading, s.spdCur, s.hull, s.mast, s.crew, s.alive]));
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/**
 * What a finished voyage banks: the summary `bank` in `holdrules.js` takes, read off the world as
 * the end screen always read it. One statement of it, because the browser banks it today and the
 * server will bank it off its own replay, and two hand-built copies would drift.
 */
export function voyageRun(world, playerId) {
  const result = world.result;
  const won = result.winners.some((w) => w.playerId === playerId);
  const mine = (won ? result.winners : result.losers).find((r) => r.playerId === playerId) || { rank: 0 };
  const s = voyageStats(world, playerId);
  return {
    mode: world.mode, earned: s.total, repaired: s.repaired, kills: s.kills, dmg: s.dmg,
    time: s.time, rams: s.rams, patches: s.patches, won, rank: mine.rank,
    dismasted: s.dismasted, healed: s.healed,
    sunkByRam: s.sunkByRam, sunkByGuns: s.sunkByGuns, sunkByMuskets: s.sunkByMuskets,
    rammedWhole: s.rammedWhole, wornDown: s.wornDown,
  };
}

/**
 * THE ROUND ENDS ONCE, HERE, at the end of the step. Hits and the weather only mark ships dead;
 * nothing inside a hit handler ends the round, because a step is not over when a hull goes
 * under. A rival's ball already in the air can still find a captain after her last rival sank,
 * and the storm can take the last two crews on one tick, and each of those used to raise both
 * ends at once: a win banked, then a sinking painted over it. So the step plays out and one
 * question is asked of what it left.
 *
 * Every captain who went under on this step is placed now, at the number of ships still afloat
 * plus one, so two who go down together share a place, and she is told at once by `player_out`
 * while the rest fight on. The round is over when no captain is left afloat, or when the last
 * ship afloat (or the top of the ladder) says the ones who are have won. A sinking outranks a
 * win: a captain not afloat was not the last afloat, whatever else went down beside her. With one
 * captain aboard this is the rule the game always had: her sinking ends it.
 *
 * Between sides the question is asked of the fleets rather than of the captains. The round is over
 * when a side has no ship afloat, AI included, and goes to the other, every captain of it, sunk or
 * not: `result.side` names it, and a captain who went under before the end is in `winners` with
 * the cause she went down for, where `voyageStats` pays her the smaller purse. Both sides wiped on
 * one step is a round nobody won. It does not end when the last captain is out, because the side
 * is still at sea: whoever runs the round sails it on until a fleet is gone.
 */
export function judge(world) {
  if (world.result.over) return;
  if (world.watching) {
    // a round being watched has nobody left to place: it ends when the fight it is showing does
    const left = world.ships.filter((s) => s.alive);
    if (left.length > 1) return;
    world.result = { ...world.watching, over: true, lastShip: left.length ? left[0].id : null };
    world.events.push({ type: "round_over", result: world.result });
    return;
  }
  const humans = world.ships.filter(isHuman);
  const standing = world.ships.filter((s) => s.alive).length;
  if (world.rules.sides) return judgeSides(world, humans);
  const together = world.rules.lastAfloatWins && standing === 0;
  for (const s of humans) {
    if (s.alive || s.placed) continue;
    s.placed = true;
    s.sankAt = world.time;
    const out = { playerId: s.playerId, rank: world.rules.ranked ? standing + 1 : 0, cause: together ? "together" : s._deathBar || "hull" };
    world.out.push(out);
    world.events.push({ type: "player_out", ...out });
  }
  const afloat = humans.filter((s) => s.alive);
  let winners = [];
  if (afloat.length && (
    (world.rules.lastAfloatWins && standing === 1) ||
    // the ladder is climbed when there is no rung left to send, which the same rule the spawner
    // reads says by sending nothing
    (world.rules.ladder && !hunterOf(world.rules, world.playerStrength, world.sunk))
  )) {
    winners = afloat.map((s) => ({ playerId: s.playerId, rank: world.rules.ranked ? 1 : 0 }));
  } else if (afloat.length) return;
  world.result = { over: true, winners, losers: world.out.map((o) => ({ ...o })), field: world.fieldSize };
  world.events.push({ type: "round_over", result: world.result });
}

function judgeSides(world, humans) {
  const gone = SIDES.filter((side) => afloatOf(world, side).length === 0);
  const together = gone.length === SIDES.length;
  for (const s of humans) {
    if (s.alive || s.placed) continue;
    s.placed = true;
    s.sankAt = world.time;
    // nobody is placed between sides: a finishing order means nothing across two fleets
    const out = { playerId: s.playerId, rank: 0, cause: together ? "together" : s._deathBar || "hull" };
    world.out.push(out);
    world.events.push({ type: "player_out", ...out });
  }
  if (!gone.length) return;
  const side = together ? null : SIDES.find((x) => !gone.includes(x));
  const sunk = (s) => world.out.find((o) => o.playerId === s.playerId);
  const entry = (s) => (s.alive ? { playerId: s.playerId, rank: 0 } : { ...sunk(s) });
  const winners = side ? humans.filter((s) => s.side === side).map(entry) : [];
  const losers = humans.filter((s) => s.side !== side).map(entry);
  world.result = { over: true, winners, losers, field: world.fieldSize, side };
  world.events.push({ type: "round_over", result: world.result });
}

/**
 * THE ROUND SAILS ON WITHOUT HER: a copy of a round that is over for its captains, to watch the
 * rest of the fight. Her own round stays exactly as it ended, because that is the one her voyage
 * was banked on, and the copy is a show, with nobody's coins or placing in it: it keeps her result
 * as it stood and ends when one ship or none is left afloat, naming the last in `lastShip`.
 *
 * Only a round where the last ship afloat wins has a fight left to watch. An arena sends its
 * hunters after the captains alone, so with her gone they would have nothing to sail for. Returns
 * null when there is nothing to watch, which `playsOn` says without making the copy.
 */
export function playOn(world) {
  if (!playsOn(world)) return null;
  const w = structuredClone(world);
  w.watching = { winners: w.result.winners, losers: w.result.losers, field: w.result.field };
  w.result = { over: false, winners: [], losers: [], field: w.result.field };
  return w;
}

/** Whether a round has a fight left to watch: over for its captains, with two ships or more still at it. */
export function playsOn(world) {
  return !!(world.result.over && world.rules.lastAfloatWins && !world.watching && world.ships.filter((s) => s.alive).length > 1);
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
      // Both are judged on what this captain did to her and not on the state she went down in,
      // because in a melee her bars carry every rival's work and the storm's besides. Worn down
      // is half of each of her three bars off this captain's own guns and bow; by the bow alone is
      // her whole hull gone to her own ram, with a hair of tolerance for the float sum.
      const b = s.byPlayers[attacker.playerId] || { hull: 0, mast: 0, crew: 0, ram: 0 };
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

/**
 * Whether two hulls are enemies, which is the one question every weapon and every AI captain asks.
 * Between sides it is the side she sails with; in a melee everyone is; otherwise the fleet is
 * against the captains and nobody else.
 */
export function hostile(world, a, b) {
  if (a === b) return false;
  if (world.rules.sides) return a.side !== b.side;
  if (world.rules.melee) return true;
  return a.controller !== b.controller;
}

/** Whether a ball or a volley from `owner` can touch `target`: afloat, and an enemy. */
export function canHit(world, owner, target) {
  return target.alive && hostile(world, owner, target);
}

/** The ships of one side still afloat, in a mode fought between sides. */
export const afloatOf = (world, side) => world.ships.filter((s) => s.alive && s.side === side);

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
      const b = (target.byPlayers[attacker.playerId] ||= { hull: 0, mast: 0, crew: 0, ram: 0 });
      b[bar] += took;
      if (cause === "ram") b.ram += took;
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

/**
 * THE REPLAY TEST — `npm run replay-test`
 *
 * The instant replay is the last seconds of the round sailed again from a copy of the world, which
 * is only a replay if the copy steps to the very bits the round did. Rounds are sailed here in plain
 * Node with a tape recording, and it fails if:
 *
 *   a clip cut at the round's end does not end in the round's own final world, bit for bit;
 *   a clip cut mid-round does not end in the world as it stood at that tick;
 *   a clip does not open where the rule says: a moment before the first hit of the final exchange
 *   between the ships the moment was about, never more than `REPLAY_MOST` seconds before the end,
 *   never less than `REPLAY_LEAST`, and the whole round when it ran shorter than that;
 *   a clip of a round with several captains loses one captain's controls;
 *   the player does not reach the same end in real-time frames, with its last second at half pace,
 *   hold a beat on the blow, sail on through its tail (the world stepping on past the round's own
 *   end with her hands easing off the stick, so a sinking is seen whole), start over, and after its
 *   passes hold on its last frame;
 *   the recording leaves the round it records a different round.
 */

import { createWorld, step, TICK, SIDES } from "../src/sim/index.js";
import { createTape, createReplay, REPLAY_MOST, REPLAY_LEAST, EXCHANGE_GAP, EXCHANGE_LEAD, SLOW_SECONDS, HIT_STOP, REPLAY_TAIL, REPLAY_LOOPS } from "../src/replay.js";
import { LIMIT, SHIPS, drive, wander, dump } from "./rounds.js";

const failures = [];
const fail = (what) => { failures.push(what); console.log("  FAIL  " + what); };
const ok = (what) => console.log("  ok    " + what);
const ticks = (s) => Math.round(s / TICK);

/** A round sailed to its end under a tape, with the world dumped at `mark` on the way, and the clip cut there. */
function sail({ mode, seed, players, hands, mark }) {
  const world = createWorld({ mode, seed, players });
  const tape = createTape();
  const ids = players.map((p) => p.id);
  const hits = []; // every hit's tick and ships, the test's own record of them
  let marked = null, markClip = null, strike = null;
  while (!world.result.over && world.time < LIMIT) {
    const inputs = {};
    ids.forEach((id, i) => { inputs[id] = hands(world.tick + i * 211); });
    tape.record(world, inputs);
    const events = step(world, inputs);
    for (const e of events) {
      if (e.type === "hit") { tape.hit(world.tick, [e.targetId, e.by]); hits.push({ tick: world.tick, ids: [e.targetId, e.by] }); }
      if (e.type === "sunk") strike = e;
    }
    if (mark && world.tick === mark) { marked = dump(world); markClip = tape.cut(world.tick); }
  }
  return { world, tape, marked, markClip, hits, strike };
}

/** Where the rule says a clip ending at `endTick` opens, worked out again here from the test's own record of the hits. */
function expectedOpening(hits, endTick, about) {
  const most = endTick - ticks(REPLAY_MOST), least = endTick - ticks(REPLAY_LEAST);
  const mine = hits.filter((h) => h.tick > most && h.tick <= endTick && h.ids.some((id) => id != null && about.includes(id)));
  let first = endTick;
  for (let i = mine.length - 1; i >= 0; i--) { if (first - mine[i].tick > ticks(EXCHANGE_GAP)) break; first = mine[i].tick; }
  return Math.max(most, 0, Math.min(least, mine.length ? first - ticks(EXCHANGE_LEAD) : least));
}

/** A clip sailed through its inputs by hand, one step each. */
function sailClip(clip) {
  const w = structuredClone(clip.world);
  for (const inp of clip.inputs) step(w, inp);
  return w;
}

function roundTest(name, opts) {
  const { world, tape, marked, markClip, hits, strike } = sail(opts);
  if (!world.result.over) { fail(`${name}: no end after ${LIMIT} s`); return; }
  // the two ships the moment was about, as the screen names them: the sunk ship and her killer
  const about = strike ? [strike.shipId, strike.by] : ["p1"];
  const clip = tape.cut(world.tick, about);
  if (!clip) { fail(`${name}: the tape cut nothing`); return; }
  const want = expectedOpening(hits, world.tick, about);
  if (clip.world.tick !== want) fail(`${name}: the clip opens at tick ${clip.world.tick}, not ${want}`);
  if (clip.inputs.length !== world.tick - clip.world.tick) fail(`${name}: the clip is ${clip.inputs.length} steps from tick ${clip.world.tick} for a round ending at ${world.tick}`);
  const ids = opts.players.map((p) => p.id);
  if (!clip.inputs.every((inp) => ids.every((id) => inp[id]))) fail(`${name}: a clip step is missing a captain's controls`);
  if (dump(sailClip(clip)) !== dump(world)) fail(`${name}: the clip does not end in the round's own world`);
  else ok(`${name}: ${clip.inputs.length} steps from tick ${clip.world.tick} end on the round's bits (round ${world.tick} steps, ${(clip.inputs.length * TICK).toFixed(1)} s shown)`);
  if (opts.mark) {
    if (!markClip) fail(`${name}: nothing cut at tick ${opts.mark}`);
    else if (dump(sailClip(markClip)) !== marked) fail(`${name}: the clip cut at tick ${opts.mark} does not end in the world as it stood`);
    else ok(`${name}: the clip cut at tick ${opts.mark} ends in the world as it stood`);
  }
  return { world, clip };
}

/** The player, fed frames of real time: reaches the same end at the right pace, holds, sails on, starts over, and holds at the last. */
function playerTest(name, world, clip) {
  const rp = createReplay(clip);
  let frames = 0, events = 0;
  // uneven frames, as a phone gives them, that still add up to the clip in real time
  const dts = [1 / 60, 1 / 50, 1 / 120, 1 / 30];
  while (!rp.over && frames < 100000) { const r = rp.advance(dts[frames++ % dts.length]); events += r.events.length; }
  if (!rp.over) { fail(`${name}: the player never reached the clip's end`); return; }
  if (dump(rp.world) !== dump(world)) fail(`${name}: the player's world is not the round's at the end`);
  if (rp.alpha !== 1) fail(`${name}: alpha is ${rp.alpha} at the clip's end`);
  const secs = frames / 4 * dts.reduce((a, b) => a + b, 0);
  const slow = Math.min(clip.inputs.length * TICK, SLOW_SECONDS);
  const expect = clip.inputs.length * TICK + slow; // the last second at half pace takes twice as long
  if (Math.abs(secs - expect) > 0.1) fail(`${name}: the clip took ${secs.toFixed(2)} s of real time, not ${expect.toFixed(2)} s with its last second at half pace`);
  // the beat on the blow: nothing steps for HIT_STOP of the screen's time
  const endTick = rp.world.tick;
  let stopped = 0;
  while (rp.world.tick === endTick && stopped < HIT_STOP + 1) { rp.advance(1 / 60); stopped += 1 / 60; }
  if (stopped < HIT_STOP - 1 / 30 || stopped > HIT_STOP + 0.1) fail(`${name}: the blow was held ${stopped.toFixed(2)} s, not ${HIT_STOP}`);
  // the tail: the world sails on past the round's end, every ship a number still, then over again
  let held = stopped, sailedOn = 0, bad = null, said = 0, restarted = false;
  while (!restarted && held < REPLAY_TAIL + 1) {
    const r = rp.advance(1 / 60);
    restarted = r.restarted;
    said += r.events.filter((e) => e.type === "round_over").length;
    held += 1 / 60;
    if (!restarted) {
      sailedOn = rp.world.tick - endTick;
      for (const s of rp.world.ships) { const f = ["x", "y", "heading", "spdCur", "hull"].find((k) => !Number.isFinite(s[k])); if (f && !bad) bad = `ship ${s.id} ${f} is ${s[f]}`; }
    }
  }
  if (!restarted) fail(`${name}: the player never started over`);
  else if (held < REPLAY_TAIL - 1 / 30) fail(`${name}: the player started over after ${held.toFixed(2)} s, before its tail`);
  else if (sailedOn < ticks(REPLAY_TAIL - 0.2)) fail(`${name}: the tail sailed the world on only ${sailedOn} steps`);
  else if (bad) fail(`${name}: sailing on past the end, ${bad}`);
  else if (said) fail(`${name}: the round's end was said ${said} times over in the tail`);
  else if (rp.loops !== 1 || rp.world.tick !== clip.world.tick) fail(`${name}: the player did not start the clip over from its start`);
  else ok(`${name}: the player reaches the same end in ${secs.toFixed(2)} s, holds the blow ${stopped.toFixed(2)} s, sails on ${sailedOn} steps and starts over (${events} events)`);
  // the passes play out and the player holds on its last frame
  let n = 0;
  while (!rp.done && n++ < 100000) rp.advance(1 / 60);
  if (!rp.done) fail(`${name}: the player never held on its last frame`);
  else if (rp.loops !== REPLAY_LOOPS - 1) fail(`${name}: the player held after ${rp.loops + 1} passes, not ${REPLAY_LOOPS}`);
  else {
    const t = rp.world.tick;
    for (let i = 0; i < 60; i++) rp.advance(1 / 60);
    if (rp.world.tick !== t || rp.alpha !== 1) fail(`${name}: the player did not hold on its last frame`);
    else ok(`${name}: the player holds on its last frame after ${REPLAY_LOOPS} passes`);
  }
}

/** Recording leaves the round exactly as it would have been without a tape. */
function harmless() {
  const sailed = (tape) => {
    const world = createWorld({ mode: "derby", seed: 44, players: [{ id: "p1", loadout: SHIPS.gundalow }] });
    while (!world.result.over && world.time < LIMIT) {
      const inputs = { p1: wander(world.tick) };
      if (tape) tape.record(world, inputs);
      for (const e of step(world, inputs)) if (tape && e.type === "hit") tape.hit(world.tick, [e.targetId, e.by]);
    }
    return dump(world);
  };
  if (sailed(createTape()) !== sailed(null)) fail("recording changed the round it recorded");
  else ok("recording leaves the round as it was");
}

/** The opening rule on its own: no hits is the least, a lull splits two exchanges, a running fight is capped at the most. */
function openings() {
  const world = createWorld({ mode: "derby", seed: 21, players: [{ id: "p1", loadout: SHIPS.gundalow }] });
  const tape = createTape();
  for (let i = 0; i < 1200; i++) { const inputs = { p1: { ...drive(world.tick), broadside: false, bow: false, musket: false } }; tape.record(world, inputs); step(world, inputs); }
  const end = world.tick;
  const T = (s) => end - ticks(s);
  const check = (what, got, want) => (got === want ? ok(`opening: ${what}`) : fail(`opening: ${what} opened at ${end - got} ticks before the end, not ${end - want}`));
  check("no hits is the least", tape.openingOf(end, ["p1"]), T(REPLAY_LEAST));
  // one exchange from 2 s out: opens a lead before it, which is still inside the least
  tape.hit(T(2), ["p1", 7]); tape.hit(T(1.5), [7, "p1"]);
  check("a short exchange still gets the least", tape.openingOf(end, ["p1"]), T(REPLAY_LEAST));
  // an exchange beginning 5 s out: opens a lead before its first hit
  tape.hit(T(5), ["p1", 7]); tape.hit(T(4), [7, "p1"]);
  check("an exchange opens a lead before its first hit", tape.openingOf(end, ["p1"]), T(5 + EXCHANGE_LEAD));
  // hits before a lull longer than the gap belong to an earlier exchange
  tape.hit(T(7.9), ["p1", 7]);
  check("a lull splits two exchanges", tape.openingOf(end, ["p1"]), T(5 + EXCHANGE_LEAD));
  // hits between others, not hers, do not count for her clip
  tape.hit(T(6.5), [8, 9]);
  check("other ships' hits do not count", tape.openingOf(end, ["p1"]), T(5 + EXCHANGE_LEAD));
  // a running fight the whole way back is capped at the most
  for (let s = 5.5; s < 12; s += 0.5) tape.hit(T(s), ["p1", 7]);
  check("a running fight is capped at the most", tape.openingOf(end, ["p1"]), T(REPLAY_MOST));
}

console.log("replay-test");
const one = (loadout) => [{ id: "p1", loadout }];
const r1 = roundTest("wave gundalow driven", { mode: "wave", seed: 5, players: one(SHIPS.gundalow), hands: drive, mark: 1000 });
if (r1) playerTest("wave gundalow driven", r1.world, r1.clip);
const r2 = roundTest("ladder first rate wandering", { mode: "ladder", seed: 8, players: one(SHIPS["first rate"]), hands: wander, mark: 2400 });
if (r2) playerTest("ladder first rate wandering", r2.world, r2.clip);
const r3 = roundTest("ffa, 4 captains wandering", { mode: "ffa", seed: 12, players: Array.from({ length: 4 }, (_, i) => ({ id: `p${i + 1}`, loadout: i % 2 ? SHIPS["first rate"] : SHIPS.gundalow })), hands: wander, mark: 600 });
if (r3) playerTest("ffa, 4 captains wandering", r3.world, r3.clip);
const r4 = roundTest("teams, 2 captains wandering", { mode: "teams", seed: 3, players: Array.from({ length: 2 }, (_, i) => ({ id: `p${i + 1}`, loadout: SHIPS.gundalow, side: SIDES[i % SIDES.length] })), hands: wander });
if (r4) playerTest("teams, 2 captains wandering", r4.world, r4.clip);
// a round shorter than the clip: a storm or a ram can end one in seconds, and the clip is all of it
{
  const world = createWorld({ mode: "derby", seed: 21, players: one(SHIPS.gundalow) });
  const tape = createTape();
  for (let i = 0; i < 90; i++) { const inputs = { p1: drive(world.tick) }; tape.record(world, inputs); step(world, inputs); }
  const clip = tape.cut(world.tick, ["p1"]);
  if (!clip || clip.inputs.length !== 90 || clip.world.tick !== 0) fail(`a 90-step round cut to ${clip && clip.inputs.length} steps from tick ${clip && clip.world.tick}`);
  else if (dump(sailClip(clip)) !== dump(world)) fail("a short round's clip does not end in its world");
  else ok("a round shorter than the clip replays whole");
}
openings();
harmless();

if (failures.length) { console.log(`\n${failures.length} failure(s)`); process.exit(1); }
console.log("\nall good");

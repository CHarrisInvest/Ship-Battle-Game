/**
 * THE REPLAY TEST — `npm run replay-test`
 *
 * The instant replay is the last seconds of the round sailed again from a copy of the world, which
 * is only a replay if the copy steps to the very bits the round did. Rounds are sailed here in plain
 * Node with a tape recording, and it fails if:
 *
 *   a clip cut at the round's end does not end in the round's own final world, bit for bit;
 *   a clip cut mid-round does not end in the world as it stood at that tick;
 *   a clip is the wrong length: the whole round when it ran shorter than the clip, else exactly
 *   `REPLAY_SECONDS` of it;
 *   a clip of a round with several captains loses one captain's controls;
 *   the player does not reach the same end in real-time frames, hold for its tail, and start over;
 *   the recording leaves the round it records a different round.
 */

import { createWorld, step, TICK, SIDES } from "../src/sim/index.js";
import { createTape, createReplay, REPLAY_SECONDS, REPLAY_TAIL } from "../src/replay.js";
import { LIMIT, SHIPS, drive, wander, dump } from "./rounds.js";

const failures = [];
const fail = (what) => { failures.push(what); console.log("  FAIL  " + what); };
const ok = (what) => console.log("  ok    " + what);
const SPAN = Math.round(REPLAY_SECONDS / TICK);

/** A round sailed to its end under a tape, with the world dumped at `mark` on the way, and the clip cut there. */
function sail({ mode, seed, players, hands, mark }) {
  const world = createWorld({ mode, seed, players });
  const tape = createTape();
  const ids = players.map((p) => p.id);
  let marked = null, markClip = null;
  while (!world.result.over && world.time < LIMIT) {
    const inputs = {};
    ids.forEach((id, i) => { inputs[id] = hands(world.tick + i * 211); });
    tape.record(world, inputs);
    step(world, inputs);
    if (mark && world.tick === mark) { marked = dump(world); markClip = tape.cut(world.tick); }
  }
  return { world, tape, marked, markClip };
}

/** A clip sailed through its inputs by hand, one step each. */
function sailClip(clip) {
  const w = structuredClone(clip.world);
  for (const inp of clip.inputs) step(w, inp);
  return w;
}

function roundTest(name, opts) {
  const { world, tape, marked, markClip } = sail(opts);
  if (!world.result.over) { fail(`${name}: no end after ${LIMIT} s`); return; }
  const clip = tape.cut(world.tick);
  if (!clip) { fail(`${name}: the tape cut nothing`); return; }
  const want = Math.min(SPAN, world.tick);
  if (clip.inputs.length !== want) fail(`${name}: the clip is ${clip.inputs.length} steps, not ${want}`);
  if (clip.world.tick !== world.tick - clip.inputs.length) fail(`${name}: the clip starts at tick ${clip.world.tick} for a round ending at ${world.tick}`);
  const ids = opts.players.map((p) => p.id);
  if (!clip.inputs.every((inp) => ids.every((id) => inp[id]))) fail(`${name}: a clip step is missing a captain's controls`);
  if (dump(sailClip(clip)) !== dump(world)) fail(`${name}: the clip does not end in the round's own world`);
  else ok(`${name}: ${clip.inputs.length} steps from tick ${clip.world.tick} end on the round's bits (round ${world.tick} steps)`);
  if (opts.mark) {
    if (!markClip) fail(`${name}: nothing cut at tick ${opts.mark}`);
    else if (dump(sailClip(markClip)) !== marked) fail(`${name}: the clip cut at tick ${opts.mark} does not end in the world as it stood`);
    else ok(`${name}: the clip cut at tick ${opts.mark} ends in the world as it stood`);
  }
  return { world, clip };
}

/** The player, fed frames of real time: reaches the same end, holds, starts over. */
function playerTest(name, world, clip) {
  const rp = createReplay(clip);
  let frames = 0, restarted = false, events = 0;
  // uneven frames, as a phone gives them, that still add up to the clip in real time
  const dts = [1 / 60, 1 / 50, 1 / 120, 1 / 30];
  while (!rp.over && frames < 100000) { const r = rp.advance(dts[frames++ % dts.length]); events += r.events.length; }
  if (!rp.over) { fail(`${name}: the player never reached the clip's end`); return; }
  if (dump(rp.world) !== dump(world)) fail(`${name}: the player's world is not the round's at the end`);
  if (rp.alpha !== 1) fail(`${name}: alpha is ${rp.alpha} at the clip's end`);
  const secs = frames / 4 * dts.reduce((a, b) => a + b, 0);
  if (Math.abs(secs - clip.inputs.length * TICK) > 0.1) fail(`${name}: the clip took ${secs.toFixed(2)} s of real time for ${(clip.inputs.length * TICK).toFixed(2)} s of round`);
  // the hold, then over again
  let held = 0;
  while (!restarted && held < REPLAY_TAIL + 1) { restarted = rp.advance(1 / 60).restarted; held += 1 / 60; }
  if (!restarted) fail(`${name}: the player never started over`);
  else if (held < REPLAY_TAIL - 1 / 30) fail(`${name}: the player started over after ${held.toFixed(2)} s, before its tail`);
  else if (rp.loops !== 1 || rp.world.tick !== clip.world.tick) fail(`${name}: the player did not start the clip over from its start`);
  else ok(`${name}: the player reaches the same end in ${secs.toFixed(2)} s, holds ${held.toFixed(2)} s and starts over (${events} events)`);
}

/** Recording leaves the round exactly as it would have been without a tape. */
function harmless() {
  const sailed = (tape) => {
    const world = createWorld({ mode: "derby", seed: 44, players: [{ id: "p1", loadout: SHIPS.gundalow }] });
    while (!world.result.over && world.time < LIMIT) {
      const inputs = { p1: wander(world.tick) };
      if (tape) tape.record(world, inputs);
      step(world, inputs);
    }
    return dump(world);
  };
  if (sailed(createTape()) !== sailed(null)) fail("recording changed the round it recorded");
  else ok("recording leaves the round as it was");
}

console.log("replay-test");
const one = (loadout) => [{ id: "p1", loadout }];
const r1 = roundTest("wave gundalow driven", { mode: "wave", seed: 5, players: one(SHIPS.gundalow), hands: drive, mark: 1000 });
if (r1) playerTest("wave gundalow driven", r1.world, r1.clip);
roundTest("ladder first rate wandering", { mode: "ladder", seed: 8, players: one(SHIPS["first rate"]), hands: wander, mark: 2400 });
roundTest("ffa, 4 captains wandering", { mode: "ffa", seed: 12, players: Array.from({ length: 4 }, (_, i) => ({ id: `p${i + 1}`, loadout: i % 2 ? SHIPS["first rate"] : SHIPS.gundalow })), hands: wander, mark: 600 });
roundTest("teams, 2 captains wandering", { mode: "teams", seed: 3, players: Array.from({ length: 2 }, (_, i) => ({ id: `p${i + 1}`, loadout: SHIPS.gundalow, side: SIDES[i % SIDES.length] })), hands: wander });
// a round shorter than the clip: a storm or a ram can end one in seconds, and the clip is all of it
{
  const world = createWorld({ mode: "derby", seed: 21, players: one(SHIPS.gundalow) });
  const tape = createTape();
  for (let i = 0; i < 90; i++) { const inputs = { p1: drive(world.tick) }; tape.record(world, inputs); step(world, inputs); }
  const clip = tape.cut(world.tick);
  if (!clip || clip.inputs.length !== 90 || clip.world.tick !== 0) fail(`a 90-step round cut to ${clip && clip.inputs.length} steps from tick ${clip && clip.world.tick}`);
  else if (dump(sailClip(clip)) !== dump(world)) fail("a short round's clip does not end in its world");
  else ok("a round shorter than the clip replays whole");
}
harmless();

if (failures.length) { console.log(`\n${failures.length} failure(s)`); process.exit(1); }
console.log("\nall good");

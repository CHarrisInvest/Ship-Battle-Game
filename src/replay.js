/**
 * THE INSTANT REPLAY: the last seconds of a round, kept as she sails and sailed again when it ends.
 *
 * The engine steps a world to the same bits from the same state and the same inputs, which is what
 * lets the server replay a voyage, and it is what makes this cheap: nothing about the picture is
 * recorded. A tape keeps a copy of the world once a second (`structuredClone`, since the world is
 * plain data) and every tick's input record since the oldest copy it holds, and no more than the
 * clip wants. When the round ends the tape is cut: the copy from just before the clip's start is
 * stepped up to it, and what comes back is the world as it stood `REPLAY_SECONDS` before the end
 * and the inputs that sail it there. `createReplay` sails such a clip in real time, holds on the
 * aftermath for the sinking to be seen, and starts it over.
 *
 * Nothing here reads the screen or the clock: real time comes in through `advance`, so the same
 * clip plays the same in a test as on a phone. The screen draws the clip's world through the same
 * renderer and effects as the round it came from.
 */

import { step, TICK } from "./sim/index.js";

/** How much of the round a clip shows, ending on the moment the round ended for her. */
export const REPLAY_SECONDS = 5;
/**
 * How long a clip sails on past the moment it ends on before starting over: long enough for the 3D
 * sea to take a ship under (2.5 seconds from her last step afloat) and for the wreckage to settle.
 */
export const REPLAY_TAIL = 4;
/** How many times a clip plays before the screen moves on by itself. */
export const REPLAY_LOOPS = 3;
// Ticks between the copies of the world the tape keeps. A copy a second is cheap, and the lead-in
// from a copy to the clip's start is at most this many steps, taken at once when the tape is cut.
const SNAP_EVERY = 60;
// The most steps one frame of a replay may take, as the frame loop's own cap.
const MAX_STEPS = 5;

/**
 * A tape for one round. `record(world, inputs)` is called just before `step(world, inputs)`, every
 * step of the round; `cut(endTick)` is the clip ending at `endTick`, the round's tick once the step
 * that ended it has run. A tape made for one world records nothing useful about another.
 */
export function createTape(seconds = REPLAY_SECONDS) {
  const span = Math.round(seconds / TICK);
  // enough copies that one always stands at or before the clip's start, plus the one just taken
  const keep = Math.ceil(span / SNAP_EVERY) + 1;
  const snaps = []; // { tick, world }, oldest first
  const frames = []; // { tick, inputs }, oldest first, every tick since the oldest copy

  return {
    record(world, inputs) {
      if (world.tick % SNAP_EVERY === 0 && (!snaps.length || snaps[snaps.length - 1].tick !== world.tick)) {
        snaps.push({ tick: world.tick, world: structuredClone(world) });
        if (snaps.length > keep) {
          snaps.shift();
          while (frames.length && frames[0].tick < snaps[0].tick) frames.shift();
        }
      }
      if (!snaps.length) return; // a world picked up between copies: the tape starts at the next one
      // a copy of the record, because an online round reuses one object for its captains' controls
      frames.push({ tick: world.tick, inputs: { ...inputs } });
    },

    /**
     * The clip ending at `endTick`: `world` as it stood `seconds` before (or as early as the tape
     * reaches), and `inputs`, one record per step, that sail it to the end. Null when nothing was
     * recorded.
     */
    cut(endTick) {
      if (!snaps.length) return null;
      const from = Math.max(endTick - span, snaps[0].tick);
      let snap = snaps[0];
      for (const s of snaps) if (s.tick <= from) snap = s;
      const world = structuredClone(snap.world);
      let i = frames.findIndex((f) => f.tick === snap.tick);
      if (i < 0) return null;
      // the lead-in: from the copy up to where the clip starts, stepped now rather than shown
      while (world.tick < from && i < frames.length && frames[i].tick < endTick) step(world, frames[i++].inputs);
      const inputs = [];
      for (; i < frames.length && frames[i].tick < endTick; i++) inputs.push(frames[i].inputs);
      if (!inputs.length) return null;
      return { world, inputs };
    },
  };
}

/**
 * A clip being played. `advance(frame, dt)` banks `frame` seconds of real time, takes the steps it
 * pays for and returns what happened in them as events, the way the frame loop does for a live
 * round, so the screen can draw the clip's smoke and splinters through the same effects.
 *
 * THE CLIP SAILS ON PAST ITS END. The moment it is cut to is the step she went under on, or the last
 * of them did, and a frame frozen there shows a hull still afloat: the 3D sea takes a ship under
 * over the seconds after her last step, her wreckage flies and the smoke drifts. So for `tail`
 * seconds after the clip's last input the world is stepped on under the hands as they stood on
 * that last step (a repair asked for then is not asked again), the round's own end notwithstanding:
 * the engine refuses to step a round that is over, and this copy is a show, so its end is lifted
 * before each of those steps and what the engine says again about it is left out of the events.
 * The frame that reaches the clip's end stops there, so the moment itself lands on a frame of its
 * own. Then the clip starts over and says so, so the screen can clear its picture of it.
 *
 * The tail is counted in `dt`, the screen's own time for what decorates the sea (the frame's time,
 * capped), because a sinking is drawn at that pace and the tail is there for it to be seen whole:
 * on a phone dropping frames both run slow together. `alpha` is how far through the last step to
 * draw, as in play.
 */
export function createReplay(clip, { tail = REPLAY_TAIL } = {}) {
  let world = structuredClone(clip.world);
  let at = 0, bank = 0, held = 0, loops = 0;
  const over = () => at >= clip.inputs.length;
  // her hands as they stood on the last step, held through the tail, with no repair asked again
  const last = clip.inputs[clip.inputs.length - 1];
  const hands = Object.fromEntries(Object.entries(last).map(([id, rec]) => [id, { ...rec, repair: null }]));
  return {
    get world() { return world; },
    // an empty bank is a step drawn whole: the frame the clip ends on, and the first of a pass
    get alpha() { return bank === 0 ? 1 : Math.min(1, bank / TICK); },
    /** How many times the clip has started over. */
    get loops() { return loops; },
    /** Whether the clip has been sailed to its end and is sailing on through the aftermath. */
    get over() { return over(); },
    advance(frame, dt = frame) {
      const events = [];
      if (over()) {
        held += dt;
        if (held >= tail) {
          world = structuredClone(clip.world);
          at = 0; bank = 0; held = 0; loops++;
          return { events, restarted: true };
        }
      }
      bank += Math.min(frame, 0.25);
      let steps = 0;
      while (bank >= TICK && steps < MAX_STEPS) {
        if (!over()) {
          for (const e of step(world, clip.inputs[at++])) events.push(e);
          bank -= TICK;
          steps++;
          if (over()) { bank = 0; break; } // the moment itself, on a frame of its own, drawn whole
        } else {
          world.result.over = false;
          for (const e of step(world, hands)) if (e.type !== "round_over") events.push(e);
          bank -= TICK;
          steps++;
        }
      }
      if (bank >= TICK) bank %= TICK; // behind by more than a frame can pay: let it go
      return { events, restarted: false };
    },
  };
}

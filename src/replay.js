/**
 * THE INSTANT REPLAY: the last seconds of a round, kept as she sails and sailed again when it ends.
 *
 * The engine steps a world to the same bits from the same state and the same inputs, which is what
 * lets the server replay a voyage, and it is what makes this cheap: nothing about the picture is
 * recorded. A tape keeps a copy of the world once a second (`structuredClone`, since the world is
 * plain data), every tick's input record since the oldest copy it holds, and the tick of every hit
 * and who it was between, no more than a clip can want. When the round ends the tape is cut: the
 * clip opens on the final exchange, the run of hits involving the ships the moment was about with no
 * long lull in it, a moment before its first hit, never longer than `REPLAY_MOST` seconds and never
 * shorter than `REPLAY_LEAST`, so a ship lost to the storm with nobody firing at her gets the short
 * clip and a running fight the long one. The copy from before the clip's start is stepped up to it,
 * and what comes back is the world as it stood there and the inputs that sail it to the end.
 * `createReplay` sails such a clip in real time, slows its last second, holds a beat on the blow,
 * sails the world on through the aftermath, and starts over.
 *
 * Nothing here reads the screen or the clock: real time comes in through `advance`, so the same
 * clip plays the same in a test as on a phone. The screen draws the clip's world through the same
 * renderer and effects as the round it came from.
 */

import { step, TICK } from "./sim/index.js";

/** The most a clip shows before the moment it ends on, and the least. */
export const REPLAY_MOST = 8;
export const REPLAY_LEAST = 3;
/** Two hits further apart than this are two exchanges, and the clip opens on the last. */
export const EXCHANGE_GAP = 2.5;
/** How long before the final exchange's first hit the clip opens. */
export const EXCHANGE_LEAD = 0.5;
/** The last second of a clip is sailed at half pace. */
export const SLOW_SECONDS = 1;
/** The beat held on the blow that ends the clip, in the screen's own time. */
export const HIT_STOP = 0.25;
/**
 * How long a clip sails on past the moment it ends on: long enough for the 3D sea to take a ship
 * under (2.5 seconds from her last step afloat) and for the wreckage to settle.
 */
export const REPLAY_TAIL = 4;
/** Over how much of the tail her hands come off the stick. */
export const HANDS_EASE = 1.5;
/** How many times a clip plays before it holds on its last frame. */
export const REPLAY_LOOPS = 3;
// Ticks between the copies of the world the tape keeps. A copy a second is cheap, and the lead-in
// from a copy to the clip's start is at most this many steps, taken at once when the tape is cut.
const SNAP_EVERY = 60;
// The most steps one frame of a replay may take, as the frame loop's own cap.
const MAX_STEPS = 5;

/**
 * A tape for one round. `record(world, inputs)` is called just before `step(world, inputs)`, every
 * step of the round, and `hit(tick, ids)` for each hit a step produced, with the tick after the
 * step and the ids of the ship struck and the ship that struck her (null for the weather).
 * `cut(endTick, ids)` is the clip ending at `endTick`, the round's tick once the step that ended it
 * has run, opened on the final exchange between `ids`. A tape made for one world records nothing
 * useful about another.
 */
export function createTape(seconds = REPLAY_MOST) {
  const span = Math.round(seconds / TICK);
  // enough copies that one always stands at or before the clip's start, plus the one just taken
  const keep = Math.ceil(span / SNAP_EVERY) + 1;
  const snaps = []; // { tick, world }, oldest first
  const frames = []; // { tick, inputs }, oldest first, every tick since the oldest copy
  const hits = []; // { tick, ids }, oldest first, since the oldest copy

  return {
    record(world, inputs) {
      if (world.tick % SNAP_EVERY === 0 && (!snaps.length || snaps[snaps.length - 1].tick !== world.tick)) {
        snaps.push({ tick: world.tick, world: structuredClone(world) });
        if (snaps.length > keep) {
          snaps.shift();
          while (frames.length && frames[0].tick < snaps[0].tick) frames.shift();
          while (hits.length && hits[0].tick < snaps[0].tick) hits.shift();
        }
      }
      if (!snaps.length) return; // a world picked up between copies: the tape starts at the next one
      // a copy of the record, because an online round reuses one object for its captains' controls
      frames.push({ tick: world.tick, inputs: { ...inputs } });
    },

    hit(tick, ids) {
      if (snaps.length) hits.push({ tick, ids });
    },

    /**
     * Where the clip ending at `endTick` opens, as a tick: `EXCHANGE_LEAD` before the first hit of
     * the final exchange between `ids` (any ship when none are named), held between `REPLAY_LEAST`
     * and `seconds` before the end, and never before the tape's oldest copy.
     */
    openingOf(endTick, ids = null) {
      const least = endTick - Math.round(REPLAY_LEAST / TICK);
      const most = endTick - span;
      const mine = hits.filter((h) => h.tick <= endTick && h.tick > most && (!ids || h.ids.some((id) => id != null && ids.includes(id)))).sort((a, b) => a.tick - b.tick);
      let first = endTick;
      for (let i = mine.length - 1; i >= 0; i--) {
        if (first - mine[i].tick > Math.round(EXCHANGE_GAP / TICK)) break;
        first = mine[i].tick;
      }
      const open = mine.length ? first - Math.round(EXCHANGE_LEAD / TICK) : least;
      return Math.max(most, snaps.length ? snaps[0].tick : most, Math.min(least, open));
    },

    /**
     * The clip ending at `endTick`: `world` as it stood at its opening and `inputs`, one record per
     * step, that sail it to the end. Null when nothing was recorded.
     */
    cut(endTick, ids = null) {
      if (!snaps.length) return null;
      const from = this.openingOf(endTick, ids);
      let snap = snaps[0];
      for (const s of snaps) if (s.tick <= from) snap = s;
      const world = structuredClone(snap.world);
      let i = frames.findIndex((f) => f.tick === snap.tick);
      if (i < 0) return null;
      // the lead-in: from the copy up to where the clip opens, stepped now rather than shown
      while (world.tick < from && i < frames.length && frames[i].tick < endTick) step(world, frames[i++].inputs);
      const inputs = [];
      for (; i < frames.length && frames[i].tick < endTick; i++) inputs.push(frames[i].inputs);
      if (!inputs.length) return null;
      return { world, inputs };
    },
  };
}

// a smooth step from 0 to 1 over 0..1
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * A clip being played. `advance(frame, dt)` banks `frame` seconds of real time, takes the steps it
 * pays for and returns what happened in them as events, the way the frame loop does for a live
 * round, so the screen can draw the clip's smoke and splinters through the same effects.
 *
 * THE LAST SECOND IS SLOW, AND THE BLOW IS HELD. The final `SLOW_SECONDS` of the clip are stepped
 * at half pace, so the broadside that decides it can be read, and the frame that reaches the clip's
 * end stops there, drawn whole, and holds for `HIT_STOP` of the screen's time with the splinters
 * still flying, because the screen's effects run on their own clock.
 *
 * THEN THE CLIP SAILS ON. The moment it is cut to is the step she went under on, or the last of them
 * did, and a frame frozen there shows a hull still afloat: the 3D sea takes a ship under over the
 * seconds after her last step. So for `tail` seconds after the clip's last input the world is
 * stepped on, under hands that come off the controls: the fire buttons let go at once and the stick
 * eased to rest over `HANDS_EASE`, so a winner glides rather than keeps steering, and no repair is
 * asked again. The round's own end notwithstanding: the engine refuses to step a round that is
 * over, and this copy is a show, so its end is lifted before each of those steps and what the
 * engine says again about it is left out of the events. Then the clip starts over and says so, so
 * the screen can clear its picture of it. THE LAST PASS STOPS ON THE MOMENT: it reaches the blow and
 * holds there, `done`, with no tail, so the screen can freeze the frame with her just starting to go
 * under rather than play her sinking through once more.
 *
 * The hold and the tail are counted in `dt`, the screen's own time for what decorates the sea (the
 * frame's time, capped), because a sinking is drawn at that pace and the tail is there for it to be
 * seen whole: on a phone dropping frames both run slow together. `alpha` is how far through the
 * last step to draw, as in play.
 */
export function createReplay(clip, { tail = REPLAY_TAIL, loops: most = REPLAY_LOOPS } = {}) {
  let world = structuredClone(clip.world);
  let at = 0, bank = 0, stop = 0, held = 0, loops = 0, done = false;
  const n = clip.inputs.length;
  const slowFrom = n - Math.round(SLOW_SECONDS / TICK);
  const over = () => at >= n;
  // what a step costs in banked time: the last second's cost double, which is half pace
  const cost = () => (!over() && at >= slowFrom ? 2 * TICK : TICK);
  // her hands as they stood on the last step, coming off the controls through the tail
  const last = clip.inputs[n - 1];
  const hands = (t) => Object.fromEntries(Object.entries(last).map(([id, rec]) => [id, {
    ...rec, joyMag: rec.joyMag * (1 - smooth(t / HANDS_EASE)), broadside: false, bow: false, musket: false, repair: null,
  }]));
  return {
    get world() { return world; },
    // an empty bank is a step drawn whole: the frame the clip ends on, and the first of a pass
    get alpha() { return bank === 0 ? 1 : Math.min(1, bank / cost()); },
    /** How many times the clip has started over. */
    get loops() { return loops; },
    /** Whether the clip has been sailed to its end and is sailing on through the aftermath. */
    get over() { return over(); },
    /** Whether the clip has played its passes and holds on the moment itself. */
    get done() { return done; },
    advance(frame, dt = frame) {
      const events = [];
      if (done) return { events, restarted: false };
      if (over()) {
        if (stop > 0) { stop -= dt; return { events, restarted: false }; }
        held += dt;
        if (held >= tail) {
          world = structuredClone(clip.world);
          at = 0; bank = 0; held = 0; loops++;
          return { events, restarted: true };
        }
      }
      bank += Math.min(frame, 0.25);
      let steps = 0;
      while (bank >= cost() && steps < MAX_STEPS) {
        if (!over()) {
          bank -= cost();
          for (const e of step(world, clip.inputs[at++])) events.push(e);
          steps++;
          // the moment itself, on a frame of its own, drawn whole; on the last pass the clip stops here
          if (over()) { bank = 0; if (loops + 1 >= most) done = true; else stop = HIT_STOP; break; }
        } else {
          world.result.over = false;
          for (const e of step(world, hands(held))) if (e.type !== "round_over") events.push(e);
          bank -= TICK;
          steps++;
        }
      }
      if (bank >= cost()) bank %= cost(); // behind by more than a frame can pay: let it go
      return { events, restarted: false };
    },
  };
}

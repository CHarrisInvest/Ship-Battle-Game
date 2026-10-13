/**
 * THE CONTROLS: the joystick, the fire buttons and the repair rail, turned into the input record the
 * engine reads once a step.
 *
 * One record per captain, the shape `NO_INPUT` in the engine names: how far the stick is pushed and
 * which way it points as a heading on the sea, which fire buttons are held, and a repair asked for
 * since the last step. `read()` is what the frame loop hands to `step`, keyed by her player id, and
 * it spends the repair, so one tap is one repair whether the next frame runs one step or none.
 */

import { useRef } from "react";
import { NO_INPUT } from "../sim/index.js";
import { TILT } from "../render/view.js";

/** The controls for the captain `playerId`, made once for the life of the component. */
export function useControls(playerId) {
  const ref = useRef(null);
  if (!ref.current) ref.current = createControls(playerId);
  return ref.current;
}

function createControls(playerId) {
  let input = { ...NO_INPUT };
  const knobRef = { current: null }; // the stick's knob, moved straight on the element
  const joy = { id: null, cx: 0, cy: 0, R: 34 };

  const move = (e) => {
    if (joy.id !== e.pointerId) return;
    const dx = e.clientX - joy.cx, dy = e.clientY - joy.cy;
    const len = Math.hypot(dx, dy) || 1;
    const cl = Math.min(len, joy.R);
    if (knobRef.current) knobRef.current.style.transform = `translate(${(dx / len) * cl}px, ${(dy / len) * cl}px)`;
    input.joyMag = cl / joy.R;
    // The stick is read in screen space and steers a world heading, and the sea is squashed by
    // TILT on the screen, so the two are not the same angle off the axes: a stick at 45 degrees
    // steered a course that showed at 31. Dividing the vertical by TILT is the world direction
    // that draws where the stick points.
    input.joyAng = Math.atan2(dy / TILT, dx);
  };
  const down = (e) => {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    joy.id = e.pointerId;
    joy.cx = r.left + r.width / 2;
    joy.cy = r.top + r.height / 2;
    joy.R = r.width / 2 - 22;
    e.currentTarget.setPointerCapture(e.pointerId);
    move(e);
  };
  const up = (e) => {
    if (joy.id !== e.pointerId) return;
    joy.id = null;
    input.joyMag = 0;
    if (knobRef.current) knobRef.current.style.transform = "translate(0px,0px)";
  };

  return {
    knobRef,
    /** Pointer handlers for the joystick's pad. */
    stick: { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up },
    /** A handler that sets one fire button held or let go. */
    hold: (key, val) => (e) => { e.preventDefault(); input[key] = val; },
    /** A repair asked for, "hull" or "mast", carried out by the next step. */
    ask: (system) => { input.repair = system; },
    /** Her controls as they stand, for one step, keyed by her id. The repair is spent. */
    read() {
      const rec = { [playerId]: { ...input } };
      input.repair = null;
      return rec;
    },
    /** Hands off everything, for a fresh round. */
    reset() { input = { ...NO_INPUT }; },
    /** The record as it stands, for the screen to draw the arcs of the guns she is holding down. */
    get input() { return input; },
  };
}

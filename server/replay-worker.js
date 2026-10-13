/** Replays off the request loop: one message in, `{ id, out }` or `{ id, error }` back. */

import { parentPort } from "node:worker_threads";
import { replay } from "./replay.js";

parentPort.on("message", ({ id, round, entries, maxTicks }) => {
  try {
    parentPort.postMessage({ id, out: replay(round, entries, maxTicks) });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message });
  }
});

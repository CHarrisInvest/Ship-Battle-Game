/**
 * SAILING WITH FRIENDS, FROM THIS BROWSER.
 *
 * A lobby is joined over a WebSocket straight to the game server (Vercel's proxy cannot carry one),
 * opened with a ticket asked of `/api/online/ticket`, where the session cookie still travels. Once the
 * host starts, the server sends the round's seed and every captain's loadout, and then, twenty times a
 * second, the controls each captain sailed with on each tick. This browser builds the same world from
 * the same seed and steps it through the same controls, so it sails the very round the server does,
 * drawn with everything a single-player round has. Every two seconds the server's fingerprint of its
 * ships comes too, and `desynced` turns true if this world ever parts company with it.
 *
 * `connectOnline({ onChange, onEvents })` returns the connection: `create()`, `join(code)`,
 * `leave()`, `setRivals(n)`, `start()`, `send(input)` for her controls, and `advance(n)` to step the
 * world up to `n` ticks of what the server has sent. `state` is everything the lobby screen reads.
 */

import { createWorld, step, shipsPrint, NO_INPUT, isInput } from "./sim/index.js";
import { call, ENGINE } from "./net.js";

/** Why an online connection could not be made, for the screen to say. */
export const ONLINE_FAILED = {
  engine: "The game has been updated since this page opened. Reload the page to sail with friends.",
  offline: "The server cannot be reached. Try again in a moment.",
  closed: "The connection to the server was lost.",
  "no-lobby": "There is no lobby with that code. Check it with the friend who sent it.",
  full: "That lobby is full: it takes 8 captains.",
  "already-in": "You are already in that lobby, in another tab.",
  elsewhere: "You opened this lobby in another tab or window, so it moved there.",
  "not-ready": "Not everyone is ready yet.",
};

const askTicket = () => call("POST", "/online/ticket", { engine: ENGINE });

export async function connectOnline({ onChange = () => {}, onEvents = () => {}, Socket = globalThis.WebSocket, getTicket = askTicket } = {}) {
  const t = await getTicket();
  if (t.status === 409) return { error: "engine" };
  if (t.status !== 200) return { error: "offline" };

  const state = {
    open: false, you: null, lobby: null, error: "", sailing: false, banked: null,
    lobbies: [], // the public lobbies open to join, kept live by the server
    round: null, // { world, you, names, cur, queue, desynced }
  };
  const ws = new Socket(`${t.data.ws}?ticket=${encodeURIComponent(t.data.ticket)}`);
  const changed = () => onChange({ ...state });
  const out = (msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  let lastSent = "";

  const opened = new Promise((resolve) => {
    ws.onopen = () => { state.open = true; changed(); resolve(true); };
    ws.onerror = () => resolve(false);
  });
  ws.onclose = () => { state.open = false; if (!state.left) state.error = "closed"; changed(); };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString()); } catch { return; }
    if (msg.t === "hello") { state.you = msg.you; changed(); }
    else if (msg.t === "lobby") { state.lobby = msg; state.error = ""; changed(); }
    else if (msg.t === "left") { state.lobby = null; if (msg.reason) state.error = msg.reason; changed(); }
    else if (msg.t === "lobbies" && Array.isArray(msg.list)) { state.lobbies = msg.list; changed(); }
    else if (msg.t === "error") { state.error = msg.error; changed(); }
    else if (msg.t === "start") {
      const world = createWorld({ mode: "ffa", seed: msg.seed, players: msg.players.map((p) => ({ id: p.id, loadout: p.loadout })), rivals: msg.rivals });
      state.round = {
        world, you: msg.you,
        names: Object.fromEntries(msg.players.map((p) => [p.id, p.name])),
        cur: Object.fromEntries(msg.players.map((p) => [p.id, { ...NO_INPUT }])),
        queue: [], desynced: false, over: false,
      };
      state.banked = null;
      lastSent = "";
      changed();
    } else if (msg.t === "frame" && state.round && Array.isArray(msg.ticks)) {
      for (const f of msg.ticks) state.round.queue.push(f);
    } else if (msg.t === "banked") {
      state.banked = msg;
      changed();
    }
  };
  if (!(await opened)) return { error: "offline" };

  return {
    get state() { return state; },
    /** Make a lobby: public ones are listed for anyone to join, private ones only by code or link. */
    create: (isPublic) => out({ t: "create", public: !!isPublic }),
    /** Say whether she is ready for the round to start. */
    setReady: (ready) => out({ t: "ready", ready: !!ready }),
    join: (code) => out({ t: "join", code }),
    leave: () => { out({ t: "leave" }); state.round = null; },
    setRivals: (n) => out({ t: "rivals", rivals: n }),
    start: () => out({ t: "start" }),
    /** Her controls, sent when they change (a repair always), for the server to sail her ship with. */
    send(input) {
      if (!state.round || !isInput(input)) return;
      const key = JSON.stringify(input);
      if (key === lastSent && !input.repair) return;
      lastSent = input.repair ? "" : key;
      out({ t: "input", input });
    },
    /** Ticks the server has sent and this world has not stepped yet. */
    get behind() { return state.round ? state.round.queue.filter((f) => f[0] !== "print").length : 0; },
    /** Step the world through up to `n` of the ticks the server has sent. Returns the events. */
    advance(n) {
      const r = state.round;
      if (!r) return [];
      const events = [];
      let stepped = 0;
      while (r.queue.length && stepped < n) {
        const f = r.queue[0];
        if (f[0] === "print") {
          if (f[1] === r.world.tick && f[2] !== shipsPrint(r.world)) r.desynced = true;
          r.queue.shift();
          continue;
        }
        const [tick, changes] = f;
        if (tick !== r.world.tick) r.desynced = true;
        if (changes) for (const [id, input] of Object.entries(changes)) r.cur[id] = input;
        for (const e of step(r.world, r.cur)) events.push(e);
        r.queue.shift();
        stepped++;
        if (r.world.result.over) r.over = true;
      }
      if (events.length) onEvents(events);
      return events;
    },
    close() { state.left = true; ws.close(); },
  };
}

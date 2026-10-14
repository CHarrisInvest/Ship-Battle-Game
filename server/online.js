/**
 * SAILING WITH FRIENDS — lobbies, and a free-for-all the server runs for everyone in one.
 *
 * A captain opens a lobby and gets a code; her friends join with it (or with the link that carries
 * it). The host sets how many AI ships sail besides them and starts. The server builds the world from
 * a seed of its own and each captain's loadout off her own hold, and then runs the round at 60 ticks
 * a second on its own clock, taking each captain's latest controls as they come in.
 *
 * What it sends back is not the world but the controls: each tick, every captain's input that
 * changed. The engine steps to the same bits in every browser and in Node (`npm run determinism`), so
 * each browser steps the very world the server does from the same seed and the same inputs, and
 * draws it with everything a single-player round has, smoke and all, for a few bytes a tick. Every
 * two seconds the server sends a fingerprint of its ships, so a browser that has somehow parted
 * company can tell. The server's world is the one that counts: each captain is banked off it, by
 * the same `bank` a single voyage uses, the moment she is out or the round ends, whether or not she
 * is still connected.
 *
 * The browser reaches this over a WebSocket straight to the server, because Vercel's proxy cannot
 * carry one, so it cannot lean on the session cookie: it first asks `/api/online/ticket` (cookie and
 * all) for a ticket, a short-lived signed note of who she is, and presents that on connecting.
 */

import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { WebSocketServer } from "ws";
import { createWorld, step, voyageRun, isInput, shipsPrint, NO_INPUT, TICK } from "../src/sim/index.js";
import { bank, blank, shipLoadout, shipName } from "../src/holdrules.js";
import { transaction } from "./db.js";
import { lockHold, writeHold } from "./hold.js";

/** Captains in a lobby, and ships on the water, AI included: the free-for-all's own field. */
export const MAX_CAPTAINS = 8;
export const MAX_SHIPS = 11;
/** How long a ticket is good for. Long enough to open a socket, too short to be worth stealing. */
const TICKET_MS = 60 * 1000;
/** Ticks per frame sent: three, so twenty messages a second. */
const FRAME_TICKS = 3;
/** Ticks between fingerprints of the server's ships. */
const PRINT_TICKS = 120;
/** The longest a round may run, as a single voyage may. */
const MAX_TICKS = 3600 * 60;
/** Letters a code is made of: no 0/O or 1/I to misread off a friend's screen. */
const CODE_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// ---- tickets ----------------------------------------------------------------------------------------

const b64 = (s) => Buffer.from(s).toString("base64url");
export function makeTicket(secret, userId, engine, now) {
  const body = b64(JSON.stringify({ u: userId, e: engine, x: now + TICKET_MS }));
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
export function readTicket(secret, ticket, now) {
  if (typeof ticket !== "string" || ticket.length > 512) return null;
  const [body, sig] = ticket.split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(createHmac("sha256", secret).update(body).digest("base64url"));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const t = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return t.x >= now ? t : null;
  } catch { return null; }
}

// ---- lobbies ----------------------------------------------------------------------------------------

/**
 * The lobbies and their rounds. `pool` for the holds, `engine` to turn away a browser on another
 * one, `now` for the clock. `attach(server, path)` takes WebSocket upgrades on `path`.
 */
export function createOnline({ pool, engine, secret, publicWs, now = () => Date.now(), catchUp = 10 }) {
  const lobbies = new Map(); // code to lobby
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };

  function newCode() {
    for (;;) {
      let c = "";
      for (let i = 0; i < 5; i++) c += CODE_ABC[randomInt(CODE_ABC.length)];
      if (!lobbies.has(c)) return c;
    }
  }

  /** What every member is told about the lobby. `mid` tells two rows apart even for one captain. */
  function lobbyView(lobby) {
    return {
      t: "lobby", code: lobby.code, state: lobby.state, rivals: lobby.rivals, host: lobby.host, public: lobby.public,
      captains: lobby.members.map((m) => ({ mid: m.mid, userId: m.userId, name: m.name, ready: !!m.ready, playerId: m.playerId || null })),
    };
  }
  const tellLobby = (lobby) => { const v = lobbyView(lobby); for (const m of lobby.members) send(m.ws, { ...v, you: m.userId }); tellLobbies(); };

  /**
   * The public lobbies a captain could join now: waiting for a round and not full. Sent to every
   * socket not in a lobby whenever one opens, fills, starts or closes, so the list is always live.
   */
  const sockets = new Set(); // every connected member
  function publicList() {
    return [...lobbies.values()]
      .filter((l) => l.public && l.state === "waiting" && l.members.length > 0 && l.members.length < MAX_CAPTAINS)
      .map((l) => ({ code: l.code, host: (l.members.find((m) => m.userId === l.host) || l.members[0]).name, captains: l.members.length, max: MAX_CAPTAINS }));
  }
  let listQueued = false;
  function tellLobbies() {
    if (listQueued) return;
    listQueued = true;
    queueMicrotask(() => {
      listQueued = false;
      const msg = { t: "lobbies", list: publicList() };
      for (const m of sockets) if (!m.lobby) send(m.ws, msg);
    });
  }

  async function nameOf(userId) {
    const { rows } = await pool.query("select data from holds where user_id = $1", [userId]);
    return rows.length ? shipName(rows[0].data) || "A captain" : "A captain";
  }

  function leave(member) {
    const lobby = member.lobby;
    if (!lobby) return;
    member.lobby = null;
    member.ready = false;
    lobby.members = lobby.members.filter((m) => m !== member);
    if (!lobby.members.length) { stopRound(lobby); lobbies.delete(lobby.code); tellLobbies(); return; }
    if (lobby.host === member.userId && !lobby.members.some((m) => m.userId === member.userId)) lobby.host = lobby.members[0].userId;
    tellLobby(lobby);
  }

  /**
   * Put a captain in a lobby. Every check is made after the one wait (her ship's name), so a join
   * sent twice, or from a second connection, cannot slip in twice: one captain is one row. If she is
   * already there on another connection (a reload, a second tab), this connection takes her place.
   */
  async function join(member, code) {
    if (member.joining) return;
    member.joining = true;
    try {
      const name = await nameOf(member.userId);
      const lobby = lobbies.get(code);
      if (!lobby) return send(member.ws, { t: "error", error: "no-lobby" });
      if (member.lobby === lobby) return tellLobby(lobby);
      const earlier = lobby.members.find((m) => m.userId === member.userId);
      if (!earlier && lobby.members.length >= MAX_CAPTAINS) return send(member.ws, { t: "error", error: "full" });
      if (member.lobby) leave(member);
      member.lobby = lobby;
      member.name = name;
      if (earlier) {
        // the same captain on a new connection: she keeps her place, and the old connection is let go
        lobby.members[lobby.members.indexOf(earlier)] = member;
        member.ready = earlier.ready;
        member.playerId = earlier.playerId;
        earlier.lobby = null;
        send(earlier.ws, { t: "left", reason: "elsewhere" });
      } else lobby.members.push(member);
      tellLobby(lobby);
      if (lobby.state === "sailing") send(member.ws, { t: "sailing" }); // she waits for the next round
    } finally {
      member.joining = false;
    }
  }

  // ---- a round --------------------------------------------------------------------------------------

  async function startRound(lobby) {
    const humans = lobby.members;
    const players = [];
    for (let i = 0; i < humans.length; i++) {
      const m = humans[i];
      const { rows } = await pool.query("select data from holds where user_id = $1", [m.userId]);
      const hold = rows.length ? rows[0].data : null;
      // the loadout off her own hold on the server, as the JSON every browser builds the world from
      const loadout = JSON.parse(JSON.stringify(shipLoadout(hold || blank())));
      m.playerId = `p${i + 1}`;
      players.push({ id: m.playerId, loadout, userId: m.userId, name: m.name });
    }
    const rivals = Math.max(0, Math.min(lobby.rivals, MAX_SHIPS - players.length));
    const seed = randomInt(0, 2 ** 32);
    const world = createWorld({ mode: "ffa", seed, players: players.map((p) => ({ id: p.id, loadout: p.loadout })), rivals });
    const round = {
      world, players, seed, rivals,
      cur: Object.fromEntries(players.map((p) => [p.id, { ...NO_INPUT }])), // the input each tick is stepped with
      sent: Object.fromEntries(players.map((p) => [p.id, JSON.stringify(NO_INPUT)])),
      next: {}, // the latest input each captain sent since the last tick
      banked: new Set(),
      frame: [],
      started: now(),
      ticksDone: 0,
    };
    lobby.round = round;
    lobby.state = "sailing";
    const roster = players.map((p) => ({ id: p.id, name: p.name, loadout: p.loadout }));
    for (const m of humans) send(m.ws, { t: "start", seed, rivals, players: roster, you: m.playerId });
    tellLobby(lobby);
    round.timer = setInterval(() => tick(lobby), 1000 / 60);
  }

  function stopRound(lobby) {
    if (lobby.round && lobby.round.timer) clearInterval(lobby.round.timer);
  }

  /** Step the round as far as the clock says it should be, sending what each tick was stepped with. */
  function tick(lobby) {
    const round = lobby.round;
    if (!round) return;
    const due = Math.min(Math.floor((now() - round.started) / (TICK * 1000)), MAX_TICKS);
    let n = 0;
    while (round.ticksDone < due && n++ < catchUp && !round.world.result.over) {
      // Each captain sails on the last controls she sent. What changed since the last tick is
      // what goes out, so a browser holding the same `cur` steps the same world.
      const at = round.world.tick;
      const changes = {};
      for (const p of round.players) {
        if (round.next[p.id]) { round.cur[p.id] = round.next[p.id]; delete round.next[p.id]; }
        const key = JSON.stringify(round.cur[p.id]);
        if (key !== round.sent[p.id]) { changes[p.id] = round.cur[p.id]; round.sent[p.id] = key; }
      }
      const events = step(round.world, round.cur);
      // a repair is spent by the step that reads it: the next tick carries none, and says so
      for (const p of round.players) if (round.cur[p.id].repair) round.cur[p.id] = { ...round.cur[p.id], repair: null };
      round.frame.push(Object.keys(changes).length ? [at, changes] : [at]);
      round.ticksDone++;
      for (const e of events) {
        if (e.type === "player_out") settle(lobby, e.playerId, e.rank);
        if (e.type === "round_over") for (const p of round.players) settle(lobby, p.id);
      }
      if (round.world.tick % PRINT_TICKS === 0) round.frame.push(["print", round.world.tick, shipsPrint(round.world)]);
    }
    if (round.frame.length && (round.frame.length >= FRAME_TICKS || round.world.result.over)) {
      const msg = { t: "frame", ticks: round.frame };
      for (const m of lobby.members) if (m.playerId) send(m.ws, msg);
      round.frame = [];
    }
    if (round.world.result.over || round.ticksDone >= MAX_TICKS) {
      stopRound(lobby);
      lobby.round = null;
      lobby.state = "waiting";
      for (const m of lobby.members) { m.playerId = null; m.ready = false; }
      tellLobby(lobby);
    }
  }

  /** Bank one captain's voyage off the server's world, once: as she goes out, or at the end. */
  function settle(lobby, playerId, rank) {
    const round = lobby.round;
    if (round.banked.has(playerId)) return;
    round.banked.add(playerId);
    const p = round.players.find((x) => x.id === playerId);
    const run = { ...voyageRun(round.world, playerId), mode: "online" };
    if (rank !== undefined) { run.rank = rank; run.won = false; }
    transaction(pool, async (client) => {
      const cur = await lockHold(client, p.userId, now);
      const out = bank(cur.hold, run);
      const version = cur.version + 1;
      await writeHold(client, p.userId, out.rec, version, now);
      return { hold: out.rec, version, banked: out.banked, bounty: out.bounty, rank: run.rank, won: run.won };
    }).then((done) => {
      for (const m of lobby.members) if (m.userId === p.userId) send(m.ws, { t: "banked", ...done });
    }, (e) => console.error("could not bank an online voyage:", e.message));
  }

  // ---- the socket -----------------------------------------------------------------------------------

  wss.on("connection", (ws, userId) => {
    const member = { ws, userId, mid: randomUUID(), lobby: null, name: "", playerId: null, ready: false, joining: false };
    sockets.add(member);
    let alive = true;
    ws.on("pong", () => { alive = true; });
    const beat = setInterval(() => { if (!alive) return ws.terminate(); alive = false; ws.ping(); }, 15000);
    send(ws, { t: "hello", you: userId });
    send(ws, { t: "lobbies", list: publicList() });
    ws.on("message", async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg !== "object") return;
      const lobby = member.lobby;
      if (msg.t === "create") {
        if (member.joining) return;
        if (member.lobby) leave(member);
        const code = newCode();
        const created = { code, members: [], host: userId, rivals: MAX_SHIPS - 1, state: "waiting", round: null, public: msg.public === true };
        lobbies.set(code, created);
        await join(member, code);
      } else if (msg.t === "join" && typeof msg.code === "string") {
        await join(member, msg.code.trim().toUpperCase());
      } else if (msg.t === "leave") {
        leave(member);
        send(ws, { t: "left" });
      } else if (msg.t === "rivals" && lobby && lobby.host === userId && lobby.state === "waiting" && Number.isInteger(msg.rivals)) {
        lobby.rivals = Math.max(0, Math.min(MAX_SHIPS - 1, msg.rivals));
        tellLobby(lobby);
      } else if (msg.t === "ready" && lobby && lobby.state === "waiting" && typeof msg.ready === "boolean") {
        member.ready = msg.ready;
        tellLobby(lobby);
      } else if (msg.t === "start" && lobby && lobby.host === userId && lobby.state === "waiting") {
        // everyone but the host has to be ready: nobody is dropped into a round they did not ask for
        const waiting = lobby.members.filter((m) => m.userId !== lobby.host && !m.ready).length;
        if (waiting) return send(ws, { t: "error", error: "not-ready", waiting });
        lobby.state = "starting";
        startRound(lobby).catch((e) => { console.error("could not start a round:", e.message); lobby.state = "waiting"; tellLobby(lobby); });
      } else if (msg.t === "input" && lobby && lobby.round && member.playerId && isInput(msg.input)) {
        const prev = lobby.round.next[member.playerId];
        const asked = msg.input.repair || (prev && prev.repair) || null;
        lobby.round.next[member.playerId] = { ...msg.input, repair: asked };
      }
    });
    ws.on("close", () => { clearInterval(beat); sockets.delete(member); leave(member); });
  });

  return {
    /** Take an upgrade request if it is for us and carries a good ticket; refuse it otherwise. */
    upgrade(req, socket, head) {
      const url = new URL(req.url, "http://x");
      const t = readTicket(secret, url.searchParams.get("ticket"), now());
      if (!t || t.e !== engine) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, t.u));
    },
    lobbies,
    publicWs,
    close() {
      for (const l of lobbies.values()) stopRound(l);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}

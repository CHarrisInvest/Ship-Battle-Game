/**
 * SAILING WITH FRIENDS — lobbies, and a round the server runs for everyone in one.
 *
 * A captain opens a lobby and gets a code; her friends join with it (or with the link that carries
 * it). The host picks a melee or two sides, sets how many AI ships sail (besides the captains in a
 * melee, to fill each side between sides, where every captain picks her own) and starts. The server
 * builds the world from a seed of its own and each captain's loadout off her own hold, and then runs
 * the round at 60 ticks a second on its own clock, taking each captain's latest controls as they
 * come in. Between sides it runs on after the last captain is out, faster, until a fleet is gone,
 * because the side still at sea may win the round for her.
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
import { createWorld, step, voyageRun, isInput, isHuman, shipsPrint, NO_INPUT, TICK, SIDES, SIDE_MIN, SIDE_MAX, TEAMS_SIDE } from "../src/sim/index.js";
import { bank, blank, shipLoadout, shipName } from "../src/holdrules.js";
import { transaction } from "./db.js";
import { lockHold, writeHold } from "./hold.js";

/** Captains in a lobby, and ships on the water, AI included: the free-for-all's own field. */
export const MAX_CAPTAINS = 8;
export const MAX_SHIPS = 11;
/** The two ways a lobby sails: a melee, or two sides drawn up across the sea. The host picks. */
export const LOBBY_MODES = ["ffa", "teams"];
/**
 * How much faster a round between sides runs once no captain is afloat. The round goes on until a
 * fleet is gone, because the side still at sea may yet win it for her captains, but a fight nobody
 * is in wants a quick end: the same ticks, taken four at a time.
 */
export const AI_PACE = 4;
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
/**
 * How long a captain whose connection dropped keeps her place: a phone that locks, an app switched
 * away from, a tunnel. She is shown as away, and she is put back the moment she reconnects.
 */
export const AWAY_MS = 2 * 60 * 1000;

export function createOnline({ pool, engine, secret, publicWs, now = () => Date.now(), catchUp = 10, awayMs = AWAY_MS }) {
  const lobbies = new Map(); // code to lobby
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };

  function newCode() {
    for (;;) {
      let c = "";
      for (let i = 0; i < 5; i++) c += CODE_ABC[randomInt(CODE_ABC.length)];
      if (!lobbies.has(c)) return c;
    }
  }

  /**
   * What every member is told about the lobby. `mid` tells two rows apart even for one captain.
   * `rivals` is the melee's AI count and `perSide` the ships a side between sides; both are kept, so
   * the host can switch between the two without losing either figure.
   */
  function lobbyView(lobby) {
    return {
      t: "lobby", code: lobby.code, state: lobby.state, mode: lobby.mode, rivals: lobby.rivals, perSide: lobby.perSide, host: lobby.host, public: lobby.public,
      captains: lobby.members.map((m) => ({ mid: m.mid, userId: m.userId, name: m.name, ready: !!m.ready, away: !!m.away, playerId: m.playerId || null, side: m.side || null })),
    };
  }

  /** The side with fewer captains on it, the left when they are even: where a captain who has not picked is put. */
  function lighterSide(lobby) {
    const n = (side) => lobby.members.filter((m) => m.side === side).length;
    return n(SIDES[1]) < n(SIDES[0]) ? SIDES[1] : SIDES[0];
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
      .map((l) => ({ code: l.code, host: (l.members.find((m) => m.userId === l.host) || l.members[0]).name, captains: l.members.length, max: MAX_CAPTAINS, mode: l.mode }));
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
    clearTimeout(member.awayTimer);
    member.lobby = null;
    member.ready = false;
    lobby.members = lobby.members.filter((m) => m !== member);
    if (!lobby.members.length) { stopRound(lobby); lobbies.delete(lobby.code); tellLobbies(); return; }
    if (lobby.host === member.userId && !lobby.members.some((m) => m.userId === member.userId)) {
      // the host goes to a captain who is here, if there is one
      lobby.host = (lobby.members.find((m) => !m.away) || lobby.members[0]).userId;
    }
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
        member.side = earlier.side;
        clearTimeout(earlier.awayTimer);
        earlier.lobby = null;
        if (!earlier.away) send(earlier.ws, { t: "left", reason: "elsewhere" });
      } else {
        // a newcomer joins the side with fewer captains, and can move
        member.side = lighterSide(lobby);
        lobby.members.push(member);
      }
      tellLobby(lobby);
      if (lobby.state === "sailing") {
        // back mid-round: the round so far, so her browser can sail it up to the server's tick; or,
        // if she was not in it, word that she waits for the next one
        if (member.playerId && lobby.round) catchUpRound(lobby, member);
        else send(member.ws, { t: "sailing" });
      }
    } finally {
      member.joining = false;
    }
  }

  // ---- a round --------------------------------------------------------------------------------------

  /**
   * The field a lobby's setting gives, as the world will be built: the melee's AI count held to what
   * the sea takes beside the captains, or the ships a side held to the sea's figures and to the
   * larger side's captains, who all sail whatever the host set.
   */
  function fieldOf(lobby) {
    if (lobby.mode === "teams") {
      const most = Math.max(...SIDES.map((side) => lobby.members.filter((m) => m.side === side).length));
      return Math.max(SIDE_MIN, most, Math.min(SIDE_MAX, lobby.perSide));
    }
    return Math.max(0, Math.min(lobby.rivals, MAX_SHIPS - lobby.members.length));
  }

  async function startRound(lobby) {
    const humans = lobby.members;
    const teams = lobby.mode === "teams";
    const players = [];
    for (let i = 0; i < humans.length; i++) {
      const m = humans[i];
      const { rows } = await pool.query("select data from holds where user_id = $1", [m.userId]);
      const hold = rows.length ? rows[0].data : null;
      // the loadout off her own hold on the server, as the JSON every browser builds the world from
      const loadout = JSON.parse(JSON.stringify(shipLoadout(hold || blank())));
      m.playerId = `p${i + 1}`;
      players.push({ id: m.playerId, loadout, userId: m.userId, name: m.name, side: teams ? m.side : null });
    }
    const rivals = fieldOf(lobby);
    const seed = randomInt(0, 2 ** 32);
    // the roster is the whole of what a browser builds the world from, so it carries each
    // captain's side as well as her loadout
    const roster = players.map((p) => ({ id: p.id, name: p.name, loadout: p.loadout, side: p.side }));
    const world = createWorld({ mode: lobby.mode, seed, players: roster.map((p) => ({ id: p.id, loadout: p.loadout, side: p.side })), rivals });
    const round = {
      world, players, seed, rivals, mode: lobby.mode, roster,
      cur: Object.fromEntries(players.map((p) => [p.id, { ...NO_INPUT }])), // the input each tick is stepped with
      sent: Object.fromEntries(players.map((p) => [p.id, JSON.stringify(NO_INPUT)])),
      next: {}, // the latest input each captain sent since the last tick
      banked: new Set(),
      bankedSent: {}, // what each captain was told she banked, to tell her again if she reconnects
      frame: [],
      log: [], // every frame entry sent, so a captain who reconnects can sail the round up to now
      started: now(),
      ticksDone: 0,
      // the clock the ticks are owed by: `base` ticks were done at `baseAt`, and `pace` ticks a
      // tick's worth of real time have fallen due since. Rebased when the pace changes.
      pace: 1, base: 0, baseAt: now(),
    };
    lobby.round = round;
    lobby.state = "sailing";
    for (const m of humans) send(m.ws, { t: "start", mode: lobby.mode, seed, rivals, players: roster, you: m.playerId });
    tellLobby(lobby);
    round.timer = setInterval(() => tick(lobby), 1000 / 60);
  }

  /**
   * A captain back in a round she was sailing: the start again, and every tick so far. Her browser
   * builds the world from the seed and steps it through them, which is the round the server has
   * sailed, and then carries on with the live frames. A minute of round steps in well under a second.
   */
  function catchUpRound(lobby, member) {
    const round = lobby.round;
    send(member.ws, { t: "start", mode: round.mode, seed: round.seed, rivals: round.rivals, players: round.roster, you: member.playerId, rejoin: true });
    send(member.ws, { t: "frame", ticks: round.log.concat(round.frame) });
    const told = round.bankedSent[member.playerId];
    if (told) send(member.ws, told);
  }

  function stopRound(lobby) {
    if (lobby.round && lobby.round.timer) clearInterval(lobby.round.timer);
  }

  /** Step the round as far as the clock says it should be, sending what each tick was stepped with. */
  function tick(lobby) {
    const round = lobby.round;
    if (!round) return;
    // Between sides a round nobody is in any more runs faster to its end; the ticks are the same
    // ticks, so every browser steps the same world, only sooner. The clock is rebased when the
    // pace changes, so no tick is owed twice or skipped.
    const pace = round.world.rules.sides && !round.world.ships.some((s) => isHuman(s) && s.alive) ? AI_PACE : 1;
    if (pace !== round.pace) { round.pace = pace; round.base = round.ticksDone; round.baseAt = now(); }
    const due = Math.min(round.base + Math.floor(((now() - round.baseAt) * pace) / (TICK * 1000)), MAX_TICKS);
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
        // a captain out of a melee is banked at once, placed and beaten; between sides her side
        // may yet win the round for her, so everyone is banked when it ends
        if (e.type === "player_out" && !round.world.rules.sides) settle(lobby, e.playerId, e.rank);
        if (e.type === "round_over") for (const p of round.players) settle(lobby, p.id);
      }
      if (round.world.tick % PRINT_TICKS === 0) round.frame.push(["print", round.world.tick, shipsPrint(round.world)]);
    }
    if (round.frame.length && (round.frame.length >= FRAME_TICKS || round.world.result.over)) {
      const msg = { t: "frame", ticks: round.frame };
      for (const f of round.frame) round.log.push(f);
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
      round.bankedSent[playerId] = { t: "banked", ...done };
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
    // a captain with a place in a lobby (her connection dropped, or she reopened the app) is put
    // straight back in it; anyone else is shown the open lobbies
    const seat = seatOf(userId);
    if (seat) join(member, seat.code);
    else send(ws, { t: "lobbies", list: publicList() });
    ws.on("message", async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg !== "object") return;
      const lobby = member.lobby;
      if (msg.t === "create") {
        if (member.joining) return;
        if (member.lobby) leave(member);
        const code = newCode();
        const created = { code, members: [], host: userId, mode: "ffa", rivals: MAX_SHIPS - 1, perSide: TEAMS_SIDE, state: "waiting", round: null, public: msg.public === true };
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
      } else if (msg.t === "mode" && lobby && lobby.host === userId && lobby.state === "waiting" && LOBBY_MODES.includes(msg.mode)) {
        lobby.mode = msg.mode;
        tellLobby(lobby);
      } else if (msg.t === "perSide" && lobby && lobby.host === userId && lobby.state === "waiting" && Number.isInteger(msg.perSide)) {
        lobby.perSide = Math.max(SIDE_MIN, Math.min(SIDE_MAX, msg.perSide));
        tellLobby(lobby);
      } else if (msg.t === "side" && lobby && lobby.state === "waiting" && SIDES.includes(msg.side)) {
        // any captain picks her own side, as long as it has room for her under the sea's ceiling
        if (lobby.members.filter((m) => m !== member && m.side === msg.side).length >= SIDE_MAX) return send(ws, { t: "error", error: "side-full" });
        member.side = msg.side;
        tellLobby(lobby);
      } else if (msg.t === "ready" && lobby && lobby.state === "waiting" && typeof msg.ready === "boolean") {
        member.ready = msg.ready;
        tellLobby(lobby);
      } else if (msg.t === "start" && lobby && lobby.host === userId && lobby.state === "waiting") {
        // everyone but the host has to be ready: nobody is dropped into a round they did not ask for
        const waiting = lobby.members.filter((m) => m.userId !== lobby.host && (!m.ready || m.away)).length;
        if (waiting) return send(ws, { t: "error", error: "not-ready", waiting });
        lobby.state = "starting";
        startRound(lobby).catch((e) => { console.error("could not start a round:", e.message); lobby.state = "waiting"; tellLobby(lobby); });
      } else if (msg.t === "input" && lobby && lobby.round && member.playerId && isInput(msg.input)) {
        const prev = lobby.round.next[member.playerId];
        const asked = msg.input.repair || (prev && prev.repair) || null;
        lobby.round.next[member.playerId] = { ...msg.input, repair: asked };
      }
    });
    ws.on("close", () => {
      clearInterval(beat);
      sockets.delete(member);
      if (!member.lobby) return;
      // dropped, not left: she keeps her place as away until she is back or the time runs out
      member.away = true;
      member.ws = null;
      tellLobby(member.lobby);
      member.awayTimer = setTimeout(() => { if (member.away && member.lobby) leave(member); }, awayMs);
    });
  });

  /** The lobby a captain has a place in, connected or away, or null. */
  function seatOf(userId) {
    for (const l of lobbies.values()) if (l.members.some((m) => m.userId === userId)) return l;
    return null;
  }

  return {
    /** Which lobby code a captain still has a place in, so a reopened app can go straight back. */
    whereIs: (userId) => { const l = seatOf(userId); return l ? l.code : null; },
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

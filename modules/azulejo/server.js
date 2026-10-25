// The socket layer for Azulejo. The rules live in game.js and the computer players in bot.js; this file keeps the rooms,
// saves them under ctx.dataDir, drives the computer players on timers, sends each player their own view and reports
// finished games to the statistics.
//
// Timing can be changed through the environment (the tests make it fast):
//   AZULEJO_BOT_DELAY   "min-max" milliseconds a computer player waits before acting (default 600-1400)
import fs from 'node:fs';
import path from 'node:path';
import * as game from './game.js';
import * as bot from './bot.js';

const KEEP_FINISHED_MS = 24 * 60 * 60 * 1000;
const KEEP_OTHER_MS = 7 * 24 * 60 * 60 * 1000;

function readDelays() {
  const [min, max] = String(process.env.AZULEJO_BOT_DELAY ?? '600-1400').split('-').map(Number);
  const low = Number.isFinite(min) ? min : 600;
  return { botMin: low, botMax: Number.isFinite(max) ? Math.max(max, low) : Math.max(1400, low) };
}

export default function (ctx) {
  const file = path.join(ctx.dataDir, 'rooms.json');
  const delays = readDelays();
  const rooms = new Map();
  const sockets = new Map(); // user id -> the sockets that user has open
  const timers = new Map(); // room code -> the timer for the next computer move

  try {
    for (const room of JSON.parse(fs.readFileSync(file, 'utf8'))) rooms.set(room.code, room);
  } catch (error) {
    if (error.code !== 'ENOENT') ctx.log('could not read the saved games:', error.message);
  }

  let saveTimer = null;
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify([...rooms.values()]));
      fs.renameSync(`${file}.tmp`, file);
    } catch (error) {
      ctx.log('could not save the games:', error.message);
    }
  }
  const save = () => {
    saveTimer ??= setTimeout(saveNow, 100);
    saveTimer.unref?.();
  };

  function discard(room) {
    clearTimeout(timers.get(room.code));
    timers.delete(room.code);
    rooms.delete(room.code);
    save();
  }

  function sweep() {
    const now = Date.now();
    for (const room of [...rooms.values()]) {
      if (now - room.updatedAt > (game.isLive(room) ? KEEP_OTHER_MS : KEEP_FINISHED_MS)) discard(room);
    }
  }
  sweep();
  const sweeper = setInterval(sweep, 60 * 60 * 1000);
  sweeper.unref();

  const open = (id, code) => [...(sockets.get(id) ?? [])].filter((s) => s.data.code === code);
  const online = (code) => (id) => open(id, code).length > 0;
  const liveRoomOf = (userId) => [...rooms.values()].find((r) => game.isLive(r) && game.hasPlayer(r, userId));
  const latestRoomOf = (userId) =>
    liveRoomOf(userId) ?? [...rooms.values()].filter((r) => game.hasPlayer(r, userId)).sort((a, b) => b.updatedAt - a.updatedAt)[0];

  function push(room) {
    for (const seat of room.seats) {
      if (!game.isHuman(seat)) continue;
      for (const socket of open(seat.id, room.code)) socket.emit('state', game.viewFor(room, seat.id, { online: online(room.code) }));
    }
  }

  function attach(socket, room) {
    socket.data.code = room.code;
    push(room);
  }

  function detach(userId, code) {
    for (const socket of open(userId, code)) {
      socket.data.code = null;
      socket.emit('state', null);
    }
  }

  function schedule(room) {
    clearTimeout(timers.get(room.code));
    timers.delete(room.code);
    if (!bot.pendingAction(room)) return;
    const wait = delays.botMin + Math.random() * (delays.botMax - delays.botMin);
    const timer = setTimeout(() => {
      timers.delete(room.code);
      if (rooms.get(room.code) !== room) return;
      try {
        bot.runPending(room);
      } catch (error) {
        ctx.log('a computer move failed:', error);
        return;
      }
      changed(room);
    }, wait);
    timers.set(room.code, timer);
  }

  function recordIfFinished(room) {
    if (room.phase !== 'finished' || room.recorded) return;
    room.recorded = true;
    try {
      ctx.stats.record({ code: room.code, players: game.statsPlayers(room) });
    } catch (error) {
      ctx.log('could not record the statistics:', error.message);
    }
  }

  function changed(room) {
    room.updatedAt = Date.now();
    recordIfFinished(room);
    save();
    push(room);
    schedule(room);
  }

  /** Takes a person out of a room (a computer player replaces them mid-game) and tells everyone. */
  function leaveRoom(room, userId) {
    const outcome = game.removeHuman(room, userId);
    if (!outcome.ok) return outcome;
    detach(userId, room.code);
    if (outcome.empty) discard(room);
    else changed(room);
    return outcome;
  }

  function enter(socket, rawCode) {
    const userId = socket.data.user.id;
    const mine = liveRoomOf(userId);
    const code = ctx.codes.normalise(rawCode);
    if (rawCode && !code) return { ok: false, error: 'That is not an invite code. It looks like boss-aware-you.' };
    if (mine && code && mine.code !== code) {
      attach(socket, mine);
      return { ok: false, error: `You are already in the game ${mine.code}. Leave it to join another.` };
    }
    if (mine) {
      attach(socket, mine);
      return { ok: true, code: mine.code };
    }
    if (!code) {
      const latest = latestRoomOf(userId);
      if (latest) attach(socket, latest);
      else socket.emit('state', null);
      return { ok: true, code: latest?.code ?? null };
    }
    const room = rooms.get(code);
    if (!room) {
      socket.emit('state', null);
      return { ok: false, error: 'No game has that code.' };
    }
    if (game.hasPlayer(room, userId)) {
      attach(socket, room);
      return { ok: true, code };
    }
    const added = game.addHuman(room, userId, socket.data.user.name);
    if (!added.ok) {
      socket.emit('state', null);
      return room.phase === 'finished' ? { ok: false, error: 'That game has finished.' } : added;
    }
    for (const old of rooms.values()) if (old !== room && game.hasPlayer(old, userId)) leaveRoom(old, userId);
    attach(socket, room);
    changed(room);
    return { ok: true, code };
  }

  ctx.io.on('connection', (socket) => {
    const userId = socket.data.user.id;
    socket.data.code = null;
    if (!sockets.has(userId)) sockets.set(userId, new Set());
    sockets.get(userId).add(socket);

    const roomOfSocket = () => rooms.get(socket.data.code);
    const on = (event, handler) =>
      socket.on(event, (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          reply(handler(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) ?? { ok: true });
        } catch (error) {
          ctx.log(`${event} failed:`, error);
          reply({ ok: false, error: 'Something went wrong on the server.' });
        }
      });

    /** Runs a rule on the room this socket is in, then tells everyone if it worked. */
    const act = (rule) => {
      const room = roomOfSocket();
      const seat = room ? game.seatOf(room, userId) : -1;
      if (seat === -1) return { ok: false, error: 'You are not in a game.' };
      const outcome = rule(room, seat);
      if (outcome.ok) changed(room);
      return outcome.ok ? { ok: true } : { ok: false, error: outcome.error };
    };

    on('resume', ({ code }) => enter(socket, code));
    on('join', ({ code }) => (typeof code === 'string' && code.trim() ? enter(socket, code) : { ok: false, error: 'Type an invite code.' }));

    on('create', (payload) => {
      const mine = liveRoomOf(userId);
      if (mine) {
        attach(socket, mine);
        return { ok: false, error: `You are already in the game ${mine.code}. Leave it to start another.` };
      }
      let room;
      try {
        room = game.createRoom({
          code: ctx.codes.generate((c) => rooms.has(c)),
          hostId: userId,
          hostName: socket.data.user.name,
          size: payload.seats === undefined ? game.DEFAULT_SIZE : payload.seats,
          settings: pickSettings(payload),
        });
      } catch (error) {
        return { ok: false, error: error.message };
      }
      for (const old of rooms.values()) if (game.hasPlayer(old, userId)) leaveRoom(old, userId);
      rooms.set(room.code, room);
      attach(socket, room);
      save();
      return { ok: true, code: room.code };
    });

    on('leave', () => {
      const room = roomOfSocket();
      if (!room) return { ok: true };
      if (!game.hasPlayer(room, userId)) {
        socket.data.code = null;
        socket.emit('state', null);
        return { ok: true };
      }
      leaveRoom(room, userId);
      return { ok: true };
    });

    on('kick', ({ seat }) => {
      const room = roomOfSocket();
      if (!room) return { ok: false, error: 'You are not in a game.' };
      const outcome = game.kick(room, userId, seat);
      if (!outcome.ok) return { ok: false, error: outcome.error };
      detach(outcome.userId, room.code);
      changed(room);
      return { ok: true };
    });
    on('settings', (payload) => act((room) => game.setSettings(room, userId, pickSettings(payload))));
    on('size', ({ seats }) => act((room) => game.setSize(room, userId, seats)));
    on('addBot', ({ seat }) => act((room) => game.addBot(room, userId, seat)));
    on('removeBot', ({ seat }) => act((room) => game.removeBot(room, userId, seat)));
    on('fillBots', () => act((room) => game.fillWithBots(room, userId)));
    on('start', () => act((room) => game.start(room, userId)));
    on('move', ({ source, colour, line }) => act((room, seat) => game.takeTiles(room, seat, { source, colour, line })));
    on('column', ({ col }) => act((room, seat) => game.chooseColumn(room, seat, { col })));
    on('again', () => act((room) => game.playAgain(room, userId)));

    socket.on('disconnect', () => {
      const set = sockets.get(userId);
      set?.delete(socket);
      if (set && !set.size) sockets.delete(userId);
      const room = roomOfSocket();
      if (room) push(room);
    });
  });

  for (const room of rooms.values()) schedule(room);

  return {
    dispose() {
      clearInterval(sweeper);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      saveNow();
    },
  };
}

/** Only the one setting, whatever else a client sends. */
function pickSettings(payload) {
  const { freeWall } = payload ?? {};
  return freeWall === undefined ? {} : { freeWall };
}

// The socket layer for Wavelength. The rules live in game.js; this file keeps the rooms, saves them under
// ctx.dataDir, sends each player their own view and reports finished games to the statistics. Computer players are
// seats in the room (see game.js); this file plays their moves on a timer, one at a time, from their own view.
//
//   WAVELENGTH_BOT_DELAY   "min-max" milliseconds a computer player waits before acting (default 600-1400)
//   WAVELENGTH_NEXT_WAIT   milliseconds the reveal waits for everyone to close the scores before moving on (default 60000)
import fs from 'node:fs';
import path from 'node:path';
import * as game from './game.js';

const KEEP_FINISHED_MS = 24 * 60 * 60 * 1000;
const KEEP_OTHER_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_BOT_DELAY = [600, 1400];

/** WAVELENGTH_BOT_DELAY ("600-1400", or one number) as [min, max] milliseconds. */
function readBotDelay() {
  const [min, max = min] = String(process.env.WAVELENGTH_BOT_DELAY ?? '').split('-').map(Number);
  if (!Number.isFinite(min) || min < 0) return DEFAULT_BOT_DELAY;
  return [min, Number.isFinite(max) ? Math.max(max, min) : min];
}

export default function (ctx) {
  const [botMin, botMax] = readBotDelay();
  const nextWait = Number(process.env.WAVELENGTH_NEXT_WAIT ?? 60000) >= 0 ? Number(process.env.WAVELENGTH_NEXT_WAIT ?? 60000) : 60000;
  const file = path.join(ctx.dataDir, 'rooms.json');
  const timers = new Map(); // room code -> the timer for the next computer move
  const rooms = new Map();
  const sockets = new Map(); // user id -> the sockets that user has open

  try {
    for (const room of JSON.parse(fs.readFileSync(file, 'utf8'))) rooms.set(room.code, game.migrate(room));
  } catch (error) {
    if (error.code !== 'ENOENT') ctx.log('could not read the saved games:', error.message);
  }

  function drop(code) {
    clearTimeout(timers.get(code));
    timers.delete(code);
    rooms.delete(code);
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

  function sweep() {
    const now = Date.now();
    for (const room of rooms.values()) {
      const age = now - room.updatedAt;
      if (age > (game.isLive(room) ? KEEP_OTHER_MS : KEEP_FINISHED_MS)) drop(room.code);
    }
    save();
  }
  sweep();
  const sweeper = setInterval(sweep, 60 * 60 * 1000);
  sweeper.unref();

  const nameOf = (id) => ctx.users.get(id)?.displayName ?? 'Someone'; // computer players are named by the game itself
  const open = (id, code) => [...(sockets.get(id) ?? [])].filter((s) => s.data.code === code);
  const onlineOf = (code) => (id) => open(id, code).length > 0;
  const activeRoomOf = (userId) => [...rooms.values()].find((r) => game.isLive(r) && game.hasPlayer(r, userId));

  function push(room) {
    for (const player of room.players) {
      for (const socket of open(player.id, room.code)) {
        socket.emit('state', game.viewFor(room, player.id, { nameOf, onlineOf: onlineOf(room.code) }));
      }
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

  function changed(room) {
    room.updatedAt = Date.now();
    save();
    push(room);
    schedule(room.code);
  }

  /** Plays the next computer move after a short wait, then looks again; stops when nothing is pending. */
  function schedule(code) {
    clearTimeout(timers.get(code));
    timers.delete(code);
    const room = rooms.get(code);
    const action = room && game.pendingBotAction(room);
    if (!room || (!action && !game.waitingForReady(room))) return;
    const timer = setTimeout(() => {
      timers.delete(code);
      if (rooms.get(code) !== room) return;
      try {
        if (action) game.runBotAction(room, Math.random, action, nameOf);
        else game.forceNext(room); // somebody has not closed the scores (away, or gone): move on without them
      } catch (error) {
        ctx.log('a computer move failed:', error);
        return;
      }
      recordIfFinished(room);
      changed(room);
    }, action ? botMin + Math.random() * (botMax - botMin) : nextWait);
    timer.unref?.();
    timers.set(code, timer);
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

  function afterRemoval(room, userId, outcome) {
    detach(userId, room.code);
    if (outcome.empty) drop(room.code);
    else {
      recordIfFinished(room);
      changed(room);
    }
    save();
  }

  function enter(socket, rawCode) {
    const userId = socket.data.user.id;
    const mine = activeRoomOf(userId);
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
      socket.emit('state', null);
      return { ok: true, code: null };
    }
    const room = rooms.get(code);
    if (!room) {
      socket.emit('state', null);
      return { ok: false, error: 'No game has that code.' };
    }
    if (!game.hasPlayer(room, userId)) {
      const added = game.addPlayer(room, userId);
      if (!added.ok) {
        socket.emit('state', null);
        return added;
      }
      attach(socket, room);
      changed(room);
      return { ok: true, code };
    }
    attach(socket, room);
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
          reply(handler(payload && typeof payload === 'object' ? payload : {}) ?? { ok: true });
        } catch (error) {
          ctx.log(`${event} failed:`, error);
          reply({ ok: false, error: 'Something went wrong on the server.' });
        }
      });

    /** Runs a rule on the room this socket is in, then tells everyone if it worked. */
    const act = (rule) => {
      const room = roomOfSocket();
      if (!room || !game.hasPlayer(room, userId)) return { ok: false, error: 'You are not in a game.' };
      const outcome = rule(room);
      if (outcome.ok) {
        recordIfFinished(room);
        changed(room);
      }
      return outcome.ok ? { ok: true } : outcome;
    };

    on('resume', ({ code }) => enter(socket, code));
    on('join', ({ code }) => (typeof code === 'string' && code.trim() ? enter(socket, code) : { ok: false, error: 'Type an invite code.' }));

    on('create', ({ turnsEach }) => {
      const mine = activeRoomOf(userId);
      if (mine) {
        attach(socket, mine);
        return { ok: false, error: `You are already in the game ${mine.code}. Leave it to start another.` };
      }
      const room = game.createRoom({ code: ctx.codes.generate((c) => rooms.has(c)), hostId: userId });
      if (turnsEach !== undefined) game.setTurnsEach(room, userId, turnsEach);
      rooms.set(room.code, room);
      attach(socket, room);
      save();
      return { ok: true, code: room.code };
    });

    on('leave', () => {
      const room = roomOfSocket();
      if (!room) return { ok: true };
      if (!game.isLive(room)) {
        detach(userId, room.code);
        return { ok: true };
      }
      afterRemoval(room, userId, game.removePlayer(room, userId, Math.random, nameOf));
      return { ok: true };
    });

    on('kick', ({ userId: target }) => {
      const room = roomOfSocket();
      if (!room || room.hostId !== userId) return { ok: false, error: 'Only the host can remove players.' };
      if (!Number.isInteger(target) || target === userId || !game.hasPlayer(room, target)) return { ok: false, error: 'That player is not in the game.' };
      afterRemoval(room, target, game.removePlayer(room, target, Math.random, nameOf));
      return { ok: true };
    });

    /** The host's tools for computer players (people are removed with kick). */
    const asHost = (rule) => {
      const room = roomOfSocket();
      if (!room || !game.hasPlayer(room, userId)) return { ok: false, error: 'You are not in a game.' };
      const outcome = rule(room);
      if (outcome.ok) changed(room);
      return outcome.ok ? { ok: true } : outcome;
    };
    on('addBot', () => asHost((room) => game.addBot(room, userId)));
    on('fillBots', ({ count }) => asHost((room) => game.fillBots(room, userId, count)));
    on('removeBot', ({ seat }) => {
      const room = roomOfSocket();
      if (!room || room.hostId !== userId) return { ok: false, error: 'Only the host can remove players.' };
      const bot = room.players.find((p) => p.id === seat && p.bot);
      if (!bot) return { ok: false, error: 'That is not a computer player.' };
      if (room.phase === 'lobby') {
        const outcome = game.removeBot(room, userId, seat);
        if (outcome.ok) changed(room);
        return outcome;
      }
      afterRemoval(room, seat, game.removePlayer(room, seat, Math.random, nameOf)); // mid-game: the game carries on with fewer players
      return { ok: true };
    });

    on('colour', ({ colour }) => act((room) => game.setColour(room, userId, colour)));
    on('settings', ({ turnsEach }) => act((room) => game.setTurnsEach(room, userId, turnsEach)));
    on('start', () => act((room) => game.start(room, userId)));
    on('clue', ({ text }) => act((room) => game.setClue(room, userId, text)));
    on('guess', ({ position }) => act((room) => game.guess(room, userId, position, nameOf)));
    on('ready', () => act((room) => game.ready(room, userId)));

    socket.on('disconnect', () => {
      const set = sockets.get(userId);
      set?.delete(socket);
      if (set && !set.size) sockets.delete(userId);
      const room = roomOfSocket();
      if (room) push(room);
    });
  });

  for (const code of rooms.keys()) schedule(code);

  return {
    dispose() {
      clearInterval(sweeper);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      saveNow();
    },
  };
}

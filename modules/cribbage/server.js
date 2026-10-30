// The socket layer for Cribbage. The rules live in game.js; this file keeps the rooms, saves them under ctx.dataDir,
// sends each player their own view, drives the computer players and reports finished games to the statistics.
import fs from 'node:fs';
import path from 'node:path';
import * as game from './game.js';

const KEEP_FINISHED_MS = 24 * 60 * 60 * 1000;
const KEEP_OTHER_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ROOMS = 500;

/** CRIBBAGE_BOT_DELAY ("600-1400", or one number) in milliseconds: how long a computer player thinks. */
function botDelay() {
  const [min, max = min] = String(process.env.CRIBBAGE_BOT_DELAY ?? '600-1400').split('-').map(Number);
  const low = Number.isFinite(min) ? min : 600;
  const high = Number.isFinite(max) ? Math.max(max, low) : 1400;
  return () => low + Math.random() * (high - low);
}

export default function (ctx) {
  const file = path.join(ctx.dataDir, 'rooms.json');
  const rooms = new Map();
  const sockets = new Map(); // user id -> the sockets that user has open
  const timers = new Map(); // room code -> the pending computer player's move
  const thinkTime = botDelay();

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

  function sweep() {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (now - room.updatedAt > (game.isLive(room) ? KEEP_OTHER_MS : KEEP_FINISHED_MS)) drop(room);
    }
    save();
  }
  const sweeper = setInterval(sweep, 60 * 60 * 1000);
  sweeper.unref();

  const open = (id, code) => [...(sockets.get(id) ?? [])].filter((s) => s.data.code === code);
  const onlineIn = (code) => (id) => open(id, code).length > 0;
  const activeRoomOf = (userId) => [...rooms.values()].find((r) => game.isLive(r) && game.hasPlayer(r, userId));

  function push(room) {
    for (const seat of room.seats) {
      if (seat.userId === null) continue;
      for (const socket of open(seat.userId, room.code)) socket.emit('state', game.viewFor(room, seat.userId, { online: onlineIn(room.code) }));
    }
  }

  function drop(room) {
    clearTimeout(timers.get(room.code));
    timers.delete(room.code);
    rooms.delete(room.code);
  }

  /** Lets a computer player move after a short pause, then looks for the next one. */
  function think(room) {
    if (timers.has(room.code) || !rooms.has(room.code) || !game.pendingBot(room)) return;
    const timer = setTimeout(() => {
      timers.delete(room.code);
      if (rooms.get(room.code) !== room || !game.pendingBot(room)) return;
      const outcome = game.botMove(room);
      if (!outcome.ok) ctx.log('a computer player could not move:', outcome.error);
      changed(room);
    }, thinkTime());
    timer.unref?.();
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
    recordIfFinished(room);
    room.updatedAt = Date.now();
    save();
    push(room);
    think(room);
  }

  function attach(socket, room) {
    socket.data.code = room.code;
    socket.emit('state', game.viewFor(room, socket.data.user.id, { online: onlineIn(room.code) }));
  }

  function detach(userId, code) {
    for (const socket of open(userId, code)) {
      socket.data.code = null;
      socket.emit('state', null);
    }
  }

  function afterRemoval(room, userId, outcome) {
    detach(userId, room.code);
    if (outcome.empty) drop(room);
    else changed(room);
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
      push(mine);
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
      const added = game.addHuman(room, userId, socket.data.user.name);
      if (!added.ok) {
        socket.emit('state', null);
        return added;
      }
      attach(socket, room);
      changed(room);
      return { ok: true, code };
    }
    attach(socket, room);
    push(room);
    return { ok: true, code };
  }

  ctx.io.on('connection', (socket) => {
    const user = socket.data.user;
    const userId = user.id;
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

    /** Runs a rule for this player in the room this socket is in, then tells everyone if it worked. */
    /** Every card a person plays counts towards the global Played cards achievement. */
    const countCards = (outcome, count) => {
      if (outcome.ok) ctx.achievements.add(userId, 'global.cards', count);
      return outcome;
    };
    const act = (rule) => {
      const room = roomOfSocket();
      if (!room || !game.hasPlayer(room, userId)) return { ok: false, error: 'You are not in a game.' };
      const outcome = rule(room, game.seatOf(room, userId));
      if (outcome.ok) changed(room);
      return outcome.ok ? { ok: true } : outcome;
    };

    on('resume', ({ code }) => enter(socket, code));
    on('join', ({ code }) => (typeof code === 'string' && code.trim() ? enter(socket, code) : { ok: false, error: 'Type an invite code.' }));

    on('create', ({ target, seats }) => {
      const mine = activeRoomOf(userId);
      if (mine) {
        attach(socket, mine);
        return { ok: false, error: `You are already in the game ${mine.code}. Leave it to start another.` };
      }
      if (rooms.size >= MAX_ROOMS) return { ok: false, error: 'There are too many games running. Please try again later.' };
      const room = game.createRoom({ code: ctx.codes.generate((c) => rooms.has(c)), hostId: userId, name: user.name });
      const settings = game.setSettings(room, userId, { target, seats });
      if (!settings.ok) return settings;
      rooms.set(room.code, room);
      attach(socket, room);
      save();
      return { ok: true, code: room.code };
    });

    on('leave', () => {
      const room = roomOfSocket();
      if (!room) return { ok: true };
      if (!game.hasPlayer(room, userId)) {
        detach(userId, room.code);
        return { ok: true };
      }
      afterRemoval(room, userId, game.removeHuman(room, userId));
      return { ok: true };
    });

    on('kick', ({ seat }) => {
      const room = roomOfSocket();
      if (!room) return { ok: false, error: 'You are not in a game.' };
      const outcome = game.kick(room, userId, seat);
      if (!outcome.ok) return outcome;
      afterRemoval(room, outcome.userId, outcome);
      return { ok: true };
    });

    on('settings', ({ target, seats }) => act((room) => game.setSettings(room, userId, { target, seats })));
    on('addBot', () => act((room) => game.addBot(room, userId)));
    on('fillBots', () => act((room) => game.fillBots(room, userId)));
    on('removeBot', ({ seat }) => act((room) => game.removeBot(room, userId, seat)));
    on('start', () => act((room) => game.start(room, userId)));
    on('discard', ({ cards }) => act((room, seat) => game.discard(room, seat, cards)));
    on('play', ({ card }) => act((room, seat) => countCards(game.playCard(room, seat, card), 1)));
    on('ready', () => act((room, seat) => game.ready(room, seat)));
    on('rematch', () =>
      act((room) => game.returnToLobby(room, userId, (id) => open(id, room.code).length > 0)),
    );

    socket.on('disconnect', () => {
      const set = sockets.get(userId);
      set?.delete(socket);
      if (set && !set.size) sockets.delete(userId);
      const room = roomOfSocket();
      if (room) push(room);
    });
  });

  for (const room of rooms.values()) think(room);

  return {
    dispose() {
      clearInterval(sweeper);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      saveNow();
    },
  };
}

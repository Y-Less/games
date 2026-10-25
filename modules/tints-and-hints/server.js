// The socket layer for Tints and Hints. The rules live in game.js; this file keeps the rooms, saves them under
// ctx.dataDir, sends each player their own view and reports finished games to the statistics.
import fs from 'node:fs';
import path from 'node:path';
import * as game from './game.js';

const KEEP_FINISHED_MS = 24 * 60 * 60 * 1000;
const KEEP_OTHER_MS = 7 * 24 * 60 * 60 * 1000;

export default function (ctx) {
  const file = path.join(ctx.dataDir, 'rooms.json');
  const rooms = new Map();
  const sockets = new Map(); // user id -> the sockets that user has open

  try {
    for (const room of JSON.parse(fs.readFileSync(file, 'utf8'))) rooms.set(room.code, game.migrate(room));
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
      const age = now - room.updatedAt;
      if (age > (game.isLive(room) ? KEEP_OTHER_MS : KEEP_FINISHED_MS)) rooms.delete(room.code);
    }
    save();
  }
  sweep();
  const sweeper = setInterval(sweep, 60 * 60 * 1000);
  sweeper.unref();

  const nameOf = (id) => ctx.users.get(id)?.displayName ?? 'Someone';
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
    if (outcome.empty) rooms.delete(room.code);
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
      afterRemoval(room, userId, game.removePlayer(room, userId));
      return { ok: true };
    });

    on('kick', ({ userId: target }) => {
      const room = roomOfSocket();
      if (!room || room.hostId !== userId) return { ok: false, error: 'Only the host can remove players.' };
      if (!Number.isInteger(target) || target === userId || !game.hasPlayer(room, target)) return { ok: false, error: 'That player is not in the game.' };
      if (room.phase !== 'lobby' && onlineOf(room.code)(target)) return { ok: false, error: 'You can only remove a player who has left the game page.' };
      afterRemoval(room, target, game.removePlayer(room, target));
      return { ok: true };
    });

    on('colour', ({ colour }) => act((room) => game.setColour(room, userId, colour)));
    on('settings', ({ turnsEach }) => act((room) => game.setTurnsEach(room, userId, turnsEach)));
    on('start', () => act((room) => game.start(room, userId)));
    on('hint', ({ text }) => act((room) => game.setHint(room, userId, text)));
    on('guess', ({ cell }) => act((room) => game.guess(room, userId, cell)));
    on('advance', () => act((room) => game.advance(room, userId, Math.random, nameOf)));

    socket.on('disconnect', () => {
      const set = sockets.get(userId);
      set?.delete(socket);
      if (set && !set.size) sockets.delete(userId);
      const room = roomOfSocket();
      if (room) push(room);
    });
  });

  return {
    dispose() {
      clearInterval(sweeper);
      saveNow();
    },
  };
}

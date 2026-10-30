// The socket layer for Hearts. The rules live in game.js; this file keeps the rooms, saves them under ctx.dataDir,
// drives the computer players and the end of each trick on timers, sends each player their own view and reports
// finished games to the statistics.
//
// Timing can be changed through the environment (the tests make it fast):
//   HEARTS_BOT_DELAY   "min-max" milliseconds a computer player waits before acting (default 600-1400)
//   HEARTS_TRICK_PAUSE milliseconds a finished trick stays on the table (default 1500)
//   HEARTS_NEXT_WAIT   milliseconds to wait for everyone to close the score pop-up between hands (default 60000)
import fs from 'node:fs';
import path from 'node:path';
import * as game from './game.js';

const KEEP_FINISHED_MS = 24 * 60 * 60 * 1000;
const KEEP_OTHER_MS = 7 * 24 * 60 * 60 * 1000;

function readDelays() {
  const [min, max] = String(process.env.HEARTS_BOT_DELAY ?? '600-1400').split('-').map(Number);
  const trick = Number(process.env.HEARTS_TRICK_PAUSE ?? 1500);
  const nextWait = Number(process.env.HEARTS_NEXT_WAIT ?? 60000);
  const low = Number.isFinite(min) ? min : 600;
  return { botMin: low, botMax: Number.isFinite(max) ? Math.max(max, low) : Math.max(1400, low), trick: Number.isFinite(trick) ? trick : 1500, nextWait: Number.isFinite(nextWait) && nextWait >= 0 ? nextWait : 60000 };
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
    const action = game.pendingAction(room);
    if (!action && !game.waitingForReady(room)) return;
    const wait = !action ? delays.nextWait : action.type === 'resolve' ? delays.trick : delays.botMin + Math.random() * (delays.botMax - delays.botMin);
    const timer = setTimeout(() => {
      timers.delete(room.code);
      if (rooms.get(room.code) !== room) return;
      try {
        if (action) game.runPending(room);
        else game.forceNextHand(room);
      } catch (error) {
        ctx.log('a computer move failed:', error);
        return;
      }
      changed(room);
    }, wait);
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
      // A finished game is not resumed without its invite code: coming back from the menu starts afresh.
      socket.emit('state', null);
      return { ok: true, code: null };
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
          reply(handler(payload && typeof payload === 'object' ? payload : {}) ?? { ok: true });
        } catch (error) {
          ctx.log(`${event} failed:`, error);
          reply({ ok: false, error: 'Something went wrong on the server.' });
        }
      });

    /** Runs a rule on the room this socket is in, then tells everyone if it worked. */
    /** Every card a person plays counts towards the global Played cards achievement. */
    const countCards = (outcome, count) => {
      if (outcome.ok) ctx.achievements.add(userId, 'global.cards', count);
      return outcome;
    };
    const act = (rule) => {
      const room = roomOfSocket();
      const seat = room ? game.seatOf(room, userId) : -1;
      if (seat === -1) return { ok: false, error: 'You are not in a game.' };
      const outcome = rule(room, seat);
      if (outcome.ok) changed(room);
      return outcome.ok ? { ok: true } : outcome;
    };

    on('resume', ({ code }) => enter(socket, code));
    on('join', ({ code }) => (typeof code === 'string' && code.trim() ? enter(socket, code) : { ok: false, error: 'Type an invite code.' }));

    on('create', (settings) => {
      const mine = liveRoomOf(userId);
      if (mine) {
        attach(socket, mine);
        return { ok: false, error: `You are already in the game ${mine.code}. Leave it to start another.` };
      }
      let room;
      try {
        room = game.createRoom({ code: ctx.codes.generate((c) => rooms.has(c)), hostId: userId, hostName: socket.data.user.name, settings: pickSettings(settings) });
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
      if (!outcome.ok) return outcome;
      detach(outcome.userId, room.code);
      changed(room);
      return { ok: true };
    });
    on('settings', (payload) => act((room) => game.setSettings(room, userId, pickSettings(payload))));
    on('addBot', ({ seat }) => act((room) => game.addBot(room, userId, seat)));
    on('removeBot', ({ seat }) => act((room) => game.removeBot(room, userId, seat)));
    on('fillBots', () => act((room) => game.fillWithBots(room, userId)));
    on('start', () => act((room) => game.start(room, userId)));
    on('pass', ({ cards }) => act((room, seat) => game.choosePass(room, seat, cards)));
    on('play', ({ card }) => act((room, seat) => countCards(game.playCard(room, seat, card), 1)));
    on('claim', () => act((room, seat) => game.claimAll(room, seat)));
    on('next', () => act((room) => game.nextHand(room, userId)));
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

/** Only the settings (the three options and the number of seats), whatever else a client sends. */
function pickSettings(payload) {
  const { target, jackOfDiamonds, moon, seats } = payload ?? {};
  return Object.fromEntries(Object.entries({ target, jackOfDiamonds, moon, seats }).filter(([, value]) => value !== undefined));
}

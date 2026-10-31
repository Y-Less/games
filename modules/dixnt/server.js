// Server half of Dixnt: games keyed by three-word invite codes, one player per account, saved under ctx.dataDir.
// Computer players are seats in the game (see game.js); this file plays their moves on a timer, one at a time.
//
//   DIXNT_BOT_DELAY   "min-max" milliseconds a computer player waits before acting (default 600-1400)
//
// This module does not use createRoomServer (shared/roomServer.js): Dixnt is not seat-based (people join by code, keep
// their seat if they leave mid-game, and a computer player can take it over), so it has its own small server. It
// follows the same house style: randomness is injected (ctx.rng, defaulting to Math.random here and nowhere else) and
// the clock is Date.now.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { placements } from '../../shared/scores.js';
import { Game, GameError, MAX_NAME_LENGTH } from './game.js';
import { newTally, statsExtras, tallyRound } from './tally.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_GAMES = 500;
const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // games nobody has touched for two weeks are forgotten
const DEFAULT_BOT_DELAY = [600, 1400];

/**
 * The token that identifies an account's seat in a game.
 *
 * @param {{ id: number }} user  the signed-in account of a socket
 * @returns {string} 'user:<id>'
 */
const tokenFor = (user) => `user:${user.id}`;

/**
 * The account id inside a seat token.
 *
 * @param {string} token  a seat token
 * @returns {number | null} the account id, or null for a computer player's token
 */
const userIdOf = (token) => (/^user:\d+$/.test(token) ? Number(token.slice(5)) : null);

/**
 * Finds the folder of card images: DIXNT_CARDS_DIR, else ./cards, else the original dixit project's cards.
 *
 * @returns {string} an absolute path (it may not exist)
 */
function resolveCardsDir() {
  if (process.env.DIXNT_CARDS_DIR) return path.resolve(process.env.DIXNT_CARDS_DIR);
  const own = path.join(here, 'cards');
  if (fs.existsSync(own)) return own;
  return path.resolve(here, '..', '..', '..', 'dixit', 'game', 'cards');
}

/**
 * Reads the chooser's word suggestions from hints.txt, one per line.
 *
 * @returns {string[]} the non-empty lines, trimmed (empty if there is no file)
 */
function loadHints() {
  const file = path.join(here, 'hints.txt');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Reads how long a computer player waits before each move.
 *
 * @returns {[number, number]} DIXNT_BOT_DELAY ("600-1400", or one number) as [min, max] milliseconds; a malformed
 *          value gives the default
 */
function readBotDelay() {
  const [min, max = min] = String(process.env.DIXNT_BOT_DELAY ?? '').split('-').map(Number);
  if (!Number.isFinite(min) || min < 0) return DEFAULT_BOT_DELAY;
  return [min, Number.isFinite(max) ? Math.max(max, min) : min];
}

/**
 * The Dixnt module: starts the server half of the game.
 *
 * @param {object} ctx  what the platform gives a module: io, mount, dataDir, codes, stats, achievements, log, and
 *                      optionally `rng` (a () => [0, 1) generator; defaults to Math.random)
 * @returns {{ dispose: () => void }} stops the timers and saves the games
 * Side effects: mounts /cards, loads the saved games, registers the socket handlers and starts the hourly sweep.
 */
export default function (ctx) {
  const rng = ctx.rng ?? Math.random; // the one place the default generator is chosen; the rules get it injected
  const [botMin, botMax] = readBotDelay();
  const cardsDir = resolveCardsDir();
  const gamesFile = path.join(ctx.dataDir, 'games.json');
  const hints = loadHints();
  ctx.mount('/cards', cardsDir, { maxAge: '7d', immutable: true });

  /**
   * Ids of every card that has a web-sized image on disk.
   *
   * @returns {number[]} sorted ascending
   */
  function getCardIds() {
    const dir = path.join(cardsDir, 'medium');
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .map((name) => /^card_(\d+)\.jpg$/.exec(name))
      .filter(Boolean)
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);
  }

  /**
   * The cards grouped into categories. cards/categories.json lists the categories; only cards whose image exists
   * are offered. Without that file every card is one "All cards" category. The answer is cached for five seconds.
   *
   * @returns {{ key: string, label: string, description: string, ids: number[] }[]}
   */
  let categoryCache = { at: 0, value: [] };
  function getCategories() {
    if (Date.now() - categoryCache.at < 5000) return categoryCache.value;
    const present = new Set(getCardIds());
    let defined = null;
    try {
      defined = JSON.parse(fs.readFileSync(path.join(cardsDir, 'categories.json'), 'utf8')).categories;
    } catch {
      // no categories file
    }
    let value;
    if (!Array.isArray(defined)) {
      value = present.size ? [{ key: 'all', label: 'All cards', description: '', ids: [...present] }] : [];
    } else {
      value = defined
        .map((c) => ({ key: c.key, label: c.label, description: c.description ?? '', ids: c.ids.filter((id) => present.has(id)) }))
        .filter((c) => c.ids.length);
    }
    categoryCache = { at: Date.now(), value };
    return value;
  }

  // ---- games: one per invite code ----
  /** code -> { game, touched, tally, tallied, recorded, collectedRound } */
  const games = new Map();
  const timers = new Map(); // code -> the timer for the next computer move

  /**
   * @returns {object} an empty per-person statistics tally
   */
  const freshTally = () => ({});

  /**
   * Creates a game (new, or restored from a save) and files it under an invite code.
   *
   * @param {object} [options]
   * @param {object | null} [options.saved]  a saved game state to restore
   * @param {number} [options.touched]       when the game was last used (ms since the epoch)
   * @param {string} [options.code]          the invite code (default: a fresh one)
   * @param {object} [options.tally]         the statistics counted so far
   * @param {number} [options.tallied]       how many rounds of the tally have been counted
   * @param {boolean} [options.recorded]     whether the finished game has been reported to the statistics
   * @returns {{ code: string, entry: object }}
   * Side effects: adds the game to `games`.
   */
  function createGame({ saved = null, touched = Date.now(), code = ctx.codes.generate((c) => games.has(c)), tally = freshTally(), tallied = 0, recorded = false } = {}) {
    const game = new Game({ getCategories, hints, rng, saved });
    // collectedRound: the round whose hands have been reported to the "Art lover" achievement (-1: none yet).
    const entry = { game, touched, tally, tallied, recorded, collectedRound: -1 };
    games.set(code, entry);
    return { code, entry };
  }

  /**
   * Keeps a damaged games file out of harm's way: copies it to games.json.corrupt (or, if that already exists,
   * games.json.corrupt-<time>) so the next save cannot overwrite the only copy.
   *
   * @returns {string | null} the path of the copy, or null if it could not be made
   * Side effects: writes a file next to games.json; logs a failure.
   */
  function keepCorruptCopy() {
    let target = `${gamesFile}.corrupt`;
    if (fs.existsSync(target)) target = `${gamesFile}.corrupt-${Date.now()}`;
    try {
      fs.copyFileSync(gamesFile, target);
      return target;
    } catch (error) {
      ctx.log('could not keep a copy of the damaged games file:', error.message);
      return null;
    }
  }

  /**
   * Loads the saved games from games.json, skipping ones nobody has touched for two weeks. A missing file just means
   * there are no games yet. A file that cannot be parsed, or a game in it that cannot be restored, is logged and the
   * file is copied to games.json.corrupt, so the damage is noticed and nothing is lost when the next save happens.
   *
   * @returns {void}
   * Side effects: fills `games`; may log and copy the file.
   */
  function loadSavedGames() {
    let text;
    try {
      text = fs.readFileSync(gamesFile, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') ctx.log('could not read the saved games:', error.message);
      return; // no saved games yet
    }
    let saved;
    try {
      saved = JSON.parse(text);
      if (!saved || typeof saved.games !== 'object' || Array.isArray(saved.games)) throw new Error('it does not contain a games object');
    } catch (error) {
      const copy = keepCorruptCopy();
      ctx.log(`the saved games file is corrupt (${error.message}); starting with no games${copy ? `, a copy is in ${copy}` : ''}`);
      return;
    }
    let damaged = 0;
    for (const [code, entry] of Object.entries(saved.games)) {
      try {
        if (Date.now() - entry.touched < STALE_AFTER_MS) {
          createGame({ saved: entry.game, touched: entry.touched, code, tally: entry.tally ?? {}, tallied: entry.tallied ?? 0, recorded: Boolean(entry.recorded) });
        }
      } catch (error) {
        games.delete(code);
        damaged++;
        ctx.log(`could not restore the saved game ${code}:`, error.message);
      }
    }
    if (damaged) ctx.log(`${damaged} saved game(s) could not be restored; a copy of the file is in ${keepCorruptCopy()}`);
  }
  loadSavedGames();

  let saveTimer = null;

  /**
   * Writes every game to games.json straight away (to a temporary file first, then renamed over it).
   *
   * @returns {void}
   * Side effects: writes files and cancels a pending scheduled save. Throws if the disk write fails.
   */
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const saved = { version: 1, games: {} };
    for (const [code, { game, touched, tally, tallied, recorded }] of games) {
      saved.games[code] = { touched, game: game.toJSON(), tally, tallied, recorded };
    }
    const tmp = `${gamesFile}.tmp`;
    fs.mkdirSync(ctx.dataDir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(saved));
    fs.renameSync(tmp, gamesFile);
  }

  /**
   * Saves the games shortly from now (changes arriving in the meantime share one write).
   *
   * @returns {void}
   * Side effects: (re)starts the save timer; a failed save is logged.
   */
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        saveNow();
      } catch (error) {
        ctx.log('could not save the games:', error.message);
      }
    }, 300);
  }

  /**
   * Forgets a game and stops its computer-move timer.
   *
   * @param {string} code  the invite code
   * @returns {void}
   * Side effects: removes it from `games` and `timers`.
   */
  function discard(code) {
    clearTimeout(timers.get(code));
    timers.delete(code);
    games.delete(code);
  }

  /**
   * Plays the next computer move after a short wait, then looks again; stops when nothing is pending.
   *
   * @param {string} code  the invite code
   * @returns {void}
   * Side effects: replaces the game's timer; when it fires it plays a move, updates the statistics, broadcasts and saves.
   */
  function schedule(code) {
    clearTimeout(timers.get(code));
    timers.delete(code);
    const entry = games.get(code);
    if (!entry?.game.pendingBotAction()) return;
    const timer = setTimeout(() => {
      timers.delete(code);
      if (games.get(code) !== entry) return;
      try {
        entry.game.runBotAction();
      } catch (error) {
        ctx.log('a computer move failed:', error);
        return;
      }
      entry.touched = Date.now();
      track(code, entry);
      broadcast(code);
      scheduleSave();
      schedule(code);
    }, botMin + rng() * (botMax - botMin));
    timer.unref?.();
    timers.set(code, timer);
  }

  /**
   * Forgets games nobody has touched for two weeks and games with no people left.
   *
   * @returns {void}
   * Side effects: discards games and schedules a save if any went.
   */
  function pruneGames() {
    let changed = false;
    for (const [code, entry] of games) {
      if (Date.now() - entry.touched > STALE_AFTER_MS || !entry.game.humans().length) {
        discard(code);
        changed = true;
      }
    }
    if (changed) scheduleSave();
  }
  const pruneTimer = setInterval(pruneGames, 60 * 60 * 1000);
  pruneTimer.unref();

  // ---- statistics ----

  /**
   * @param {object} entry   a game's entry in `games`
   * @param {string} token   a person's seat token
   * @returns {object} that person's tally for this game (created if it is new)
   */
  function tallyOf(entry, token) {
    return (entry.tally[token] ??= newTally());
  }

  /**
   * Counts a completed round towards each person's statistics (once per round).
   *
   * @param {object} entry  a game's entry in `games`
   * @returns {void}
   * Side effects: adds to the entry's tallies.
   */
  function countRound(entry) {
    const { game } = entry;
    const tallyFor = (id) => {
      const player = game.player(id);
      return player && player.kind !== 'bot' ? tallyOf(entry, player.token) : null; // computer players are not accounts and are not counted
    };
    tallyRound(tallyFor, { pickers: Object.keys(game.s.picks), results: game.s.results });
  }

  /**
   * Reports a finished game (winners, places, scores and the extra counters) to the platform's statistics.
   *
   * @param {object} entry  a game's entry in `games`
   * @param {string} code   the invite code (the game's identity in the statistics)
   * @returns {void}
   * Side effects: calls ctx.stats.record; a failure is logged, not thrown.
   */
  function recordFinished(entry, code) {
    const { game } = entry;
    const winners = new Set(game.winnerIds());
    const places = placements(Object.fromEntries(game.s.players.map((p) => [p.id, p.score])));
    const players = [];
    for (const p of game.s.players) {
      const userId = userIdOf(p.token);
      if (userId === null) continue;
      players.push({
        userId,
        outcome: winners.has(p.id) ? 'win' : 'loss',
        placement: places[p.id],
        score: p.score,
        extras: statsExtras(entry.tally[p.token] ?? newTally()),
      });
    }
    try {
      ctx.stats.record({ code, players });
    } catch (error) {
      ctx.log('could not record the statistics:', error.message);
    }
  }

  /**
   * Adds the cards each person holds to the ones they have been dealt (the "Art lover" achievement).
   *
   * @param {object} entry  a game's entry in `games`
   * @returns {void}
   * Side effects: calls ctx.achievements.collect for each person; a failure is logged, not thrown.
   */
  function collectCards(entry) {
    for (const p of entry.game.s.players) {
      const userId = userIdOf(p.token);
      if (userId === null || !p.hand?.length) continue;
      try {
        ctx.achievements?.collect(userId, 'art', p.hand);
      } catch (error) {
        ctx.log('could not collect cards:', error.message);
      }
    }
  }

  /**
   * Keeps the statistics in step with the game after every change. Hands only change when cards are dealt, which
   * happens when a round starts, so the cards are collected once per round rather than after every action.
   *
   * @param {string} code   the invite code
   * @param {object} entry  a game's entry in `games`
   * @returns {void}
   * Side effects: may collect cards, count a round, reset the tally (in the lobby) or record a finished game.
   */
  function track(code, entry) {
    const s = entry.game.s;
    if (s.phase === 'lobby') {
      entry.tally = freshTally();
      entry.tallied = 0;
      entry.recorded = false;
      entry.collectedRound = -1; // the next game deals new hands
      return;
    }
    if (s.round !== entry.collectedRound) {
      entry.collectedRound = s.round;
      collectCards(entry);
    }
    if (s.completed > entry.tallied && s.phase === 'results' && s.results) countRound(entry);
    entry.tallied = s.completed;
    if (s.phase === 'finished' && !entry.recorded) {
      entry.recorded = true;
      recordFinished(entry, code);
    }
  }

  // ---- connections ----
  // socket.id -> { code }: which game a connection is in. A player can have several sockets (phone and laptop).
  const sessions = new Map();

  /**
   * @param {string} code  the invite code
   * @returns {Set<string>} the seat ids that have at least one open connection in that game
   */
  function connectedPlayerIds(code) {
    const { game } = games.get(code);
    const ids = new Set();
    for (const [socketId, session] of sessions) {
      if (session.code !== code) continue;
      const player = game.findByToken(tokenFor(ctx.io.sockets.get(socketId)?.data.user ?? {}));
      if (player) ids.add(player.id);
    }
    return ids;
  }

  /**
   * Sends every connection in the game its own personalised view (or null if it is no longer in the game).
   *
   * @param {string} code  the invite code
   * @returns {void}
   * Side effects: emits 'state' to sockets; forgets sockets whose account is no longer a player.
   */
  function broadcast(code) {
    const entry = games.get(code);
    const connected = entry ? connectedPlayerIds(code) : null;
    for (const [socketId, session] of [...sessions]) {
      if (session.code !== code) continue;
      const socket = ctx.io.sockets.get(socketId);
      const player = socket && entry?.game.findByToken(tokenFor(socket.data.user));
      if (!player) sessions.delete(socketId);
      socket?.emit('state', player ? { ...entry.game.viewFor(player.id, connected), code } : null);
    }
  }

  /**
   * @param {object} socket  a Socket.IO socket
   * @returns {object | null} the seat of the socket's account in the game the socket is in
   */
  const playerOf = (socket) => {
    const entry = games.get(sessions.get(socket.id)?.code);
    return entry ? entry.game.findByToken(tokenFor(socket.data.user)) : null;
  };

  /**
   * @param {object} socket  a Socket.IO socket
   * @returns {Game | undefined} the game the socket is in
   */
  const gameOf = (socket) => games.get(sessions.get(socket.id)?.code)?.game;

  /**
   * Runs one client request: calls `fn`, answers through the acknowledgement ({ ok: true, ... } or
   * { ok: false, error }), then keeps the games in step (statistics, computer moves, broadcasts, saving).
   *
   * @param {object} socket  the requesting socket
   * @param {Function | any} ack  the client's acknowledgement callback (ignored if it is not a function)
   * @param {() => object | void} fn  does the work; may return extra fields for the answer and may throw a GameError
   * @returns {void}
   * Side effects: replies, may discard a game with no people left, broadcasts and schedules a save. Other errors are
   * logged and the client is told something went wrong.
   */
  function respond(socket, ack, fn) {
    const reply = typeof ack === 'function' ? ack : () => {};
    const before = sessions.get(socket.id)?.code;
    try {
      reply({ ok: true, ...(fn() ?? {}) });
    } catch (error) {
      if (error instanceof GameError) {
        reply({ ok: false, error: error.message });
      } else {
        ctx.log(error);
        reply({ ok: false, error: 'Something went wrong on the server.' });
      }
    }
    for (const code of new Set([before, sessions.get(socket.id)?.code])) {
      if (!code) continue;
      const entry = games.get(code);
      if (entry) {
        entry.touched = Date.now();
        if (!entry.game.humans().length) discard(code); // the last person left: computer players alone do not keep a game
        else {
          track(code, entry);
          schedule(code);
        }
      }
      broadcast(code);
    }
    scheduleSave();
  }

  /**
   * Registers an action that needs a joined player. `run(player, payload, game)` may return extra ack fields.
   *
   * @param {object} socket  the connection to listen on
   * @param {string} event   the socket event name
   * @param {(player: object, payload: object, game: Game) => object | void} run  the work
   * @returns {void}
   * Side effects: adds a socket listener.
   */
  function action(socket, event, run) {
    socket.on(event, (payload, ack) =>
      respond(socket, ack, () => {
        const player = playerOf(socket);
        if (!player) throw new GameError('You are not in this game.');
        return run(player, payload ?? {}, gameOf(socket));
      }),
    );
  }

  /**
   * @param {string} rawCode  an invite code as typed
   * @returns {{ code: string, entry: object }} the game it names
   * Side effects: throws a GameError if there is no such game.
   */
  const requireGame = (rawCode) => {
    const code = ctx.codes.normalise(rawCode);
    const entry = code && games.get(code);
    if (!entry) throw new GameError('There is no game with that code.');
    return { code, entry };
  };

  /**
   * The account's display name, made unique within the game and short enough for it.
   *
   * @param {Game} game       the game being joined
   * @param {string} rawName  the account's name
   * @returns {string}
   */
  function nameInGame(game, rawName) {
    const base = String(rawName ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH) || 'Player';
    const taken = (name) => game.s.players.some((p) => p.name.toLowerCase() === name.toLowerCase());
    for (let n = 1; n < 100; n++) {
      const suffix = n === 1 ? '' : ` (${n})`;
      const name = `${base.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`;
      if (!taken(name)) return name;
    }
    return base;
  }

  // One set of handlers per connection. Each event below is a request from the client; most go through action() so
  // they need a seat in the game, and every one answers through respond().
  ctx.io.on('connection', (socket) => {
    const user = socket.data.user;
    const token = tokenFor(user);

    // Does a game with this code exist? (An invite link asks before showing the join button.)
    socket.on('lookup', (payload, ack) => {
      const code = ctx.codes.normalise(payload?.code);
      if (typeof ack === 'function') ack({ ok: true, code, exists: Boolean(code && games.has(code)) });
    });

    // Reconnect: succeeds only if this account is still a player in that game. Without a code, the account's most
    // recently used unfinished game is chosen.
    socket.on('resume', (payload, ack) =>
      respond(socket, ack, () => {
        let code = ctx.codes.normalise(payload?.code);
        if (!code) {
          // A finished game is not resumed without its code: coming back from the menu starts afresh.
          const mine = [...games].filter(([, e]) => e.game.s.phase !== 'finished' && e.game.findByToken(token)).sort((a, b) => b[1].touched - a[1].touched);
          code = mine[0]?.[0] ?? '';
        }
        if (!code || !games.get(code)?.game.findByToken(token)) throw new GameError('Please join the game.');
        sessions.set(socket.id, { code });
        return { code };
      }),
    );

    // Start a new game with this account as its host.
    socket.on('create', (payload, ack) =>
      respond(socket, ack, () => {
        if (games.size >= MAX_GAMES) throw new GameError('There are too many games running. Please try again later.');
        const { code, entry } = createGame();
        try {
          entry.game.addPlayer(nameInGame(entry.game, user.name), token);
        } catch (error) {
          games.delete(code);
          throw error;
        }
        sessions.set(socket.id, { code });
        return { code };
      }),
    );

    // Join a game by its code (or simply attach this connection if the account is already in it).
    socket.on('join', (payload, ack) =>
      respond(socket, ack, () => {
        const { code, entry } = requireGame(payload?.code);
        if (!entry.game.findByToken(token)) entry.game.addPlayer(nameInGame(entry.game, user.name), token);
        sessions.set(socket.id, { code });
        return { code };
      }),
    );

    // A connection closing: forget it and let the others see that this person may now be away.
    socket.on('disconnect', () => {
      const code = sessions.get(socket.id)?.code;
      sessions.delete(socket.id);
      if (code && games.has(code)) broadcast(code);
    });

    action(socket, 'leave', (player, _payload, game) => {
      game.leave(player.id, player.id);
      sessions.delete(socket.id);
      socket.emit('state', null);
    });
    action(socket, 'setHandSize', (player, { size }, game) => game.setHandSize(player.id, size));
    action(socket, 'setRounds', (player, { count }, game) => game.setRounds(player.id, count));
    action(socket, 'setJudging', (player, { mode }, game) => game.setJudging(player.id, mode));
    action(socket, 'setCategories', (player, { keys }, game) => game.setCategories(player.id, keys));
    action(socket, 'declareAI', (player, { id }, game) => game.setAI(player.id, id));
    action(socket, 'addBot', (player, _payload, game) => game.addBot(player.id));
    action(socket, 'fillBots', (player, { count }, game) => game.fillWithBots(player.id, count));
    action(socket, 'removeBot', (player, { targetId }, game) => game.removeBot(player.id, targetId));
    action(socket, 'start', (player, _payload, game) => game.start(player.id));
    action(socket, 'endGame', (player, _payload, game) => game.returnToLobby(player.id));
    action(socket, 'hints', (_player, _payload, game) => ({ hints: game.nextHints(3) }));
    action(socket, 'submitWord', (player, { word }, game) => game.submitWord(player.id, word));
    action(socket, 'playCard', (player, { cardId }, game) => game.playCard(player.id, Number(cardId)));
    action(socket, 'vote', (player, { targetId }, game) => game.vote(player.id, targetId));
    action(socket, 'nextRound', (player, _payload, game) => game.nextRound(player.id));
    action(socket, 'abortRound', (player, _payload, game) => game.abortRound(player.id));
    // The host's "kick": refused for a finished game (see Game.requireMayRemove).
    action(socket, 'removePlayer', (player, { targetId }, game) => game.leave(player.id, targetId));
  });

  for (const code of games.keys()) schedule(code);

  ctx.log(`${getCardIds().length} cards in ${getCategories().length} categories, ${hints.length} hints, ${games.size} saved games`);

  return {
    /**
     * Stops the timers and saves the games one last time.
     *
     * @returns {void}
     * Side effects: clears intervals and timeouts, writes games.json (a failure is logged).
     */
    dispose() {
      clearInterval(pruneTimer);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      try {
        saveNow();
      } catch (error) {
        ctx.log('could not save the games:', error.message);
      }
    },
  };
}

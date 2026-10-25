// Server half of Dixnt: games keyed by three-word invite codes, one player per account, saved under ctx.dataDir.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { placements } from '../../shared/scores.js';
import { Game, GameError, MAX_NAME_LENGTH } from './game.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_GAMES = 500;
const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // games nobody has touched for two weeks are forgotten
const TALLY_KEYS = ['roundsAsImposter', 'timesFooledGroup', 'correctGuesses', 'cardsPlayed'];

const tokenFor = (user) => `user:${user.id}`;
const userIdOf = (token) => (/^user:\d+$/.test(token) ? Number(token.slice(5)) : null);

function resolveCardsDir() {
  if (process.env.DIXNT_CARDS_DIR) return path.resolve(process.env.DIXNT_CARDS_DIR);
  const own = path.join(here, 'cards');
  if (fs.existsSync(own)) return own;
  return path.resolve(here, '..', '..', '..', 'dixit', 'game', 'cards');
}

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

export default function (ctx) {
  const cardsDir = resolveCardsDir();
  const gamesFile = path.join(ctx.dataDir, 'games.json');
  const hints = loadHints();
  ctx.mount('/cards', cardsDir, { maxAge: '7d', immutable: true });

  /** Ids of every card that has a web-sized image on disk. */
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
   * are offered. Without that file every card is one "All cards" category.
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
  /** code -> { game, touched, tally, tallied, recorded } */
  const games = new Map();
  const freshTally = () => ({});

  function createGame({ saved = null, touched = Date.now(), code = ctx.codes.generate((c) => games.has(c)), tally = freshTally(), tallied = 0, recorded = false } = {}) {
    const game = new Game({ getCategories, hints, saved });
    const entry = { game, touched, tally, tallied, recorded };
    games.set(code, entry);
    return { code, entry };
  }

  try {
    const saved = JSON.parse(fs.readFileSync(gamesFile, 'utf8'));
    for (const [code, entry] of Object.entries(saved.games ?? {})) {
      if (Date.now() - entry.touched < STALE_AFTER_MS) {
        createGame({ saved: entry.game, touched: entry.touched, code, tally: entry.tally ?? {}, tallied: entry.tallied ?? 0, recorded: Boolean(entry.recorded) });
      }
    }
  } catch {
    // no saved games yet
  }

  let saveTimer = null;
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

  function pruneGames() {
    let changed = false;
    for (const [code, entry] of games) {
      if (Date.now() - entry.touched > STALE_AFTER_MS || entry.game.s.players.length === 0) {
        games.delete(code);
        changed = true;
      }
    }
    if (changed) scheduleSave();
  }
  const pruneTimer = setInterval(pruneGames, 60 * 60 * 1000);
  pruneTimer.unref();

  // ---- statistics ----
  function tallyOf(entry, token) {
    return (entry.tally[token] ??= Object.fromEntries(TALLY_KEYS.map((key) => [key, 0])));
  }

  /** Counts a completed round towards each player's statistics (once per round). */
  function tallyRound(entry) {
    const { game } = entry;
    const s = game.s;
    const results = s.results;
    const tokenOfPlayer = (id) => game.player(id)?.token;
    for (const id of Object.keys(s.picks)) {
      const token = tokenOfPlayer(id);
      if (token) tallyOf(entry, token).cardsPlayed++;
    }
    if (!results.imposterId) return;
    const imposter = tokenOfPlayer(results.imposterId);
    if (imposter) {
      tallyOf(entry, imposter).roundsAsImposter++;
      if (!results.groupCorrect) tallyOf(entry, imposter).timesFooledGroup++;
    }
    for (const [voterId, targetId] of Object.entries(results.votes)) {
      const voter = tokenOfPlayer(voterId);
      if (voter && targetId === results.imposterId && voterId !== results.imposterId) tallyOf(entry, voter).correctGuesses++;
    }
  }

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
        extras: { ...Object.fromEntries(TALLY_KEYS.map((key) => [key, 0])), ...(entry.tally[p.token] ?? {}) },
      });
    }
    try {
      ctx.stats.record({ code, players });
    } catch (error) {
      ctx.log('could not record the statistics:', error.message);
    }
  }

  /** Keeps the statistics in step with the game after every change. */
  function track(code, entry) {
    const s = entry.game.s;
    if (s.phase === 'lobby') {
      entry.tally = freshTally();
      entry.tallied = 0;
      entry.recorded = false;
      return;
    }
    if (s.completed > entry.tallied && s.phase === 'results' && s.results) tallyRound(entry);
    entry.tallied = s.completed;
    if (s.phase === 'finished' && !entry.recorded) {
      entry.recorded = true;
      recordFinished(entry, code);
    }
  }

  // ---- connections ----
  // socket.id -> { code }: which game a connection is in. A player can have several sockets (phone and laptop).
  const sessions = new Map();

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

  /** Sends every connection in the game its own personalised view (or null if it is no longer in the game). */
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

  const playerOf = (socket) => {
    const entry = games.get(sessions.get(socket.id)?.code);
    return entry ? entry.game.findByToken(tokenFor(socket.data.user)) : null;
  };
  const gameOf = (socket) => games.get(sessions.get(socket.id)?.code)?.game;

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
        if (entry.game.s.players.length === 0) games.delete(code); // the last player left
        else track(code, entry);
      }
      broadcast(code);
    }
    scheduleSave();
  }

  /** Registers an action that needs a joined player. `run(player, payload, game)` may return extra ack fields. */
  function action(socket, event, run) {
    socket.on(event, (payload, ack) =>
      respond(socket, ack, () => {
        const player = playerOf(socket);
        if (!player) throw new GameError('You are not in this game.');
        return run(player, payload ?? {}, gameOf(socket));
      }),
    );
  }

  const requireGame = (rawCode) => {
    const code = ctx.codes.normalise(rawCode);
    const entry = code && games.get(code);
    if (!entry) throw new GameError('There is no game with that code.');
    return { code, entry };
  };

  /** The account's display name, made unique within the game and short enough for it. */
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

  ctx.io.on('connection', (socket) => {
    const user = socket.data.user;
    const token = tokenFor(user);

    // Does a game with this code exist? (An invite link asks before showing the join button.)
    socket.on('lookup', (payload, ack) => {
      const code = ctx.codes.normalise(payload?.code);
      if (typeof ack === 'function') ack({ ok: true, code, exists: Boolean(code && games.has(code)) });
    });

    // Reconnect: succeeds only if this account is still a player in that game. Without a code, the account's most
    // recently used game is chosen.
    socket.on('resume', (payload, ack) =>
      respond(socket, ack, () => {
        let code = ctx.codes.normalise(payload?.code);
        if (!code) {
          const mine = [...games].filter(([, e]) => e.game.findByToken(token)).sort((a, b) => b[1].touched - a[1].touched);
          code = mine[0]?.[0] ?? '';
        }
        if (!code || !games.get(code)?.game.findByToken(token)) throw new GameError('Please join the game.');
        sessions.set(socket.id, { code });
        return { code };
      }),
    );

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

    socket.on('join', (payload, ack) =>
      respond(socket, ack, () => {
        const { code, entry } = requireGame(payload?.code);
        if (!entry.game.findByToken(token)) entry.game.addPlayer(nameInGame(entry.game, user.name), token);
        sessions.set(socket.id, { code });
        return { code };
      }),
    );

    socket.on('disconnect', () => {
      const code = sessions.get(socket.id)?.code;
      sessions.delete(socket.id);
      if (code && games.has(code)) broadcast(code);
    });

    action(socket, 'leave', (player, _payload, game) => {
      game.removePlayer(player.id, player.id);
      sessions.delete(socket.id);
      socket.emit('state', null);
    });
    action(socket, 'setHandSize', (player, { size }, game) => game.setHandSize(player.id, size));
    action(socket, 'setRounds', (player, { count }, game) => game.setRounds(player.id, count));
    action(socket, 'setJudging', (player, { mode }, game) => game.setJudging(player.id, mode));
    action(socket, 'setCategories', (player, { keys }, game) => game.setCategories(player.id, keys));
    action(socket, 'start', (player, _payload, game) => game.start(player.id));
    action(socket, 'endGame', (player, _payload, game) => game.returnToLobby(player.id));
    action(socket, 'hints', (_player, _payload, game) => ({ hints: game.nextHints(3) }));
    action(socket, 'submitWord', (player, { word }, game) => game.submitWord(player.id, word));
    action(socket, 'playCard', (player, { cardId }, game) => game.playCard(player.id, Number(cardId)));
    action(socket, 'vote', (player, { targetId }, game) => game.vote(player.id, targetId));
    action(socket, 'nextRound', (player, _payload, game) => game.nextRound(player.id));
    action(socket, 'abortRound', (player, _payload, game) => game.abortRound(player.id));
    action(socket, 'removePlayer', (player, { targetId }, game) => game.removePlayer(player.id, targetId));
  });

  ctx.log(`${getCardIds().length} cards in ${getCategories().length} categories, ${hints.length} hints, ${games.size} saved games`);

  return {
    dispose() {
      clearInterval(pruneTimer);
      try {
        saveNow();
      } catch (error) {
        ctx.log('could not save the games:', error.message);
      }
    },
  };
}

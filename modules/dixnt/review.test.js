// Fixes from the code review: a player leaving mid-round no longer abandons it needlessly, submitWord cannot throw on an
// empty round, ids come from the injected rng, cards are collected once per round, a corrupt games.json is kept and
// logged, a finished game cannot have people removed, and seats say kind: 'bot'. The first group drives the rules
// (game.js) directly; the second drives the real server module (server.js) with a fake socket layer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Game, GameError, newPublicId } from './game.js';
import createServer from './server.js';

const cards = (n) => Array.from({ length: n }, (_, i) => i + 1);

/** A small repeatable random number generator. */
function seededRng(seed = 1) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** A game of `count` people (Ann hosts), started, with plenty of rounds and the given judging style. */
function started(count = 5, judging = 'everyone') {
  const game = new Game({ getCardIds: () => cards(200), hints: [], rng: seededRng(11) });
  const people = Array.from({ length: count }, (_, i) => game.addPlayer(['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay'][i], `t${i}`));
  const host = people[0];
  game.setRounds(host.id, 10);
  game.setJudging(host.id, judging);
  game.start(host.id);
  return { game, people, host };
}

/** Moves the game on to `phase`, using the first card of each hand and voting for the first target. */
function advanceTo(game, phase) {
  const s = game.s;
  if (phase === 'word') return;
  game.submitWord(s.chooserId, 'lighthouse');
  if (phase === 'picking') return;
  for (const p of game.cardPlayers()) game.playCard(p.id, p.hand[0]);
  if (phase === 'voting') return;
  for (const v of game.voters()) game.vote(v.id, game.cardPlayers().find((p) => p.id !== v.id).id);
}

// ---------- (1) removing a player continues the round when it can ----------

test('removing someone who is not needed in the word phase keeps the round', () => {
  const { game, host } = started();
  const bystander = game.s.players.find((p) => p.id !== game.s.chooserId && p.id !== host.id);
  const round = game.s.round;
  game.removePlayer(host.id, bystander.id);
  assert.equal(game.s.phase, 'word');
  assert.equal(game.s.round, round, 'the round was not restarted');
});

test('removing the chooser abandons the round: it cannot go on without them', () => {
  const { game, host } = started();
  const chooser = game.s.chooserId;
  const round = game.s.round;
  game.removePlayer(host.id, chooser);
  assert.equal(game.s.round, round + 1);
  assert.notEqual(game.s.chooserId, chooser);
});

test('removing the imposter abandons the round: only they saw ???', () => {
  const { game, host } = started();
  advanceTo(game, 'picking');
  const imposter = game.s.imposterId;
  const round = game.s.round;
  game.removePlayer(host.id, imposter);
  assert.equal(game.s.round, round + 1);
  assert.equal(game.s.phase, 'word');
});

test('removing a card player who has not played yet keeps picking going, and the last card opens voting', () => {
  const { game, host } = started(5);
  advanceTo(game, 'picking');
  const players = game.cardPlayers().filter((p) => p.id !== game.s.imposterId && p.id !== host.id);
  const [leaver] = players;
  for (const p of game.cardPlayers()) if (p.id !== leaver.id) game.playCard(p.id, p.hand[0]);
  assert.equal(game.s.phase, 'picking', 'one card is still missing');
  const round = game.s.round;
  game.removePlayer(host.id, leaver.id);
  assert.equal(game.s.round, round);
  assert.equal(game.s.phase, 'voting', 'everyone who is left has played');
  assert.equal(game.s.tableOrder.length, game.cardPlayers().length);
  assert.ok(!game.s.tableOrder.includes(leaver.id));
});

test('removing a card player who already played takes their card and votes off the table', () => {
  const { game, host } = started(5);
  advanceTo(game, 'voting');
  const leaver = game.cardPlayers().find((p) => p.id !== game.s.imposterId && p.id !== host.id);
  const other = game.cardPlayers().find((p) => p.id !== leaver.id);
  game.vote(other.id, leaver.id);
  game.vote(leaver.id, other.id);
  const round = game.s.round;
  game.removePlayer(host.id, leaver.id);
  assert.equal(game.s.round, round);
  assert.equal(game.s.phase, 'voting');
  assert.ok(!(leaver.id in game.s.picks) && !(leaver.id in game.s.votes));
  assert.ok(!Object.values(game.s.votes).includes(leaver.id), 'votes for the leaver are gone');
  assert.ok(!game.s.tableOrder.includes(leaver.id));
});

test('removing the last person who had not voted resolves the round', () => {
  const { game, host } = started(5);
  advanceTo(game, 'voting');
  const voters = game.voters();
  const leaver = voters.find((p) => p.id !== game.s.imposterId && p.id !== host.id);
  for (const v of voters) {
    if (v.id === leaver.id) continue;
    game.vote(v.id, game.cardPlayers().find((p) => p.id !== v.id && p.id !== leaver.id).id);
  }
  assert.equal(game.s.phase, 'voting');
  game.removePlayer(host.id, leaver.id);
  assert.equal(game.s.phase, 'results');
  assert.ok(!(leaver.id in game.s.results.deltas));
  assert.ok(!(leaver.id in game.s.results.tally));
});

test('removing a bystander while results are showing keeps the results', () => {
  const { game, host } = started(5);
  advanceTo(game, 'results');
  const leaver = game.s.players.find((p) => ![game.s.chooserId, game.s.imposterId, host.id].includes(p.id));
  game.removePlayer(host.id, leaver.id);
  assert.equal(game.s.phase, 'results');
  assert.ok(!(leaver.id in game.s.results.deltas));
  assert.ok(!Object.entries(game.s.results.votes).some(([v, t]) => v === leaver.id || t === leaver.id));
  game.nextRound(host.id);
  assert.equal(game.s.phase, 'word');
});

test('removing someone down to two players still sends the game to the lobby', () => {
  const { game, host } = started(3);
  game.removePlayer(host.id, game.s.players[2].id);
  assert.equal(game.s.phase, 'lobby');
});

// ---------- (2) submitWord with nobody to play ----------

test('submitWord refuses cleanly when nobody else is in the round', () => {
  const { game } = started(3);
  for (const p of game.s.players) if (p.id !== game.s.chooserId) p.waiting = true;
  const before = JSON.stringify(game.s);
  assert.throws(() => game.submitWord(game.s.chooserId, 'lonely'), (e) => e instanceof GameError && /nobody else/i.test(e.message));
  assert.equal(JSON.stringify(game.s), before, 'nothing changed');
});

// ---------- (3) ids come from the rng ----------

test('a Game needs an rng, and the same rng gives the same ids', () => {
  assert.throws(() => new Game({ getCardIds: () => cards(10), hints: [] }), TypeError);
  const ids = () => {
    const game = new Game({ getCardIds: () => cards(50), hints: [], rng: seededRng(5) });
    return ['a', 'b', 'c'].map((name) => game.addPlayer(name, name).id);
  };
  assert.deepEqual(ids(), ids());
});

test('newPublicId uses only the rng it is given, and never repeats an id that is taken', () => {
  const originalRandom = Math.random;
  Math.random = () => assert.fail('Math.random must not be used by the rules');
  try {
    const taken = new Set();
    for (let i = 0; i < 5; i++) taken.add(newPublicId(() => 0.5, taken)); // a constant rng cannot make a clash
    assert.equal(taken.size, 5);
    assert.equal(newPublicId(() => 0), '00000000');
    const game = new Game({ getCardIds: () => cards(50), hints: [], rng: () => 0.25 });
    const a = game.addPlayer('Ann', 'a');
    const b = game.addPlayer('Bob', 'b');
    assert.notEqual(a.id, b.id);
  } finally {
    Math.random = originalRandom;
  }
});

// ---------- (6) nobody can be removed from a finished game ----------

test('the host cannot remove anyone from a finished game, but people can still leave', () => {
  const { game, host, people } = started(3);
  game.s.phase = 'finished';
  for (const call of [() => game.removePlayer(host.id, people[1].id), () => game.leave(host.id, people[1].id)]) {
    assert.throws(call, (e) => e instanceof GameError && e.message === 'The game is over: there is nobody to remove.');
  }
  assert.equal(game.s.players.length, 3);
  game.leave(people[1].id, people[1].id);
  assert.equal(game.s.players.length, 2, 'leaving for yourself still works');
});

// ---------- (7) kind: 'bot' ----------

test('computer players are kind bot, people are kind human, and the view still says bot', () => {
  const game = new Game({ getCardIds: () => cards(100), hints: [], rng: seededRng(2) });
  const host = game.addPlayer('Ann', 't1');
  game.fillWithBots(host.id, 3);
  assert.deepEqual(game.s.players.map((p) => p.kind), ['human', 'bot', 'bot']);
  assert.ok(game.s.players.every((p) => !('bot' in p)));
  assert.deepEqual(game.viewFor(host.id).players.map((p) => p.bot), [false, true, true]);
});

test('a saved room with bot: true seats is migrated to kind bot', () => {
  const game = new Game({ getCardIds: () => cards(100), hints: [], rng: seededRng(2) });
  const host = game.addPlayer('Ann', 't1');
  game.fillWithBots(host.id, 3);
  const old = JSON.parse(JSON.stringify(game.toJSON()));
  for (const p of old.players) {
    p.bot = p.kind === 'bot';
    delete p.kind;
  }
  const loaded = new Game({ getCardIds: () => cards(100), hints: [], rng: seededRng(2), saved: old });
  assert.deepEqual(loaded.s.players.map((p) => p.kind), ['human', 'bot', 'bot']);
  assert.ok(loaded.s.players.every((p) => !('bot' in p)));
  assert.equal(loaded.humans().length, 1);
});

// ---------- the server module, with a fake socket layer ----------

/** Runs the Dixnt server against fake sockets. `setup(dataDir)` can prepare files first. */
function launch(t, { setup, collected = [] } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dixnt-review-'));
  const cardsDir = path.join(dataDir, 'cards');
  fs.mkdirSync(path.join(cardsDir, 'medium'), { recursive: true });
  for (const id of cards(60)) fs.writeFileSync(path.join(cardsDir, 'medium', `card_${id}.jpg`), '');
  process.env.DIXNT_CARDS_DIR = cardsDir;
  process.env.DIXNT_BOT_DELAY = '0-1';
  setup?.(dataDir);
  const logs = [];
  const sockets = new Map();
  const io = Object.assign(new EventEmitter(), { sockets });
  let games = 0;
  const ctx = {
    io,
    dataDir,
    mount() {},
    log: (...args) => logs.push(args.join(' ')),
    rng: seededRng(3),
    codes: { generate: () => `game-${++games}`, normalise: (code) => (typeof code === 'string' && code ? code.toLowerCase() : '') },
    stats: { record() {} },
    achievements: { collect: (userId, key, ids) => collected.push({ userId, key, ids: [...ids] }) },
  };
  const module = createServer(ctx);
  t.after(() => {
    module.dispose();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  /** A connected fake socket for account `id`; call(event, payload) resolves with the acknowledgement. */
  const connect = (id, name) => {
    const socket = Object.assign(new EventEmitter(), { id: `s${id}`, data: { user: { id, name } }, state: null });
    socket.emit = (event, payload) => {
      if (event === 'state') socket.state = payload;
      return true;
    };
    const handlers = new EventEmitter();
    socket.on = (event, fn) => handlers.on(event, fn);
    sockets.set(socket.id, socket);
    io.emit('connection', socket);
    socket.call = (event, payload = {}) => new Promise((resolve) => handlers.emit(event, payload, resolve));
    return socket;
  };
  return { ctx, logs, dataDir, connect, gamesFile: path.join(dataDir, 'games.json'), module };
}

test('a corrupt games.json is logged and kept as games.json.corrupt, not silently overwritten', (t) => {
  const { logs, gamesFile, module } = launch(t, { setup: (dir) => fs.writeFileSync(path.join(dir, 'games.json'), '{"version":1,"games":{ not json') });
  assert.ok(logs.some((line) => /corrupt/.test(line)), `logged: ${logs.join(' | ')}`);
  assert.equal(fs.readFileSync(`${gamesFile}.corrupt`, 'utf8'), '{"version":1,"games":{ not json');
  module.dispose(); // the next save replaces games.json, but the copy stays
  assert.equal(fs.readFileSync(`${gamesFile}.corrupt`, 'utf8'), '{"version":1,"games":{ not json');
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(gamesFile, 'utf8')));
});

test('a missing games.json is normal: nothing logged as corrupt and no copy made', (t) => {
  const { logs, gamesFile } = launch(t);
  assert.ok(!logs.some((line) => /corrupt/.test(line)));
  assert.equal(fs.existsSync(`${gamesFile}.corrupt`), false);
});

test('a games.json with a game that cannot be restored keeps a copy and still loads the others', (t) => {
  const { logs, gamesFile } = launch(t, {
    setup: (dir) => {
      const good = new Game({ getCardIds: () => cards(60), hints: [], rng: seededRng(1) });
      good.addPlayer('Ann', 'user:1');
      const entry = { touched: Date.now(), game: good.toJSON() };
      fs.writeFileSync(path.join(dir, 'games.json'), JSON.stringify({ version: 1, games: { 'good-game': entry, 'bad-game': { touched: Date.now(), game: { players: 'nonsense' } } } }));
    },
  });
  assert.ok(logs.some((line) => /bad-game/.test(line)));
  assert.equal(fs.existsSync(`${gamesFile}.corrupt`), true);
  assert.ok(logs.some((line) => /1 saved games/.test(line)), 'the good game was loaded');
});

test('cards are collected once per round, not after every action', async (t) => {
  const collected = [];
  const { connect } = launch(t, { collected });
  const sockets = [1, 2, 3].map((id) => connect(id, `P${id}`));
  const created = await sockets[0].call('create');
  assert.equal(created.ok, true);
  for (const socket of sockets.slice(1)) assert.equal((await socket.call('join', { code: created.code })).ok, true);
  assert.equal(collected.length, 0, 'nothing is dealt in the lobby');
  assert.equal((await sockets[0].call('start')).ok, true);
  assert.equal(collected.length, 3, 'one collection for each person when the round is dealt');
  const chooser = sockets.find((s) => s.state.me.isChooser);
  assert.equal((await chooser.call('submitWord', { word: 'a word' })).ok, true);
  for (const socket of sockets.filter((s) => s !== chooser)) assert.equal((await socket.call('playCard', { cardId: socket.state.me.hand[0] })).ok, true);
  assert.equal(collected.length, 3, 'playing cards collects nothing more');
  for (const socket of sockets) if (socket.state.voteTargets.length) await socket.call('vote', { targetId: socket.state.voteTargets[0] });
  assert.equal(collected.length, 3, 'voting collects nothing more');
  assert.equal((await sockets[0].call('nextRound')).ok, true);
  assert.equal(collected.length, 6, 'the next round deals new cards, which are collected');
});

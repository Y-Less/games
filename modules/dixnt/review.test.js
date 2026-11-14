// Fixes from the code review, kept as tests: a person who leaves mid-round never costs the round (a computer player
// takes their place, with their card and their vote), submitWord cannot throw on an empty round, a finished game
// cannot have people removed, players say kind: 'bot' or 'human', a damaged saved-games file is kept and logged, and
// cards are collected once per round.  The first group drives the rules (game.js) directly; the second drives the real
// server module (server.js) with a fake socket layer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { cards, makeRoom, rulesWith, seededRng } from './harness.js';
import createServer from './server.js';

/** A game of `count` people (Ann hosts), started, with plenty of rounds and the given judging style. */
function started(count = 5, judging = 'everyone') {
  const names = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay'].slice(0, count);
  return makeRoom(names, { cardCount: 200, seed: 11, rounds: 10, judging, start: true });
}

/** Moves the game on to `phase`, using the first card of each hand and voting for the first target. */
function advanceTo({ game, room, rng }, phase) {
  if (phase === 'word') return;
  game.submitWord(room, room.chooserId, 'lighthouse', rng);
  if (phase === 'picking') return;
  for (const p of game.cardPlayers(room)) game.playCard(room, p.id, p.hand[0], rng);
  if (phase === 'voting') return;
  for (const v of game.voters(room)) game.vote(room, v.id, game.cardPlayers(room).find((p) => p.id !== v.id).id);
}

// ---------- (1) somebody leaving never costs the round ----------

for (const phase of ['word', 'picking', 'voting', 'results']) {
  test(`a person leaving in the ${phase} phase leaves the turn exactly where it was`, () => {
    const made = started();
    const { game, room, rng } = made;
    advanceTo(made, phase);
    const before = { phase: room.phase, turn: room.turn, completed: room.completedTurns, picks: Object.keys(room.picks).length, votes: Object.keys(room.votes).length };
    const leaver = room.players.find((p) => p.kind === 'human' && p.id !== room.hostId);
    assert.equal(game.removeHuman(room, leaver.id, rng, 0).ok, true);
    assert.equal(room.phase, before.phase, 'the phase is untouched');
    assert.equal(room.turn, before.turn, 'the turn was not abandoned');
    assert.equal(room.completedTurns, before.completed);
    assert.equal(Object.keys(room.picks).length, before.picks, 'their card is still on the table');
    assert.equal(Object.keys(room.votes).length, before.votes, 'and their vote still counts');
    assert.equal(room.players.length, 5);
  });
}

test('even the chooser leaving keeps the round: a computer player chooses the word for them', () => {
  const made = started();
  const { game, room, rng } = made;
  const chooser = room.chooserId;
  const round = room.turn;
  assert.equal(game.removeHuman(room, chooser, rng, 0).ok, true);
  assert.equal(room.turn, round, 'the round was not abandoned');
  assert.equal(room.phase, 'word');
  const now = game.playerOf(room, room.chooserId);
  assert.equal(now.kind, 'bot');
  assert.deepEqual(game.pendingBotAction(room), { type: 'word', id: now.id }, 'and it is its move');
});

test('the imposter leaving keeps the round, and the computer player standing in still knows nothing', () => {
  const made = started();
  const { game, room, rng } = made;
  advanceTo(made, 'picking');
  const imposter = room.imposterId;
  const round = room.turn;
  assert.equal(game.removeHuman(room, imposter, rng, 0).ok, true);
  assert.equal(room.turn, round);
  assert.equal(room.phase, 'picking');
  assert.notEqual(room.imposterId, imposter, 'the place has a new name');
  assert.equal(game.viewFor(room, room.imposterId).word, null, 'whoever holds it is still in the dark');
});

test('removing a card player who had not played leaves a computer player to play for them', () => {
  const made = started(5);
  const { game, room, rng } = made;
  advanceTo(made, 'picking');
  const leaver = game.cardPlayers(room).find((p) => p.id !== room.imposterId && p.id !== room.hostId);
  for (const p of game.cardPlayers(room)) if (p.id !== leaver.id) game.playCard(room, p.id, p.hand[0], rng);
  assert.equal(room.phase, 'picking', 'one card is still missing');
  assert.equal(game.removeHuman(room, leaver.id, rng, 0).ok, true);
  assert.equal(room.phase, 'picking', 'the round waits for the computer player to play it');
  const pending = game.pendingBotAction(room);
  assert.equal(pending.type, 'card');
  assert.equal(game.runBotAction(room, rng, pending), true);
  assert.equal(room.phase, 'voting', 'and then voting opens as it would have done');
  assert.equal(room.tableOrder.length, game.cardPlayers(room).length);
});

test('the last person who had not voted leaving leaves the computer player to finish it', () => {
  const made = started(5);
  const { game, room, rng } = made;
  advanceTo(made, 'voting');
  const voters = game.voters(room);
  const leaver = voters.find((p) => p.id !== room.imposterId && p.id !== room.hostId);
  for (const v of voters) {
    if (v.id === leaver.id) continue;
    game.vote(room, v.id, game.cardPlayers(room).find((p) => p.id !== v.id && p.id !== leaver.id).id);
  }
  assert.equal(room.phase, 'voting');
  assert.equal(game.removeHuman(room, leaver.id, rng, 0).ok, true);
  assert.equal(game.runBotAction(room, rng), true);
  assert.equal(room.phase, 'results');
  assert.equal(Object.keys(room.results.deltas).length, 5, 'everybody is in the results, including the place that changed hands');
});

test('a person leaving while the results are up keeps them, and the next round still starts', () => {
  const made = started(5);
  const { game, room, rng } = made;
  advanceTo(made, 'results');
  const leaver = room.players.find((p) => p.kind === 'human' && ![room.chooserId, room.imposterId, room.hostId].includes(p.id));
  const score = leaver.score;
  assert.equal(game.removeHuman(room, leaver.id, rng, 0).ok, true);
  assert.equal(room.phase, 'results');
  const stand = room.players.find((p) => p.stoodInFor === leaver.id);
  assert.equal(room.results.deltas[stand.id], room.history.at(-1).deltas[leaver.id] ?? room.results.deltas[stand.id]);
  assert.equal(stand.score, score, 'the score stayed with the place');
  assert.equal(game.nextTurn(room, room.hostId, rng).ok, true);
  assert.equal(room.phase, 'word');
});

test('the room is never left below three players by somebody leaving', () => {
  const { game, room, rng } = started(3);
  assert.equal(game.removeHuman(room, 3, rng, 0).ok, true);
  assert.equal(room.players.length, 3);
  assert.notEqual(room.phase, 'lobby');
});

// ---------- (2) submitWord with nobody to play ----------

test('submitWord refuses cleanly when nobody else is in the round', () => {
  const { game, room } = makeRoom(['Ann'], { cardCount: 200 });
  Object.assign(room, { phase: 'word', chooserId: 1 });
  const before = JSON.stringify(room);
  assert.equal(game.submitWord(room, 1, 'lonely', () => 0.5).error, 'nobodyToPlay');
  assert.equal(JSON.stringify(room), before, 'nothing changed');
});

// ---------- (3) who a player is ----------

test('a person is known by their account and a computer player is not an account at all', () => {
  const { game, room } = makeRoom(['Ann', 'Bob'], { cardCount: 50, bots: 1 });
  assert.deepEqual(room.players.map((p) => p.id), [1, 2, 'bot:1']);
  assert.ok(room.players.every((p) => !('token' in p)), 'no seat tokens are kept any more');
  assert.deepEqual(game.viewFor(room, 1).scoreboard.players.map((p) => p.userId), [1, 2, undefined]);
});

// ---------- (6) nobody can be removed from a finished game ----------

test('the host cannot remove anyone from a finished game, but people can still leave', () => {
  const { game, room, rng } = started(3);
  room.phase = 'finished';
  assert.equal(game.kick(room, 1, game.playerOf(room, 2).slot, rng, 0).error, 'gameOverNobodyToRemove');
  assert.equal(room.players.length, 3);
  const left = game.removeHuman(room, 2, rng, 0);
  assert.equal(left.ok, true);
  assert.equal(left.changed, false, 'leaving a finished game changes nothing for the others');
  assert.equal(room.players.length, 3, 'the final standings still name them');
});

// ---------- (7) kind: 'bot' ----------

test('computer players are kind bot, people are kind human, and the view still says bot', () => {
  const { game, room } = makeRoom(['Ann'], { cardCount: 100 });
  assert.equal(game.fillWithBots(room, 1, 3).ok, true);
  assert.deepEqual(room.players.map((p) => p.kind), ['human', 'bot', 'bot']);
  assert.ok(room.players.every((p) => !('bot' in p)));
  assert.deepEqual(game.viewFor(room, 1).players.map((p) => p.bot), [false, true, true]);
});

test('a saved room with bot: true players is migrated to kind bot', () => {
  const { game, room } = makeRoom(['Ann'], { cardCount: 100 });
  game.fillWithBots(room, 1, 3);
  const old = JSON.parse(JSON.stringify(room));
  for (const p of old.players) {
    p.bot = p.kind === 'bot';
    delete p.kind;
  }
  const loaded = rulesWith({ getCardIds: () => cards(100) }).migrate(old);
  assert.deepEqual(loaded.players.map((p) => p.kind), ['human', 'bot', 'bot']);
  assert.ok(loaded.players.every((p) => !('bot' in p)));
  assert.equal(game.humans(loaded).length, 1);
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
    users: { get: () => null },
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
  return { ctx, logs, dataDir, connect, roomsFile: path.join(dataDir, 'rooms.json'), module };
}

test('a corrupt rooms.json is logged and kept as rooms.json.corrupt, not silently overwritten', (t) => {
  const { logs, roomsFile, module } = launch(t, { setup: (dir) => fs.writeFileSync(path.join(dir, 'rooms.json'), '[ not json') });
  assert.ok(logs.some((line) => /corrupt/.test(line)), `logged: ${logs.join(' | ')}`);
  assert.equal(fs.readFileSync(`${roomsFile}.corrupt`, 'utf8'), '[ not json');
  module.dispose(); // the rooms are kept in the database from here, and the copy stays where it is
  assert.equal(fs.readFileSync(`${roomsFile}.corrupt`, 'utf8'), '[ not json');
  assert.equal(fs.existsSync(roomsFile), false, 'the unreadable file is not left to be read again at every start');
});

test('a missing rooms.json is normal: nothing logged as corrupt and no copy made', (t) => {
  const { logs, roomsFile } = launch(t);
  assert.ok(!logs.some((line) => /corrupt/.test(line)));
  assert.equal(fs.existsSync(`${roomsFile}.corrupt`), false);
});

test('a rooms.json with a room that cannot be brought up to date keeps a copy and still loads the others', (t) => {
  const { logs, roomsFile } = launch(t, {
    setup: (dir) => {
      const good = rulesWith({ getCardIds: () => cards(60) }).createRoom({ code: 'good-game', hostId: 1, hostName: 'Ann', now: Date.now() });
      fs.writeFileSync(path.join(dir, 'rooms.json'), JSON.stringify([good, { code: 'bad-game', players: 'nonsense' }]));
    },
  });
  assert.ok(logs.some((line) => /bad-game/.test(line)), `logged: ${logs.join(' | ')}`);
  assert.equal(fs.existsSync(`${roomsFile}.imported`), true, 'the file it came from is kept');
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
  assert.equal((await sockets[0].call('nextTurn')).ok, true);
  assert.equal(collected.length, 6, 'the next round deals new cards, which are collected');
});

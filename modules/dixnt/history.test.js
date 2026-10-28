import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from './game.js';
import { totalsFromRounds } from '../../shared/scores.js';

const range = (start, count) => Array.from({ length: count }, (_, i) => start + i);

function seededRng(seed = 7) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const newGame = (saved = null) => new Game({ getCardIds: () => range(1, 200), hints: [], rng: seededRng(), saved });

function setup(names, judging = 'everyone') {
  const game = newGame();
  const players = names.map((n) => game.addPlayer(n, `token-${n}`));
  game.setJudging(players[0].id, judging);
  return { game, players, host: players[0] };
}

/** Plays a round to its results. `right` says whether everyone who votes names the imposter. */
function playRound(game, { right = true } = {}) {
  const s = game.s;
  game.submitWord(s.chooserId, 'a word');
  for (const p of game.cardPlayers()) game.playCard(p.id, p.hand[0]);
  for (const voter of game.voters()) {
    const targets = game.cardPlayers().filter((p) => p.id !== voter.id);
    const target = right ? targets.find((p) => p.id === s.imposterId) : targets.find((p) => p.id !== s.imposterId);
    game.vote(voter.id, (target ?? targets[0]).id);
  }
  assert.equal(s.phase, 'results');
}

const everyView = (game, connected) => game.s.players.map((p) => game.viewFor(p.id, connected));

function assertAddsUp(game) {
  for (const view of everyView(game)) {
    const { players, rounds, lowIsBetter } = view.scoreboard;
    assert.equal(lowIsBetter, false);
    assert.equal('target' in view.scoreboard, false, 'Dixnt has no target score');
    const totals = totalsFromRounds(rounds, players.map((p) => p.id));
    for (const p of players) assert.equal(totals[p.id], p.score, `${p.name}: table total equals score`);
  }
}

test('every completed round is added to the history, with notes, and the totals equal the scores', () => {
  const { game, host } = setup(['Ann', 'Bob', 'Cat', 'Dan']);
  game.start(host.id);
  assert.deepEqual(game.viewFor(host.id).scoreboard.rounds, []);
  for (let i = 1; i <= 3; i++) {
    const chooserId = game.s.chooserId;
    playRound(game, { right: i % 2 === 1 });
    const rounds = game.viewFor(host.id).scoreboard.rounds;
    assert.equal(rounds.length, i);
    const last = rounds.at(-1);
    assert.equal(last.label, `Round ${i}`);
    assert.deepEqual(last.deltas, game.s.results.deltas);
    assert.equal(last.notes[chooserId], 'chooser');
    assert.match(last.notes[game.s.imposterId], /^imposter, (caught|fooled all)$/);
    assertAddsUp(game);
    game.nextRound(host.id);
  }
});

test('the scoreboard shape is the same for everybody, with isMe and away set per viewer', () => {
  const { game, players } = setup(['Ann', 'Bob', 'Cat']);
  game.start(players[0].id);
  playRound(game);
  const views = everyView(game, new Set([players[0].id, players[1].id]));
  assert.deepEqual(views[0].scoreboard.rounds, views[2].scoreboard.rounds);
  assert.deepEqual(views[0].scoreboard.players.map((p) => p.isMe), [true, false, false]);
  assert.deepEqual(views[1].scoreboard.players.map((p) => p.isMe), [false, true, false]);
  assert.deepEqual(views[0].scoreboard.players.map((p) => p.away), [false, false, true]);
  assert.deepEqual(Object.keys(views[0].scoreboard.players[0]).sort(), ['away', 'bot', 'current', 'id', 'isMe', 'name', 'score', 'userId']);
});

test('nothing is revealed early: the history only grows when the round is over', () => {
  const { game, host } = setup(['Ann', 'Bob', 'Cat']);
  game.start(host.id);
  playRound(game);
  game.nextRound(host.id);
  const before = JSON.stringify(game.viewFor(host.id).scoreboard);
  game.submitWord(game.s.chooserId, 'word');
  assert.equal(JSON.stringify(game.viewFor(host.id).scoreboard), before, 'choosing the word changes nothing');
  for (const p of game.cardPlayers()) game.playCard(p.id, p.hand[0]);
  assert.equal(JSON.stringify(game.viewFor(host.id).scoreboard), before, 'neither does voting time');
});

test('abandoned rounds are not recorded, and labels count completed rounds only', () => {
  const { game, host } = setup(['Ann', 'Bob', 'Cat']);
  game.start(host.id);
  playRound(game);
  game.nextRound(host.id);
  game.submitWord(game.s.chooserId, 'word');
  game.abortRound(host.id);
  game.abortRound(host.id);
  assert.equal(game.s.history.length, 1);
  playRound(game);
  assert.deepEqual(game.s.history.map((r) => r.label), ['Round 1', 'Round 2']);
  assertAddsUp(game);
});

test('every judging style records its own notes and still adds up', () => {
  for (const judging of ['chooser', 'favourite']) {
    const { game, host } = setup(['Ann', 'Bob', 'Cat'], judging);
    game.start(host.id);
    const chooserId = game.s.chooserId;
    playRound(game, { right: false });
    const { notes, deltas } = game.s.history[0];
    assert.equal(Object.values(deltas).reduce((a, b) => a + b, 0) > 0, true);
    if (judging === 'chooser') assert.equal(notes[chooserId], 'chooser, fooled');
    else assert.ok(Object.values(notes).includes('card picked'));
    assertAddsUp(game);
  }
});

test('late joiners show with a score of nothing, and a player who leaves is removed from the table', () => {
  const { game, host, players } = setup(['Ann', 'Bob', 'Cat', 'Dan']);
  game.start(host.id);
  playRound(game);
  const late = game.addPlayer('Eve', 'token-Eve');
  game.nextRound(host.id);
  playRound(game);
  game.nextRound(host.id);
  const view = game.viewFor(late.id);
  assert.equal(view.scoreboard.players.find((p) => p.id === late.id).score >= 0, true);
  assertAddsUp(game);
  game.removePlayer(host.id, players[3].id);
  for (const round of game.s.history) assert.equal(players[3].id in round.deltas, false);
  assert.equal(game.s.history.length >= 2, true);
  assertAddsUp(game);
});

test('the history survives saving, and the lobby clears it', () => {
  const { game, host } = setup(['Ann', 'Bob', 'Cat']);
  game.start(host.id);
  playRound(game);
  const copy = newGame(JSON.parse(JSON.stringify(game)));
  assert.deepEqual(copy.s.history, game.s.history);
  assertAddsUp(copy);
  game.returnToLobby(host.id);
  assert.deepEqual(game.viewFor(host.id).scoreboard.rounds, []);
  assert.ok(game.viewFor(host.id).scoreboard.players.every((p) => p.score === 0));
});

test('older saves without a history still load: existing scores become one "Earlier rounds" row', () => {
  const { game, host } = setup(['Ann', 'Bob', 'Cat']);
  game.start(host.id);
  playRound(game);
  game.nextRound(host.id);
  const old = JSON.parse(JSON.stringify(game));
  delete old.history;
  const loaded = newGame(old);
  const { rounds } = loaded.viewFor(host.id).scoreboard;
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].label, 'Earlier rounds');
  assertAddsUp(loaded);
  playRound(loaded);
  assert.deepEqual(loaded.s.history.map((r) => r.label), ['Earlier rounds', 'Round 2']);
  assertAddsUp(loaded);

  const lobby = newGame({ phase: 'lobby', players: [] });
  assert.deepEqual(lobby.s.history, []);
});

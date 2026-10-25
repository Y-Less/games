// Whole computer-only games: always terminate, with every invariant true after EVERY action (tile conservation, the
// score = the history, legal walls, no hidden information in any view).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { assertInvariants, driveStep, playingRoom, viewLeaks } from './testing.js';

const SIZES = [2, 3, 4, 5];

function playOut(n, g, free) {
  const { room, rng } = playingRoom(n, { seed: n * 100000 + g, free });
  let actions = 0;
  let refills = 0;
  let lastBag = room.bag.length;
  let step;
  assertInvariants(room, 'start');
  while ((step = driveStep(room, rng))) {
    actions++;
    if (room.bag.length > lastBag) refills++;
    lastBag = room.bag.length;
    assertInvariants(room, `n=${n} free=${free} game ${g} step ${actions}`);
    if (actions % 9 === 0) {
      for (let seat = 0; seat < n; seat++) assert.deepEqual(viewLeaks(room, game.viewFor(room, seat + 1)), [], `n=${n} game ${g} step ${actions}`);
    }
    assert.ok(actions < 3000, 'the game must end');
  }
  assert.equal(room.phase, 'finished');
  assertInvariants(room, `n=${n} game ${g} end`);
  assert.equal(room.final.players.length, n);
  assert.ok(room.winners.length >= 1);
  const view = game.viewFor(room, 1);
  for (const p of view.scoreboard.players) {
    assert.equal(p.score, room.final.players[p.id].total, 'the table shows the final score');
    assert.equal(view.scoreboard.rounds.reduce((s, r) => s + r.deltas[p.id], 0), p.score, 'the history adds up to the score');
  }
  return { room, actions, refills };
}

for (const free of [false, true]) {
  test(`computer-only games always terminate with every invariant after every action (${free ? 'free wall' : 'fixed wall'})`, () => {
    let games = 0;
    let actions = 0;
    let rounds = 0;
    let refills = 0;
    let bonusGames = 0;
    for (const n of SIZES) {
      for (let g = 0; g < 30; g++) {
        const result = playOut(n, g, free);
        games++;
        actions += result.actions;
        rounds += result.room.playedRounds;
        refills += result.refills;
        if (result.room.final.players.some((p) => p.bonus > 2)) bonusGames++;
        assert.ok(result.room.playedRounds >= 5, 'a row takes at least five rounds');
        assert.ok(result.room.playedRounds <= 14, `a sensible length (${result.room.playedRounds})`);
      }
    }
    assert.equal(games, 120);
    console.log(`  ${games} games, ${actions} actions, ${(rounds / games).toFixed(1)} rounds on average, ${refills} bag refills, ${bonusGames} games with more than a single row's bonus`);
  });
}

test('the bag really does run out and get refilled from the lid in ordinary games', () => {
  let refilled = 0;
  for (let g = 0; g < 20; g++) {
    const { room, rng } = playingRoom(5, { seed: 50 + g });
    let lastBag = room.bag.length;
    while (driveStep(room, rng)) {
      if (room.bag.length > lastBag) refilled++;
      lastBag = room.bag.length;
    }
  }
  assert.ok(refilled > 0, 'a five-player game deals 44 tiles a round: the bag is refilled in round 3');
});

test('random (not computer) play also keeps every invariant, including a lot of floor', () => {
  for (let g = 0; g < 40; g++) {
    const n = 2 + (g % 4);
    const { room, rng } = playingRoom(n, { seed: 7000 + g, free: g % 3 === 0 });
    let guard = 0;
    while (room.phase !== 'finished' && guard++ < 4000) {
      if (room.phase === 'tiling') {
        const seat = room.pending.findIndex(Boolean);
        const cols = room.pending[seat].columns;
        assert.equal(game.chooseColumn(room, seat, { col: cols[Math.floor(rng() * cols.length)] }, rng).ok, true);
      } else {
        const moves = game.legalMoves(room, room.turn);
        // Half the time only the floor: stress the lid, the marker and the zero-score clamp.
        const pool = rng() < 0.5 ? moves.filter((m) => m.line === 'floor') : moves;
        assert.equal(game.takeTiles(room, room.turn, pool[Math.floor(rng() * pool.length)], rng).ok, true);
      }
      assertInvariants(room, `random game ${g}`);
    }
    assert.equal(room.phase, 'finished', `random game ${g} ended`);
  }
});

test('a game is reproducible from its seed (the rules use only the random numbers they are given)', () => {
  const a = playOut(3, 4, false).room;
  const b = playOut(3, 4, false).room;
  assert.deepEqual(a.scores, b.scores);
  assert.deepEqual(a.history, b.history);
});

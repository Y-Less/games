// Rules-level gaps found by reading game.js against the existing tests: settings edges, leaving in each phase,
// refusals that must change nothing and the first-trick restrictions.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { seeded } from '../../shared/testkit.js';

const full = (settings) => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann', settings });
  game.addHuman(room, 2, 'bob');
  game.fillWithBots(room, 1);
  return room;
};

test('settings: each bad value is refused with its own message and changes nothing', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann' });
  const before = JSON.stringify(room.settings);
  for (const input of [{ target: 75 }, { target: '100' }, { target: null }, { jackOfDiamonds: 'yes' }, { jackOfDiamonds: 1 }, { moon: 'both' }, { moon: null }, { target: 50, moon: 'x' }]) {
    const result = game.setSettings(room, 1, input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(typeof result.error, 'string');
  }
  assert.equal(JSON.stringify(room.settings), before);
  assert.equal(game.setSettings(room, 1, { target: 150, moon: 'self', jackOfDiamonds: true, extra: 'ignored' }).ok, true);
  assert.deepEqual(room.settings, { target: 150, jackOfDiamonds: true, moon: 'self' });
  assert.throws(() => game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann', settings: { target: 3 } }));
});

test('addBot and removeBot: seats must exist, be free or hold a computer player', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann' });
  for (const seat of [-1, 4, 1.5, '1', null, NaN]) assert.equal(game.addBot(room, 1, seat).ok, false, String(seat));
  assert.equal(game.addBot(room, 1, 0).ok, false, 'a taken seat');
  assert.equal(game.addBot(room, 1, 2).ok, true);
  assert.equal(game.addBot(room, 1, 2).ok, false);
  assert.equal(game.removeBot(room, 1, 0).ok, false, 'a person is not a computer player');
  assert.equal(game.removeBot(room, 1, 3).ok, false, 'an empty seat');
  assert.equal(game.removeBot(room, 2, 2).ok, false, 'only the host');
  game.fillWithBots(room, 1);
  assert.equal(game.addBot(room, 1).ok, false, 'every seat is taken');
  assert.deepEqual(room.seats.map((s) => s.name).length, 4);
  assert.equal(new Set(room.seats.map((s) => s.name)).size, 4, 'computer players get different names');
});

test('start needs four seats and at least one person', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann' });
  assert.equal(game.start(room, 1).ok, false);
  game.fillWithBots(room, 1);
  room.seats[0] = room.seats[1];
  assert.equal(game.start(room, 1).ok, false, 'no person is seated');
});

test('leaving: in the lobby the seat is freed, mid-game a computer takes it, and the last person closes the room', () => {
  const room = full();
  assert.deepEqual(game.removeHuman(room, 2), { ok: true, empty: false, seat: 1, replaced: false });
  assert.equal(room.seats[1], null);
  assert.equal(game.removeHuman(room, 2).ok, false, 'not in the game any more');
  game.fillWithBots(room, 1);
  game.start(room, 1, seeded(1));
  const outcome = game.removeHuman(room, 1);
  assert.equal(outcome.empty, true);
  assert.equal(outcome.seat, 0);
  const fresh = full();
  game.start(fresh, 1, seeded(2));
  assert.equal(game.removeHuman(fresh, 1).replaced, true);
  assert.equal(fresh.hostId, 2, 'the host moves to the remaining person');
  assert.equal(game.isBot(fresh.seats[0]), true);
});

test('play again: only the host, only after the end, and it wipes the game', () => {
  const room = full({ target: 50 });
  const rng = seeded(3);
  game.start(room, 1, rng);
  assert.equal(game.playAgain(room, 1).ok, false, 'not over yet');
  room.phase = 'finished';
  assert.equal(game.playAgain(room, 2).ok, false, 'only the host');
  room.scores = [10, 20, 30, 40];
  assert.equal(game.playAgain(room, 1).ok, true);
  assert.equal(room.phase, 'lobby');
  assert.deepEqual(room.scores, [0, 0, 0, 0]);
  assert.deepEqual(room.history, []);
  assert.equal(room.winners, null);
});

test('the first trick: the 2 of clubs leads, and points may only go on it when nothing else is left', () => {
  const room = full();
  const rng = seeded(11);
  game.start(room, 1, rng);
  for (let seat = 0; seat < 4; seat++) game.choosePass(room, seat, room.hands[seat].slice(0, 3));
  if (room.phase !== 'playing') for (let seat = 0; seat < 4; seat++) game.choosePass(room, seat, room.hands[seat].slice(0, 3));
  assert.equal(room.phase, 'playing');
  const leader = room.turn;
  assert.ok(room.hands[leader].includes('2C'));
  for (const card of room.hands[leader].filter((c) => c !== '2C')) assert.equal(game.playCard(room, leader, card).ok, false);
  assert.equal(game.playCard(room, (leader + 1) % 4, room.hands[(leader + 1) % 4][0]).ok, false, 'out of turn');
  // A hand of nothing but hearts and the queen may dump them on the first trick.
  room.hands[(leader + 1) % 4] = ['QS', '3H'];
  game.playCard(room, leader, '2C');
  assert.equal(game.illegalReason(room, (leader + 1) % 4, 'QS'), null);
  room.hands[(leader + 1) % 4] = ['QS', '3H', '5D'];
  assert.match(game.illegalReason(room, (leader + 1) % 4, 'QS'), /first trick|follow/);
});

test('statistics: everybody seated is recorded once with the right outcome and placement', () => {
  const room = full({ target: 50 });
  game.start(room, 1, seeded(5));
  room.phase = 'finished';
  room.scores = [60, 10, 10, 70];
  room.winners = game.winnersOf(room.scores);
  const stats = game.statsPlayers(room);
  assert.deepEqual(stats.map((p) => [p.userId, p.outcome, p.placement]), [[1, 'loss', 3], [2, 'win', 1]]);
  assert.ok(stats.every((p) => Object.values(p.extras).every(Number.isFinite)));
});

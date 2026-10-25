// Rules-level gaps found by reading game.js against the existing tests: resizing seats, names, leaving after the end,
// play again, refusals that change nothing, and trick winners with trumps.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { seeded } from '../../shared/testkit.js';

const make = (settings = {}) => game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann', settings });

test('settings: bad values are refused and change nothing; valid ones resize the table', () => {
  const room = make();
  const before = JSON.stringify(room);
  for (const input of [{ seats: 2 }, { seats: 8 }, { seats: 4.5 }, { seats: '4' }, { length: 'medium' }, { missPoints: 'yes' }, { seats: null }]) {
    assert.equal(game.setSettings(room, 1, input).ok, false, JSON.stringify(input));
  }
  assert.equal(JSON.stringify(room), before);
  assert.equal(game.setSettings(room, 1, { seats: 6 }).ok, true);
  assert.equal(room.seats.length, 6);
  assert.equal(room.scores.length, 6, 'scores follow the table size');
  assert.equal(game.setSettings(room, 1, { seats: 3, length: 'short', missPoints: false }).ok, true);
  assert.deepEqual(room.settings, { seats: 3, length: 'short', missPoints: false });
  assert.equal(room.seats.length, 3);
  assert.throws(() => make({ seats: 99 }));
});

test('shrinking the table drops computer players first and refuses when only people would have to go', () => {
  const room = make({ seats: 5 });
  game.addHuman(room, 2, 'bob');
  game.addHuman(room, 3, 'cat');
  game.addHuman(room, 4, 'dan');
  game.addBot(room, 1);
  assert.equal(game.setSettings(room, 1, { seats: 4 }).ok, true);
  assert.equal(room.seats.filter(game.isBot).length, 0, 'the computer player went');
  assert.equal(game.setSettings(room, 1, { seats: 3 }).ok, false, 'four people cannot sit at three seats');
  assert.equal(room.seats.length, 4);
  assert.equal(room.settings.seats, 4);
});

test('names: people with the same name get numbered, and computer players never clash', () => {
  const room = make({ seats: 5 });
  game.addHuman(room, 2, 'ann');
  game.addHuman(room, 3, 'ANN');
  assert.deepEqual(room.seats.slice(0, 3).map((s) => s.name), ['ann', 'ann (2)', 'ANN (3)']);
  game.fillWithBots(room, 1);
  assert.equal(new Set(room.seats.map((s) => s.name.toLowerCase())).size, 5);
});

test('after the end: a person who leaves keeps a "gone" seat; play again clears it and starts a lobby', () => {
  const room = make({ seats: 3, length: 'short' });
  game.addHuman(room, 2, 'bob');
  game.fillWithBots(room, 1);
  const rng = seeded(8);
  game.start(room, 1, rng);
  while (room.phase !== 'finished') {
    if (game.pendingAction(room)) game.runPending(room, rng);
    else if (room.phase === 'roundEnd') game.nextRound(room, 1, rng);
    else if (room.phase === 'nominating') game.nominate(room, room.turn, game.allowedNominations(room, room.turn)[0]);
    else game.playCard(room, room.turn, game.legalCards(room, room.turn)[0]);
  }
  assert.equal(game.removeHuman(room, 2).replaced, false);
  assert.equal(room.seats[1].kind, 'gone');
  assert.equal(game.viewFor(room, 1).seats[1].away, true);
  assert.equal(game.playAgain(room, 2).ok, false);
  assert.equal(game.playAgain(room, 1).ok, true);
  assert.equal(room.seats[1], null, 'the gone seat is empty again');
  assert.equal(room.phase, 'lobby');
  assert.deepEqual(room.scores, [0, 0, 0]);
  assert.equal(game.statsPlayers({ ...room, winners: [0], phase: 'finished' }).length, 1);
});

test('the winner of a trick: trumps beat the suit led, otherwise the highest of the suit led; no trumps in a no-trump round', () => {
  const t = (...cards) => cards.map((card, seat) => ({ seat, card }));
  assert.equal(game.trickWinner(t('5H', 'KH', '2S'), 'S'), 2, 'a low trump beats a high card of the suit led');
  assert.equal(game.trickWinner(t('5H', 'KH', '2S', '9S'), 'S'), 3, 'the highest trump wins');
  assert.equal(game.trickWinner(t('5H', 'KH', '2S'), null), 1, 'no trumps: the highest of the suit led');
  assert.equal(game.trickWinner(t('5H', 'AS', '2D'), 'C'), 0, 'discards of other suits never win');
  assert.equal(game.trickWinner(t('5H'), 'S'), 0);
});

test('the trump suit cycles hearts, clubs, diamonds, spades, no trumps; the deal passes round the table', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(game.trumpOf), ['H', 'C', 'D', 'S', null, 'H', null]);
  assert.equal(game.trumpName(null), 'no trumps');
  assert.equal(game.roundCount({ length: 'full' }), 14);
  assert.equal(game.roundCount({ length: 'short' }), 7);
  assert.deepEqual([0, 1, 2, 3, 4].map((r) => game.dealerFor(2, r, 4)), [2, 3, 0, 1, 2]);
  assert.match(game.roundLabel({ length: 'full' }, 6), /1 card,/);
});

test('refused nominations and plays leave the room exactly as it was', () => {
  const room = make({ seats: 3, length: 'short' });
  game.addHuman(room, 2, 'bob');
  game.fillWithBots(room, 1);
  game.start(room, 1, seeded(21));
  while (game.pendingAction(room)) game.runPending(room, seeded(1));
  const seat = room.turn;
  const before = JSON.stringify(room);
  for (const number of [-1, 8, 0.5, '2', null, undefined, NaN, [], {}]) assert.equal(game.nominate(room, seat, number).ok, false);
  assert.equal(game.nominate(room, (seat + 1) % 3, 0).ok, false);
  assert.equal(game.playCard(room, seat, room.hands[seat][0]).ok, false, 'not playing yet');
  assert.equal(game.resolveTrick(room).ok, false);
  assert.equal(JSON.stringify(room), before);
});

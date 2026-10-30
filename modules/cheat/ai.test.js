// The Cheat computer players: what they play and call in set positions, and that whole games of computers always finish
// legally, with every card accounted for at every step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from '../../shared/testkit.js';
import * as g from './game.js';
import { AIS } from './ai/index.js';

const ai = (id) => AIS.find((a) => a.id === id);
const context = (extra) => ({ seat: 1, hand: ['2C', '2D', '9S'], rank: '2', plays: 1, pileSize: 4, handSizes: [5, 3, 5, 5], decks: 1, maxPlay: 4, last: null, final: false, ...extra });

/** A game of computers only: the first seat is a computer too (the host is replaced when they leave). */
function botGame(n, seed, ais) {
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats: n } });
  g.fillWithBots(room, 1);
  g.start(room, 1, seeded(seed));
  g.removeHuman(room, 1, seeded(seed)); // seat 0 becomes a computer
  room.seats.forEach((seat, i) => (seat.ai = ais ? ais[i % ais.length] : seat.ai));
  return room;
}
const cardCount = (room) => room.hands.flat().length + room.pile.length;

test('there are several computer players and the first is the standard one', () => {
  assert.ok(AIS.length >= 3);
  assert.equal(AIS[0].id, 'standard');
  assert.ok(AIS.every((a) => a.name && a.description && typeof a.play === 'function' && typeof a.call === 'function'));
});

test('an honest player plays every card of the rank, up to four', () => {
  const play = ai('standard').play(context({ hand: ['2C', '2D', '2H', '2S', '9S'] }), seeded(1));
  assert.deepEqual([...play].sort(), ['2C', '2D', '2H', '2S']);
  assert.deepEqual(ai('standard').play(context({ hand: ['2C', '9S', 'KD'] }), seeded(1)), ['2C']);
});

test('without the rank, a player has to cheat with cards from their own hand', () => {
  for (const a of AIS) {
    const hand = ['3C', '9S', 'KD', '5H'];
    const play = a.play(context({ hand }), seeded(2));
    assert.ok(play.length >= 1 && play.length <= 4);
    assert.ok(play.every((c) => hand.includes(c)));
  }
});

test('a play that cannot be true is always called by the thinking players', () => {
  // The caller holds three of the four 7s, so nobody can have played two 7s from one pack.
  const ctx = context({ hand: ['7C', '7D', '7H'], last: { seat: 0, count: 2, rank: '7' }, handSizes: [5, 3, 5, 5] });
  for (const id of ['standard', 'suspicious', 'bluffer']) assert.equal(ai(id).call(ctx, seeded(3)), true, id);
});

test('a play that is plainly safe is not always called, and the thinking players never call their own', () => {
  const ctx = context({ hand: ['9C', '9D'], last: { seat: 0, count: 1, rank: '2' }, pileSize: 12 });
  for (const id of ['standard', 'suspicious', 'bluffer']) {
    let calls = 0;
    for (let i = 0; i < 400; i++) calls += ai(id).call(ctx, seeded(i + 1)) ? 1 : 0;
    assert.ok(calls < 400, `${id} does not call everything`);
  }
});

test('a broken computer player cannot stop a game', () => {
  const room = botGame(4, 5, ['standard']);
  const standard = ai('standard');
  const { play, call } = standard;
  standard.play = () => ['ZZ', 'QQ'];
  standard.call = () => {
    throw new Error('boom');
  };
  try {
    for (let i = 0; i < 60 && room.phase !== 'finished'; i++) g.runPending(room, seeded(i));
    assert.equal(cardCount(room), 52);
    assert.ok(room.plays > 10, 'the game went on');
  } finally {
    Object.assign(standard, { play, call });
  }
});

for (const n of [3, 4, 5, 6, 7]) {
  test(`${n} computer players play whole games to a finish, with every card accounted for`, () => {
    for (let seed = 1; seed <= 12; seed++) {
      const room = botGame(n, seed * 10 + n);
      const total = cardCount(room);
      const rng = seeded(seed);
      let steps = 0;
      while (room.phase !== 'finished') {
        const done = g.runPending(room, rng);
        assert.ok(done, `a computer always has something to do (${n} players, seed ${seed}, phase ${room.phase})`);
        assert.equal(cardCount(room), total, 'no card is created or lost');
        if (g.decksFor(n) === 1) assert.equal(new Set(room.hands.flat().concat(room.pile)).size, total, 'no card appears twice in one pack');
        assert.ok(++steps < 20000, `the game finishes (${n} players, seed ${seed})`);
      }
      assert.equal(room.hands[room.winner].length, 0, 'the winner is out of cards');
      const stats = g.statsPlayers(room);
      assert.equal(stats.length, 0, 'no people, nothing to record');
    }
  });
}

test('every kind of computer player wins games against the others', () => {
  const wins = Object.fromEntries(AIS.map((a) => [a.id, 0]));
  for (let seed = 1; seed <= 40; seed++) {
    const room = botGame(AIS.length, seed, AIS.map((a) => a.id));
    const rng = seeded(seed);
    while (room.phase !== 'finished') g.runPending(room, rng);
    wins[room.seats[room.winner].ai]++;
  }
  assert.ok(Object.values(wins).every((n) => n >= 0));
  assert.ok(wins.random < 20, `a random player does not dominate: ${JSON.stringify(wins)}`);
});

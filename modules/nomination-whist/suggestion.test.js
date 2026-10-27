// The nomination suggested to a person on their turn: only their own, only at that moment, and always a legal number.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as g from './game.js';

const seeded = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
};

/** A started game of `seats` with one person (user 1, Ann) and computer players, up to the point where Ann must nominate. */
function toAnnsTurn(seed, seats = 4) {
  const rng = seeded(seed);
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats } });
  assert.ok(g.fillWithBots(room, 1).ok);
  assert.ok(g.start(room, 1, rng).ok);
  while (room.phase === 'nominating' && room.turn !== 0) g.runPending(room, rng);
  return room;
}

test('on their turn the person is suggested an allowed number for their own hand', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const room = toAnnsTurn(seed, 3 + (seed % 5));
    assert.equal(room.phase, 'nominating');
    const view = g.viewFor(room, 1);
    assert.ok(Number.isInteger(view.suggestion), 'a suggestion is made');
    assert.ok(view.suggestion >= 0 && view.suggestion <= view.round.cards);
    assert.notEqual(view.suggestion, view.forbidden, 'never the number the dealer may not nominate');
    assert.ok(g.nominate(room, 0, view.suggestion).ok, 'it can really be nominated');
  }
});

test('the dealer is never suggested the forbidden number', () => {
  let dealerTurns = 0;
  for (let seed = 1; seed <= 400 && dealerTurns < 40; seed++) {
    const room = toAnnsTurn(seed, 3);
    const view = g.viewFor(room, 1);
    if (room.dealer !== 0 || view.forbidden === null) continue;
    dealerTurns++;
    assert.notEqual(view.suggestion, view.forbidden);
  }
  assert.ok(dealerTurns >= 10, 'the situation came up often enough to matter');
});

test('nobody is suggested anything off their turn, and the suggestion is not in anyone else\'s view', () => {
  const rng = seeded(5);
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats: 3 } });
  g.addHuman(room, 2, 'Bob');
  g.fillWithBots(room, 1);
  assert.equal(g.viewFor(room, 1).suggestion, undefined, 'none in the lobby');
  g.start(room, 1, rng);
  const ann = g.viewFor(room, 1);
  const bob = g.viewFor(room, 2);
  const turnOf = room.turn;
  assert.equal(ann.suggestion === null, turnOf !== 0);
  assert.equal(bob.suggestion === null, turnOf !== 1);
  assert.equal(g.viewFor(room, 99).suggestion, null, 'a spectator gets none');
  // Once the nominating is over, there is nothing to suggest.
  while (room.phase === 'nominating') {
    const seat = room.turn;
    const seatView = g.viewFor(room, seat === 0 ? 1 : 2);
    if (room.seats[seat].kind === 'human') g.nominate(room, seat, seatView.suggestion);
    else g.runPending(room, rng);
  }
  assert.equal(g.viewFor(room, 1).suggestion, null);
  assert.equal(g.viewFor(room, 2).suggestion, null);
});

test('the suggestion is the same every time it is asked for', () => {
  const room = toAnnsTurn(7);
  const first = g.viewFor(room, 1).suggestion;
  for (let i = 0; i < 20; i++) assert.equal(g.viewFor(room, 1).suggestion, first);
});

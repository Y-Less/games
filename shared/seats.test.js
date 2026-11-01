// Tests for the shared seat rules (shared/seats.js) and random helpers (shared/random.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawUnused, pickOne, seeded } from './random.js';
import { createSeatRules, freeGoneSeats, freeName, goneSeat, isBot, isGone, isHuman, nextBotName, seatOf, uniqueName } from './seats.js';

/** A three-seat lobby with Ann (the host) in seat 0. */
function lobby() {
  return { hostId: 1, phase: 'lobby', nextBot: 1, seats: [{ kind: 'human', id: 1, name: 'Ann' }, null, null] };
}

const rules = createSeatRules({ isMidGame: (room) => room.phase === 'playing' });

test('addHuman seats a newcomer, once, and gives them a name nobody else has', () => {
  const room = lobby();
  assert.deepEqual(rules.addHuman(room, 2, 'ann'), { ok: true, seat: 1 });
  assert.equal(room.seats[1].name, 'ann (2)');
  assert.deepEqual(rules.addHuman(room, 2, 'ann'), { ok: true, seat: 1 }, 'joining twice keeps the same seat');
  assert.equal(room.seats.filter(Boolean).length, 2);
  assert.equal(uniqueName(room, 'Bob'), 'Bob');
});

test('addHuman refuses a full table and a game that has started', () => {
  const room = lobby();
  rules.fillWithBots(room, 1);
  assert.equal(rules.addHuman(room, 5, 'Eve').error, 'That game is full.');
  room.phase = 'playing';
  assert.equal(rules.addHuman(room, 5, 'Eve').error, 'That game has already started.');
});

test('only the host changes the lobby, and only in the lobby', () => {
  const room = lobby();
  rules.addHuman(room, 2, 'Bob');
  assert.equal(rules.addBot(room, 2).error, 'Only the host can do that.');
  assert.deepEqual(rules.addBot(room, 1), { ok: true, seat: 2 });
  assert.ok(isBot(room.seats[2]));
  assert.equal(rules.removeBot(room, 1, 2).ok, true);
  assert.equal(room.seats[2], null);
  room.phase = 'playing';
  assert.equal(rules.addBot(room, 1).error, 'You can only change that before the game starts.');
});

test('computer players take the names in order, then fall back to Computer', () => {
  const room = lobby();
  const small = createSeatRules({ isMidGame: () => false, botNames: ['Zed'] });
  small.fillWithBots(room, 1);
  assert.deepEqual(room.seats.slice(1).map((s) => s.name), ['Zed', 'Computer']);
  assert.deepEqual(room.seats.slice(1).map((s) => s.id), ['bot:1', 'bot:2']);
});

test('removeHuman frees the seat in the lobby and passes the host on', () => {
  const room = lobby();
  rules.addHuman(room, 2, 'Bob');
  const out = rules.removeHuman(room, 1);
  assert.equal(out.ok, true);
  assert.equal(out.replaced, false);
  assert.equal(room.seats[0], null);
  assert.equal(room.hostId, 2);
  assert.equal(rules.removeHuman(room, 99).error, 'You are not in this game.');
});

test('removeHuman mid-game puts a computer player in the seat, via the takeOver hook', () => {
  const calls = [];
  const custom = createSeatRules({
    isMidGame: () => true,
    takeOver: (room, bot, seat) => {
      calls.push(seat);
      return { ...bot, ai: 'standard' };
    },
    afterRemoval: (room) => calls.push('after'),
  });
  const room = lobby();
  custom.addHuman(room, 2, 'Bob');
  room.phase = 'playing';
  const out = custom.removeHuman(room, 2);
  assert.deepEqual(out, { ok: true, empty: false, seat: 1, replaced: true });
  assert.equal(room.seats[1].ai, 'standard');
  assert.ok(isBot(room.seats[1]));
  assert.deepEqual(calls, [1, 'after']);
});

test('removeHuman reports an empty room when the last person goes', () => {
  const room = lobby();
  const out = rules.removeHuman(room, 1);
  assert.deepEqual(out, { ok: true, empty: true, seat: 0 });
});

test('a finished game can keep a marker for the person who left', () => {
  const keeping = createSeatRules({ isMidGame: () => false, finishedSeat: (seat) => ({ kind: 'gone', name: seat.name }) });
  const room = lobby();
  keeping.addHuman(room, 2, 'Bob');
  room.phase = 'finished';
  keeping.removeHuman(room, 2);
  assert.deepEqual(room.seats[1], { kind: 'gone', name: 'Bob' });
});

test('kick removes someone else, never the host, and never from a finished game', () => {
  const room = lobby();
  rules.addHuman(room, 2, 'Bob');
  assert.equal(rules.kick(room, 2, 0).error, 'Only the host can do that.');
  assert.equal(rules.kick(room, 1, 0).error, 'There is no one else in that seat.');
  assert.equal(rules.kick(room, 1, 2).error, 'There is no one else in that seat.');
  room.phase = 'finished';
  assert.equal(rules.kick(room, 1, 1).error, 'The game is over: there is nobody to remove.');
  room.phase = 'lobby';
  const out = rules.kick(room, 1, 1);
  assert.deepEqual(out, { ok: true, userId: 2, replaced: false });
  assert.equal(seatOf(room, 2), -1);
  assert.ok(isHuman(room.seats[0]));
});

test('seeded random numbers repeat, and pickOne stays inside the list', () => {
  const a = seeded(7);
  const b = seeded(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  const rng = seeded(1);
  for (let i = 0; i < 50; i++) assert.ok(['x', 'y', 'z'].includes(pickOne(['x', 'y', 'z'], rng)));
});

test('drawUnused never repeats until everything has been drawn, then starts again', () => {
  const rng = seeded(3);
  const used = [];
  const first = [drawUnused(['a', 'b', 'c'], used, rng), drawUnused(['a', 'b', 'c'], used, rng), drawUnused(['a', 'b', 'c'], used, rng)];
  assert.deepEqual([...first].sort(), ['a', 'b', 'c']);
  const fourth = drawUnused(['a', 'b', 'c'], used, rng);
  assert.deepEqual(used, [fourth], 'the memory was cleared and now holds only the new draw');
});

test('a person who leaves a finished game leaves a gone marker, which play-again clears', () => {
  const gone = createSeatRules({ isMidGame: (room) => room.phase === 'playing', finishedSeat: goneSeat });
  const room = { hostId: 1, phase: 'finished', nextBot: 1, seats: [{ kind: 'human', id: 1, name: 'Ann' }, { kind: 'human', id: 2, name: 'Bob' }, { kind: 'bot', id: 'bot:1', name: 'Hazel' }] };
  assert.deepEqual(gone.removeHuman(room, 1, seeded(1), 0), { ok: true, empty: false, seat: 0, replaced: false });
  assert.deepEqual(room.seats[0], { kind: 'gone', name: 'Ann' });
  assert.equal(isGone(room.seats[0]), true);
  assert.equal(isHuman(room.seats[0]), false, 'a gone marker is not a person');
  assert.equal(room.hostId, 2);
  assert.equal(gone.kick(room, 2, 0, seeded(1), 0).ok, false, 'there is nobody in that seat to remove');
  freeGoneSeats(room);
  assert.equal(room.seats[0], null);
  assert.equal(room.seats[1].id, 2, 'the others keep their seats');
});

test('computer players are named without regard to capitals, like people', () => {
  const room = { hostId: 1, phase: 'lobby', nextBot: 1, seats: [{ kind: 'human', id: 1, name: 'hazel' }, { kind: 'human', id: 2, name: 'COMPUTER' }, null, null] };
  const first = rules.newBot(room);
  assert.notEqual(first.name.toLowerCase(), 'hazel', 'the first list name is taken, whatever its capitals');
  const bots = createSeatRules({ isMidGame: () => false, botNames: ['hazel'] });
  assert.equal(bots.newBot(room).name, 'Computer 2', 'the fallback is numbered past the person called COMPUTER');
  assert.equal(nextBotName(['Otis', 'computer', 'COMPUTER 2'], ['Otis']), 'Computer 3', 'past the list, Computer is numbered without regard to capitals');
  assert.equal(freeName(['Ann', 'ann (2)'], 'ANN', (w, n) => `${w} (${n})`), 'ANN (3)');
});

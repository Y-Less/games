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

test('addHuman refuses a full table in the lobby, and a game that is over', () => {
  const room = lobby();
  rules.fillWithBots(room, 1);
  assert.equal(rules.addHuman(room, 5, 'Eve').error, 'gameFull');
  room.phase = 'finished'; // not mid-game, so there is nothing left to take over
  assert.equal(rules.addHuman(room, 5, 'Eve').error, 'thatGameStarted');
});

// --- coming late to the invitation: a newcomer takes a computer player's seat rather than being turned away ---

test('somebody arriving at a game under way takes the first computer player seat, and everything in it', () => {
  const room = lobby();
  rules.fillWithBots(room, 1);
  Object.assign(room.seats[1], { score: 12, hand: ['7H'], ai: 'steady' });
  room.phase = 'playing';
  assert.deepEqual(rules.addHuman(room, 5, 'Eve'), { ok: true, seat: 1, tookOver: 'Hazel' });
  assert.deepEqual(room.seats[1], { kind: 'human', id: 5, name: 'Eve', score: 12, hand: ['7H'] }, 'the hand and the score stay; the AI goes');
  assert.ok(isBot(room.seats[2]), 'and only the first computer player is taken over');
  assert.equal(seatOf(room, 5), 1);
});

test('a newcomer may go by the name the computer player was using, there being no clash once it has gone', () => {
  const room = lobby();
  rules.fillWithBots(room, 1);
  room.phase = 'playing';
  assert.equal(rules.addHuman(room, 5, 'Hazel').seat, 1);
  assert.equal(room.seats[1].name, 'Hazel', 'the Hazel they are replacing is gone');
  assert.equal(rules.addHuman(room, 6, 'Hazel').seat, 2);
  assert.equal(room.seats[2].name, 'Hazel (2)', 'but the next one has to make way for them');
});

test('a game under way with nobody but people in it has no seat to take', () => {
  const room = lobby();
  rules.addHuman(room, 2, 'Bob');
  rules.addHuman(room, 3, 'Cat');
  room.phase = 'playing';
  assert.equal(rules.addHuman(room, 5, 'Eve').error, 'gameFull');
  assert.deepEqual(rules.addHuman(room, 2, 'Bob'), { ok: true, seat: 1 }, 'and somebody already playing just comes back');
});

// A seated game keeps what is on the table by seat index (the hands, the pegs, the scores), so getting your own seat
// back is how you get your own cards back.  Cheat's tests play that through for real.
test('coming back puts you in your own seat, which is where your cards still are', () => {
  const room = lobby();
  rules.addHuman(room, 2, 'Bob');
  rules.addBot(room, 1); // seat 2, which the host filled and is nobody's stand-in
  room.phase = 'playing';
  assert.equal(rules.removeHuman(room, 2, Math.random).replaced, true);
  assert.deepEqual(room.seats.map((s) => s?.stoodInFor), [undefined, 2, undefined]);

  assert.equal(rules.addHuman(room, 9, 'Zoe').seat, 2, "a stranger takes the host's seat, not the one kept for Bob");
  assert.deepEqual(rules.addHuman(room, 2, 'Bob'), { ok: true, seat: 1, tookOver: 'Otis' }, 'so Bob gets his own seat back');
  assert.equal(room.seats[1].stoodInFor, undefined, 'and it is nobody else’s stand-in any more');
  assert.equal(rules.addHuman(room, 8, 'Yan').error, 'gameFull', 'with every seat held by a person there is nothing left to take');
});

test('handOver is given the person, the seat and the computer player, and says what to store', () => {
  const seen = [];
  const own = createSeatRules({
    isMidGame: (room) => room.phase === 'playing',
    handOver: (room, person, seat, bot) => {
      seen.push({ person: { ...person }, seat, bot: { ...bot } });
      return { ...person, cameLate: true };
    },
  });
  const room = lobby();
  own.fillWithBots(room, 1);
  room.seats[1].ai = 'steady';
  room.phase = 'playing';
  own.addHuman(room, 5, 'Eve');
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].person, { kind: 'human', id: 5, name: 'Eve' }, 'the AI is already off it');
  assert.equal(seen[0].seat, 1);
  assert.deepEqual(seen[0].bot, { kind: 'bot', id: 'bot:1', name: 'Hazel', ai: 'steady' }, 'and the computer player is there as it was');
  assert.equal(room.seats[1].cameLate, true, 'what it returns is what sits there');
});

test('only the host changes the lobby, and only in the lobby', () => {
  const room = lobby();
  rules.addHuman(room, 2, 'Bob');
  assert.equal(rules.addBot(room, 2).error, 'hostOnly');
  assert.deepEqual(rules.addBot(room, 1), { ok: true, seat: 2 });
  assert.ok(isBot(room.seats[2]));
  assert.equal(rules.removeBot(room, 1, 2).ok, true);
  assert.equal(room.seats[2], null);
  room.phase = 'playing';
  assert.equal(rules.addBot(room, 1).error, 'settingsBeforeStart');
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
  assert.equal(rules.removeHuman(room, 99).error, 'notInGame');
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
  assert.equal(rules.kick(room, 2, 0).error, 'hostOnly');
  assert.equal(rules.kick(room, 1, 0).error, 'nobodyElseInSeat');
  assert.equal(rules.kick(room, 1, 2).error, 'nobodyElseInSeat');
  room.phase = 'finished';
  assert.equal(rules.kick(room, 1, 1).error, 'gameOverNobodyToRemove');
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

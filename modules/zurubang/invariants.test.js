// What must be true of a Zurubang room after every single move, checked over whole seeded games between computer
// players.  These are the tests that catch the bugs the readable ones never will: a card that is in two places at
// once, a hand that has grown, a score that does not match the scoreboard, a game that never ends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { playGame } from './arena.js';
import { CARDS } from './cards.js';
import { HAND_SIZE, SEATS, statsPlayers } from './game.js';
import { POSITIONS } from './duel.js';

/** Every pairing worth checking, including each AI against itself. */
const PAIRINGS = [
  ['standard', 'standard'],
  ['standard', 'sharp'],
  ['sharp', 'sharp'],
  ['sharp', 'hasardeur'],
  ['hasardeur', 'random'],
  ['random', 'standard'],
];
const SEEDS = 12;

/**
 * Everything that must be true of a room as it stands.  It is given every state of every game, so it has to say
 * exactly what went wrong rather than merely that something did.
 */
function check(room, where) {
  const everywhere = [...room.hands.flat(), ...room.stacks.flat(), ...room.graveyard, ...(room.duel ? room.duel.placed.flat().filter(Boolean) : [])];

  // Every card in the deck is in exactly one place: a hand, a stack, the graveyard, or the battlefield.
  assert.equal(everywhere.length, CARDS.length, `${where}: ${everywhere.length} cards instead of ${CARDS.length}`);
  const once = new Set(everywhere);
  assert.equal(once.size, everywhere.length, `${where}: a card is in two places at once`);

  // A hand is never more than five, and is only ever short while the duel it emptied is still on the table.
  for (let seat = 0; seat < SEATS; seat++) {
    assert.ok(room.hands[seat].length <= HAND_SIZE, `${where}: seat ${seat} holds ${room.hands[seat].length} cards`);
    if (room.hands[seat].length < HAND_SIZE) assert.ok(room.duel, `${where}: seat ${seat} is short of cards with no duel on`);
  }

  // Nobody is ever placed into somebody else's position, and a side never has more than five down.
  if (room.duel) {
    for (const row of room.duel.placed) assert.equal(row.length, POSITIONS, `${where}: a side has ${row.length} positions`);
    assert.ok(room.duel.at <= POSITIONS, `${where}: the duel is at position ${room.duel.at}`);
  }

  // The score on a seat is the sum of what the scoreboard says that seat has been given.
  const totals = [0, 0];
  for (const round of room.history) for (const [seat, points] of Object.entries(round.deltas)) totals[seat] += points;
  for (let seat = 0; seat < SEATS; seat++) assert.equal(room.seats[seat].score, totals[seat], `${where}: seat ${seat}'s score and its scoreboard disagree`);

  // The counters never run ahead of themselves.  Only the duels are bounded by each other: a fight is counted the
  // moment it is won, and the duel it belongs to is not counted until it is banked, so the two are not comparable
  // while one is still on the table.
  for (const seat of room.seats) {
    assert.ok(seat.stats.duelsWon <= seat.stats.duelsFought, `${where}: more duels won than fought`);
    for (const [key, value] of Object.entries(seat.stats)) assert.ok(Number.isInteger(value) && value >= 0, `${where}: ${key} is ${value}`);
  }
}

test('every card is in exactly one place after every move of every game', () => {
  let states = 0;
  for (const ais of PAIRINGS) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      playGame({
        ais,
        seed,
        watch: (room) => {
          states += 1;
          check(room, `${ais.join(' v ')} seed ${seed} in ${room.phase}`);
        },
      });
    }
  }
  assert.ok(states > 2000, `only ${states} states were checked, which is too few to mean anything`);
});

test('a game between computer players always reaches an end, whichever two of them are playing', () => {
  for (const ais of PAIRINGS) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { room, scores } = playGame({ ais, seed });
      assert.equal(room.phase, 'finished', `${ais.join(' v ')} seed ${seed}`);
      assert.ok(scores[room.winner] >= room.target, `${ais.join(' v ')} seed ${seed}: the winner is short of the target`);
      assert.equal(room.seats.filter((seat) => seat.score >= room.target).length >= 1, true);
    }
  }
});

test('a game played twice from the same seed is the same game both times', () => {
  const once = playGame({ ais: ['sharp', 'standard'], seed: 42 });
  const twice = playGame({ ais: ['sharp', 'standard'], seed: 42 });
  assert.deepEqual(once.scores, twice.scores);
  assert.equal(once.moves, twice.moves);
  assert.deepEqual(JSON.parse(JSON.stringify(once.room.history)), JSON.parse(JSON.stringify(twice.room.history)));
});

test('a finished room survives being saved and read back without changing', () => {
  const { room } = playGame({ ais: ['standard', 'sharp'], seed: 9 });
  const copy = JSON.parse(JSON.stringify(room));
  assert.deepEqual(copy, JSON.parse(JSON.stringify(room)));
  check(copy, 'after a round trip through JSON');
});

test('the statistics a finished game reports are only ever about people', () => {
  const { room } = playGame({ ais: ['standard', 'sharp'], seed: 4 });
  // The bench turns both seats into computer players, so a game it plays reports nobody at all.
  assert.deepEqual(statsPlayers(room), []);
});

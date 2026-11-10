// The drawing order: every pair exactly as often as asked for, and nobody drawing three turns running.  Both are
// checked over every table size the game allows and every number of rounds, with a lot of seeds, because the order is
// shuffled and a rule that holds for one shuffle is not a rule.
//
// A turn is one pair drawing; a round is every pair having drawn once, which is the whole circle; a rotation is one
// step of the circle method, in which everybody is paired off at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from '../../shared/random.js';
import { circle, pairings, restful } from './pairings.js';
import { ROUNDS, MAX_PLAYERS, MIN_PLAYERS } from './game.js';

/** The players of a table of `n`, as the account ids 1..n. */
const table = (n) => Array.from({ length: n }, (_, i) => i + 1);
/** A pair as a key, whichever way round it is. */
const key = (pair) => [...pair].sort((a, b) => a - b).join('-');

test('the circle pairs everybody with everybody, once each, and nobody twice in one rotation', () => {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    const rotations = circle(table(n));
    const seen = rotations.flat().map(key);
    assert.equal(new Set(seen).size, seen.length, `${n} players: no pair twice`);
    assert.equal(seen.length, (n * (n - 1)) / 2, `${n} players: every pair`);
    for (const pairs of rotations) {
      const ids = pairs.flat();
      assert.equal(new Set(ids).size, ids.length, `${n} players: nobody is in one rotation twice`);
    }
  }
});

test('a game plays every pair the number of times the host asked for', () => {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    for (let rounds = ROUNDS.min; rounds <= ROUNDS.max; rounds++) {
      const turns = pairings(table(n), rounds, seeded(n * 100 + rounds));
      assert.equal(turns.length, ((n * (n - 1)) / 2) * rounds, `${n} players, ${rounds} rounds: the number of turns`);
      const counts = new Map();
      for (const pair of turns) counts.set(key(pair), (counts.get(key(pair)) ?? 0) + 1);
      assert.equal(counts.size, (n * (n - 1)) / 2, `${n} players: every pair appears`);
      for (const [pair, times] of counts) assert.equal(times, rounds, `${n} players: ${pair} appears ${rounds} times`);
    }
  }
});

test('everybody draws the same number of times', () => {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    const turns = pairings(table(n), 1, seeded(n));
    const drawn = new Map(table(n).map((id) => [id, 0]));
    for (const pair of turns) for (const id of pair) drawn.set(id, drawn.get(id) + 1);
    for (const [id, times] of drawn) assert.equal(times, n - 1, `${n} players: ${id} draws against each of the others`);
  }
});

test('nobody ever draws three turns running, whatever the table, the rounds or the shuffle', () => {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    for (let rounds = ROUNDS.min; rounds <= ROUNDS.max; rounds++) {
      for (let seed = 1; seed <= 40; seed++) {
        const turns = pairings(table(n), rounds, seeded(seed));
        assert.ok(restful(turns), `${n} players, ${rounds} rounds, seed ${seed}: somebody drew three times running`);
      }
    }
  }
});

test('two in a row does happen, so the rule is doing something rather than nothing', () => {
  let twice = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const turns = pairings(table(4), 2, seeded(seed));
    for (let i = 0; i + 1 < turns.length; i++) if (turns[i].some((id) => turns[i + 1].includes(id))) twice++;
  }
  assert.ok(twice > 0, 'a player drawing in two turns running is allowed, and does come up');
});

test('the same seed gives the same order, and different seeds give different ones', () => {
  const one = pairings(table(5), 2, seeded(3));
  assert.deepEqual(pairings(table(5), 2, seeded(3)), one, 'a seed replays the order');
  const orders = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(pairings(table(5), 1, seeded(i + 1)))));
  assert.ok(orders.size > 1, 'the order is not always the same');
});

test('a table of three, whose rotations are one pair each, still nobody draws three running', () => {
  for (let rounds = ROUNDS.min; rounds <= ROUNDS.max; rounds++) {
    for (let seed = 1; seed <= 100; seed++) {
      const turns = pairings(table(3), rounds, seeded(seed));
      assert.equal(turns.length, 3 * rounds);
      assert.ok(restful(turns), `three players, ${rounds} rounds, seed ${seed}`);
    }
  }
});

test('the two sides of a pair are not always the same way round', () => {
  const firsts = new Set();
  for (let seed = 1; seed <= 30; seed++) for (const pair of pairings(table(4), 1, seeded(seed))) firsts.add(pair[0]);
  assert.ok(firsts.size > 1, 'neither player of a pair is always the one named first');
});

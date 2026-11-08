// The drawing order: every pair exactly as often as asked for, and nobody drawing three rounds running.  Both are
// checked over every table size the game allows and every number of cycles, with a lot of seeds, because the order is
// shuffled and a rule that holds for one shuffle is not a rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from '../../shared/random.js';
import { circle, pairings, restful } from './pairings.js';
import { CYCLES, MAX_PLAYERS, MIN_PLAYERS } from './game.js';

/** The players of a table of `n`, as the account ids 1..n. */
const table = (n) => Array.from({ length: n }, (_, i) => i + 1);
/** A pair as a key, whichever way round it is. */
const key = (pair) => [...pair].sort((a, b) => a - b).join('-');

test('the circle pairs everybody with everybody, once each, and nobody twice in one turn', () => {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    const turns = circle(table(n));
    const seen = turns.flat().map(key);
    assert.equal(new Set(seen).size, seen.length, `${n} players: no pair twice`);
    assert.equal(seen.length, (n * (n - 1)) / 2, `${n} players: every pair`);
    for (const pairs of turns) {
      const ids = pairs.flat();
      assert.equal(new Set(ids).size, ids.length, `${n} players: nobody is in one turn twice`);
    }
  }
});

test('a game plays every pair the number of times the host asked for', () => {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    for (let cycles = CYCLES.min; cycles <= CYCLES.max; cycles++) {
      const rounds = pairings(table(n), cycles, seeded(n * 100 + cycles));
      assert.equal(rounds.length, ((n * (n - 1)) / 2) * cycles, `${n} players, ${cycles} cycles: the number of rounds`);
      const counts = new Map();
      for (const pair of rounds) counts.set(key(pair), (counts.get(key(pair)) ?? 0) + 1);
      assert.equal(counts.size, (n * (n - 1)) / 2, `${n} players: every pair appears`);
      for (const [pair, times] of counts) assert.equal(times, cycles, `${n} players: ${pair} appears ${cycles} times`);
    }
  }
});

test('everybody draws the same number of times', () => {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    const rounds = pairings(table(n), 1, seeded(n));
    const drawn = new Map(table(n).map((id) => [id, 0]));
    for (const pair of rounds) for (const id of pair) drawn.set(id, drawn.get(id) + 1);
    for (const [id, times] of drawn) assert.equal(times, n - 1, `${n} players: ${id} draws against each of the others`);
  }
});

test('nobody ever draws three rounds running, whatever the table, the cycles or the shuffle', () => {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    for (let cycles = CYCLES.min; cycles <= CYCLES.max; cycles++) {
      for (let seed = 1; seed <= 40; seed++) {
        const rounds = pairings(table(n), cycles, seeded(seed));
        assert.ok(restful(rounds), `${n} players, ${cycles} cycles, seed ${seed}: somebody drew three times running`);
      }
    }
  }
});

test('two in a row does happen, so the rule is doing something rather than nothing', () => {
  let twice = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const rounds = pairings(table(4), 2, seeded(seed));
    for (let i = 0; i + 1 < rounds.length; i++) if (rounds[i].some((id) => rounds[i + 1].includes(id))) twice++;
  }
  assert.ok(twice > 0, 'a player drawing in two rounds running is allowed, and does come up');
});

test('the same seed gives the same order, and different seeds give different ones', () => {
  const one = pairings(table(5), 2, seeded(3));
  assert.deepEqual(pairings(table(5), 2, seeded(3)), one, 'a seed replays the order');
  const orders = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(pairings(table(5), 1, seeded(i + 1)))));
  assert.ok(orders.size > 1, 'the order is not always the same');
});

test('a table of three, whose turns are one pair each, still nobody draws three running', () => {
  for (let cycles = CYCLES.min; cycles <= CYCLES.max; cycles++) {
    for (let seed = 1; seed <= 100; seed++) {
      const rounds = pairings(table(3), cycles, seeded(seed));
      assert.equal(rounds.length, 3 * cycles);
      assert.ok(restful(rounds), `three players, ${cycles} cycles, seed ${seed}`);
    }
  }
});

test('the two sides of a pair are not always the same way round', () => {
  const firsts = new Set();
  for (let seed = 1; seed <= 30; seed++) for (const pair of pairings(table(4), 1, seeded(seed))) firsts.add(pair[0]);
  assert.ok(firsts.size > 1, 'neither player of a pair is always the one named first');
});

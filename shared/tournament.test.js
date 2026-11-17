// The arithmetic of a tournament: the table a game starts with, the rounds everybody plays, and the standings.
//
// What is asserted here is what shared/tournament.js promises in words — every combination exactly once, nobody at
// two tables at once, and nobody sitting out unless the numbers make them — rather than the particular pairs a
// particular method happens to produce.  The one exception is the six-person trap, which is there because it is the
// case that tells the two methods apart.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_HUMANS, MAX_ENTRANTS, checkTable, combinations, defaultTable, ranking, recordTable, schedule, tableCount, tableSize } from './tournament.js';

/** Everybody at every table of every round, as "a+b" strings, for counting how often a combination was played. */
const every = (rounds) => rounds.flat().map((table) => [...table].sort((a, b) => a - b).join('+'));
/** The ids, as a lobby of that many people would hold them. */
const people = (n) => Array.from({ length: n }, (_, i) => i + 1);

test('a table starts at two people, filled up to a normal game of whatever it is a tournament of', () => {
  // Hearts: a normal game is four, so two people play two computer players.
  assert.deepEqual(defaultTable({ min: 3, max: 7, fillTo: 4 }), { on: false, humans: DEFAULT_HUMANS, bots: 2 });
  // Cribbage: a normal game is two, so two people play each other and no computer player is added.
  assert.deepEqual(defaultTable({ min: 2, max: 3, fillTo: 2 }), { on: false, humans: 2, bots: 0 });
  // A game whose normal table is six still starts with two people: it is the computer players that make it up.
  const six = defaultTable({ min: 3, max: 8, fillTo: 6 });
  assert.equal(tableSize(six), 6);
  assert.equal(six.humans, 2);
  // A game that says nothing about a normal table gets the four everything else assumes.
  assert.equal(tableSize(defaultTable({ min: 2, max: 8 })), 4);
  // A normal table the game could not actually deal is brought inside what it allows.
  assert.equal(tableSize(defaultTable({ min: 5, max: 8, fillTo: 2 })), 5);
  assert.equal(tableSize(defaultTable({ min: 1, max: 3, fillTo: 9 })), 3);
  // Two people, whatever the game will settle for: a game that can be played by one is still played in pairs here,
  // and the table is simply the two of them.
  assert.deepEqual(defaultTable({ min: 1, max: 4, fillTo: 1 }), { on: false, humans: 2, bots: 0 });
  // Only a game that cannot seat two gets fewer: then everybody plays their own table.
  assert.deepEqual(defaultTable({ min: 1, max: 1, fillTo: 1 }), { on: false, humans: 1, bots: 0 });
});

test('a table must hold somebody, and as many as the game allows', () => {
  const limits = { min: 2, max: 4 };
  assert.deepEqual(checkTable({ humans: 2, bots: 2 }, limits), { ok: true });
  assert.deepEqual(checkTable({ humans: 4, bots: 0 }, limits), { ok: true });
  assert.deepEqual(checkTable({ humans: 0, bots: 4 }, limits), { ok: false, error: 'tournamentPeople', params: { max: MAX_ENTRANTS } });
  assert.deepEqual(checkTable({ humans: 2, bots: 3 }, limits), { ok: false, error: 'tournamentSize', params: { min: 2, max: 4 } });
  assert.deepEqual(checkTable({ humans: 1, bots: 0 }, limits), { ok: false, error: 'tournamentSize', params: { min: 2, max: 4 } });
  assert.deepEqual(checkTable({ humans: 2.5, bots: 1 }, limits), { ok: false, error: 'tournamentTable' });
  assert.deepEqual(checkTable({ humans: 2, bots: -1 }, limits), { ok: false, error: 'tournamentTable' });
});

test('the combinations of a list are every choice of that many, in the list order', () => {
  assert.deepEqual(combinations(['a', 'b', 'c'], 2), [['a', 'b'], ['a', 'c'], ['b', 'c']]);
  assert.deepEqual(combinations(['a', 'b', 'c'], 3), [['a', 'b', 'c']]);
  assert.deepEqual(combinations(['a', 'b'], 3), []);
  assert.equal(combinations(people(8), 3).length, 56);
});

test('in pairs, everybody meets everybody else exactly once', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, MAX_ENTRANTS]) {
    const rounds = schedule(people(n), 2);
    const played = every(rounds);
    const wanted = combinations(people(n), 2).map((pair) => pair.join('+'));
    assert.deepEqual([...played].sort(), [...wanted].sort(), `${n} people meet each other once`);
    assert.equal(played.length, new Set(played).size, `${n} people never meet twice`);
  }
});

test('nobody is at two tables at once, and only an odd number makes anybody sit out', () => {
  for (const n of [4, 6, 8, 10]) {
    for (const round of schedule(people(n), 2)) {
      const sitting = round.flat();
      assert.equal(sitting.length, new Set(sitting).size, 'nobody is at two tables of one round');
      assert.equal(sitting.length, n, 'with an even number nobody sits out');
    }
  }
  for (const n of [3, 5, 7, 9]) {
    const satOut = [];
    for (const round of schedule(people(n), 2)) {
      const sitting = round.flat();
      assert.equal(sitting.length, new Set(sitting).size, 'nobody is at two tables of one round');
      assert.equal(sitting.length, n - 1, 'exactly one person sits out of each round');
      satOut.push(people(n).find((id) => !sitting.includes(id)));
    }
    // Sitting out goes round the table: nobody misses two rounds while somebody else misses none.
    assert.deepEqual([...satOut].sort((a, b) => a - b), people(n), `each of ${n} sits out exactly once`);
  }
});

test('six people are the case that greedy pairing cannot do', () => {
  // 1-2, 3-4, 5-6 and then 1-3, 2-4 leaves five and six, who have already met.  The rounds this draws up do not,
  // which is the whole reason the ring is rotated rather than the pairs being taken as they come.
  const rounds = schedule(people(6), 2);
  assert.equal(rounds.length, 5, 'six people play five rounds');
  assert.deepEqual([...every(rounds)].sort(), [...combinations(people(6), 2).map((p) => p.join('+'))].sort());
});

test('in threes or more, every combination is played once and no round seats anybody twice', () => {
  for (const [n, perTable] of [[5, 3], [6, 3], [7, 4]]) {
    const rounds = schedule(people(n), perTable);
    const played = every(rounds);
    assert.deepEqual([...played].sort(), [...combinations(people(n), perTable).map((c) => c.join('+'))].sort());
    for (const round of rounds) {
      const sitting = round.flat();
      assert.equal(sitting.length, new Set(sitting).size, 'nobody is at two tables of one round');
    }
  }
});

test('fewer people than a table holds play one table together', () => {
  assert.deepEqual(schedule(people(3), 4), [[[1, 2, 3]]]);
  assert.deepEqual(schedule(people(1), 2), [[[1]]]);
  assert.deepEqual(schedule([], 2), []);
  // One person to a table is a tournament against the computer players: everybody plays once.
  assert.deepEqual(schedule(people(3), 1), [[[1], [2], [3]]]);
});

test('the lobby is told how many tables the evening is, before anybody starts it', () => {
  for (const [n, perTable] of [[2, 2], [5, 2], [6, 2], [16, 2], [6, 3], [7, 4], [3, 4]]) {
    assert.equal(tableCount(n, perTable), schedule(people(n), perTable).flat().length, `${n} people, ${perTable} to a table`);
  }
  assert.equal(tableCount(0, 2), 0);
});

test('a finished table is counted for the people at it, and never for a computer player', () => {
  const standings = {};
  // What a game answers for the statistics, which is what a finished table is read from: people only.
  recordTable(standings, [
    { userId: 7, outcome: 'win', placement: 1, score: 12 },
    { userId: 8, outcome: 'loss', placement: 2, score: 5 },
  ]);
  recordTable(standings, [{ userId: 7, outcome: 'loss', placement: 3, score: 1 }]);
  assert.deepEqual(standings[7], { played: 2, wins: 1, places: 4, score: 13 });
  assert.deepEqual(standings[8], { played: 1, wins: 0, places: 2, score: 5 });
  assert.equal(standings['bot:1'], undefined);
  // A table that was abandoned reports nothing, and nothing is counted.
  assert.deepEqual(recordTable(standings, undefined), standings);
});

test('the standings are read out by tables won, then by where they came', () => {
  const standings = {
    1: { played: 2, wins: 2, places: 2, score: 0 },
    2: { played: 2, wins: 1, places: 3, score: 0 },
    3: { played: 2, wins: 1, places: 3, score: 0 },
    4: { played: 2, wins: 0, places: 4, score: 0 },
  };
  const named = [1, 2, 3, 4].map((id) => ({ id, name: `P${id}` }));
  const order = ranking(standings, named);
  assert.deepEqual(order.map((row) => row.id), [1, 2, 3, 4]);
  // Two people level on everything share a place, and the one after them is not promoted.
  assert.deepEqual(order.map((row) => row.place), [1, 2, 2, 4]);
  assert.equal(order[0].name, 'P1');
});

test('somebody who has not played yet is last, not first', () => {
  const order = ranking({ 2: { played: 1, wins: 0, places: 2, score: 0 } }, [{ id: 1, name: 'Ann' }, { id: 2, name: 'Bo' }]);
  assert.deepEqual(order.map((row) => row.id), [2, 1]);
  assert.deepEqual(order[1], { id: 1, name: 'Ann', played: 0, wins: 0, places: 0, score: 0, place: 2 });
});

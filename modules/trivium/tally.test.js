// The counters Trivium keeps about each player: what counts as quick, as dead centre, as on the edge, and as a round
// nobody could fault.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SNAP_MS, isCentre, isEdge, pointsFor } from './scoring.js';
import { STAT_KEYS, newCounters, statsExtras, tallyQuestion, tallyRound } from './tally.js';

/** A player with nothing counted yet. */
const player = (id) => ({ id, ...newCounters() });
/** One answer, as closeQuestion hands them over. */
const given = (id, right, at, x = 0.3, y = 0.3) => ({ id, right, at, x, y });

test('a fresh set of counters is every key at zero', () => {
  const counters = newCounters();
  assert.deepEqual(Object.keys(counters).sort(), [...STAT_KEYS].sort());
  assert.ok(Object.values(counters).every((n) => n === 0));
});

test('a right answer counts, and the first one counts twice over', () => {
  const people = [player(1), player(2), player(3)];
  const by = (id) => people.find((p) => p.id === id);
  tallyQuestion([given(1, true, 300), given(2, true, 4000), given(3, false, 5000)], [], by);
  assert.equal(by(1).rightAnswers, 1);
  assert.equal(by(1).fastestRight, 1);
  assert.equal(by(1).snapAnswers, 1, 'under half a second');
  assert.equal(by(2).fastestRight, 0);
  assert.equal(by(2).snapAnswers, 0);
  assert.equal(by(2).lastButRight, 0, 'the last answer was somebody else');
  assert.equal(by(3).rightAnswers, 0);
  assert.equal(by(3).answersGiven, 1);
  assert.equal(by(1).soleRight, 0, 'two people had it');
});

test('being the only one right, and being last but right, want somebody to have been beaten', () => {
  const alone = [player(1), player(2)];
  tallyQuestion([given(1, false, 100), given(2, true, 9000)], [], (id) => alone.find((p) => p.id === id));
  assert.equal(alone[1].soleRight, 1);
  assert.equal(alone[1].lastButRight, 1);

  const only = [player(1)];
  tallyQuestion([given(1, true, 100)], [], () => only[0]);
  assert.equal(only[0].soleRight, 0, 'there was nobody else in it');
  assert.equal(only[0].lastButRight, 0);
});

test('where the finger landed is counted too', () => {
  const people = [player(1), player(2), player(3)];
  const by = (id) => people.find((p) => p.id === id);
  tallyQuestion([given(1, true, 100, 0.5, 0.5), given(2, false, 200, 0.01, 0.4), given(3, true, 300, 0.3, 0.3)], [], by);
  assert.equal(by(1).bullseyes, 1);
  assert.equal(by(1).edgeClicks, 0);
  assert.equal(by(2).edgeClicks, 1);
  assert.equal(by(2).bullseyes, 0);
  assert.equal(by(3).bullseyes, 0);
  assert.equal(by(3).edgeClicks, 0);
  assert.ok(isCentre(0.5, 0.5) && !isCentre(0.5, 0.9));
  assert.ok(isEdge(0.99, 0.5) && isEdge(0.5, 0) && !isEdge(0.4, 0.6));
});

test('letting a question go by counts, and nothing else does', () => {
  const people = [player(1), player(2)];
  tallyQuestion([given(1, true, 100)], [2], (id) => people.find((p) => p.id === id));
  assert.equal(people[1].questionsMissed, 1);
  assert.equal(people[1].answersGiven, 0);
  assert.equal(people[1].rightAnswers, 0);
});

test('a question counts as faced whether or not it was answered', () => {
  const people = [player(1), player(2), player(3)];
  const by = (id) => people.find((p) => p.id === id);
  tallyQuestion([given(1, true, 100), given(2, false, 200)], [3], by);
  assert.deepEqual(people.map((p) => p.questionsFaced), [1, 1, 1]);
  tallyQuestion([given(1, false, 100)], [2, 3], by);
  assert.deepEqual(people.map((p) => p.questionsFaced), [2, 2, 2]);
  assert.deepEqual(people.map((p) => p.answersGiven), [2, 1, 0], 'which is not the same as answering them');
});

test('a round keeps the best score and notices a clean sweep and a blank', () => {
  const people = [player(1), player(2), player(3)];
  tallyRound(people, { 1: 23, 2: 5, 3: 0 }, { 1: 3, 2: 1 }, 3);
  assert.equal(people[0].bestRound, 23);
  assert.deepEqual(people.map((p) => p.perfectRounds), [1, 0, 0]);
  assert.deepEqual(people.map((p) => p.blankRounds), [0, 0, 1], 'the one who got none of the category right');
  tallyRound(people, { 1: 8, 2: 30, 3: 0 }, { 1: 1, 2: 3 }, 3);
  assert.equal(people[0].bestRound, 23, 'the best round stands');
  assert.equal(people[1].bestRound, 30);
  assert.equal(people[2].blankRounds, 2);
  tallyRound(people, {}, {}, 0);
  assert.deepEqual(people.map((p) => p.perfectRounds), [1, 1, 0], 'a round with no questions is no clean sweep');
  assert.equal(people[2].blankRounds, 2, 'nor a blank');
});

test('the counters that go to the statistics are the ones the game declares', () => {
  const one = player(1);
  one.rightAnswers = 4;
  assert.deepEqual(Object.keys(statsExtras(one)).sort(), [...STAT_KEYS].sort());
  assert.equal(statsExtras(one).rightAnswers, 4);
  assert.equal(statsExtras({}).bullseyes, 0, 'a counter a saved room never had reads as none');
});

test('the points a question is worth', () => {
  assert.equal(pointsFor(false, 0), 0);
  assert.equal(pointsFor(true, 0), 10);
  assert.equal(pointsFor(true, 1), 9);
  assert.equal(pointsFor(true, 4), 6);
  assert.equal(pointsFor(true, 5), 5, 'the sixth right answer gets nothing extra');
  assert.equal(pointsFor(true, 50), 5);
  assert.equal(SNAP_MS, 500);
});

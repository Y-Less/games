import test from 'node:test';
import assert from 'node:assert/strict';
import { fullDeck, shuffle } from '../../shared/cards.js';
import { pipValue, scoreHand, scorePlay } from './scoring.js';

const hand = (cards, starter, options) => scoreHand(cards, starter, options);
const count = (result, kind) => result.items.filter((i) => i.kind === kind).length;

test('card values: aces are 1 and court cards 10', () => {
  assert.deepEqual(['AS', '2H', '9D', '10C', 'JS', 'QH', 'KD'].map(pipValue), [1, 2, 9, 10, 10, 10, 10]);
});

test('the perfect 29 hand, and 28 when the jack does not match the starter', () => {
  const perfect = hand(['5H', '5D', '5S', 'JC'], '5C');
  assert.equal(perfect.total, 29);
  assert.equal(count(perfect, 'fifteen'), 8);
  assert.equal(count(perfect, 'pair'), 6);
  assert.equal(count(perfect, 'nobs'), 1);
  assert.equal(hand(['5D', '5S', '5C', 'JD'], '5H').total, 28);
});

test('well known hands: 24, double runs, triple run and double double run', () => {
  assert.equal(hand(['7H', '7D', '8H', '8D'], '9S').total, 24);

  const double = hand(['4H', '4D', '5S', '6C'], 'KD');
  assert.equal(double.total, 14);
  assert.equal(count(double, 'run'), 2);
  assert.equal(count(double, 'pair'), 1);
  assert.equal(count(double, 'fifteen'), 3);

  assert.equal(hand(['3H', '3D', '3S', '4C'], '5D').total, 21);
  assert.equal(hand(['3H', '3D', '4S', '4C'], '5D').total, 20);
  assert.equal(hand(['3H', '4D', '5S', '6C'], '7D').total, 5 + 4, 'a run of five and 3+4+... fifteens counted: 3+5+7 and 4+5+6');
});

test('a hand of nothing scores 0, and the impossible scores never occur', () => {
  assert.equal(hand(['KH', '8D', '6S', '2C'], 'JD').total, 0);
  assert.equal(hand(['KH', '8D', '6S', '2C'], 'JD').items.length, 0);

  const impossible = new Set([19, 25, 26, 27]);
  const seen = new Set();
  let seed = 7;
  const rng = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (let i = 0; i < 40000; i++) {
    const [a, b, c, d, starter] = shuffle(fullDeck(), rng);
    const { total } = hand([a, b, c, d], starter);
    assert.ok(!impossible.has(total), `a hand cannot score ${total}`);
    assert.ok(total <= 29);
    seen.add(total);
  }
  assert.ok(seen.has(0) && seen.has(4) && seen.has(24), 'common scores do occur');
});

test('runs: aces are low, runs of four and five, no wrapping', () => {
  assert.equal(count(hand(['AH', '2D', '3S', '9C'], 'KD'), 'run'), 1);
  assert.equal(hand(['QH', 'KD', 'AS', '9C'], '2D').items.filter((i) => i.kind === 'run').length, 0, 'queen king ace is not a run');
  const four = hand(['6H', '7D', '8S', '9C'], 'KD');
  assert.equal(four.items.find((i) => i.kind === 'run').points, 4);
  const five = hand(['6H', '7D', '8S', '9C'], '10D');
  assert.deepEqual(five.items.filter((i) => i.kind === 'run').map((i) => i.points), [5]);
});

test('flushes: four in hand, five with the starter; the crib needs all five', () => {
  assert.equal(count(hand(['2H', '4H', '6H', '9H'], 'KD'), 'flush'), 1);
  assert.equal(hand(['2H', '4H', '6H', '9H'], 'KD').items.find((i) => i.kind === 'flush').points, 4);
  assert.equal(hand(['2H', '4H', '6H', '9H'], 'KH').items.find((i) => i.kind === 'flush').points, 5);
  assert.equal(count(hand(['2H', '4H', '6H', '9H'], 'KD', { crib: true }), 'flush'), 0, 'four of a suit in the crib is nothing');
  assert.equal(hand(['2H', '4H', '6H', '9H'], 'KH', { crib: true }).items.find((i) => i.kind === 'flush').points, 5);
  assert.equal(hand(['2H', '4H', '6S', '9H'], 'KH').items.some((i) => i.kind === 'flush'), false, 'a mixed hand is not a flush');
});

test('nobs: a jack in the hand matching the starter suit, never the starter itself', () => {
  assert.equal(count(hand(['JH', '2C', '4D', '8S'], '9H'), 'nobs'), 1);
  assert.equal(count(hand(['JH', '2C', '4D', '8S'], '9C'), 'nobs'), 0);
  assert.equal(count(hand(['QH', '2C', '4D', '8S'], 'JH'), 'nobs'), 0, 'a jack as starter is not nobs');
  assert.equal(count(hand(['JH', '2C', '4D', '8S'], '9H', { crib: true }), 'nobs'), 1, 'nobs counts in the crib too');
});

test('the items add up to the total and every fifteen really is fifteen', () => {
  let seed = 3;
  const rng = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (let i = 0; i < 500; i++) {
    const [a, b, c, d, starter] = shuffle(fullDeck(), rng);
    const result = hand([a, b, c, d], starter);
    assert.equal(result.total, result.items.reduce((sum, item) => sum + item.points, 0));
    for (const item of result.items.filter((x) => x.kind === 'fifteen')) assert.equal(item.cards.reduce((sum, card) => sum + pipValue(card), 0), 15);
  }
});

test('the play: fifteen, thirty-one and the count', () => {
  const fifteen = scorePlay(['10H', '5D']);
  assert.equal(fifteen.count, 15);
  assert.deepEqual(fifteen.items.map((i) => i.kind), ['fifteen']);
  const thirtyOne = scorePlay(['10H', 'KD', 'QS', 'AC']);
  assert.equal(thirtyOne.count, 31);
  assert.equal(thirtyOne.total, 2);
  assert.equal(scorePlay(['9H']).total, 0);
});

test('the play: pairs, pair royal and double pair royal', () => {
  assert.equal(scorePlay(['4H', '9D', '9S']).total, 2);
  assert.equal(scorePlay(['3H', '9D', '9S', '9C']).total, 6);
  assert.equal(scorePlay(['2H', '2D', '2S', '2C']).total, 12);
  assert.equal(scorePlay(['KH', 'QD', 'QS']).total, 2, 'pairs are by rank, so K and Q do not pair');
  assert.equal(scorePlay(['KH', 'KD']).total, 2);
  assert.equal(scorePlay(['9H', '9D', '2S', '9C']).total, 0, 'an interloper breaks the pair');
  assert.equal(scorePlay(['5H', '5D', '5S']).total, 6 + 2, 'pair royal making fifteen');
});

test('the play: runs in any order, longest run only, broken by an interloper', () => {
  assert.equal(scorePlay(['6H', '4D', '5S']).total, 3 + 2, 'run of three in any order, and the count is 15');
  assert.equal(scorePlay(['2H', '3D', '4S', '5C']).total, 4);
  assert.equal(scorePlay(['9H', '3D', '5S', '4C']).total, 3, 'the last three, 3 5 4, are a run');
  assert.equal(scorePlay(['3D', '5S', '4C']).total, 3);
  assert.equal(scorePlay(['4H', '5D', '9S', '6C']).total, 0, 'a nine in the middle breaks it');
  assert.equal(scorePlay(['3H', '4D', '4S', '5C']).total, 0, 'a pair in the middle is no run');
  assert.equal(scorePlay(['8H', '4D', '5S', '6C']).total, 3, 'earlier cards outside the run do not matter');
  assert.equal(scorePlay(['QH', 'KD', 'AS']).total, 0, 'no wrapping round the ace');
  assert.equal(scorePlay(['AH', '2D', '3S']).total, 3);
  assert.equal(scorePlay(['7H', '8D', '9S', '10C', 'JD']).total, 5);
});

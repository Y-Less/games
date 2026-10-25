import test from 'node:test';
import assert from 'node:assert/strict';
import { cardName, fullDeck, isCard, isRed, rankOf, rankValue, shuffle, sortHand, suitOf } from './cards.js';

test('a full deck has 52 distinct valid cards', () => {
  const deck = fullDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck).size, 52);
  assert.ok(deck.every(isCard));
});

test('card helpers', () => {
  assert.equal(rankOf('10H'), '10');
  assert.equal(suitOf('10H'), 'H');
  assert.equal(rankValue('2C'), 2);
  assert.equal(rankValue('AS'), 14);
  assert.equal(rankValue('10D'), 10);
  assert.equal(isRed('JD'), true);
  assert.equal(isRed('JS'), false);
  assert.equal(cardName('QS'), 'queen of spades');
  assert.equal(cardName('7D'), '7 of diamonds');
  assert.equal(isCard('1S'), false);
  assert.equal(isCard('QX'), false);
  assert.equal(isCard(12), false);
});

test('shuffle keeps every card, leaves the input alone, and is repeatable with a seeded rng', () => {
  const deck = fullDeck();
  const seeded = (seed) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const a = shuffle(deck, seeded(1));
  assert.deepEqual([...a].sort(), [...deck].sort());
  assert.deepEqual(deck, fullDeck());
  assert.deepEqual(shuffle(deck, seeded(1)), a);
  assert.notDeepEqual(a, deck);
});

test('sortHand groups suits and orders ranks low to high', () => {
  assert.deepEqual(sortHand(['AH', '2C', 'KS', '9C', 'JD']), ['2C', '9C', 'JD', 'KS', 'AH']);
});

// Tests for the shared trick-taking helpers (shared/tricks.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bestCard, followCards, nextSeat, trickWinnerSeat, turnAfterPlay } from './tricks.js';

test('the next seat goes round the table', () => {
  assert.equal(nextSeat(0, 4), 1);
  assert.equal(nextSeat(3, 4), 0);
  assert.equal(nextSeat(0, 1), 0);
});

test('after a play the turn passes on, and after the last card of a trick it belongs to nobody', () => {
  assert.equal(turnAfterPlay(1, 2, 4), 2);
  assert.equal(turnAfterPlay(3, 4, 4), null);
  assert.equal(turnAfterPlay(0, 3, 3), null);
});

test('following suit keeps only cards of the suit led, in hand order', () => {
  assert.deepEqual(followCards(['2H', 'KS', '9H', 'AC'], 'H'), ['2H', '9H']);
  assert.deepEqual(followCards(['2H', 'KS'], 'D'), []);
  assert.deepEqual(followCards(['JK1', '2H'], 'H'), ['2H']);
});

test('the best card is the highest of the suit led when there is no trump', () => {
  assert.equal(bestCard(['10H', 'AS', 'KH', '2H']), 'KH');
  assert.equal(bestCard(['10H', 'AS', 'KH', '2H'], null), 'KH');
  assert.equal(bestCard(['5C']), '5C');
});

test('a trump beats the suit led, and the highest trump wins', () => {
  assert.equal(bestCard(['AH', '2S', 'KH'], 'S'), '2S');
  assert.equal(bestCard(['AH', '2S', '9S', 'KH'], 'S'), '9S');
  assert.equal(bestCard(['AH', 'KH'], 'S'), 'AH');
  assert.equal(bestCard(['2S', 'AH'], 'S'), '2S');
});

test('the trick winner is the seat that played the best card, for a trick still in progress too', () => {
  const trick = [
    { seat: 2, card: '4D' },
    { seat: 3, card: 'JD' },
    { seat: 0, card: 'AH' },
  ];
  assert.equal(trickWinnerSeat(trick), 3);
  assert.equal(trickWinnerSeat(trick, 'H'), 0);
  assert.equal(trickWinnerSeat(trick.slice(0, 1)), 2);
});

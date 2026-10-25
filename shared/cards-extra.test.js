// More card helper edge cases (see cards.test.js for the basics).
import test from 'node:test';
import assert from 'node:assert/strict';
import { RANKS, SUITS, cardName, fullDeck, isCard, isRed, rankOf, rankValue, shuffle, sortHand, suitOf } from './cards.js';

test('sortHand: the whole deck comes out grouped C, D, S, H and low to high within each suit', () => {
  const sorted = sortHand(fullDeck());
  assert.equal(sorted.length, 52);
  assert.deepEqual(sorted.map(suitOf), ['C', 'D', 'S', 'H'].flatMap((s) => Array(13).fill(s)));
  for (let i = 0; i < 52; i += 13) {
    const values = sorted.slice(i, i + 13).map(rankValue);
    assert.deepEqual(values, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  }
});

test('sortHand gives the same order whatever order the hand came in', () => {
  const expected = sortHand(fullDeck());
  const seeded = (seed) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let seed = 1; seed <= 20; seed++) assert.deepEqual(sortHand(shuffle(fullDeck(), seeded(seed))), expected);
});

test('sortHand does not change its input, and sorting twice changes nothing', () => {
  const hand = ['AH', '2C', 'KS', '9C', 'JD'];
  const copy = [...hand];
  const once = sortHand(hand);
  assert.deepEqual(hand, copy);
  assert.notEqual(once, hand);
  assert.deepEqual(sortHand(once), once);
});

test('sortHand is stable for equal cards and copes with tiny hands', () => {
  assert.deepEqual(sortHand([]), []);
  assert.deepEqual(sortHand(['7S']), ['7S']);
  assert.deepEqual(sortHand(['9H', '9H', '2C', '9H']), ['2C', '9H', '9H', '9H'], 'duplicates (from several decks) stay together');
  // Stability: objects that compare equal keep their order. Strings that compare equal are identical, so check with a
  // wrapper that carries an identity but sorts by the card text.
  const a = new String('5D');
  const b = new String('5D');
  const out = sortHand([b, a]);
  assert.equal(out[0], b);
  assert.equal(out[1], a);
});

test('sortHand puts cards of an unknown suit first rather than losing them', () => {
  assert.deepEqual(sortHand(['AH', '3X', '2C']), ['3X', '2C', 'AH']);
});

test('shuffle with a degenerate rng that always says 0 gives a fixed permutation of the same cards', () => {
  assert.deepEqual(shuffle([1, 2, 3, 4], () => 0), [2, 3, 4, 1]);
  const deck = fullDeck();
  const out = shuffle(deck, () => 0);
  assert.deepEqual([...out].sort(), [...deck].sort());
  assert.deepEqual(shuffle(deck, () => 0), out, 'and the same one each time');
});

test('shuffle with an rng that always says almost 1 leaves the order alone', () => {
  const deck = fullDeck();
  assert.deepEqual(shuffle(deck, () => 0.9999999999), deck);
});

test('shuffle asks the rng once per card except the last, and copes with 0 or 1 cards', () => {
  let calls = 0;
  const rng = () => (calls++, 0.5);
  assert.deepEqual(shuffle([], rng), []);
  assert.deepEqual(shuffle(['AS'], rng), ['AS']);
  assert.equal(calls, 0);
  shuffle(fullDeck(), rng);
  assert.equal(calls, 51);
});

test('shuffle accepts any iterable, returns a new array and keeps duplicates', () => {
  const set = new Set(['AS', 'KS', 'QS']);
  const out = shuffle(set, () => 0.3);
  assert.ok(Array.isArray(out));
  assert.deepEqual([...out].sort(), ['AS', 'KS', 'QS']);
  const dupes = ['2C', '2C', '3D'];
  assert.deepEqual([...shuffle(dupes)].sort(), ['2C', '2C', '3D']);
  const original = [1, 2, 3];
  assert.notEqual(shuffle(original), original);
});

test('the default shuffle really shuffles: every position sees many different cards', () => {
  const firsts = new Set();
  for (let i = 0; i < 200; i++) firsts.add(shuffle(fullDeck())[0]);
  assert.ok(firsts.size > 30, `only ${firsts.size} different top cards in 200 shuffles`);
});

test('shuffle is not biased towards leaving cards where they were (a rough check with a seeded rng)', () => {
  const seeded = (seed) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const rng = seeded(7);
  const counts = [0, 0, 0];
  for (let i = 0; i < 3000; i++) counts[shuffle(['a', 'b', 'c'], rng).indexOf('a')]++;
  for (const count of counts) assert.ok(count > 800 && count < 1200, `positions of "a": ${counts}`);
});

test('isCard accepts exactly the 52 cards of the deck and nothing else', () => {
  const deck = new Set(fullDeck());
  const candidates = [];
  for (const rank of [...RANKS, '1', '0', '11', '1O', 'j', 'X', '']) for (const suit of [...SUITS, 'c', 'X', '']) candidates.push(rank + suit);
  for (const card of candidates) assert.equal(isCard(card), deck.has(card), JSON.stringify(card));
  for (const bad of [null, undefined, 10, ['AS'], { toString: () => 'AS' }, ' AS', 'AS ', 'AS\n', '10', 'S', '10HH', '010H', '2C2C']) assert.equal(isCard(bad), false, JSON.stringify(bad));
});

test('rank and suit helpers agree for every card', () => {
  for (const card of fullDeck()) {
    assert.equal(rankOf(card) + suitOf(card), card);
    assert.ok(rankValue(card) >= 2 && rankValue(card) <= 14);
    assert.equal(isRed(card), suitOf(card) === 'D' || suitOf(card) === 'H');
    assert.match(cardName(card), /^(\d+|jack|queen|king|ace) of (clubs|diamonds|hearts|spades)$/);
  }
  assert.equal(cardName('10C'), '10 of clubs');
  assert.equal(cardName('AD'), 'ace of diamonds');
  assert.equal(cardName('KH'), 'king of hearts');
  assert.equal(cardName('JS'), 'jack of spades');
});

test('a full deck is in suit order then rank order, and is a new array each time', () => {
  const deck = fullDeck();
  assert.deepEqual(deck.slice(0, 3), ['2C', '3C', '4C']);
  assert.equal(deck[12], 'AC');
  assert.equal(deck[13], '2D');
  assert.notEqual(fullDeck(), deck);
  deck.pop();
  assert.equal(fullDeck().length, 52, 'changing one deck does not change the next');
});

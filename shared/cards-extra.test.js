// More card helper edge cases (see cards.test.js for the basics).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_ORDERS, DEFAULT_CARD_ORDER, RANKS, SUITS, cardName, fullDeck, isCard, isCardOrder, isRed, orderHand, rankOf, rankValue, shuffle, sortHand, suitOf } from './cards.js';

test('sortHand: the whole deck comes out grouped H, S, D, C and high to low within each suit', () => {
  const sorted = sortHand(fullDeck());
  assert.equal(sorted.length, 52);
  assert.deepEqual(sorted.map(suitOf), ['H', 'S', 'D', 'C'].flatMap((s) => Array(13).fill(s)));
  for (let i = 0; i < 52; i += 13) {
    const values = sorted.slice(i, i + 13).map(rankValue);
    assert.deepEqual(values, [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  }
});

// How a player has their own hand laid out (a profile setting; see src/cardOrder.js).  The cards a game deals are the
// same for everybody at the table, so none of this is anything a game decides.

test('the orders are the three there are, and the default is what every hand has always been', () => {
  assert.deepEqual(CARD_ORDERS, ['highLow', 'lowHigh', 'random']);
  assert.equal(DEFAULT_CARD_ORDER, 'highLow');
  for (const order of CARD_ORDERS) assert.equal(isCardOrder(order), true);
  for (const nonsense of ['', 'shuffled', 'HIGHLOW', null, 3, ['lowHigh'], undefined]) assert.equal(isCardOrder(nonsense), false, JSON.stringify(nonsense));
  assert.deepEqual(orderHand(fullDeck()), sortHand(fullDeck()), 'and asking for nothing in particular gives it');
});

test('lowest first turns each suit round and leaves the suits where they were', () => {
  const high = orderHand(fullDeck(), { order: 'highLow' });
  const low = orderHand(fullDeck(), { order: 'lowHigh' });
  assert.deepEqual(low.map(suitOf), high.map(suitOf), 'the same suits in the same places');
  for (let i = 0; i < 52; i += 13) {
    assert.deepEqual(low.slice(i, i + 13).map(rankValue), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  }
});

test('the trump suit comes first whichever way round the ranks go', () => {
  const hand = ['AH', '2C', 'KS', '9C', 'JD'];
  for (const order of CARD_ORDERS.filter((o) => o !== 'random')) {
    assert.equal(suitOf(orderHand(hand, { order, trump: 'C' })[0]), 'C', order);
  }
});

test('no order at all: a hand is scattered, differently at each table, and the same every time at one', () => {
  const hand = sortHand(['AH', '5S', '2C', '10H', 'KD', 'JK1', '7S']);
  const here = orderHand(hand, { order: 'random', salt: 'boss-aware-you' });
  assert.deepEqual([...here].sort(), [...hand].sort(), 'the same cards');
  assert.notDeepEqual(here, hand, 'but not in the order they were dealt');
  assert.deepEqual(orderHand(hand, { order: 'random', salt: 'boss-aware-you' }), here, 'and the same on every redraw');
  assert.notDeepEqual(orderHand(hand, { order: 'random', salt: 'other-code-here' }), here, 'another table, another order');
});

test('no order at all stays put as the hand changes, which is the whole difficulty with it', () => {
  // A hand that rearranged itself every time a card left it would be unplayable, so each card's place is its own.
  const hand = sortHand(fullDeck().slice(0, 13));
  const salt = 'boss-aware-you';
  const before = orderHand(hand, { order: 'random', salt });
  for (const gone of hand) {
    const after = orderHand(hand.filter((card) => card !== gone), { order: 'random', salt });
    assert.deepEqual(after, before.filter((card) => card !== gone), `playing ${gone} moved the others`);
  }
});

test('two of the same card always tie, so a hand of several packs can be drawn by position', () => {
  // Cheat deals more than one pack, and tells the copies apart by where they are in the hand.
  for (const order of CARD_ORDERS) {
    const doubled = ['AH', 'AH', '2C', '2C'];
    assert.deepEqual(orderHand(doubled, { order, salt: 'x' }).filter((card) => card === 'AH').length, 2, order);
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
  assert.deepEqual(sortHand(['9H', '9H', '2C', '9H']), ['9H', '9H', '9H', '2C'], 'duplicates (from several decks) stay together');
  // Stability: objects that compare equal keep their order.  Strings that compare equal are identical, so check with a
  // wrapper that carries an identity but sorts by the card text.
  const a = new String('5D');
  const b = new String('5D');
  const out = sortHand([b, a]);
  assert.equal(out[0], b);
  assert.equal(out[1], a);
});

test('sortHand puts cards of an unknown suit first rather than losing them', () => {
  assert.deepEqual(sortHand(['AH', '3X', '2C']), ['3X', 'AH', '2C']);
});

test('sortHand puts the trump suit first, then hearts, spades, diamonds and clubs, whatever the trump is', () => {
  const hand = ['2C', 'AD', 'KS', '3H', 'JK1', 'QD', '9C'];
  assert.deepEqual(sortHand(hand), ['3H', 'KS', 'AD', 'QD', '9C', '2C', 'JK1']);
  assert.deepEqual(sortHand(hand, 'C'), ['9C', '2C', '3H', 'KS', 'AD', 'QD', 'JK1']);
  assert.deepEqual(sortHand(hand, 'D'), ['AD', 'QD', '3H', 'KS', '9C', '2C', 'JK1']);
  assert.deepEqual(sortHand(hand, 'H'), sortHand(hand), 'hearts as trumps is already first');
  assert.deepEqual(sortHand(hand, null), sortHand(hand), 'no trumps');
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
  assert.deepEqual([...shuffle(dupes, Math.random)].sort(), ['2C', '2C', '3D']);
  const original = [1, 2, 3];
  assert.notEqual(shuffle(original, Math.random), original);
});

test('the default shuffle really shuffles: every position sees many different cards', () => {
  const firsts = new Set();
  for (let i = 0; i < 200; i++) firsts.add(shuffle(fullDeck(), Math.random)[0]);
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

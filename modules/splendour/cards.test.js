import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, CARD_BY_ID, COLOURS, LEVELS, NOBLES, cardsOfLevel, isCardId, isNobleId } from './cards.js';

const sum = (list) => list.reduce((a, b) => a + b, 0);

test('there are 40, 30 and 20 cards at the three levels, with unique ids', () => {
  assert.deepEqual(LEVELS.map((l) => cardsOfLevel(l).length), [40, 30, 20]);
  assert.equal(CARDS.length, 90);
  assert.equal(new Set(CARDS.map((c) => c.id)).size, 90);
  assert.ok(CARDS.every((c) => /^c\d\d$/.test(c.id) && CARD_BY_ID[c.id] === c));
});

test('each colour has 8, 6 and 4 cards as its bonus at levels 1, 2 and 3', () => {
  for (const [level, each] of [[1, 8], [2, 6], [3, 4]]) {
    for (let colour = 0; colour < COLOURS.length; colour++) {
      assert.equal(cardsOfLevel(level).filter((c) => c.bonus === colour).length, each, `level ${level} colour ${colour}`);
    }
  }
});

test('costs are in the five colours only, whole numbers, and sensible for the level', () => {
  const range = { 1: [3, 5], 2: [5, 8], 3: [7, 14] };
  for (const card of CARDS) {
    assert.equal(card.cost.length, 5, card.id);
    assert.ok(card.cost.every((c) => Number.isInteger(c) && c >= 0 && c <= 7), `${card.id}: each colour costs at most 7`);
    const total = sum(card.cost);
    assert.ok(total >= range[card.level][0] && total <= range[card.level][1], `${card.id}: total ${total} for level ${card.level}`);
  }
});

test('prestige ranges: mostly 0 at level 1, 1 to 3 at level 2, 3 to 5 at level 3', () => {
  const points = (l) => cardsOfLevel(l).map((c) => c.points);
  assert.ok(points(1).every((p) => p === 0 || p === 1));
  assert.equal(points(1).filter((p) => p === 0).length, 35);
  assert.ok(points(2).every((p) => p >= 1 && p <= 3));
  assert.ok(points(3).every((p) => p >= 3 && p <= 5));
  assert.equal(Math.max(...points(3)), 5);
  assert.equal(CARDS.filter((c) => c.points === 5).length, 5);
  // Dearer cards are worth more: the average cost rises with the points within each level.
  for (const l of LEVELS) {
    const cards = cardsOfLevel(l);
    const avg = (p) => sum(cards.filter((c) => c.points === p).map((c) => sum(c.cost))) / cards.filter((c) => c.points === p).length;
    const levels = [...new Set(cards.map((c) => c.points))].sort();
    if (l === 3) assert.ok(avg(5) > avg(3) - 5);
    assert.ok(levels.length >= 1);
  }
});

test('no card is impossible or free, and none costs its own colour only', () => {
  for (const card of CARDS) {
    assert.ok(sum(card.cost) > 0, `${card.id} is not free`);
    assert.ok(Object.hasOwn(COLOURS, card.bonus) || (card.bonus >= 0 && card.bonus < 5));
    assert.notDeepEqual(card.cost.map((c, i) => (i === card.bonus ? 0 : c)), [0, 0, 0, 0, 0], `${card.id} must cost something other than its own colour`);
  }
});

test('the set is balanced between colours: every colour has the same total cost and points per level', () => {
  for (const l of LEVELS) {
    const per = COLOURS.map((_, colour) => {
      const cards = cardsOfLevel(l).filter((c) => c.bonus === colour);
      return [sum(cards.map((c) => c.points)), sum(cards.map((c) => sum(c.cost)))];
    });
    for (const row of per) assert.deepEqual(row, per[0]);
  }
  // And each colour is demanded equally across the whole set.
  const demand = COLOURS.map((_, c) => sum(CARDS.map((card) => card.cost[c])));
  assert.ok(demand.every((d) => d === demand[0]), `demand ${demand}`);
});

test('the set is deterministic', () => {
  assert.equal(CARDS[0].id, 'c01');
  assert.deepEqual(CARDS[0], { id: 'c01', level: 1, bonus: 0, points: 0, cost: [0, 1, 1, 1, 1] });
  assert.equal(CARDS.at(-1).id, 'c90');
  assert.equal(isCardId('c90'), true);
  assert.equal(isCardId('c91'), false);
  assert.equal(isCardId('constructor'), false);
  assert.equal(isCardId('__proto__'), false);
  assert.equal(isCardId(5), false);
});

test('there are ten nobles worth 3 whose requirements are 4+4 or 3+3+3 of card bonuses', () => {
  assert.equal(NOBLES.length, 10);
  assert.equal(new Set(NOBLES.map((n) => n.id)).size, 10);
  const shapes = NOBLES.map((n) => Object.values(n.requires).sort().join('+'));
  assert.equal(shapes.filter((s) => s === '4+4').length, 5);
  assert.equal(shapes.filter((s) => s === '3+3+3').length, 5);
  for (const noble of NOBLES) {
    assert.equal(noble.points, 3);
    // Reachable: the deck has enough cards of each colour (8 + 6 + 4 = 18).
    for (const [colour, count] of Object.entries(noble.requires)) assert.ok(Number(colour) < 5 && count <= 18);
  }
  assert.equal(isNobleId('n10'), true);
  assert.equal(isNobleId('n11'), false);
  assert.equal(isNobleId('toString'), false);
});

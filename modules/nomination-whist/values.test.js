// The bid-value table: what each nomination is worth for the exact cards of a small hand (or the estimate of a bigger one),
// the table position and the earlier nominations, learned from simulated deals in which every nomination was tried.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fullDeck, shuffle } from '../../shared/cards.js';
import { lutv } from './ai/lut.js';
import { descriptorOf, keyBuckets, valueCell } from './sim/value-features.js';
import { bestByValue, expectedPoints, valueModel, valueRow } from './sim/value-model.js';
import { mulberry32 } from './sim/rng.js';

const model = valueModel(false);
const skip = !model;
const first = (players) => Array(players).fill(null);
const nominating = (hand, trump, players, over = {}) => ({ hand, trump, players, allowed: Array.from({ length: hand.length + 1 }, (_, n) => n), nominations: first(players), missPoints: true, ...over });

test('a hand is described by its exact cards when it is small, and the trump suit does not matter, only trump or not', () => {
  assert.equal(descriptorOf('2C', 'H'), 0);
  assert.equal(descriptorOf('AC', 'H'), 12);
  assert.equal(descriptorOf('2H', 'H'), 13, 'a trump of the same rank is a different card');
  assert.equal(descriptorOf('AH', 'H'), 25);
  assert.equal(descriptorOf('JK1', 'H'), 26);
  assert.equal(descriptorOf('JK2', null), 26, 'the two Jokers are alike');
  assert.equal(keyBuckets(1), 27);
  assert.equal(keyBuckets(2), 27 * 27 * 2);
  assert.equal(keyBuckets(5), 21);
  const a = valueCell(nominating(['QH', '2C'], 'H', 4));
  assert.deepEqual(valueCell(nominating(['2C', 'QH'], 'H', 4)), a, 'the order of the cards does not matter');
  assert.deepEqual(valueCell(nominating(['QS', '2D'], 'S', 4)), a, 'nor does which suit is trumps');
  assert.notDeepEqual(valueCell(nominating(['QH', '2H'], 'H', 4)), a, 'two trumps are a different hand');
  assert.notEqual(valueCell(nominating(['9C', '3C'], null, 4)).key, valueCell(nominating(['9C', '3D'], null, 4)).key, 'sharing a suit is part of a pair');
  assert.equal(valueCell(nominating(['QH', '2C'], null, 4)).regime, 0);
  assert.equal(valueCell(nominating(['QH', '2C'], 'H', 4)).regime, 1);
});

test('the table covers 3 to 7 players, trumps or none, and every number of cards, with sensible numbers', { skip }, () => {
  assert.equal(model.kind, 'bidding-values');
  for (let players = 3; players <= 7; players++) {
    assert.equal(model.players[players].length, 2, 'no trumps, trumps');
    for (const regime of [0, 1]) {
      for (let cards = 1; cards <= 7; cards++) {
        let rows = 0;
        for (const byKey of model.players[players][regime][cards]) {
          for (const byUnclaimed of byKey ?? []) {
            for (const row of byUnclaimed ?? []) {
              if (!row) continue;
              rows++;
              assert.equal(row.length, cards + 1, 'one entry per number that can be nominated');
              for (const entry of row) {
                if (!entry) continue;
                assert.ok(entry[0] >= 0 && entry[0] <= 1, `a chance: ${entry[0]}`);
                assert.ok(entry[1] >= 0 && entry[1] <= cards, `tricks on a miss: ${entry[1]}`);
              }
            }
          }
        }
        assert.ok(rows > 0, `${players} players, regime ${regime}, ${cards} cards has some data`);
      }
    }
  }
});

test('the queen of trumps with a weak second card is worth nominating 1, not 0, at 7 players, first to nominate', { skip }, () => {
  for (const second of ['2C', '9D', '5S']) {
    const ctx = nominating(['QH', second], 'H', 7);
    const row = valueRow(model, ctx);
    assert.ok(row, `a row for QH + ${second}`);
    assert.equal(bestByValue(model, ctx), 1, `QH + ${second}`);
    assert.ok(expectedPoints(row[1], 1) > expectedPoints(row[0], 0) + 3, 'nominating 0 and hoping to duck a queen of trumps is a poor bet');
  }
});

test('two trumps are worth more than one: with the queen and a low heart, nominate 2 rather than 1', { skip }, () => {
  assert.equal(bestByValue(model, nominating(['QH', '3H'], 'H', 7)), 2);
});

test('a weak hand nominates 0', { skip }, () => {
  assert.equal(bestByValue(model, nominating(['9C', '3D'], 'H', 7)), 0);
  assert.equal(bestByValue(model, nominating(['9C', '3D'], 'H', 4)), 0);
});

test('the dealer who may not nominate the number that totals the tricks gets the best of the others, using the second card too', { skip }, () => {
  // 7 players, hearts, 2 cards: the first six nominated 0, so the dealer may not nominate 2
  const others = [0, 0, 0, 0, 0, 0, null];
  const strong = nominating(['KH', 'KS'], 'H', 7, { nominations: others, allowed: [0, 1] });
  assert.equal(bestByValue(model, strong), 1);
  // with 1 forbidden (others total 1) a king of trumps with a king of spades is better nominating 2 than 0
  const oneForbidden = nominating(['KH', 'KS'], 'H', 7, { nominations: [1, 0, 0, 0, 0, 0, null], allowed: [0, 2] });
  const row = valueRow(model, oneForbidden);
  assert.ok(row[2] && row[0], 'both numbers are valued');
  assert.equal(bestByValue(model, oneForbidden), expectedPoints(row[2], 2) > expectedPoints(row[0], 0) ? 2 : 0);
});

test('in a one-card round, 3 players, no trumps, the first to nominate (who leads) should nominate 1 whatever the card', { skip }, () => {
  for (const card of fullDeck()) {
    const ctx = nominating([card], null, 3);
    assert.equal(bestByValue(model, ctx), 1, card);
  }
});

test('only allowed numbers are ever chosen, and scoring a miss as nothing makes a high nomination less attractive', { skip }, () => {
  const rng = mulberry32(2);
  let chosen = 0;
  for (let i = 0; i < 600; i++) {
    const players = 3 + (i % 5);
    const cards = 1 + (i % 7);
    const hand = shuffle(fullDeck(), rng).slice(0, cards);
    const forbidden = i % 3 === 0 ? Math.floor(rng() * (cards + 1)) : -1;
    const allowed = Array.from({ length: cards + 1 }, (_, n) => n).filter((n) => n !== forbidden);
    const ctx = nominating(hand, i % 2 ? 'S' : null, players, { allowed, nominations: first(players).map((_, s) => (s < i % players ? Math.floor(rng() * (cards + 1)) : null)) });
    ctx.nominations[i % players] = null;
    ctx.seat = i % players;
    const bid = bestByValue(model, ctx);
    if (bid !== null) {
      chosen++;
      assert.ok(allowed.includes(bid));
    }
    assert.ok(allowed.includes(lutv.nominate({ ...ctx, rng })), 'the lookup AI always answers with an allowed number');
  }
  assert.ok(chosen > 300, `the table had an answer for most situations (${chosen})`);
  const row = valueRow(model, nominating(['QH', '3H'], 'H', 7));
  assert.ok(expectedPoints(row[2], 2, false) < expectedPoints(row[2], 2, true), 'a miss scoring nothing is worth less');
});

const jokerModel = valueModel(true);

test('the table for games with Jokers is its own file, and values a Joker as most of a trick', { skip: !jokerModel }, () => {
  assert.notEqual(jokerModel, model);
  assert.equal(jokerModel.trainedOn.jokers, true);
  assert.ok(!model.trainedOn.jokers);
  for (const joker of ['JK1', 'JK2']) {
    // leading a Joker in a 3-player one-card round almost always wins the trick, so nominate 1
    const ctx = nominating([joker], null, 3, { jokers: true });
    assert.equal(bestByValue(jokerModel, ctx), 1, joker);
    assert.ok(valueRow(jokerModel, ctx)[1][0] > 0.8, `${joker} led wins most of the time`);
  }
  // a Joker beside a high card makes a 2-card hand worth nominating 2 where the same hand with a deuce is not
  const withJoker = nominating(['JK1', 'AS'], 'H', 4, { jokers: true });
  const withDeuce = nominating(['2C', 'AS'], 'H', 4, { jokers: true });
  assert.ok(bestByValue(jokerModel, withJoker) > bestByValue(jokerModel, withDeuce), 'a Joker is worth more than a deuce');
});

test('a game with the Jokers is advised from the Jokers table and a game without from the other', { skip: !jokerModel }, () => {
  const hand = ['QH', '3H'];
  const base = nominating(hand, 'H', 4);
  assert.equal(lutv.nominate({ ...base, jokers: false, rng: () => 0.5 }), bestByValue(model, base));
  assert.equal(lutv.nominate({ ...base, jokers: true, rng: () => 0.5 }), bestByValue(jokerModel, base));
});

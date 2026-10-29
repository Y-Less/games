// The hand model: what it is shown of a hand, how the network is stored and read, and the examples it learns from.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lutv } from './ai/lut.js';
import { collectDeals } from './sim/hand-collect.js';
import { INPUTS, handFeatures } from './sim/hand-features.js';
import { BIDS, bestByHandModel, forward, handModel, modelFromJson, modelToJson, newModel, pointsOf, valuesFor } from './sim/hand-model.js';
import { mulberry32 } from './sim/rng.js';

const ctx = (hand, extra = {}) => ({ hand, trump: 'H', players: 4, nominations: [null, null, null, null], allowed: Array.from({ length: hand.length + 1 }, (_, n) => n), missPoints: true, ...extra });
const features = (hand, extra) => Array.from(handFeatures(ctx(hand, extra)));

test('the features are numbers, one per input, and the same hand always gives the same ones', () => {
  const f = features(['KH', '2C', '3D', '4S']);
  assert.equal(f.length, INPUTS);
  assert.ok(f.every(Number.isFinite));
  assert.deepEqual(features(['KH', '2C', '3D', '4S']), f);
  assert.deepEqual(features(['4S', '3D', '2C', 'KH']), f, 'the order of the cards does not matter');
});

test('every card changes the features: a lone king of trumps is told apart from other hands of the same estimate', () => {
  const loneKing = features(['KH', '2C', '3D', '4S']);
  assert.notDeepEqual(features(['QH', 'AC', '3D', '4S']), loneKing);
  assert.notDeepEqual(features(['KH', '2C', '3D', '5S']), loneKing, 'even a four against a five');
  assert.notDeepEqual(features(['KH', '2H', '3D', '4S']), loneKing, 'a second trump');
  assert.equal(loneKing[11], 1, 'the king of trumps has its own input');
  assert.equal(loneKing[0 + 14 - 2], 0, 'the ace of trumps is not held');
});

test('the other suits are interchangeable: swapping them changes nothing, but swapping trumps with them does', () => {
  const hand = ['KH', 'AC', 'QC', '5D', '9S'];
  const swapped = ['KH', 'AD', 'QD', '5S', '9C']; // the three other suits renamed
  assert.deepEqual(features(hand), features(swapped));
  assert.notDeepEqual(features(hand), features(['KC', 'AH', 'QH', '5D', '9S']));
});

test('the table position and the nominations so far are part of what the model sees', () => {
  const hand = ['KH', '2C', '3D', '4S'];
  const first = features(hand);
  const last = features(hand, { nominations: [2, 1, 0, null] });
  assert.notDeepEqual(first, last);
  assert.notDeepEqual(features(hand, { players: 5, nominations: [null, null, null, null, null] }), first);
});

test('a round without trumps has no trump features, and a Joker is counted', () => {
  const f = features(['KH', 'JK1', 'JK2'], { trump: null });
  assert.equal(f[11], 0, 'the king is an ordinary card now');
  assert.equal(f[13 + 11], 1);
  assert.equal(f[26], 1, 'both Jokers');
  assert.equal(f[30], 0);
});

test('a model survives being saved and read back, and a wrong file is refused', () => {
  const model = newModel(mulberry32(5));
  const back = modelFromJson(JSON.parse(JSON.stringify(modelToJson(model))));
  const x = handFeatures(ctx(['AH', 'KH', '2C', '3D']));
  const a = forward(model, x).y;
  const b = forward(back, x).y;
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-3, `output ${i}`);
  assert.equal(modelFromJson(null), null);
  assert.equal(modelFromJson({ ...modelToJson(model), inputs: INPUTS + 1 }), null);
  assert.equal(modelFromJson({ ...modelToJson(model), w1: [1, 2, 3] }), null);
});

test('values are given for each number up to the cards held, and the best allowed one is chosen', () => {
  const model = newModel(mulberry32(9));
  const context = ctx(['AH', 'KH', '2C']);
  const values = valuesFor(model, context);
  assert.equal(values.length, 4);
  assert.ok(values.every(Number.isFinite));
  const best = values.indexOf(Math.max(...values));
  assert.equal(bestByHandModel(model, context), best);
  const without = bestByHandModel(model, { ...context, allowed: [0, 1, 2, 3].filter((n) => n !== best) });
  assert.notEqual(without, best, 'the dealer\'s forbidden number is never chosen');
  assert.equal(bestByHandModel(model, { ...context, allowed: [] }), null);
  assert.equal(BIDS, 8);
});

test('points are the chance of a hit times 10 plus the number, plus the tricks taken on a miss if misses score', () => {
  const y = new Float32Array(2 * BIDS);
  y[2] = 0; // a 50% chance of hitting 2
  y[BIDS + 2] = 1.5;
  assert.equal(pointsOf(y, 2), 0.5 * 12 + 1.5);
  assert.equal(pointsOf(y, 2, false), 0.5 * 12);
  y[BIDS + 2] = -3; // tricks on a miss never go below nothing
  assert.equal(pointsOf(y, 2), 0.5 * 12);
});

test('the Statistician always nominates an allowed number, with a model or without one', () => {
  const rng = mulberry32(3);
  for (let i = 0; i < 200; i++) {
    const cards = 1 + Math.floor(rng() * 7);
    const deck = ['AH', 'KH', 'QH', 'JH', '10H', '9H', '8H', 'AC', 'KC', 'QC', '2D', '3D', '4S'];
    const hand = deck.sort(() => rng() - 0.5).slice(0, cards);
    const forbidden = Math.floor(rng() * (cards + 1)); // the dealer's number
    const allowed = Array.from({ length: cards + 1 }, (_, n) => n).filter((n) => n !== forbidden);
    const number = lutv.nominate({ ...ctx(hand), allowed, rng });
    assert.ok(allowed.includes(number), `${hand} -> ${number}`);
  }
});

test('collecting deals gives examples that line up: features, number nominated, tricks taken', () => {
  const out = collectDeals({ model: null, table: null, seed: 1, chunk: 0, size: 60, players: [3, 4] });
  assert.ok(out.n >= 60 * 3);
  assert.equal(out.x.length, out.n * INPUTS);
  assert.equal(out.bid.length, out.n);
  assert.equal(out.deals, 60);
  for (let k = 0; k < out.n; k++) {
    assert.ok(out.taken[k] <= 7 && out.bid[k] <= 7);
    assert.ok(out.explorer[k] === 0 || out.explorer[k] === 1);
  }
  assert.ok(out.explorer.some((e) => e === 1), 'one seat per deal is the random one');
  const again = collectDeals({ model: null, table: null, seed: 1, chunk: 0, size: 60, players: [3, 4] });
  assert.deepEqual(Array.from(again.bid), Array.from(out.bid), 'the same seed gives the same deals');
});

test('the shipped model nominates 1, not 0, for a lone king of trumps with three small cards in other suits', () => {
  const model = handModel(false);
  assert.ok(model, 'a trained model is shipped');
  for (const hand of [['KH', '2C', '3D', '4S'], ['KH', '5C', '7D', '9S'], ['KH', '6C', '3D', '8S']]) {
    for (const nominations of [[null, null, null, null], [1, null, null, null], [1, 1, 1, null], [2, 1, null, null]]) {
      const context = { ...ctx(hand), nominations };
      assert.equal(bestByHandModel(model, context), 1, `${hand} after ${JSON.stringify(nominations)}`);
    }
  }
});

// The spinner: wedges as wide as their categories, a floor under the thin ones, and a stop that always lands the
// pointer well inside the wedge the rules chose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from '../../shared/random.js';
import { CATEGORY_ORDER, MIN_SHARE, buildWheel, categoryAt, pickSpin, slices } from './wheel.js';

const SOURCES = { history: 400, music: 200, geography: 100, science: 1 };

test('a wedge is as wide as its category, with a floor under the thin ones', () => {
  const wheel = buildWheel(SOURCES);
  assert.deepEqual(wheel.map((w) => w.category), ['geography', 'history', 'music', 'science'], 'in the fixed order, and only the ones with questions');
  const weight = (name) => wheel.find((w) => w.category === name).weight;
  assert.equal(weight('history'), 400);
  assert.equal(weight('music'), 200);
  assert.ok(weight('science') > 1, 'a category with almost nothing is still worth aiming at');
  assert.ok(weight('science') >= 701 * MIN_SHARE);
  assert.ok(weight('history') > weight('music'), 'and the big ones are still bigger');
});

test('counts that say nothing give an even wheel of every category', () => {
  for (const nothing of [{}, undefined, { history: 0 }, { nonsense: 50 }]) {
    const wheel = buildWheel(nothing);
    assert.equal(wheel.length, CATEGORY_ORDER.length);
    assert.equal(new Set(wheel.map((w) => w.weight)).size, 1);
  }
});

test('the wedges fill the circle exactly once, in order', () => {
  const cut = slices(buildWheel(SOURCES));
  assert.equal(cut[0].from, 0);
  assert.equal(cut.at(-1).to, 360);
  for (const [index, slice] of cut.entries()) {
    assert.ok(slice.to > slice.from, `${slice.category} has width`);
    if (index) assert.equal(slice.from, cut[index - 1].to, 'no gaps and no overlaps');
  }
});

test('a spin stops with the pointer inside the wedge it chose, every time', () => {
  const wheel = buildWheel(SOURCES);
  const rng = seeded(99);
  for (let n = 0; n < 2000; n++) {
    const { category, angle } = pickSpin(wheel, rng);
    assert.ok(angle >= 0 && angle < 360, `angle ${angle}`);
    assert.equal(categoryAt(wheel, angle), category, 'the pointer is over the category the rules chose');
  }
});

test('a spin picks each category about as often as its wedge is wide', () => {
  const wheel = buildWheel({ history: 750, music: 250 });
  const rng = seeded(7);
  const seen = { history: 0, music: 0 };
  for (let n = 0; n < 4000; n++) seen[pickSpin(wheel, rng).category]++;
  assert.ok(Math.abs(seen.history / 4000 - 0.75) < 0.03, `history came up ${seen.history} times in 4000`);
  assert.ok(seen.music > 0 && seen.history > 0);
});

test('a wheel of one category is a circle that still works', () => {
  const wheel = buildWheel({ history: 10 });
  assert.equal(wheel.length, 1);
  const { category, angle } = pickSpin(wheel, seeded(1));
  assert.equal(category, 'history');
  assert.equal(categoryAt(wheel, angle), 'history');
});

test('the categories are the ten the question sources know, each listed once', () => {
  assert.equal(CATEGORY_ORDER.length, 10);
  assert.equal(new Set(CATEGORY_ORDER).size, CATEGORY_ORDER.length, 'no category is listed twice');
  assert.ok(CATEGORY_ORDER.every((name) => /^[a-z_]+$/.test(name)), 'and each is a canonical name');
});

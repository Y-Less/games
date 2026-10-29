import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKGROUND_ANIMATIONS, NAME_ANIMATIONS, isBackgroundAnimation, isNameAnimation } from './animations.js';

test('each list starts with a free, still choice and has unique ids and whole prices', () => {
  for (const list of [NAME_ANIMATIONS, BACKGROUND_ANIMATIONS]) {
    assert.deepEqual([list[0].id, list[0].price], ['none', 0]);
    assert.equal(new Set(list.map((a) => a.id)).size, list.length);
    for (const a of list) assert.ok(Number.isInteger(a.price) && a.price >= 0, a.id);
  }
});

test('only listed ids are animations, and an animation of one kind is not the other kind', () => {
  assert.equal(isNameAnimation('glow'), true);
  assert.equal(isBackgroundAnimation('glow'), false);
  assert.equal(isBackgroundAnimation('stars'), true);
  assert.equal(isNameAnimation('stars'), false);
  for (const bad of ['', 7, null, undefined, '__proto__', 'constructor']) {
    assert.equal(isNameAnimation(bad), false);
    assert.equal(isBackgroundAnimation(bad), false);
  }
});

test('Matrix is for sale under its short name, and Matrix B is kept but hidden, so it can be drawn but not bought', () => {
  assert.equal(BACKGROUND_ANIMATIONS.find((a) => a.id === 'matrix-a').name, 'Matrix');
  const b = BACKGROUND_ANIMATIONS.find((a) => a.id === 'matrix');
  assert.equal(b.hidden, true);
  assert.equal(isBackgroundAnimation('matrix'), true, 'still a valid animation');
  assert.equal(BACKGROUND_ANIMATIONS.filter((a) => a.hidden).length, 1, 'nothing else is hidden');
});

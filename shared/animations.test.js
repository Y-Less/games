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

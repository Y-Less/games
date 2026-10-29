// The avatar catalogue: every slot has options, the first is free, and anything unknown is made safe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR_SLOTS, DEFAULT_AVATAR, avatarItemId, avatarItems, avatarOption, isAvatarOption, normaliseAvatar } from './avatar.js';

test('every slot has unique options, a free first one, whole prices and colours where it is a colour slot', () => {
  for (const { slot, options } of AVATAR_SLOTS) {
    assert.ok(options.length >= 2, slot);
    assert.equal(new Set(options.map((o) => o.id)).size, options.length, slot);
    assert.equal(options[0].price, 0, `${slot} starts free`);
    for (const o of options) assert.ok(Number.isInteger(o.price) && o.price >= 0, `${slot}:${o.id}`);
    if (slot.endsWith('Colour') || slot === 'skin' || slot === 'backdrop') for (const o of options) assert.ok(o.colour, `${slot}:${o.id}`);
  }
  assert.deepEqual(Object.keys(DEFAULT_AVATAR), AVATAR_SLOTS.map((s) => s.slot));
});

test('options are looked up by slot and id, and nothing inherited counts', () => {
  assert.equal(avatarOption('hair', 'curly').name, 'Curly');
  assert.equal(isAvatarOption('hair', 'nonsense'), false);
  assert.equal(isAvatarOption('nonsense', 'curly'), false);
  assert.equal(isAvatarOption('hair', '__proto__'), false);
  assert.equal(isAvatarOption('__proto__', 'x'), false);
  assert.equal(isAvatarOption('hair', 7), false);
});

test('the shop gets one item per option', () => {
  const items = avatarItems();
  assert.equal(items.length, AVATAR_SLOTS.reduce((n, s) => n + s.options.length, 0));
  assert.deepEqual(items.find((i) => i.id === avatarItemId('hair', 'curly')), { id: 'av:hair:curly', slot: 'hair', option: 'curly', name: 'Hair: Curly', price: 150 });
});

test('normalising fills gaps and replaces unknown options with the default', () => {
  assert.deepEqual(normaliseAvatar(null), DEFAULT_AVATAR);
  assert.deepEqual(normaliseAvatar('text'), DEFAULT_AVATAR);
  const avatar = normaliseAvatar({ hair: 'curly', eyes: 'nonsense', extra: 1 });
  assert.equal(avatar.hair, 'curly');
  assert.equal(avatar.eyes, DEFAULT_AVATAR.eyes);
  assert.equal('extra' in avatar, false);
});

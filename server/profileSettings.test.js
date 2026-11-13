// The checks that turn whatever a client sends for a profile setting into the clean value that is stored
// (server/profileSettings.js).  The server is the only judge of these (the browser does not repeat the checks), so what
// is protected here is the judge: a valid choice comes back clean and nothing else is kept with it, and anything else
// at all is a 400 refusal with that setting's own code, never a crash and never a half-cleaned value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthError } from './errors.js';
import {
  BACKGROUND_PRESETS,
  CARD_BACK_PRESETS,
  EFFECT_INTENSITY,
  EFFECT_SPEED,
  cleanAvatar,
  cleanBackground,
  cleanBackgroundAnimation,
  cleanCardBack,
  cleanChoice,
  cleanEffectLevel,
  cleanMarkerColour,
  cleanNameStyle,
  cleanPlayAnimations,
} from './profileSettings.js';
import { AVATAR_SLOTS, DEFAULT_AVATAR } from '../shared/avatar.js';
import { BACKGROUND_ANIMATIONS, NAME_ANIMATIONS } from '../shared/animations.js';
import { NAME_STYLES } from '../shared/nameStyles.js';
import { assertNoPollution, garbageValues, prototypeNames, seeded } from '../shared/testkit.js';
import { pickOne } from '../shared/random.js';

/** Asserts that `fn` refuses with a 400 AuthError carrying `code`. */
function refuses(fn, code, what) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof AuthError, `${what}: threw ${error?.name}: ${error?.message} rather than a refusal`);
    assert.equal(error.message, code, what);
    assert.equal(error.status, 400, what);
    return true;
  }, what);
}

// Names every object inherits: a preset looked up carelessly would find these.
const INHERITED = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];

test('a preset background is one of the presets by name, and nothing inherited counts as one', () => {
  for (const value of Object.keys(BACKGROUND_PRESETS)) assert.deepEqual(cleanBackground({ type: 'preset', value }), { type: 'preset', value });
  for (const value of [...INHERITED, 'nope', '', 'Night', ' night', 5, null, undefined, ['night'], { toString: () => 'night' }]) {
    refuses(() => cleanBackground({ type: 'preset', value }), 'invalidBackground', `preset ${String(value)}`);
  }
});

test('a colour background is #rrggbb and is kept in lower case', () => {
  assert.deepEqual(cleanBackground({ type: 'colour', value: '#AABBCC' }), { type: 'colour', value: '#aabbcc' });
  assert.deepEqual(cleanBackground({ type: 'colour', value: '#012def' }), { type: 'colour', value: '#012def' });
  for (const value of ['#abc', 'aabbcc', '#aabbcc ', ' #aabbcc', '#aabbccdd', '#gggggg', 'red', '#aabbcc;background:url(x)', '#aabbcc\n', '', 0xaabbcc, null, ['#aabbcc']]) {
    refuses(() => cleanBackground({ type: 'colour', value }), 'invalidBackground', `colour ${JSON.stringify(value)}`);
  }
});

test('a gradient needs two colours; its angle is a whole number of degrees from 0 to 360, 160 when not given', () => {
  assert.deepEqual(cleanBackground({ type: 'gradient', from: '#AA0000', to: '#0000BB', angle: 45 }), { type: 'gradient', from: '#aa0000', to: '#0000bb', angle: 45 });
  const angleOf = (angle) => cleanBackground({ type: 'gradient', from: '#aa0000', to: '#0000bb', angle }).angle;
  assert.equal(angleOf(undefined), 160);
  assert.equal(angleOf(null), 160);
  assert.equal(angleOf(0), 0);
  assert.equal(angleOf(360), 360);
  assert.equal(angleOf(-20), 0, 'below the range is brought up to it');
  assert.equal(angleOf(9999), 360, 'above the range is brought down to it');
  assert.equal(angleOf(44.6), 45, 'a part degree is rounded');
  assert.equal(angleOf('90'), 90, 'a number written as text is still that number');
  for (const [label, value] of garbageValues()) {
    const angle = angleOf(value);
    assert.ok(Number.isInteger(angle) && angle >= 0 && angle <= 360, `angle ${label} became ${angle}`);
  }
  for (const [from, to] of [['#aa0000', undefined], [undefined, '#0000bb'], ['red', '#0000bb'], ['#aa0000', '#00b'], [1, 2], ['#aa0000', ['#0000bb']]]) {
    refuses(() => cleanBackground({ type: 'gradient', from, to, angle: 10 }), 'invalidBackground', `gradient ${String(from)} to ${String(to)}`);
  }
});

test('an uploaded background is named exactly as the upload route names one, and no other file can be', () => {
  for (const file of ['bg-1-0123456789ab.png', 'bg-42-abcdef012345.jpg', 'bg-100000-ffffffffffff.webp']) {
    assert.deepEqual(cleanBackground({ type: 'image', file }), { type: 'image', file });
  }
  for (const file of [
    'cb-1-0123456789ab.png', // a card back is not a background
    'bg-1-0123456789ab.gif',
    'bg-1-0123456789ab.svg',
    'bg-1-0123456789AB.png',
    'bg-1-0123456789a.png',
    'bg-1-0123456789abc.png',
    'bg--0123456789ab.png',
    'bg-x-0123456789ab.png',
    '../bg-1-0123456789ab.png',
    'bg-1-0123456789ab.png/../../site.db',
    'x/bg-1-0123456789ab.png',
    'bg-1-0123456789ab.png\n',
    'bg-1-0123456789ab.png\u0000.html',
    '',
    7,
    null,
    ['bg-1-0123456789ab.png'],
  ]) {
    refuses(() => cleanBackground({ type: 'image', file }), 'invalidBackground', `file ${JSON.stringify(file)}`);
  }
});

test('nothing but the setting itself is kept: extra fields a client adds are dropped', () => {
  const extra = { evil: '<script>', __proto__: { polluted: true }, isBot: true };
  assert.deepEqual(cleanBackground({ ...extra, type: 'preset', value: 'night' }), { type: 'preset', value: 'night' });
  assert.deepEqual(cleanBackground({ ...extra, type: 'colour', value: '#112233', file: 'x' }), { type: 'colour', value: '#112233' });
  assert.deepEqual(cleanBackground({ ...extra, type: 'gradient', from: '#112233', to: '#445566', angle: 1, value: 'night' }), { type: 'gradient', from: '#112233', to: '#445566', angle: 1 });
  assert.deepEqual(cleanBackground({ ...extra, type: 'image', file: 'bg-1-0123456789ab.png', value: 'night' }), { type: 'image', file: 'bg-1-0123456789ab.png' });
  assert.deepEqual(cleanCardBack({ ...extra, type: 'preset', value: 'crimson' }), { type: 'preset', value: 'crimson' });
  assert.deepEqual(cleanCardBack({ ...extra, type: 'image', file: 'cb-1-0123456789ab.png' }), { type: 'image', file: 'cb-1-0123456789ab.png' });
  assert.deepEqual(cleanCardBack({ ...extra, type: 'avatar', file: 'cb-1-0123456789ab.png', value: 'crimson' }), { type: 'avatar' }, 'the avatar back keeps nothing but the choice');
  assert.deepEqual(cleanNameStyle({ ...extra, style: 'plain' }), { style: 'plain' });
});

test('an unknown kind of background, or no background at all, is refused', () => {
  for (const input of [undefined, null, 0, '', 'night', [], {}, { type: 'video' }, { type: 'PRESET', value: 'night' }, { type: ['preset'], value: 'night' }, { value: 'night' }, { type: 'avatar' }]) {
    refuses(() => cleanBackground(input), 'invalidBackground', JSON.stringify(input));
  }
});

test('a card back is a preset, your own uploaded picture, or your avatar', () => {
  for (const value of Object.keys(CARD_BACK_PRESETS)) assert.deepEqual(cleanCardBack({ type: 'preset', value }), { type: 'preset', value });
  assert.deepEqual(cleanCardBack({ type: 'image', file: 'cb-3-0123456789ab.webp' }), { type: 'image', file: 'cb-3-0123456789ab.webp' });
  assert.deepEqual(cleanCardBack({ type: 'avatar' }), { type: 'avatar' });
  for (const input of [
    undefined,
    null,
    'crimson',
    {},
    { type: 'preset' },
    { type: 'preset', value: 'night' }, // a background preset, not a card back
    ...INHERITED.map((value) => ({ type: 'preset', value })),
    { type: 'colour', value: '#112233' }, // card backs have no plain colours
    { type: 'image', file: 'bg-3-0123456789ab.webp' }, // a background picture is not a card back
    { type: 'image', file: '../cb-3-0123456789ab.webp' },
    { type: 'image' },
  ]) {
    refuses(() => cleanCardBack(input), 'invalidCardBack', JSON.stringify(input));
  }
});

test('a name style is a known style with, optionally, a known animation; a still name is stored without one', () => {
  for (const { id } of NAME_STYLES) assert.deepEqual(cleanNameStyle({ style: id }), { style: id });
  assert.deepEqual(cleanNameStyle({ style: 'plain', animation: 'none' }), { style: 'plain' }, '"none" is the still choice, stored as no animation');
  assert.deepEqual(cleanNameStyle({ style: 'plain', animation: undefined }), { style: 'plain' });
  for (const { id } of NAME_ANIMATIONS.filter((a) => a.id !== 'none')) {
    assert.deepEqual(cleanNameStyle({ style: 'plain', animation: id }), { style: 'plain', animation: id });
  }
  for (const input of [undefined, null, 'plain', {}, { style: 'nope' }, { style: null }, { style: ['plain'] }, ...INHERITED.map((style) => ({ style }))]) {
    refuses(() => cleanNameStyle(input), 'invalidNameStyle', JSON.stringify(input));
  }
  for (const animation of ['nope', '', null, 0, false, ['glow'], {}, ...INHERITED]) {
    refuses(() => cleanNameStyle({ style: 'plain', animation }), 'invalidNameAnimation', `animation ${JSON.stringify(animation)}`);
  }
});

test('play animations is true, false, or null, and nothing that merely looks like one of them', () => {
  assert.equal(cleanPlayAnimations(true), true);
  assert.equal(cleanPlayAnimations(false), false);
  assert.equal(cleanPlayAnimations(null), null);
  for (const input of [undefined, 0, 1, 'true', 'false', '', 'null', [], {}, NaN]) {
    refuses(() => cleanPlayAnimations(input), 'invalidPlayAnimations', String(input));
  }
});

test('an effect level is a whole number within its range, ends included, and a refusal says what the range is', () => {
  for (const range of [EFFECT_INTENSITY, EFFECT_SPEED]) {
    assert.ok(range.min <= range.normal && range.normal <= range.max, 'the normal level is itself allowed');
    for (const level of [range.min, range.min + 1, range.normal, range.max - 1, range.max]) assert.equal(cleanEffectLevel(level, range), level);
    for (const level of [range.min - 1, range.max + 1, range.normal + 0.5, -range.normal, 0, String(range.normal), NaN, Infinity, -Infinity, null, undefined, true, [range.normal], {}]) {
      assert.throws(() => cleanEffectLevel(level, range), (error) => {
        assert.ok(error instanceof AuthError, `level ${String(level)}`);
        assert.equal(error.message, 'invalidEffectLevel');
        assert.equal(error.status, 400);
        assert.deepEqual(error.params, { min: range.min, max: range.max }, 'the page can say what would have been allowed');
        return true;
      });
    }
  }
});

test('a background animation is one of the known ones', () => {
  for (const { id } of BACKGROUND_ANIMATIONS) assert.equal(cleanBackgroundAnimation(id), id);
  for (const input of ['nope', '', 'None', null, undefined, 0, ['none'], {}, ...INHERITED]) {
    refuses(() => cleanBackgroundAnimation(input), 'invalidBackgroundAnimation', JSON.stringify(input));
  }
});

test('a choice comes back unchanged when it exists, and is refused with the code given when it does not', () => {
  const isFruit = (value) => value === 'apple' || value === 'pear';
  assert.equal(cleanChoice('apple', isFruit, 'invalidFruit'), 'apple');
  assert.equal(cleanChoice('pear', isFruit, 'invalidFruit'), 'pear');
  refuses(() => cleanChoice('brick', isFruit, 'invalidFruit'), 'invalidFruit', 'brick');
  refuses(() => cleanChoice(undefined, isFruit, 'invalidSiteTheme'), 'invalidSiteTheme', 'undefined');
});

test('a marker colour is a #rrggbb colour kept in lower case, or null for none', () => {
  assert.equal(cleanMarkerColour(null), null);
  assert.equal(cleanMarkerColour('#FF2D95'), '#ff2d95');
  assert.equal(cleanMarkerColour('#000000'), '#000000');
  for (const input of [undefined, '', 'red', '#fff', '#ff2d9', '#ff2d955', 'ff2d95', ' #ff2d95', 0, false, ['#ff2d95'], {}]) {
    refuses(() => cleanMarkerColour(input), 'invalidMarkerColour', JSON.stringify(input));
  }
});

test('an avatar has a known option in every slot: missing slots get the default, and one bad part refuses the lot', () => {
  assert.deepEqual(cleanAvatar({}), { ...DEFAULT_AVATAR }, 'nothing chosen is the default avatar');
  for (const { slot, options } of AVATAR_SLOTS) {
    for (const { id } of options) {
      assert.deepEqual(cleanAvatar({ [slot]: id }), { ...DEFAULT_AVATAR, [slot]: id }, `${slot}: ${id}`);
    }
    for (const bad of ['nope', '', null, 0, ['x'], {}, ...INHERITED]) {
      refuses(() => cleanAvatar({ [slot]: bad }), 'invalidAvatar', `${slot}: ${JSON.stringify(bad)}`);
    }
  }
  const last = Object.fromEntries(AVATAR_SLOTS.map(({ slot, options }) => [slot, options.at(-1).id]));
  assert.deepEqual(cleanAvatar(last), last, 'every slot chosen at once');
  assert.deepEqual(cleanAvatar({ ...last, extra: 'ignored', isBot: true }), last, 'what is not a slot is not kept');
  for (const input of [undefined, null, 0, 1, '', 'avatar', true, [], [last]]) {
    refuses(() => cleanAvatar(input), 'invalidAvatar', JSON.stringify(input));
  }
});

// ---- fuzz ----
// Every cleaner, with the code it refuses with.  Each is given shapes built at random from valid parts and rubbish.
const CLEANERS = [
  ['background', cleanBackground, 'invalidBackground'],
  ['cardBack', cleanCardBack, 'invalidCardBack'],
  ['nameStyle', cleanNameStyle, ['invalidNameStyle', 'invalidNameAnimation']],
  ['playAnimations', cleanPlayAnimations, 'invalidPlayAnimations'],
  ['effectIntensity', (input) => cleanEffectLevel(input, EFFECT_INTENSITY), 'invalidEffectLevel'],
  ['effectSpeed', (input) => cleanEffectLevel(input, EFFECT_SPEED), 'invalidEffectLevel'],
  ['backgroundAnimation', cleanBackgroundAnimation, 'invalidBackgroundAnimation'],
  ['markerColour', cleanMarkerColour, 'invalidMarkerColour'],
  ['avatar', cleanAvatar, 'invalidAvatar'],
];

/** One value a hostile or careless client might put in a field: sometimes right, mostly not. */
function fieldValue(rng, depth = 0) {
  const plausible = [
    'preset', 'colour', 'gradient', 'image', 'avatar', 'night', 'crimson', 'plain', 'none', 'glow', 'stars',
    '#aabbcc', '#AABBCC', '#abc', 'bg-1-0123456789ab.png', 'cb-1-0123456789ab.jpg', '../bg-1-0123456789ab.png',
    ...INHERITED, 0, 1, 100, 160, 300, 301, -1, 1.5, 1e308, NaN, Infinity, true, false, null, undefined, '', ' ',
  ];
  const roll = rng();
  if (roll < 0.7 || depth > 2) return pickOne(plausible, rng);
  if (roll < 0.8) return Array.from({ length: Math.floor(rng() * 3) }, () => fieldValue(rng, depth + 1));
  if (roll < 0.9) return Object.create(null); // an object with no prototype: String() and Number() of it throw
  return randomShape(rng, depth + 1);
}

/** An object with a random handful of the field names the cleaners read (and some they do not). */
function randomShape(rng, depth = 0) {
  const names = ['type', 'value', 'from', 'to', 'angle', 'file', 'style', 'animation', ...AVATAR_SLOTS.map((s) => s.slot), '__proto__', 'constructor', 'length', 'toString'];
  const shape = {};
  const count = Math.floor(rng() * 5);
  // defineProperty, so that a field called __proto__ is a field (as JSON.parse makes it) rather than a change of prototype
  for (let i = 0; i < count; i++) Object.defineProperty(shape, pickOne(names, rng), { value: fieldValue(rng, depth), enumerable: true, writable: true, configurable: true });
  return shape;
}

/** assertNoPollution, saying where in the run the prototype was found changed. */
function unpolluted(before, where) {
  try {
    assertNoPollution(before);
  } catch (error) {
    assert.fail(`${where}: ${error.message}`);
  }
}

test('fuzz: every cleaner either returns a clean value or refuses with its own code, whatever it is given', () => {
  const before = prototypeNames();
  const SEED = 20261113;
  const STEPS = 4000;
  const rng = seeded(SEED);
  const garbage = garbageValues().map(([, value]) => value);
  let accepted = 0;
  for (let step = 0; step < STEPS; step++) {
    const [name, clean, codes] = pickOne(CLEANERS, rng);
    const input = rng() < 0.15 ? pickOne(garbage, rng) : rng() < 0.5 ? randomShape(rng) : fieldValue(rng);
    const where = `seed ${SEED}, step ${step}, ${name}`;
    let result;
    try {
      result = clean(input);
    } catch (error) {
      assert.ok(error instanceof AuthError, `${where}: threw ${error?.name}: ${error?.message} rather than refusing`);
      assert.ok([codes].flat().includes(error.message), `${where}: refused with ${error.message}`);
      assert.equal(error.status, 400, where);
      unpolluted(before, where);
      continue;
    }
    accepted++;
    // What is stored must survive being stored (it is written as JSON or as a plain column) and must itself be valid:
    // cleaning a clean value changes nothing.
    assert.deepEqual(JSON.parse(JSON.stringify({ v: result })), { v: result }, `${where}: the clean value does not survive being stored`);
    let again;
    assert.doesNotThrow(() => (again = clean(result)), `${where}: the clean value was itself refused`);
    assert.deepEqual(again, result, `${where}: the clean value is not itself clean`);
    unpolluted(before, where);
  }
  assert.ok(accepted > STEPS / 50, `seed ${SEED}: only ${accepted} of ${STEPS} inputs were accepted, so the fuzz is not reaching the accepting paths`);
});

// Language tags (shared/languages.js): what a profile may save and what a rules request may ask for.  A tag ends up in
// a file name on the way to a rules page, so what is refused matters as much as what is let through.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLanguageTag } from './languages.js';
import { seeded } from './random.js';

const platform = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the simple tags are tags', () => {
  for (const tag of ['en', 'fr', 'tlh', 'pt-BR', 'zh-Hant', 'zh-Hant-TW', 'de-CH-1996', 'es-419', 'en-GB-oxendict-x1']) assert.equal(isLanguageTag(tag), true, tag);
});

test('every language the site ships is one it would accept', () => {
  const shipped = fs.readdirSync(path.join(platform, 'src', 'locales')).filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -'.json'.length));
  assert.ok(shipped.includes('en'), 'the site has English, at least');
  for (const tag of shipped) assert.equal(isLanguageTag(tag), true, tag);
});

test('what is not a tag is refused', () => {
  const not = [
    '', // nothing
    'e', // too short
    'engl', // too long for a primary subtag
    'EN', // the primary subtag is lower case
    'en-', // a dangling hyphen
    '-en',
    'en--GB',
    'en-G', // a subtag of one
    'en-abcdefghi', // a subtag of nine
    'en-a-b-c-d', // more than three after the first (and each too short)
    'en-GB-aa-bb-cc', // more than three after the first
    'en_GB', // an underscore is not a hyphen
    'en GB',
    ' en',
    'en ',
    'en\n',
    'en\u0000',
    'ен', // letters, but not these
    'en-ÉÉ',
  ];
  for (const tag of not) assert.equal(isLanguageTag(tag), false, JSON.stringify(tag));
});

test('nothing that could name a file somewhere else is a tag', () => {
  for (const tag of ['..', '../en', 'en/..', 'en/../../x', 'en\\..', 'en.json', 'en%2F', 'C:', 'en:x', 'en;x', 'en?x', 'en#x', '~']) assert.equal(isLanguageTag(tag), false, tag);
});

test('only a string can be a tag', () => {
  const en = { toString: () => 'en' };
  for (const value of [undefined, null, 0, 1, true, [], ['en'], {}, en, Object.create(null), Symbol('en'), () => 'en']) assert.equal(isLanguageTag(value), false);
});

test('fuzz: whatever is accepted is made only of letters, digits, and single hyphens, and is short', () => {
  const seed = 0x7a6;
  const rng = seeded(seed);
  const alphabet = 'abcxyzABCXYZ0189-_/.\\ \n%é';
  let accepted = 0;
  for (let i = 0; i < 20000; i++) {
    let text = '';
    for (let n = Math.floor(rng() * 12); n > 0; n--) text += alphabet[Math.floor(rng() * alphabet.length)];
    if (!isLanguageTag(text)) continue;
    accepted++;
    const where = `seed ${seed}, step ${i}: ${JSON.stringify(text)}`;
    assert.match(text, /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/, where);
    assert.ok(text.length <= 3 + 3 * 9, where);
    assert.equal(path.basename(`${text}.json`), `${text}.json`, where);
  }
  assert.ok(accepted > 0, `seed ${seed}: the fuzz never made a tag, so it checked nothing`);
});

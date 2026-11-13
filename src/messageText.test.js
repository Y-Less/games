// Putting what the server sends into words.  Everything a game says to a player arrives as a message `{ key, params }`
// (shared/messages.js) and goes through here, so this is the one place where a missing translation, a hostile player
// name, or a malformed message could turn into a blank line, a thrown render, or text that is read as a template.
// What is protected: the game's own words come before the site's; a message nobody wrote shows its key (the gap is
// visible, not silent); names are text and stay text, whatever is in them; and nothing the server can send throws.
//
// The expected values are worked out from messages this file registers itself (a made-up game, `zzgame`, and a made-up
// language, `zz`), so no test depends on the wording of a real locale file.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import { mount } from '@vue/test-utils';
import { cardMsg, msg } from '../shared/messages.js';
import { pickOne, seeded } from '../shared/random.js';
import { FALLBACK, i18n } from './i18n.js';
import { errorText, hasText, intlLocale, keyFor, listText, messageText, ordinalText } from './messageText.js';

const GAME = 'zzgame';
const GAME_MESSAGES = {
  greet: 'Hello {name}',
  pair: '{a} then {b}',
  items: 'no items | one item | {count} items',
  cards: { name: 'ZZ {rank} / {suit}' }, // the same key as the site's card name, to show the game's is tried first
  errors: { full: 'The table is full ({max}).' },
};

beforeAll(() => {
  i18n.global.mergeLocaleMessage(FALLBACK, { [GAME]: GAME_MESSAGES, zzsite: { only: 'Only the site says this', english: 'English only' } });
  i18n.global.setLocaleMessage('zz', { zzsite: { only: 'ZZ only' } });
});
afterEach(() => {
  i18n.global.locale.value = FALLBACK;
});

// Text that would do harm if it were ever read as markup, as a message template, or as a property name.
const HOSTILE = [
  '<img src=x onerror=alert(1)>',
  '<script>alert(1)</script>',
  '</p><b>bold</b>',
  '&lt;b&gt;&amp;',
  '{name}',
  '{0}',
  "{'@'}",
  '@:errors.noAnswer',
  '@.upper:zzgame.greet',
  'a | b | c',
  '%{x}',
  '$t(greet)',
  '__proto__',
  'constructor',
  'toString',
  'hasOwnProperty',
  'valueOf',
  '',
  ' ',
  '\n',
  '\ud800',
  '\udfff!',
  'Ann',
  'O\'Brien "The" <Ace>',
  'x) url(javascript:alert(1)',
  'имя',
  '名前',
  'a.b.c',
  '.',
  '..',
];

describe('finding a key', () => {
  it('has text for a key the current language has', () => {
    expect(hasText('zzgame.greet')).toBe(true);
  });

  it('has text for a key only the fallback language has, so a half-translated language still shows it', async () => {
    i18n.global.locale.value = 'zz';
    expect(hasText('zzsite.only')).toBe(true);
    expect(hasText('zzsite.english')).toBe(true);
  });

  it('has no text for a key nobody wrote, nor for a branch of keys, which is not text', () => {
    expect(hasText('zzgame.nope')).toBe(false);
    expect(hasText('zzgame.cards')).toBe(false);
    expect(hasText('')).toBe(false);
  });

  it("uses the game's own key when the game has it, and the site's when it has not", () => {
    expect(keyFor('greet', GAME)).toBe('zzgame.greet');
    expect(keyFor('zzsite.only', GAME)).toBe('zzsite.only');
    expect(keyFor('greet', null)).toBe('greet');
  });

  it('gives the Intl formatters British English for the site\'s English, and any other language its own tag', () => {
    expect(intlLocale()).toBe('en-GB');
    i18n.global.locale.value = 'zz';
    expect(intlLocale()).toBe('zz');
  });
});

describe('lists and places', () => {
  it('joins a list as the language does', () => {
    expect(listText(['Ann', 'Bob', 'Cat'])).toBe('Ann, Bob and Cat');
    expect(listText(['Ann', 'Bob'])).toBe('Ann and Bob');
    expect(listText(['Ann'])).toBe('Ann');
    expect(listText([])).toBe('');
  });

  it('still joins a list in a language Intl does not know', () => {
    i18n.global.locale.value = 'not a language tag';
    const joined = listText(['Ann', 'Bob']);
    expect(joined).toContain('Ann');
    expect(joined).toContain('Bob');
  });

  it('writes a place as English does', () => {
    const places = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 11: '11th', 12: '12th', 13: '13th', 21: '21st', 22: '22nd', 23: '23rd', 101: '101st', 111: '111th' };
    for (const [n, text] of Object.entries(places)) expect(ordinalText(Number(n)), `place ${n}`).toBe(text);
  });

  it('writes a place in the plain form in a language Intl does not know, rather than failing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); // vue-i18n remarks that this made-up language has no messages
    i18n.global.locale.value = 'not a language tag';
    expect(ordinalText(3)).toContain('3');
    warn.mockRestore();
  });
});

describe('a value from the server', () => {
  it('is nothing at all when there is none', () => {
    expect(messageText(null)).toBe('');
    expect(messageText(undefined)).toBe('');
  });

  it('stays as it is when it is plain text, such as a name', () => {
    expect(messageText('Ann')).toBe('Ann');
    expect(messageText('{name} | @:zzgame.greet')).toBe('{name} | @:zzgame.greet');
    expect(messageText('zzgame.greet')).toBe('zzgame.greet'); // text that happens to look like a key is still text
  });

  it('is translated when it is a message, with its values put in', () => {
    expect(messageText(msg('zzgame.greet', { name: 'Ann' }))).toBe('Hello Ann');
  });

  it("looks in the game's own messages first and the site's after", () => {
    expect(messageText(msg('greet', { name: 'Ann' }), GAME)).toBe('Hello Ann');
    expect(messageText(msg('zzsite.only'), GAME)).toBe('Only the site says this');
    // The site names a card "queen of spades"; the game has its own `cards.name`, and only that one key is overridden.
    expect(messageText(cardMsg('QS'))).toBe('queen of spades');
    expect(messageText(cardMsg('QS'), GAME)).toBe('ZZ queen / spades');
  });

  it('translates a value that is itself a message before putting it in', () => {
    expect(messageText(msg('greet', { name: msg('pair', { a: 'Ann', b: msg('zzsite.only') }) }), GAME)).toBe('Hello Ann then Only the site says this');
  });

  it('joins a value that is a list as the language joins lists', () => {
    expect(messageText(msg('greet', { name: ['Ann', 'Bob', 'Cat'] }), GAME)).toBe('Hello Ann, Bob and Cat');
    expect(messageText(msg('greet', { name: ['Ann', msg('pair', { a: 'Bob', b: 'Cat' })] }), GAME)).toBe('Hello Ann and Bob then Cat');
  });

  it('chooses the plural form from a numeric count', () => {
    expect(messageText(msg('items', { count: 0 }), GAME)).toBe('no items');
    expect(messageText(msg('items', { count: 1 }), GAME)).toBe('one item');
    expect(messageText(msg('items', { count: 5 }), GAME)).toBe('5 items');
  });

  it('shows the key of a message nobody wrote, so the gap is visible rather than silent', () => {
    expect(messageText(msg('zzgame.nope', { name: 'Ann' }))).toBe('zzgame.nope');
    expect(messageText(msg('nope'), GAME)).toBe('nope');
  });

  it('is shown in English in a language that has not translated it, and in that language where it has', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); // see the todo below
    i18n.global.locale.value = 'zz';
    expect(messageText(msg('zzsite.english'))).toBe('English only');
    expect(messageText(msg('zzsite.only'))).toBe('ZZ only');
    expect(messageText(msg('greet', { name: 'Ann' }), GAME)).toBe('Hello Ann');
    warn.mockRestore();
  });

  it('joins a list of values, each put into words', () => {
    expect(messageText(['Ann', msg('greet', { name: 'Bob' }), 'Cat'], GAME)).toBe('Ann, Hello Bob and Cat');
  });
});

describe('a refusal', () => {
  const noAnswer = () => i18n.global.t('errors.noAnswer');

  it('says the server did not answer when there is no reply or no code', () => {
    for (const reply of [null, undefined, {}, { error: '' }, { error: 7 }, { ok: false }]) expect(errorText(reply), JSON.stringify(reply)).toBe(noAnswer());
  });

  it("puts a code into words from the game's errors, with its values", () => {
    expect(errorText({ error: 'full', params: { max: 6 } }, GAME)).toBe('The table is full (6).');
  });

  it("falls back to the site's errors for a code the game does not have", () => {
    expect(errorText({ error: 'noAnswer' }, GAME)).toBe(noAnswer());
  });

  it('shows a code nobody wrote as it is, so a stray sentence still reaches the player', () => {
    expect(errorText({ error: 'That room is full.' }, GAME)).toBe('That room is full.');
    expect(errorText({ error: 'full' })).toBe('full'); // the game's code means nothing outside the game
  });
});

describe('hostile values (seeded)', () => {
  let warn;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());
  afterAll(() => vi.restoreAllMocks());

  /** Runs one step of a seeded loop, so that anything it throws says which seed and step it was. */
  function atStep(where, body) {
    try {
      body();
    } catch (error) {
      if (!String(error.message).includes(where)) error.message = `${where}: ${error.message}`;
      throw error;
    }
  }

  /** The warnings vue-i18n gave about a key that does not exist: `messageText` is meant to check before it asks. */
  const missing = () => warn.mock.calls.map((call) => call.join(' ')).filter((text) => /not found/i.test(text));

  it('puts a name into a message exactly as it is, never reading it as a template', () => {
    const SEED = 20261113;
    const rng = seeded(SEED);
    for (let step = 0; step < 300; step++) {
      const [name, a, b] = [pickOne(HOSTILE, rng), pickOne(HOSTILE, rng), pickOne(HOSTILE, rng)];
      const where = `seed ${SEED} step ${step} (${JSON.stringify([name, a, b])})`;
      atStep(where, () => {
        expect(messageText(msg('greet', { name }), GAME), where).toBe(`Hello ${name}`);
        expect(messageText(msg('greet', { name: msg('pair', { a, b }) }), GAME), where).toBe(`Hello ${a} then ${b}`);
        expect(messageText(name, GAME), where).toBe(name);
        expect(errorText({ error: 'full', params: { max: name } }, GAME), where).toBe(`The table is full (${name}).`);
        expect(missing(), where).toEqual([]);
      });
    }
  });

  // The keys a made-up message may carry: real ones (relative to the game and to the site), and nonsense.
  const KEYS = ['greet', 'pair', 'items', 'cards.name', 'errors.full', 'zzsite.only', 'errors.noAnswer', 'cards', 'zzgame', 'errors', ...HOSTILE];
  // The names its values may go under, the dangerous property names among them.
  const NAMES = ['name', 'a', 'b', 'count', 'rank', 'suit', 'max', 'n', '__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', '0', ''];

  /**
   * One value as the wire could carry it, written as JSON so that a `__proto__` name is an ordinary property of the
   * parsed object (as it is when it arrives from the server) rather than a change of prototype.
   * @param {() => number} rng
   * @param {number} depth  how much further it may nest
   * @returns {string} JSON text of plain text, a number, a boolean, null, a list, or a message
   */
  function wireValue(rng, depth) {
    const roll = rng();
    if (depth <= 0 || roll < 0.3) return JSON.stringify(pickOne(HOSTILE, rng));
    if (roll < 0.4) return JSON.stringify(pickOne([0, 1, 2, 5, -1, 2.5, 1e21, 1000000], rng));
    if (roll < 0.45) return pickOne(['true', 'false', 'null'], rng);
    if (roll < 0.6) return `[${Array.from({ length: Math.floor(rng() * 4) }, () => wireValue(rng, depth - 1)).join(',')}]`;
    const key = JSON.stringify(pickOne(KEYS, rng));
    if (rng() < 0.2) return `{"key":${key}}`;
    const names = [...new Set(Array.from({ length: Math.floor(rng() * 4) }, () => pickOne(NAMES, rng)))];
    return `{"key":${key},"params":{${names.map((name) => `${JSON.stringify(name)}:${wireValue(rng, depth - 1)}`).join(',')}}}`;
  }

  it('never throws, always answers with text, and never asks for a key that is not there', () => {
    const SEED = 4242;
    const rng = seeded(SEED);
    for (let step = 0; step < 600; step++) {
      const json = wireValue(rng, 3);
      const where = `seed ${SEED} step ${step}: ${json}`;
      const game = pickOne([GAME, null, 'hearts', '__proto__', 'constructor'], rng);
      let text;
      expect(() => (text = messageText(JSON.parse(json), game)), where).not.toThrow();
      expect(typeof text, where).toBe('string');
      let refusal;
      expect(() => (refusal = errorText({ error: pickOne(KEYS, rng), params: JSON.parse(json)?.params }, game)), where).not.toThrow();
      expect(typeof refusal, where).toBe('string');
      expect(missing(), where).toEqual([]);
      expect(Object.prototype, where).not.toHaveProperty('name'); // and nothing was written through a `__proto__` name
    }
  });

  it('reaches the page as text and nothing else, whatever the words are', () => {
    const SEED = 99;
    const rng = seeded(SEED);
    for (let step = 0; step < 150; step++) {
      const json = wireValue(rng, 3);
      const where = `seed ${SEED} step ${step}: ${json}`;
      atStep(where, () => {
        const text = messageText(JSON.parse(json), GAME);
        const wrapper = mount({ render: () => h('p', text) });
        expect(wrapper.element.children.length, where).toBe(0);
        expect(wrapper.element.textContent, where).toBe(text);
        wrapper.unmount();
      });
    }
  });
});

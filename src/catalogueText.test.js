// The names the server defines in English and a language may override by key: games, statistics, achievements, shop
// items, avatar parts, and categories.  The promise being protected is the one in catalogueText.js's header: English is
// the definition itself, a language's file holds a translation under the key, and a missing one falls back to the
// server's English, so a half-translated catalogue still shows every name (never a key, and never nothing).
//
// The translations here are registered by this file under a made-up language (`zz`) and a made-up game (`zzgame`), so
// the expected values come from the key scheme the header documents rather than from any real locale file.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import { mount } from '@vue/test-utils';
import { pickOne, seeded } from '../shared/random.js';
import { FALLBACK, i18n } from './i18n.js';
import { catalogue, named } from './catalogueText.js';

beforeAll(() => {
  i18n.global.setLocaleMessage('zz', {
    zzgame: {
      meta: { name: 'ZZ game', description: 'ZZ description' },
      stats: { handsPlayed: 'ZZ hands played' },
      achievements: {
        moon: { name: 'ZZ moon', text: 'ZZ shoot the moon {n} times', one: 'ZZ shoot the moon once' },
        noOne: { text: 'ZZ do it {n} times' },
        own: { label: 'ZZ own label' },
      },
    },
    siteAchievements: { cards: { name: 'ZZ cards', text: 'ZZ play {n} cards', one: 'ZZ play a card', label: 'ZZ cards label' } },
    achievements: { stats: { played: 'ZZ games played' } },
    shop: { 'ns:gold': 'ZZ gold' },
    avatar: { slots: { hair: 'ZZ hair' }, options: { hair: { curly: 'ZZ curly' } } },
    categories: { cards: 'ZZ card games' },
    zzsite: { hello: 'ZZ hello {who}' },
  });
});
beforeEach(() => {
  i18n.global.locale.value = 'zz';
});
afterEach(() => {
  i18n.global.locale.value = FALLBACK;
});

describe('named', () => {
  it('uses the translation under the key when the language has one, with its values put in', () => {
    expect(named('zzsite.hello', 'Hello', { who: 'Ann' })).toBe('ZZ hello Ann');
  });

  it("falls back to the server's English when no language has the key", () => {
    expect(named('zzsite.nope', 'Hello')).toBe('Hello');
  });
});

describe('the catalogue, in a language that translates it', () => {
  it("names a game and describes it from the game's own file", () => {
    const game = { id: 'zzgame', name: 'Game', description: 'A game.' };
    expect(catalogue.gameName(game)).toBe('ZZ game');
    expect(catalogue.gameDescription(game)).toBe('ZZ description');
  });

  it('labels a category, a statistic, a shop item, an avatar slot, and an avatar option', () => {
    expect(catalogue.categoryLabel('cards')).toBe('ZZ card games');
    expect(catalogue.statLabel('zzgame', { key: 'handsPlayed', label: 'Hands played' })).toBe('ZZ hands played');
    expect(catalogue.shopItemName({ id: 'ns:gold', name: 'Gold' })).toBe('ZZ gold');
    expect(catalogue.avatarSlotLabel({ slot: 'hair', label: 'Hair' })).toBe('ZZ hair');
    expect(catalogue.avatarOptionName('hair', { id: 'curly', name: 'Curly' })).toBe('ZZ curly');
  });

  it("names a game's achievement from the game's file and the site's own from the site's", () => {
    expect(catalogue.achievementName('zzgame', { key: 'moon', name: 'Shoot the moon' })).toBe('ZZ moon');
    expect(catalogue.achievementName('global', { key: 'cards', name: 'Played cards' })).toBe('ZZ cards');
  });

  it('puts the number into what a level asks for, and uses the `one` text when the number is 1', () => {
    const moon = { key: 'moon' };
    expect(catalogue.achievementText('zzgame', moon, 5, 'Shoot the moon 5 times')).toBe('ZZ shoot the moon 5 times');
    expect(catalogue.achievementText('zzgame', moon, 1, 'Shoot the moon 1 times')).toBe('ZZ shoot the moon once');
    expect(catalogue.achievementText('global', { key: 'cards' }, 1, 'Play 1 cards')).toBe('ZZ play a card');
  });

  it('uses the numbered text for 1 when the language gives no `one` text', () => {
    expect(catalogue.achievementText('zzgame', { key: 'noOne' }, 1, 'Do it 1 times')).toBe('ZZ do it 1 times');
  });

  it("labels an achievement that reads a stat by that stat: the game's own translation first, then the shared one", () => {
    expect(catalogue.achievementLabel('zzgame', { key: 'hands', stat: 'handsPlayed', label: 'Hands played' })).toBe('ZZ hands played');
    expect(catalogue.achievementLabel('zzgame', { key: 'games', stat: 'played', label: 'Games played' })).toBe('ZZ games played');
  });

  it('labels an achievement that counts something no stat does by its own label', () => {
    expect(catalogue.achievementLabel('zzgame', { key: 'own', stat: null, label: 'Own label' })).toBe('ZZ own label');
    expect(catalogue.achievementLabel('global', { key: 'cards', stat: null, label: 'Cards played' })).toBe('ZZ cards label');
  });

  it('has no label for an achievement that has none', () => {
    expect(catalogue.achievementLabel('zzgame', { key: 'own', stat: null, label: null })).toBeNull();
    expect(catalogue.achievementLabel('zzgame', { key: 'hands', stat: 'handsPlayed', label: null })).toBeNull();
  });
});

describe("the catalogue, where nothing is translated: the server's English throughout", () => {
  it('shows every name as the server gave it', () => {
    expect(catalogue.gameName({ id: 'zznone', name: 'Game' })).toBe('Game');
    expect(catalogue.gameDescription({ id: 'zznone', description: 'A game.' })).toBe('A game.');
    expect(catalogue.statLabel('zznone', { key: 'handsPlayed', label: 'Hands played' })).toBe('Hands played');
    expect(catalogue.shopItemName({ id: 'zz:none', name: 'Gold' })).toBe('Gold');
    expect(catalogue.avatarSlotLabel({ slot: 'zznone', label: 'Hair' })).toBe('Hair');
    expect(catalogue.avatarOptionName('hair', { id: 'zznone', name: 'Curly' })).toBe('Curly');
    expect(catalogue.achievementName('zznone', { key: 'moon', name: 'Shoot the moon' })).toBe('Shoot the moon');
    expect(catalogue.achievementName('global', { key: 'zznone', name: 'Played cards' })).toBe('Played cards');
  });

  it('shows a category nobody named as its key', () => {
    expect(catalogue.categoryLabel('zznone')).toBe('zznone');
  });

  it("shows the server's text for what a level asks for, whatever the number", () => {
    expect(catalogue.achievementText('zznone', { key: 'moon' }, 1, 'Shoot the moon once')).toBe('Shoot the moon once');
    expect(catalogue.achievementText('zznone', { key: 'moon' }, 5, 'Shoot the moon 5 times')).toBe('Shoot the moon 5 times');
  });

  it("shows the server's label for an achievement, with or without a stat", () => {
    expect(catalogue.achievementLabel('zznone', { key: 'x', stat: 'zznone', label: 'Things done' })).toBe('Things done');
    expect(catalogue.achievementLabel('zznone', { key: 'x', stat: null, label: 'Things done' })).toBe('Things done');
  });
});

describe('numbers in achievement texts', () => {
  it("are grouped as the language groups them (British English for the site's English)", () => {
    i18n.global.locale.value = FALLBACK;
    i18n.global.mergeLocaleMessage(FALLBACK, { zzgroup: { achievements: { big: { text: 'Score {n} points' } } } });
    expect(catalogue.achievementText('zzgroup', { key: 'big' }, 1000000, 'fallback')).toBe(`Score ${(1000000).toLocaleString('en-GB')} points`);
  });
});

describe('hostile names from the server (seeded)', () => {
  const HOSTILE = ['<img src=x onerror=alert(1)>', '<b>bold</b>', '{n}', '{name}', '@:zzsite.hello', 'a | b', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '', '.', '..', 'a.b', 'meta', 'zzgame', '\ud800', 'ns:gold', 'cards', 'moon', 'global', 'O\'Brien "The" <Ace>'];
  // Kept quiet: an odd id can land on a key only English has, and vue-i18n remarks on every fall-back to English.
  let warn;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  /** Runs one step of a seeded loop, so that anything it throws says which seed and step it was. */
  function atStep(where, body) {
    try {
      body();
    } catch (error) {
      if (!String(error.message).includes(where)) error.message = `${where}: ${error.message}`;
      throw error;
    }
  }

  it("never throws, always answers with text, and shows the server's own English untouched when there is no translation", () => {
    const SEED = 1113;
    const rng = seeded(SEED);
    const hostile = () => pickOne(HOSTILE, rng);
    for (let step = 0; step < 400; step++) {
      // An id no language can have a key under, so the fallback is the only right answer however odd it is.
      const none = `zznone${step}`;
      const [name, id, key] = [hostile(), hostile(), hostile()];
      const where = `seed ${SEED} step ${step} (${JSON.stringify({ name, id, key })})`;
      atStep(where, () => {
        expect(catalogue.gameName({ id: none, name }), where).toBe(name);
        expect(catalogue.gameDescription({ id: none, description: name }), where).toBe(name);
        expect(catalogue.statLabel(none, { key, label: name }), where).toBe(name);
        expect(catalogue.achievementName(none, { key, name }), where).toBe(name);
        expect(catalogue.achievementText(none, { key }, step, name), where).toBe(name);
        expect(catalogue.shopItemName({ id: none, name }), where).toBe(name);
        expect(catalogue.avatarOptionName(none, { id, name }), where).toBe(name);
      });
      // Hostile ids and keys as well: whatever comes back, it is text, and getting it did not throw.
      const answers = [];
      expect(() => {
        answers.push(
          catalogue.gameName({ id, name }),
          catalogue.gameDescription({ id, description: name }),
          catalogue.categoryLabel(key),
          catalogue.statLabel(id, { key, label: name }),
          catalogue.achievementName(id, { key, name }),
          catalogue.achievementText(id, { key }, pickOne([0, 1, 2, 1000], rng), name),
          catalogue.shopItemName({ id, name }),
          catalogue.avatarSlotLabel({ slot: key, label: name }),
          catalogue.avatarOptionName(key, { id, name }),
          catalogue.achievementLabel(id, { key, stat: pickOne([null, key, 'played'], rng), label: name || 'label' }),
        );
      }, where).not.toThrow();
      for (const answer of answers) expect(typeof answer, where).toBe('string');
    }
  });

  it('reaches the page as text and nothing else', () => {
    const SEED = 7;
    const rng = seeded(SEED);
    for (let step = 0; step < 60; step++) {
      const name = pickOne(HOSTILE, rng);
      const where = `seed ${SEED} step ${step} (${JSON.stringify(name)})`;
      atStep(where, () => {
        const text = catalogue.gameName({ id: `zznone${step}`, name });
        const wrapper = mount({ render: () => h('p', text) });
        expect(wrapper.element.children.length, where).toBe(0);
        expect(wrapper.element.textContent, where).toBe(name);
        wrapper.unmount();
      });
    }
  });
});

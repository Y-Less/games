// The words inside a game's components.  A component never names its game: the play view provides the id and
// `useGameText()` picks it up, which is what lets one shared component (the scoreboard, say) speak in the words of
// whichever game it is drawn in.  Protected here: the id is injected (or given outright), the game's keys are tried
// before the site's, and `text`, `error`, and `list` are messageText.js's helpers with that id already filled in.
//
// The game (`zzgame`) and its words are made up by this file, so nothing depends on a real game's locale file.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { msg } from '../shared/messages.js';
import { pickOne, seeded } from '../shared/random.js';
import { FALLBACK, i18n } from './i18n.js';
import { GAME_ID, useGameText } from './useGameText.js';

beforeAll(() => {
  i18n.global.mergeLocaleMessage(FALLBACK, {
    zzgame: { greet: 'Hello {name}', items: 'no items | one item | {count} items', zzshared: 'The game says this', errors: { full: 'The table is full.' } },
    zzother: { greet: 'Good day {name}' },
    zzshared: 'The site says this',
    zzsiteOnly: 'Only the site says this',
  });
});
afterEach(() => {
  i18n.global.locale.value = FALLBACK;
});

/**
 * Calls useGameText in a component's setup, as a game's component would.
 * @param {{ provided?: string | null, id?: string | null }} options  the id the play view provides, and the one given outright (left out: none given)
 * @returns {ReturnType<typeof useGameText>}
 */
function words({ provided = null, ...rest } = {}) {
  let helpers;
  mount(
    {
      setup() {
        helpers = 'id' in rest ? useGameText(rest.id) : useGameText();
        return () => null;
      },
    },
    { global: { provide: { [GAME_ID]: provided } } },
  );
  return helpers;
}

describe('useGameText', () => {
  it('takes the game from the play view, so no component has to name it', () => {
    const { game, t } = words({ provided: 'zzgame' });
    expect(game).toBe('zzgame');
    expect(t('greet', { name: 'Ann' })).toBe('Hello Ann');
  });

  it('uses the id it is given outright instead of the one provided', () => {
    const { game, t } = words({ provided: 'zzgame', id: 'zzother' });
    expect(game).toBe('zzother');
    expect(t('greet', { name: 'Ann' })).toBe('Good day Ann');
  });

  it('is in no game when given null, even inside one, and when nothing is provided', () => {
    expect(words({ provided: 'zzgame', id: null }).game).toBeNull();
    expect(words().game).toBeNull();
    expect(words().t('zzshared')).toBe('The site says this');
  });

  it("tries the game's key first and falls back to the site's", () => {
    const { t } = words({ provided: 'zzgame' });
    expect(t('zzshared')).toBe('The game says this');
    expect(t('zzsiteOnly')).toBe('Only the site says this');
  });

  it("passes everything else to vue-i18n's `t` as it is, such as the count that picks a plural", () => {
    const { t } = words({ provided: 'zzgame' });
    expect(t('items', { count: 1 }, 1)).toBe('one item');
    expect(t('items', { count: 4 }, 4)).toBe('4 items');
  });

  it("puts a server message into the game's words, and leaves a name alone", () => {
    const { text } = words({ provided: 'zzgame' });
    expect(text(msg('greet', { name: 'Ann' }))).toBe('Hello Ann');
    expect(text('Ann')).toBe('Ann');
    expect(text(null)).toBe('');
  });

  it("puts a refusal into the game's words", () => {
    expect(words({ provided: 'zzgame' }).error({ error: 'full' })).toBe('The table is full.');
    expect(words().error({ error: 'full' })).toBe('full'); // outside the game the code means nothing, and is shown as it is
  });

  it('joins a list as the language does', () => {
    expect(words().list(['Ann', 'Bob', 'Cat'])).toBe('Ann, Bob and Cat');
  });

  it('gives the current language, and follows it when it changes', () => {
    const { locale } = words();
    expect(locale.value).toBe(FALLBACK);
    i18n.global.locale.value = 'zz';
    expect(locale.value).toBe('zz');
  });
});

describe('hostile names in a game template (seeded)', () => {
  const HOSTILE = ['<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '</p><b>bold</b>', '{{ 1 + 1 }}', '{name}', '@:zzgame.greet', 'a | b', '__proto__', '&amp;', 'O\'Brien "The" <Ace>', '\ud800', ''];

  it('shows a name exactly as it is, as text, when a component draws it with `text` and `t`', () => {
    const SEED = 5150;
    const rng = seeded(SEED);
    for (let step = 0; step < 80; step++) {
      const name = pickOne(HOSTILE, rng);
      const where = `seed ${SEED} step ${step} (${JSON.stringify(name)})`;
      try {
        const wrapper = mount(
          {
            props: { name: { type: String, required: true }, message: { type: Object, required: true } },
            setup: () => useGameText(),
            template: '<p><span class="plain">{{ text(name) }}</span><span class="said">{{ text(message) }}</span><span class="own">{{ t("greet", { name }) }}</span></p>',
          },
          { props: { name, message: msg('greet', { name }) }, global: { provide: { [GAME_ID]: 'zzgame' } } },
        );
        expect(wrapper.find('.plain').element.textContent, where).toBe(name);
        expect(wrapper.find('.said').element.textContent, where).toBe(`Hello ${name}`);
        expect(wrapper.find('.own').element.textContent, where).toBe(`Hello ${name}`);
        expect(wrapper.element.querySelectorAll('*').length, where).toBe(3); // the three spans, and nothing a name smuggled in
        wrapper.unmount();
      } catch (error) {
        if (!String(error.message).includes(where)) error.message = `${where}: ${error.message}`; // a throw says which seed and step, too
        throw error;
      }
    }
  });
});

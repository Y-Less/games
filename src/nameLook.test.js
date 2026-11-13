// What a player's name pill looks like.  A name style and animation are things players pay for, and everybody who sees
// the name sees them, so two things matter: the right look reaches the page (your own from the session at once, the
// shop's previews whatever you own, somebody else's once the site has it), and an id the site does not know is drawn
// plain rather than breaking the name.  The colours are checked against shared/nameStyles.js, where a style is defined.
//
// The ids are also fuzzed (seeded), on their own and through StyledName.vue, which is where the look meets the DOM: the
// name stays text, and only colours from the catalogue are ever bound as CSS.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { NAME_STYLES, nameStyleById } from '../shared/nameStyles.js';
import { pickOne, seeded } from '../shared/random.js';
import StyledName from './components/StyledName.vue';
import { nameLook } from './nameLook.js';
import { clearProfiles } from './profiles.js';
import { session } from './session.js';

const gold = nameStyleById('gold');
const withText = NAME_STYLES.find((style) => style.text);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  clearProfiles();
  session.user = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ players: { 2: { displayName: 'Bob', nameStyle: { style: 'ruby', animation: 'glow' } } } }) })),
  );
});
afterEach(() => {
  clearProfiles();
  session.user = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('nameLook', () => {
  it('is plain and still, with nothing to bind, when nothing is asked for', () => {
    for (const look of [nameLook(), nameLook({}), nameLook({ userId: null })]) {
      expect(look).toEqual({ id: 'plain', animation: 'none', styled: false, css: undefined });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("binds a style's border and fill, and glows in the border's colour", () => {
    const look = nameLook({ styleId: 'gold' });
    expect(look.id).toBe('gold');
    expect(look.styled).toBe(true);
    expect(look.css).toEqual({ '--ns-border': gold.border, '--ns-fill': gold.fill, '--ns-glow': gold.border });
  });

  it('binds a text colour only for a style that has one', () => {
    expect(nameLook({ styleId: withText.id }).css['--ns-text']).toBe(withText.text);
    expect(nameLook({ styleId: 'gold' }).css).not.toHaveProperty('--ns-text');
  });

  it('makes a plain name that has an animation glow in gold', () => {
    const look = nameLook({ animationId: 'glow' });
    expect(look).toMatchObject({ id: 'plain', animation: 'glow', styled: true });
    expect(look.css['--ns-glow']).toBe(gold.border);
  });

  it('draws an unknown style as plain', () => {
    expect(nameLook({ styleId: 'no-such-style' })).toEqual({ id: 'plain', animation: 'none', styled: false, css: undefined });
  });

  it('uses your own chosen look straight from the session, without asking the server', () => {
    session.user = { id: 1, displayName: 'Me', nameStyle: { style: 'gold', animation: 'pulse' } };
    expect(nameLook({ userId: 1 })).toMatchObject({ id: 'gold', animation: 'pulse', styled: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows a particular style or animation whatever the player owns, for the shop's previews", () => {
    session.user = { id: 1, displayName: 'Me', nameStyle: { style: 'gold', animation: 'pulse' } };
    expect(nameLook({ userId: 1, styleId: 'ruby' })).toMatchObject({ id: 'ruby', animation: 'pulse' });
    expect(nameLook({ userId: 1, animationId: 'glow' })).toMatchObject({ id: 'gold', animation: 'glow' });
    expect(nameLook({ userId: 1, styleId: 'plain', animationId: 'none' })).toMatchObject({ id: 'plain', animation: 'none', styled: false });
  });

  it("is plain until another player's look has arrived, and theirs once it has", async () => {
    expect(nameLook({ userId: 2 }).styled).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    await flushPromises();
    expect(nameLook({ userId: 2 })).toMatchObject({ id: 'ruby', animation: 'glow', styled: true });
  });

  it('is plain for a player with no chosen look at all', () => {
    session.user = { id: 1, displayName: 'Me' };
    expect(nameLook({ userId: 1 })).toEqual({ id: 'plain', animation: 'none', styled: false, css: undefined });
  });
});

describe('hostile ids (seeded)', () => {
  const HOSTILE = ['<img src=x onerror=alert(1)>', '"><script>alert(1)</script>', 'red; background: url(x)', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '', ' ', 'GOLD', 'gold ', '\ud800', 'x'.repeat(200), 'none', 'plain', 'gold', 'midnight', 'glow', 'rainbow'];
  const ODD = [null, undefined, 0, 1, -1, 2.5, NaN, true, {}, [], ['gold']];
  const known = new Set(NAME_STYLES.map((style) => style.id));
  const colours = new Set(NAME_STYLES.flatMap((style) => [style.border, style.fill, style.text]).filter(Boolean));

  it('always answers with a style the catalogue has, and binds only its colours', () => {
    const SEED = 2718;
    const rng = seeded(SEED);
    for (let step = 0; step < 500; step++) {
      const any = () => (rng() < 0.7 ? pickOne(HOSTILE, rng) : pickOne(ODD, rng));
      const options = { userId: pickOne([null, 1, '1', 2.5, NaN, '__proto__', {}], rng), styleId: any(), animationId: any() };
      session.user = rng() < 0.5 ? null : { id: 1, nameStyle: pickOne([undefined, null, {}, { style: any(), animation: any() }], rng) };
      const where = `seed ${SEED} step ${step}: ${JSON.stringify({ options, user: session.user })}`;
      let look;
      expect(() => (look = nameLook(options)), where).not.toThrow();
      expect(known.has(look.id), where).toBe(true);
      expect(typeof look.styled, where).toBe('boolean');
      if (look.id !== 'plain') expect(look.styled, where).toBe(true);
      if (!look.styled) expect(look.css, where).toBeUndefined();
      for (const [name, value] of Object.entries(look.css ?? {})) {
        expect(['--ns-border', '--ns-fill', '--ns-glow', '--ns-text'], where).toContain(name);
        expect(colours.has(value), `${where} bound ${name}: ${value}`).toBe(true);
      }
      expect(fetch, where).not.toHaveBeenCalled(); // none of those ids is another player's account id
    }
  });

  it('keeps the name as text on the page, whatever the name and the ids are', () => {
    const SEED = 1618;
    const rng = seeded(SEED);
    for (let step = 0; step < 120; step++) {
      const [name, styleId, animationId] = [pickOne(HOSTILE, rng), pickOne(HOSTILE, rng), pickOne(HOSTILE, rng)];
      const where = `seed ${SEED} step ${step}: ${JSON.stringify({ name, styleId, animationId })}`;
      try {
        const wrapper = mount(StyledName, { props: { name, styleId, animationId } });
        expect(wrapper.element.children.length, where).toBe(0);
        expect(wrapper.element.textContent, where).toBe(name);
        expect(known.has(wrapper.attributes('data-name-style')), where).toBe(true);
        wrapper.unmount();
      } catch (error) {
        if (!String(error.message).includes(where)) error.message = `${where}: ${error.message}`; // a throw says which seed and step, too
        throw error;
      }
    }
  });
});

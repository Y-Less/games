// How a user's choices reach the page: the background, the card back, whether animations play, and the theme and font
// variables.  session.test.js already covers the ordinary background and card-back settings on the way through signing
// in; this file protects the rest of appearance.js: an avatar as a CSS image, the avatar card back, the animations
// choice against the device's own setting, and `applyUserLook` putting all of it on the document at once.
//
// A user's settings are stored on the server and come back to every page, so they are also fuzzed (seeded): whatever
// shape they have, the page gets *a* look (the documented fall-backs) and nothing throws while the session loads.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AVATAR } from '../shared/avatar.js';
import { pickOne, seeded } from '../shared/random.js';
import { SITE_FONTS, SITE_THEMES, siteVariables } from '../shared/siteThemes.js';
import { animationsPlaying, applyUserLook, avatarImage, backgroundCss, cardBackCss } from './appearance.js';
import { session } from './sessionState.js';

const PRESETS = { night: 'night-image', dawn: 'dawn-image' };
const BACKS = { crimson: 'crimson-back', navy: 'navy-back' };
const root = document.documentElement;

beforeEach(() => {
  Object.assign(session, { user: null, presets: PRESETS, cardBacks: BACKS });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(session, { user: null, presets: {}, cardBacks: {} });
  root.removeAttribute('style');
  delete root.dataset.animations;
});

/** The SVG document inside a `url("data:image/svg+xml,...")` value, parsed.  @returns {Document} */
function svgOf(image) {
  const match = image.match(/^url\("data:image\/svg\+xml,([^"]*)"\)$/);
  expect(match, `not a quoted SVG data URL: ${image.slice(0, 60)}`).not.toBeNull();
  return new DOMParser().parseFromString(decodeURIComponent(match[1]), 'image/svg+xml');
}
/** Markup with the per-drawing gradient and clip ids taken out, so that two drawings of one avatar can be compared. */
const withoutIds = (svg) => new XMLSerializer().serializeToString(svg).replace(/avatar-(gradient|hairline)-\d+/g, 'avatar-id');

describe('avatarImage()', () => {
  it('is an SVG document inlined as a CSS image, the same square the avatar is drawn in', () => {
    const svg = svgOf(avatarImage(DEFAULT_AVATAR));
    expect(svg.querySelector('parsererror')).toBeNull();
    expect(svg.documentElement.localName).toBe('svg');
    expect(svg.documentElement.getAttribute('viewBox')).toBe('0 0 100 100');
    expect(svg.documentElement.children.length).toBeGreaterThan(0);
  });

  it('draws the default avatar when given none', () => {
    expect(withoutIds(svgOf(avatarImage(null)))).toBe(withoutIds(svgOf(avatarImage(DEFAULT_AVATAR))));
  });

  it('draws the avatar it is given: a different choice is a different picture', () => {
    const other = { ...DEFAULT_AVATAR, hat: 'crown' };
    expect(withoutIds(svgOf(avatarImage(other)))).not.toBe(withoutIds(svgOf(avatarImage(DEFAULT_AVATAR))));
  });
});

describe('cardBackCss() with an avatar card back', () => {
  it('draws the avatar it is given, covering the card', () => {
    const avatar = { ...DEFAULT_AVATAR, hat: 'crown' };
    const css = cardBackCss({ type: 'avatar' }, BACKS, avatar);
    const image = css.match(/^url\("[^"]*"\)/)?.[0];
    expect(withoutIds(svgOf(image))).toBe(withoutIds(svgOf(avatarImage(avatar))));
    expect(css).toContain('cover');
  });

  it("draws the signed-in user's own avatar when given none, and the default one for a user without", () => {
    const avatar = { ...DEFAULT_AVATAR, hat: 'crown' };
    session.user = { id: 1, avatar };
    const image = (css) => css.match(/^url\("[^"]*"\)/)?.[0];
    expect(withoutIds(svgOf(image(cardBackCss({ type: 'avatar' }))))).toBe(withoutIds(svgOf(avatarImage(avatar))));
    session.user = null;
    expect(withoutIds(svgOf(image(cardBackCss({ type: 'avatar' }))))).toBe(withoutIds(svgOf(avatarImage(null))));
  });
});

describe('animationsPlaying()', () => {
  /** Makes the device say whether it wants less motion. */
  const device = (reduced) => vi.stubGlobal('matchMedia', (query) => ({ matches: reduced && query === '(prefers-reduced-motion: reduce)' }));

  it("follows the user's own choice, whatever the device says", () => {
    device(true);
    expect(animationsPlaying({ playAnimations: true })).toBe(true);
    device(false);
    expect(animationsPlaying({ playAnimations: false })).toBe(false);
  });

  it("follows the device's motion setting when the user has made no choice, or nobody is signed in", () => {
    device(true);
    expect(animationsPlaying({ playAnimations: null })).toBe(false);
    expect(animationsPlaying({})).toBe(false);
    expect(animationsPlaying(null)).toBe(false);
    device(false);
    expect(animationsPlaying({})).toBe(true);
    expect(animationsPlaying(null)).toBe(true);
  });

  it('reads the signed-in user when given nobody in particular', () => {
    device(false);
    session.user = { id: 1, playAnimations: false };
    expect(animationsPlaying()).toBe(false);
    session.user = { id: 1, playAnimations: true };
    expect(animationsPlaying()).toBe(true);
  });
});

describe('applyUserLook()', () => {
  const variable = (name) => root.style.getPropertyValue(name);
  /** Whether the document carries every variable of this theme and font. */
  const wears = (theme, font) => Object.entries(siteVariables(theme, font)).every(([name, value]) => variable(name) === value);

  it("puts the user's background, card back, theme, and font on the document", () => {
    const theme = SITE_THEMES.at(-1).id;
    const font = SITE_FONTS.at(-1).id;
    applyUserLook({ background: { type: 'preset', value: 'dawn' }, cardBack: { type: 'preset', value: 'navy' }, siteTheme: theme, siteFont: font });
    expect(variable('--site-bg')).toBe('dawn-image');
    expect(variable('--card-back')).toBe('navy-back');
    expect(wears(theme, font)).toBe(true);
  });

  it('gives nobody the signed-out look: the night sky, the crimson back, and the default theme and font', () => {
    applyUserLook({ background: { type: 'preset', value: 'dawn' }, cardBack: { type: 'preset', value: 'navy' }, siteTheme: SITE_THEMES.at(-1).id, siteFont: SITE_FONTS.at(-1).id });
    applyUserLook(null);
    expect(variable('--site-bg')).toBe('night-image');
    expect(variable('--card-back')).toBe('crimson-back');
    expect(wears(SITE_THEMES[0].id, SITE_FONTS[0].id)).toBe(true);
    expect(root.dataset.animations).toBe('auto');
  });

  it('marks the document with the animations choice: always, never, or follow the device', () => {
    applyUserLook({ playAnimations: true });
    expect(root.dataset.animations).toBe('on');
    applyUserLook({ playAnimations: false });
    expect(root.dataset.animations).toBe('off');
    applyUserLook({ playAnimations: null });
    expect(root.dataset.animations).toBe('auto');
    applyUserLook({});
    expect(root.dataset.animations).toBe('auto');
  });
});

describe('hostile settings (seeded)', () => {
  const TEXT = ['', 'night', 'dawn', 'crimson', 'navy', 'nope', '<img src=x onerror=alert(1)>', '"); background: url(x', 'red; } body { display: none', 'a b.png', '../../etc/passwd', '%', '%zz', 'имя.png', 'x'.repeat(300)];
  const ODD = [null, undefined, 0, 1, -1, 2.5, true, false, [], {}, ['night'], { type: 'preset' }];
  const TYPES = ['preset', 'colour', 'gradient', 'image', 'avatar', 'nope', '', null, undefined, 7];

  /** A setting of any shape: sometimes not an object at all. */
  function setting(rng) {
    if (rng() < 0.1) return pickOne([...ODD, ...TEXT], rng);
    const any = () => (rng() < 0.75 ? pickOne(TEXT, rng) : pickOne(ODD, rng));
    return { type: pickOne(TYPES, rng), value: any(), file: pickOne(TEXT, rng), angle: any(), from: any(), to: any() };
  }

  it('always gives the page some background and some card back, and never throws', () => {
    const SEED = 31337;
    const rng = seeded(SEED);
    for (let step = 0; step < 500; step++) {
      const [background, cardBack] = [setting(rng), setting(rng)];
      const where = `seed ${SEED} step ${step}: ${JSON.stringify({ background, cardBack })}`;
      let css;
      expect(() => (css = [backgroundCss(background), cardBackCss(cardBack), cardBackCss(cardBack, BACKS, setting(rng))]), where).not.toThrow();
      for (const value of css) expect(typeof value, where).toBe('string');
      // Anything that is not one of the kinds of background there are is the default night sky.
      if (!['preset', 'colour', 'gradient', 'image'].includes(background?.type)) expect(css[0], where).toBe('night-image');
      // A preset is one of the presets, or the default: never something the setting itself supplied.
      if (background?.type === 'preset') expect(Object.values(PRESETS), where).toContain(css[0]);
      if (!['image', 'avatar'].includes(cardBack?.type)) expect(Object.values(BACKS), where).toContain(css[1]);
    }
  });

  it('dresses the document for any user at all: a known theme, a known font, and a known animations mark', () => {
    const SEED = 808;
    const rng = seeded(SEED);
    const themes = SITE_THEMES.map((theme) => siteVariables(theme.id, undefined)['--bg']);
    const fonts = SITE_FONTS.map((font) => siteVariables(undefined, font.id)['--body']);
    for (let step = 0; step < 300; step++) {
      const any = () => pickOne([...TEXT, ...ODD, SITE_THEMES.at(-1).id, SITE_FONTS.at(-1).id], rng);
      const user = rng() < 0.05 ? pickOne([null, undefined], rng) : { background: setting(rng), cardBack: setting(rng), siteTheme: any(), siteFont: any(), playAnimations: any(), avatar: setting(rng) };
      const where = `seed ${SEED} step ${step}: ${JSON.stringify(user)}`;
      expect(() => applyUserLook(user), where).not.toThrow();
      expect(themes, where).toContain(root.style.getPropertyValue('--bg'));
      expect(fonts, where).toContain(root.style.getPropertyValue('--body'));
      expect(['on', 'off', 'auto'], where).toContain(root.dataset.animations);
      expect(document.body.children.length, where).toBe(0); // a look is variables on the document, never markup in it
    }
  });
});
